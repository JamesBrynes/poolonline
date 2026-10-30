// ============================================================================
//  台球物理引擎（纯 JS，无依赖，确定性）
//  - 坐标系：x = 球台长边方向，y = 短边方向，z = 竖直向上；原点在台面中心；单位 米 / 秒
//  - 只用 + - * / 和 Math.sqrt（IEEE 精确），不用 sin/cos/exp，
//    保证同样的输入在任何浏览器 / Node 服务器上算出完全一样的结果 —— 联机同步靠这个。
//  - 运动模型：滑动(摩擦使母球从滑动过渡到纯滚动) / 滚动(滚动阻力) / 原地旋转(侧旋衰减)
//  - 碰撞：球-球(带摩擦 → 切球投掷效应 / 塞的传递)，球-库边(库边接触点高于球心 → 塞改变反弹角)
// ============================================================================

// 球的尺寸随球台切换（setTable），用 let 导出 → 其它模块读到的是实时值
export let R = 0.028575;              // 球半径（中式八球 57.15mm / 斯诺克 52.5mm）
export let M = 0.17;                  // 球质量 kg
export let I = 0.4 * M * R * R;       // 实心球转动惯量
const G = 9.81;

export const PHYS = {
  muSlide: 0.2,        // 球-台呢 滑动摩擦
  muRoll: 0.014,       // 滚动阻力
  spinDecel: 8.5,      // 竖直轴侧旋衰减 rad/s²
  eBall: 0.95,         // 球-球 恢复系数
  muCushion: 0.14,     // 球-库边 摩擦
  cushionSin: 0.27,    // 库边接触点高于球心：sinθ = (h - R)/R，h ≈ 0.635 × 球直径
  squirt: 0.035,       // 加塞造成的母球偏移系数
};
let CUSH_COS = Math.sqrt(1 - PHYS.cushionSin * PHYS.cushionSin);

// ---------------------------------------------------------------------------
//  球台规格
// ---------------------------------------------------------------------------
export const TABLE_SPECS = {
  // 中式黑八台：有效台面 2540 × 1270 mm，球 57.15mm
  pool: {
    kind: 'pool', HL: 1.27, HW: 0.635, ballR: 0.028575, ballM: 0.17,
    MC: 0.106, MS: 0.124, CW: 0.05, railW: 0.13, rfC: 0.028, rfS: 0.026, holeR: 0.058,
    noseH: 0.0363,                         // 库边鼻尖高度 = 球直径 63.5%
    cushionE: 1,                           // 库边回弹倍数
    jawE: 0.8, jawT: 0.9,                  // 袋角（晃袋）额外吸能：法向 / 切向保留比例
  },
  // 斯诺克 12 尺台（WPBSA）：有效台面 3569 × 1778 mm，球 52.5mm
  // 开球线距底库 737mm，D 半径 292mm，黑球点距顶库 324mm
  // 袋口：官方模板约 3.3 寸（84mm），这里角袋 116mm（喉部≥1.9 球）/ 中袋 122mm 放宽
  snooker: {
    kind: 'snooker', HL: 1.7845, HW: 0.889, ballR: 0.02625, ballM: 0.142,
    MC: 0.116, MS: 0.122, CW: 0.05, railW: 0.15, rfC: 0.040, rfS: 0.036, holeR: 0.052,
    noseH: 0.0365,
    cushionE: 0.4,                         // 库边回弹倍数（比八球台软得多）
    jawE: 0.7, jawT: 0.85,                 // 袋角（晃袋）额外吸能
    baulk: 0.737, dR: 0.292, blackFromTop: 0.324,
  },
};

export const TABLE = {};
export function setTable(kind) {
  const spec = TABLE_SPECS[kind];
  R = spec.ballR; M = spec.ballM; I = 0.4 * M * R * R;
  PHYS.cushionSin = (spec.noseH - R) / R;
  CUSH_COS = Math.sqrt(1 - PHYS.cushionSin * PHYS.cushionSin);
  for (const k of Object.keys(TABLE)) delete TABLE[k];
  Object.assign(TABLE, buildTable(spec));
  return TABLE;
}

function buildTable(spec) {
  const { HL, HW, MC, MS, CW } = spec;
  // 圆弧袋角：库边鼻尖先走一段圆弧，再接直的袋角
  // cos/sin 都预先写成常数，只用加减乘除和开方 → 各端结果完全一致
  const JAW = {
    corner: { cos: 0.788011, sin: 0.615661, rf: spec.rfC, steps: 6, dc: 0.993897, ds: 0.110301 },   // 142°，每步 6.333°
    side:   { cos: 0.241922, sin: 0.970296, rf: spec.rfS, steps: 8, dc: 0.986286, ds: 0.165048 },   // 104°，每步 9.5°
  };

  // 局部坐标里的一端：鼻尖 X 沿 -x 方向通向袋口，球在 +y 一侧
  function endPoly(X, j, jawLen) {
    const pts = [[X, 0]];
    const cxp = X, cyp = -j.rf;                         // 圆弧圆心（在库边里面）
    let c = 1, sn = 0;
    for (let k = 1; k <= j.steps; k++) {
      const c2 = c * j.dc - sn * j.ds; sn = sn * j.dc + c * j.ds; c = c2;
      pts.push([cxp - j.rf * sn, cyp + j.rf * c]);       // C + rf(n cosφ + t sinφ)，t = (-1,0)，n = (0,1)
    }
    const [lx, ly] = pts[pts.length - 1];
    pts.push([lx - j.cos * jawLen, ly - j.sin * jawLen]);
    return pts;
  }
  // 角袋：沿对角线对称，袋口宽 = 2 × 到对角线的最小距离
  const cornerMouth = (c) => {
    let m = Infinity;
    for (const [u, v] of endPoly(c, JAW.corner, 0)) m = Math.min(m, (u - v) / Math.SQRT2);
    return 2 * m;
  };
  const sideMouth = (h) => {
    let m = Infinity;
    for (const [u] of endPoly(h, JAW.side, 0)) m = Math.min(m, u);
    return 2 * m;
  };
  const solve = (f, target) => { let lo = 0.0, hi = 0.3; for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (f(mid) < target) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const c = solve(cornerMouth, MC);       // 角袋鼻尖离台角的距离
  const hs = solve(sideMouth, MS);        // 中袋鼻尖离中点的距离

  // 落袋判定圆：边缘在袋口最窄处后面一点
  const HOLE_R = spec.holeR;
  const cornerPolyRaw = endPoly(c, JAW.corner, 0);
  let cm = Infinity; for (const [u, v] of cornerPolyRaw) cm = Math.min(cm, (u + v) / Math.SQRT2);
  const cornerHoleD = cm - 0.016 - HOLE_R;                 // 沿对角线（局部）
  const sidePolyRaw = endPoly(hs, JAW.side, 0);
  let sm = Infinity; for (const [, v] of sidePolyRaw) sm = Math.min(sm, v);
  const sideHoleY = sm - 0.008 - HOLE_R;
  // 袋角一直延伸到落袋圆里面
  const lenInto = (poly, hx, hy, j) => {
    const [lx, ly] = poly[poly.length - 1];
    for (let L = 0.005; L < 0.2; L += 0.002) {
      const x = lx - j.cos * L, y = ly - j.sin * L;
      if ((x - hx) ** 2 + (y - hy) ** 2 < (HOLE_R - 0.006) ** 2) return L;
    }
    return 0.06;
  };
  const chx = cornerHoleD / Math.SQRT2;
  const cornerPoly = endPoly(c, JAW.corner, lenInto(cornerPolyRaw, chx, chx, JAW.corner));
  const sidePoly = endPoly(hs, JAW.side, lenInto(sidePolyRaw, 0, sideHoleY, JAW.side));

  // 局部 → 全局
  const mapC = (sx, sy, swap) => ([u, v]) => (swap ? [sx * (HL - v), sy * (HW - u)] : [sx * (HL - u), sy * (HW - v)]);
  const mapS = (sy, mx) => ([u, v]) => [mx * u, sy * (HW - v)];
  const rails = [
    { A: cornerPoly.map(mapC(-1, -1, false)), B: sidePoly.map(mapS(-1, -1)), n: [0, 1] },
    { A: sidePoly.map(mapS(-1, 1)), B: cornerPoly.map(mapC(1, -1, false)), n: [0, 1] },
    { A: cornerPoly.map(mapC(-1, 1, false)), B: sidePoly.map(mapS(1, -1)), n: [0, -1] },
    { A: sidePoly.map(mapS(1, 1)), B: cornerPoly.map(mapC(1, 1, false)), n: [0, -1] },
    { A: cornerPoly.map(mapC(-1, -1, true)), B: cornerPoly.map(mapC(-1, 1, true)), n: [1, 0] },
    { A: cornerPoly.map(mapC(1, -1, true)), B: cornerPoly.map(mapC(1, 1, true)), n: [-1, 0] },
  ];

  const segments = [];
  const pointMap = new Map();
  const cushions = [];
  const addPoint = (x, y) => pointMap.set(x.toFixed(6) + ',' + y.toFixed(6), { x, y });
  for (const r of rails) {
    const line = [...r.A].reverse().concat(r.B);       // 袋角 → 圆弧 → 鼻尖 …… 鼻尖 → 圆弧 → 袋角
    const [nx, ny] = r.n;
    const a0 = r.A[0], b0 = r.B[0];
    const tdx = b0[0] - a0[0], tdy = b0[1] - a0[1];
    const sign = (-tdy * nx + tdx * ny) >= 0 ? 1 : -1;  // 左法线是否朝台内
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i], [bx, by] = line[i + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) continue;
      const nose = (line[i] === a0 && line[i + 1] === b0);
      segments.push({ ax, ay, bx, by, tx: dx / len, ty: dy / len, len, nx: (-dy / len) * sign, ny: (dx / len) * sign, jaw: !nose });
      addPoint(ax, ay); addPoint(bx, by);
    }
    // 渲染用多边形：前面这条线 + 背面
    const depth = (P) => (P[0] - a0[0]) * -nx + (P[1] - a0[1]) * -ny;
    const back = (P) => {
      const d = Math.max(CW, depth(P) + 0.004) - depth(P);
      return [P[0] - nx * d, P[1] - ny * d];
    };
    cushions.push({ poly: [...line, back(line[line.length - 1]), back(line[0])], n: r.n, line, sign });
  }

  const pockets = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1])
    pockets.push({ x: sx * (HL - chx), y: sy * (HW - chx), r: HOLE_R, kind: 'corner', sx, sy });
  for (const sy of [-1, 1])
    pockets.push({ x: 0, y: sy * (HW - sideHoleY), r: HOLE_R, kind: 'side', sx: 0, sy });

  const out = {
    kind: spec.kind, spec, HL, HW, CW, MC, MS, railW: spec.railW, noseH: spec.noseH,
    headX: -HL / 2,        // 开球线（八球）
    footX: HL / 2,         // 置球点（八球）
    segments, points: [...pointMap.values()], pockets, cushions,
  };
  if (spec.kind === 'snooker') {
    const baulkX = -HL + spec.baulk;
    out.baulkX = baulkX; out.dR = spec.dR;
    // 视线从开球端看向顶库：右手边是 -y
    out.spots = {
      yellow: [baulkX, -spec.dR], green: [baulkX, spec.dR], brown: [baulkX, 0],
      blue: [0, 0], pink: [HL / 2, 0], black: [HL - spec.blackFromTop, 0],
    };
  }
  return out;
}
setTable('pool');

// ---------------------------------------------------------------------------
//  球
// ---------------------------------------------------------------------------
export function makeBall(id, x, y) {
  return { id, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, on: true, pocket: -1 };
}

export function isBallMoving(b) {
  return b.on && (b.vx !== 0 || b.vy !== 0 || b.wx !== 0 || b.wy !== 0 || b.wz !== 0);
}

// 出杆
//   dx,dy  水平瞄准方向（单位向量）
//   speed  杆给球的速度 m/s
//   a      左右塞（右为正），b 高低杆（高为正），单位 R，范围约 ±0.55
//   squirt 球杆的偏移系数（碳纤维小、大头杆大）
//   ce,se  球杆仰角的 cos / sin（由出杆方算好一起发送，保证各端结果一致；不传 = 水平出杆）
// 球杆方向 c = (dx·ce, dy·ce, -se)（从杆尾指向球、向下）；击球点 r = R(a·s + b·u - k·c)
// 冲量沿 c → 线速度取水平分量（竖直分量被台面吃掉，不模拟跳球）；
// 角速度 ω = r×J/I = 2.5·V/R·(a·u - b·s) —— 抬杆 + 侧塞 会产生水平旋转轴，台面摩擦让母球走弧线（扎杆）
export function strike(ball, { dx, dy, speed, a, b, ce = 1, se = 0, squirt = PHYS.squirt }) {
  const sx = dy, sy = -dx;                       // 右手方向 s（水平）
  const ux = dx * se, uy = dy * se, uz = ce;     // u = s × c（垂直于杆的"上"方向）
  // 加塞偏移（squirt）：右塞母球向左偏一点
  let mx = dx - squirt * a * sx, my = dy - squirt * a * sy;
  const ml = Math.sqrt(mx * mx + my * my);
  mx /= ml; my /= ml;
  const vh = speed * ce;
  ball.vx = vh * mx; ball.vy = vh * my;
  const k = 2.5 * speed / R;
  ball.wx = k * (a * ux - b * sx);
  ball.wy = k * (a * uy - b * sy);
  ball.wz = k * (a * uz);
}

// ---------------------------------------------------------------------------
//  碰撞时间（TOI）—— 在一个子步内认为匀速直线
// ---------------------------------------------------------------------------
function toiCircle(px, py, vx, vy, cx, cy, rad, maxT) {
  const dx = px - cx, dy = py - cy;
  const b = dx * vx + dy * vy;
  if (b >= 0) return -1;                         // 正在远离
  const c = dx * dx + dy * dy - rad * rad;
  if (c <= 0) return 0;                          // 已接触且接近
  const a = vx * vx + vy * vy;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= maxT ? t : -1;
}

function toiSegment(px, py, vx, vy, s, maxT) {
  const vn = vx * s.nx + vy * s.ny;
  if (vn >= -1e-12) return -1;
  const d = (px - s.ax) * s.nx + (py - s.ay) * s.ny;
  let t;
  if (d <= R) {
    if (d < R - 0.012) return -1;                // 在库边背后，不算
    t = 0;
  } else {
    t = (d - R) / -vn;
    if (t > maxT) return -1;
  }
  const qx = px + vx * t - s.ax, qy = py + vy * t - s.ay;
  const u = qx * s.tx + qy * s.ty;
  if (u < 0 || u > s.len) return -1;
  return t;
}

// 供辅助线使用：从 (px,py) 沿单位方向 (dx,dy) 扫一个半径 R 的圆，返回最先碰到的东西
export function castBall(px, py, dx, dy, balls, ignoreId, maxDist = 6) {
  let best = { t: maxDist, type: 'none' };
  for (const o of balls) {
    if (!o.on || o.id === ignoreId) continue;
    const t = toiCircle(px, py, dx, dy, o.x, o.y, 2 * R, best.t);
    if (t >= 0 && t < best.t) best = { t, type: 'ball', ball: o };
  }
  for (const s of TABLE.segments) {
    const t = toiSegment(px, py, dx, dy, s, best.t);
    if (t >= 0 && t < best.t) best = { t, type: 'cushion', nx: s.nx, ny: s.ny };
  }
  for (const p of TABLE.points) {
    const t = toiCircle(px, py, dx, dy, p.x, p.y, R, best.t);
    if (t >= 0 && t < best.t) {
      const cx = px + dx * t - p.x, cy = py + dy * t - p.y, l = Math.sqrt(cx * cx + cy * cy) || 1;
      best = { t, type: 'cushion', nx: cx / l, ny: cy / l };
    }
  }
  // 是否会先进袋（母球路径经过袋口）
  for (let i = 0; i < TABLE.pockets.length; i++) {
    const pk = TABLE.pockets[i];
    const t = toiCircle(px, py, dx, dy, pk.x, pk.y, pk.r, best.t);
    if (t > 0 && t < best.t) best = { t, type: 'pocket', pocket: i };
  }
  best.x = px + dx * best.t; best.y = py + dy * best.t;
  return best;
}

// ---------------------------------------------------------------------------
//  碰撞响应
// ---------------------------------------------------------------------------
function resolveBallBall(b1, b2) {
  let nx = b2.x - b1.x, ny = b2.y - b1.y;
  const l = Math.sqrt(nx * nx + ny * ny);
  nx /= l; ny /= l;
  // 接触点相对速度（接触点在赤道上：r1 = R n, r2 = -R n）
  // ω × (R n) = R(-wz ny, wz nx, wx ny - wy nx)
  const c1x = b1.vx - R * b1.wz * ny, c1y = b1.vy + R * b1.wz * nx, c1z = R * (b1.wx * ny - b1.wy * nx);
  const c2x = b2.vx + R * b2.wz * ny, c2y = b2.vy - R * b2.wz * nx, c2z = -R * (b2.wx * ny - b2.wy * nx);
  const rx = c1x - c2x, ry = c1y - c2y, rz = c1z - c2z;
  const vn = rx * nx + ry * ny;
  if (vn <= 0) return 0;
  const Jn = (1 + PHYS.eBall) * vn * M / 2;
  // 切向滑移 → 摩擦（投掷效应）
  const sx = rx - vn * nx, sy = ry - vn * ny, sz = rz;
  const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
  let Px = Jn * nx, Py = Jn * ny, Pz = 0;       // 作用在 b2 上的冲量
  let fx = 0, fy = 0, fz = 0;
  if (sl > 1e-9) {
    // 摩擦系数随滑移速度变化（Alciatore 实测曲线的有理近似）
    const mu = 0.00995 + 0.108 / (1 + 1.088 * sl + 0.59 * sl * sl);
    const Jt = Math.min(mu * Jn, M * sl / 7);
    fx = Jt * sx / sl; fy = Jt * sy / sl; fz = Jt * sz / sl;   // b2 受到 +f，b1 受到 -f
    Px += fx; Py += fy; Pz += fz;
  }
  b1.vx -= Px / M; b1.vy -= Py / M;
  b2.vx += Px / M; b2.vy += Py / M;
  // 角速度：Δω = r × F / I ；b1: r = R n, F = -f ；b2: r = -R n, F = +f  → 两者相同
  const k = R / I;
  const tx = ny * fz, ty = -nx * fz, tz = nx * fy - ny * fx;   // n × f
  b1.wx -= k * tx; b1.wy -= k * ty; b1.wz -= k * tz;
  b2.wx -= k * tx; b2.wy -= k * ty; b2.wz -= k * tz;
  return vn;
}

function resolveCushion(b, nx, ny, jaw = false) {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  const sp = -vn;
  // 库边恢复系数：中速约 0.75、越快越低（实测有效 COR 多在 0.6~0.8；
  // 好球台用力打一杆来回约 5 个台长）
  let e = 0.75 - 0.03 * sp;
  if (e < 0.5) e = 0.5;
  e *= TABLE.spec.cushionE;
  if (jaw) e *= TABLE.spec.jawE;
  const Jn = (1 + e) * sp * M;
  const sn = PHYS.cushionSin, cs = CUSH_COS;
  // 接触点（相对球心）：朝库边方向、略高于球心
  const rx = -R * cs * nx, ry = -R * cs * ny, rz = R * sn;
  // 接触点速度 v + ω × r
  const cx = b.vx + (b.wy * rz - b.wz * ry);
  const cy = b.vy + (b.wz * rx - b.wx * rz);
  const cz = (b.wx * ry - b.wy * rx);
  const Nx = nx * cs, Ny = ny * cs, Nz = -sn;
  const cn = cx * Nx + cy * Ny + cz * Nz;
  const sx = cx - cn * Nx, sy = cy - cn * Ny, sz = cz - cn * Nz;
  const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
  let Px = Jn * nx, Py = Jn * ny, Pz = 0;
  if (sl > 1e-9) {
    const Jt = Math.min(PHYS.muCushion * Jn, M * sl / 3.5);
    Px -= Jt * sx / sl; Py -= Jt * sy / sl; Pz -= Jt * sz / sl;
  }
  b.vx += Px / M; b.vy += Py / M;
  b.wx += (ry * Pz - rz * Py) / I;
  b.wy += (rz * Px - rx * Pz) / I;
  b.wz += (rx * Py - ry * Px) / I;
  if (jaw) {
    // 袋角有弧度、包着台呢，球擦着袋角滑过时会损失更多速度（晃袋很快就停下来）
    const vn2 = b.vx * nx + b.vy * ny;
    const tx = b.vx - vn2 * nx, ty = b.vy - vn2 * ny;
    const k = TABLE.spec.jawT;
    b.vx = vn2 * nx + tx * k; b.vy = vn2 * ny + ty * k;
    b.wz *= k;
  }
  return sp;
}

// ---------------------------------------------------------------------------
//  台呢摩擦（解析积分，单步内精确）
// ---------------------------------------------------------------------------
function applyCloth(b, dt) {
  // 侧旋衰减
  if (b.wz !== 0) {
    const d = PHYS.spinDecel * dt;
    if (b.wz > d) b.wz -= d; else if (b.wz < -d) b.wz += d; else b.wz = 0;
  }
  let ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;
  let us = Math.sqrt(ux * ux + uy * uy);
  let rem = dt;
  if (us > 1e-6) {
    const mg = PHYS.muSlide * G;
    const tSlip = us / (3.5 * mg);
    const t = tSlip < rem ? tSlip : rem;
    const ex = ux / us, ey = uy / us;
    b.vx -= mg * t * ex; b.vy -= mg * t * ey;
    const k = 2.5 * mg / R * t;
    b.wx += -k * ey; b.wy += k * ex;
    rem -= t;
    if (tSlip > dt) return;
  }
  // 纯滚动
  const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  const dv = PHYS.muRoll * G * rem;
  if (v <= dv || v < 1e-4) { b.vx = 0; b.vy = 0; }
  else { const s = (v - dv) / v; b.vx *= s; b.vy *= s; }
  b.wx = -b.vy / R; b.wy = b.vx / R;
  if (b.vx === 0 && b.vy === 0 && Math.abs(b.wz) < 0.05) b.wz = 0;
}

// ---------------------------------------------------------------------------
//  模拟器
// ---------------------------------------------------------------------------
export const DT = 1 / 1000;

export class Sim {
  constructor(balls) {
    this.balls = balls;
    this.time = 0;
    this.events = [];   // {t, type:'ball'|'cushion'|'pocket', a, b, speed, pocket}
  }

  moving() { return this.balls.some(isBallMoving); }

  _advance(t) {
    if (t <= 0) return;
    for (const b of this.balls) if (b.on) { b.x += b.vx * t; b.y += b.vy * t; }
    this.time += t;
  }

  _checkPockets() {
    for (const b of this.balls) {
      if (!b.on) continue;
      let hit = -1;
      for (let i = 0; i < TABLE.pockets.length; i++) {
        const p = TABLE.pockets[i];
        const dx = b.x - p.x, dy = b.y - p.y;
        if (dx * dx + dy * dy < p.r * p.r) { hit = i; break; }
      }
      // 保险：飞出台面
      if (hit < 0 && (Math.abs(b.x) > TABLE.HL + 0.08 || Math.abs(b.y) > TABLE.HW + 0.08)) {
        let bd = Infinity;
        TABLE.pockets.forEach((p, i) => { const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2; if (d < bd) { bd = d; hit = i; } });
      }
      if (hit >= 0) {
        b.on = false; b.pocket = hit;
        this.events.push({ t: this.time, type: 'pocket', a: b.id, pocket: hit, speed: Math.sqrt(b.vx * b.vx + b.vy * b.vy), x: b.x, y: b.y, vx: b.vx, vy: b.vy });
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      }
    }
  }

  step(dt = DT) {
    const balls = this.balls;
    let rem = dt, iter = 0;
    while (rem > 0 && iter < 200) {
      let best = rem, ev = null;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (!b.on) continue;
        const mov = b.vx !== 0 || b.vy !== 0;
        for (let j = i + 1; j < balls.length; j++) {
          const o = balls[j];
          if (!o.on) continue;
          if (!mov && o.vx === 0 && o.vy === 0) continue;
          const t = toiCircle(b.x, b.y, b.vx - o.vx, b.vy - o.vy, o.x, o.y, 2 * R, best);
          if (t >= 0 && (t < best || (ev === null && t <= best))) { best = t; ev = { k: 0, b, o }; }
        }
        if (!mov) continue;
        // 粗筛：球离所有库边都还远（这一步内够不着），就跳过库边检测 —— 结果不变，省很多计算
        const reach = R + (Math.abs(b.vx) + Math.abs(b.vy)) * rem + 0.002;
        if (Math.abs(b.x) < TABLE.HL - reach && Math.abs(b.y) < TABLE.HW - reach) continue;
        for (const s of TABLE.segments) {
          const t = toiSegment(b.x, b.y, b.vx, b.vy, s, best);
          if (t >= 0 && (t < best || (ev === null && t <= best))) { best = t; ev = { k: 1, b, nx: s.nx, ny: s.ny, jaw: s.jaw }; }
        }
        for (const p of TABLE.points) {
          const t = toiCircle(b.x, b.y, b.vx, b.vy, p.x, p.y, R, best);
          if (t >= 0 && (t < best || (ev === null && t <= best))) { best = t; ev = { k: 2, b, p }; }
        }
      }
      if (!ev) { this._advance(rem); rem = 0; break; }
      this._advance(best);
      rem -= best;
      iter++;
      if (ev.k === 0) {
        const sp = resolveBallBall(ev.b, ev.o);
        if (sp > 0) this.events.push({ t: this.time, type: 'ball', a: ev.b.id, b: ev.o.id, speed: sp, x: (ev.b.x + ev.o.x) / 2, y: (ev.b.y + ev.o.y) / 2 });
      } else {
        let nx = ev.nx, ny = ev.ny;
        if (ev.k === 2) {
          nx = ev.b.x - ev.p.x; ny = ev.b.y - ev.p.y;
          const l = Math.sqrt(nx * nx + ny * ny) || 1; nx /= l; ny /= l;
        }
        const sp = resolveCushion(ev.b, nx, ny, ev.k === 2 || !!ev.jaw);
        if (sp > 0) this.events.push({ t: this.time, type: 'cushion', a: ev.b.id, speed: sp, x: ev.b.x, y: ev.b.y, jaw: ev.k === 2 || !!ev.jaw });
      }
    }
    if (rem > 0) this._advance(rem);
    this._checkPockets();
    for (const b of balls) if (b.on) applyCloth(b, dt);
  }
}

// ---------------------------------------------------------------------------
//  摆球（确定性随机，联机时由房主下发 seed）
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rackBalls(seed = 1) {
  const rnd = mulberry32(seed);
  const gap = 0.0002;
  const d = 2 * R + gap;
  const rowDx = d * 0.8660254037844386;
  // 位置：5 行三角形，顶点在置球点，朝向开球方向
  const spots = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j <= i; j++)
    spots.push({ x: TABLE.footX + i * rowDx + (rnd() - 0.5) * 0.0003, y: (j - i / 2) * d + (rnd() - 0.5) * 0.0003, i, j });
  // 8 号在第 3 行中间；底角一实一花
  const solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [arr[i], arr[k]] = [arr[k], arr[i]]; } return arr; };
  shuffle(solids); shuffle(stripes);
  const order = new Array(15).fill(0);
  const idx = (i, j) => spots.findIndex(s => s.i === i && s.j === j);
  order[idx(2, 1)] = 8;
  const leftSolid = rnd() < 0.5;
  order[idx(4, 0)] = leftSolid ? solids.pop() : stripes.pop();
  order[idx(4, 4)] = leftSolid ? stripes.pop() : solids.pop();
  const rest = shuffle([...solids, ...stripes]);
  for (let k = 0; k < 15; k++) if (!order[k]) order[k] = rest.pop();
  const balls = [makeBall(0, TABLE.headX - 0.05, 0)];
  spots.forEach((s, k) => balls.push(makeBall(order[k], s.x, s.y)));
  balls.sort((a, b) => a.id - b.id);
  return balls;
}

// ---------------------------------------------------------------------------
//  斯诺克摆球：15 红 + 6 彩
//  id：0 母球，1~15 红球，16 黄 17 绿 18 棕 19 蓝 20 粉 21 黑
// ---------------------------------------------------------------------------
export const SNOOKER_COLOURS = [
  { id: 16, key: 'yellow', name: '黄球', value: 2 },
  { id: 17, key: 'green', name: '绿球', value: 3 },
  { id: 18, key: 'brown', name: '棕球', value: 4 },
  { id: 19, key: 'blue', name: '蓝球', value: 5 },
  { id: 20, key: 'pink', name: '粉球', value: 6 },
  { id: 21, key: 'black', name: '黑球', value: 7 },
];
export function rackSnooker(seed = 1) {
  const rnd = mulberry32(seed);
  const T = TABLE;
  const d = 2 * R + 0.0002;
  const rowDx = d * 0.8660254037844386;
  const balls = [makeBall(0, T.baulkX - 0.08, 0.13)];
  const apexX = T.spots.pink[0] + 2 * R + 0.002;    // 红球堆顶点尽量靠近粉球但不接触
  let id = 1;
  for (let i = 0; i < 5; i++) for (let j = 0; j <= i; j++)
    balls.push(makeBall(id++, apexX + i * rowDx + (rnd() - 0.5) * 0.0002, (j - i / 2) * d + (rnd() - 0.5) * 0.0002));
  for (const c of SNOOKER_COLOURS) balls.push(makeBall(c.id, T.spots[c.key][0], T.spots[c.key][1]));
  return balls;
}

// 序列化（联机下发最终球位用）
export function snapshot(balls) {
  return balls.map(b => ({ id: b.id, x: b.x, y: b.y, on: b.on }));
}
