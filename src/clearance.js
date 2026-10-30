// ============================================================================
//  球杆避让：保证球杆不穿过库边 / 木边 / 其它球
//  规则（真实打法）：
//    · 母球贴库（后方库边几乎贴着）→ 自动把击球点往上提（加高杆），让杆从库边上方过
//    · 母球靠近库边但没贴着 / 杆后面有球挡着 → 自动抬杆尾
// ============================================================================
import { R, TABLE, castBall } from './physics.js';
import { cueRadiusAt } from './cues.js';

const RAIL_H = 0.049;                 // 木边顶部 + 倒角余量
const GAP = 0.012;                    // 架杆时皮头离球
const CHECK_LEN = 1.1;                // 检查到后手位置为止
const MAX_SPIN = 0.55;
export const ELEV_MAX = 1.2;

// 返回球杆与障碍物之间的最小间隙（<0 表示穿模）
function clearance(balls, cb, dx, dy, a, b, elev, def) {
  const ce = Math.cos(elev), se = Math.sin(elev);
  const sx = dy, sy = -dx;
  const ux = dx * se, uy = dy * se, uz = ce;
  const cx = dx * ce, cy = dy * ce, cz = -se;
  const k = Math.sqrt(Math.max(0, 1 - a * a - b * b));
  const hx = cb.x + (a * sx + b * ux - k * cx) * R;
  const hy = cb.y + (a * sy + b * uy - k * cy) * R;
  const hz = R + (b * uz - k * cz) * R;
  let worst = Infinity;
  // 只检查杆后方、够得着的球（省计算）
  const near = [];
  for (const o of balls) {
    if (!o.on || o.id === 0) continue;
    const ox = o.x - cb.x, oy = o.y - cb.y;
    if (ox * -dx + oy * -dy < -3 * R) continue;
    if (ox * ox + oy * oy > (CHECK_LEN + 0.1) ** 2) continue;
    near.push(o);
  }
  const HLx = TABLE.HL, HWy = TABLE.HW;
  const RAIL_OUT = TABLE.CW + TABLE.railW + 0.02;   // 库边 + 木边宽度（到台外）
  for (let t = GAP; t <= CHECK_LEN; t += 0.01) {
    const px = hx - cx * t, py = hy - cy * t, pz = hz - cz * t;
    const r = cueRadiusAt(def, t - GAP) * (1 / Math.max(0.3, ce));   // 倾斜时竖直截面更厚
    // 库边 + 木边
    const ax = Math.abs(px), ay = Math.abs(py);
    if ((ax > HLx - r || ay > HWy - r) && ax < HLx + RAIL_OUT && ay < HWy + RAIL_OUT) {
      worst = Math.min(worst, pz - r - RAIL_H);
      if (worst < 0) return worst;      // 只关心会不会穿模，发现穿模立刻返回
    }
    // 其它球
    for (const o of near) {
      const ddx = px - o.x, ddy = py - o.y;
      const dh = Math.sqrt(ddx * ddx + ddy * ddy) - r;
      if (dh >= R) continue;
      const top = dh <= 0 ? 2 * R : R + Math.sqrt(R * R - dh * dh);
      worst = Math.min(worst, pz - r - top);
      if (worst < 0) return worst;
    }
  }
  return worst;
}

const cache = { key: '', out: null };

// 输入玩家设置的 (a, b, elev)，输出实际使用的值
export function solveCue(balls, dx, dy, a, b, elev, def) {
  const cb = balls[0];
  let key = `${TABLE.kind},${cb.x.toFixed(4)},${cb.y.toFixed(4)},${dx.toFixed(5)},${dy.toFixed(5)},${a.toFixed(3)},${b.toFixed(3)},${elev.toFixed(4)},${def.id}`;
  for (const o of balls) if (o.on && o.id) key += `|${o.x.toFixed(3)},${o.y.toFixed(3)}`;
  if (key === cache.key) return cache.out;

  let out = { a, b, elev, autoB: false, autoElev: false };
  if (clearance(balls, cb, dx, dy, a, b, elev, def) < 0) {
    // 母球是否贴库（沿杆的反方向，库边在 6mm 以内）
    const back = castBall(cb.x, cb.y, -dx, -dy, balls, 0, 0.05);
    const frozen = back.type === 'cushion' && back.t < 0.006;
    let nb = b;
    if (frozen) {
      const bMax = Math.sqrt(Math.max(0, MAX_SPIN * MAX_SPIN - a * a));
      for (nb = Math.max(b, 0); nb <= bMax + 1e-9; nb += 0.02) {
        if (clearance(balls, cb, dx, dy, a, nb, elev, def) >= 0) break;
      }
      nb = Math.min(nb, bMax);
      out.b = nb; out.autoB = nb > b + 1e-6;
    }
    if (clearance(balls, cb, dx, dy, a, nb, elev, def) < 0) {
      // 二分找到刚好不穿模的最小仰角
      let lo = elev, hi = ELEV_MAX;
      if (clearance(balls, cb, dx, dy, a, nb, hi, def) < 0) lo = hi;
      else for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (clearance(balls, cb, dx, dy, a, nb, mid, def) >= 0) hi = mid; else lo = mid;
      }
      out.elev = Math.min(ELEV_MAX, hi + 0.004);
      out.autoElev = true;
    }
  }
  cache.key = key; cache.out = out;
  return out;
}
