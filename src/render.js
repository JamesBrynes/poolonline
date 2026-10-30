// ============================================================================
//  3D 渲染（Three.js）
//  物理坐标 (x, y, z上) → Three 坐标 (x, z, -y)
// ============================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { R, TABLE } from './physics.js';

const RAIL_TOP = 0.046;
export const CUE_ELEV = 0.07;   // 默认球杆仰角（弧度）
const LIGHT = { pool: 2.0, snk: 1.7, angle: 1.25, pen: 0.45 };   // 台灯强度 / 光锥角 / 边缘柔和度

// 斯诺克球颜色（id 1~15 红，16 黄 17 绿 18 棕 19 蓝 20 粉 21 黑）
export const SNOOKER_BALL_COLORS = { red: '#b3121c', 16: '#f4c414', 17: '#127a3c', 18: '#6e3b1c', 19: '#1f48c0', 20: '#f27ea6', 21: '#0d0d0d' };
export const snookerColorOf = (id) => (id >= 1 && id <= 15 ? SNOOKER_BALL_COLORS.red : SNOOKER_BALL_COLORS[id] || '#f7f2e4');

export const BALL_COLORS = {
  1: '#f4c20d', 2: '#1d3fb0', 3: '#d0212b', 4: '#4c2a85', 5: '#f2661b', 6: '#127443', 7: '#7a1c1f', 8: '#111111',
};
const colorOf = (id) => BALL_COLORS[id > 8 ? id - 8 : id];

export const v3 = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

// ---------------------------------------------------------------------------
//  程序化贴图
// ---------------------------------------------------------------------------
const canvasTex = (w, h, draw, { repeat = [1, 1], srgb = true } = {}) => {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
const rnd = (a, b) => a + Math.random() * (b - a);

function noise(g, w, h, amp) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function snookerBallTexture(id) {
  return canvasTex(512, 256, (g, W, H) => {
    g.fillStyle = id === 0 ? '#f7f3e6' : snookerColorOf(id); g.fillRect(0, 0, W, H);
    noise(g, W, H, 4);
    if (id === 0) {   // 训练母球的小红点，方便看旋转
      g.fillStyle = '#c4262e';
      for (const [u, v] of [[0.0, 0.5], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5]]) { g.beginPath(); g.arc(u * W, v * H, 5, 0, Math.PI * 2); g.fill(); }
    }
  });
}

function ballTexture(id) {
  return canvasTex(1024, 512, (g, W, H) => {
    const ivory = '#f7f2e4';
    if (id === 0) {
      g.fillStyle = ivory; g.fillRect(0, 0, W, H);
      g.fillStyle = '#c4262e';     // 母球上的小红点，方便看清旋转
      for (const [u, v] of [[0.0, 0.5], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.125, 0.14], [0.625, 0.86]]) {
        g.beginPath(); g.ellipse(u * W, v * H, 8, 8 / Math.max(0.25, Math.sin(v * Math.PI)), 0, 0, Math.PI * 2); g.fill();
      }
      return;
    }
    const stripe = id > 8;
    g.fillStyle = stripe ? ivory : colorOf(id); g.fillRect(0, 0, W, H);
    if (stripe) { g.fillStyle = colorOf(id); g.fillRect(0, H * 0.27, W, H * 0.46); }
    for (const u of [0.25, 0.75]) {
      g.fillStyle = ivory;
      g.beginPath(); g.ellipse(u * W, H / 2, 56, 112, 0, 0, Math.PI * 2); g.fill();
      g.save(); g.translate(u * W, H / 2); g.scale(1, 2);
      g.fillStyle = '#111'; g.font = 'bold 60px Helvetica, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(id), 0, 3);
      if (id === 6 || id === 9) g.fillRect(-16, 28, 32, 4);
      g.restore();
    }
  }, { repeat: [1, 1] });
}

function woodTexture(base = ['#4a2412', '#5e3018', '#43200f'], rep = [3, 3]) {
  return canvasTex(1024, 256, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, base[0]); grd.addColorStop(0.5, base[1]); grd.addColorStop(1, base[2]);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      g.strokeStyle = `rgba(${rnd(10, 40)},${rnd(4, 14)},0,${rnd(0.12, 0.35)})`;
      g.lineWidth = rnd(0.5, 2.2);
      g.beginPath();
      let y = Math.random() * H; g.moveTo(0, y);
      for (let x = 0; x <= W; x += 24) { y += (Math.random() - 0.5) * 2.5; g.lineTo(x, y); }
      g.stroke();
    }
  }, { repeat: rep });
}

// 台呢：细密纤维 + 法线贴图
function clothMaps(base) {
  const map = canvasTex(512, 512, (g, W, H) => { g.fillStyle = base; g.fillRect(0, 0, W, H); noise(g, W, H, 10); }, { repeat: [10, 5] });
  const normal = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 128 + (Math.random() - 0.5) * 60;
      img.data[i + 1] = 128 + (Math.random() - 0.5) * 60;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: [40, 20], srgb: false });
  return { map, normal };
}

function floorTexture() {
  return canvasTex(1024, 1024, (g, W, H) => {
    const plankH = 64;
    for (let y = 0; y < H; y += plankH) {
      let x = -Math.random() * 300;
      while (x < W) {
        const len = rnd(220, 420);
        const l = rnd(11, 16);
        g.fillStyle = `hsl(25, 35%, ${l}%)`;
        g.fillRect(x, y, len, plankH);
        for (let k = 0; k < 6; k++) {
          g.strokeStyle = `rgba(0,0,0,${rnd(0.05, 0.15)})`;
          g.beginPath(); g.moveTo(x, y + rnd(4, plankH - 4)); g.lineTo(x + len, y + rnd(4, plankH - 4)); g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, 2, plankH);
        x += len;
      }
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, y, W, 2);
    }
  }, { repeat: [4, 4] });
}

// 灰色地毯
function carpetTexture() {
  return canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#4a4b4c'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      const l = rnd(18, 42);
      g.fillStyle = `hsla(30, 4%, ${l}%, 0.6)`;
      g.fillRect(Math.random() * W, Math.random() * H, rnd(1, 3), rnd(1, 3));
    }
  }, { repeat: [10, 10] });
}

// 碳纤维斜纹（库边木框）
function carbonTexture(rep = [60, 60]) {
  return canvasTex(64, 64, (g, W, H) => {
    const n = 8, cs = W / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const on = ((x + y) >> 1) % 2 === 0;
      const grd = on ? g.createLinearGradient(x * cs, y * cs, x * cs + cs, y * cs) : g.createLinearGradient(x * cs, y * cs, x * cs, y * cs + cs);
      grd.addColorStop(0, on ? '#2a2b2e' : '#141517'); grd.addColorStop(0.5, on ? '#3a3b3f' : '#1d1e21'); grd.addColorStop(1, on ? '#232427' : '#121315');
      g.fillStyle = grd; g.fillRect(x * cs, y * cs, cs, cs);
    }
  }, { repeat: rep });
}

// 白色网兜
function netTexture() {
  return canvasTex(128, 128, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.strokeStyle = '#f2f0ea'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H);
    g.moveTo(-W / 2, 0); g.lineTo(W / 2, H); g.moveTo(W / 2, 0); g.lineTo(W * 1.5, H);
    g.moveTo(W / 2, 0); g.lineTo(-W / 2, H); g.moveTo(W * 1.5, 0); g.lineTo(W / 2, H);
    g.stroke();
  }, { repeat: [14, 5] });
}

function shadowTexture() {
  return canvasTex(128, 128, (g, W, H) => {
    const grd = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)'); grd.addColorStop(0.45, 'rgba(0,0,0,0.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }, { srgb: false });
}

// ---- 球杆材质 ----
function splicedTexture(base, point, veneers, n = 4) {
  return canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {           // 木纹
      g.strokeStyle = `rgba(80,50,20,${rnd(0.04, 0.12)})`;
      g.beginPath(); const x = Math.random() * W; g.moveTo(x, 0); g.lineTo(x + rnd(-6, 6), H); g.stroke();
    }
    // 尖角：底边在 canvas 顶部（杆尾方向），尖在前方
    for (let k = 0; k < n; k++) {
      const cx = ((k + 0.5) / n) * W, half = W / n * 0.42;
      const layers = [...veneers.map((c, i) => [c, (veneers.length - i) * 5]), [point, 0]];
      for (const [c, off] of layers) {
        g.fillStyle = c;
        g.beginPath(); g.moveTo(cx - half - off, 0); g.lineTo(cx + half + off, 0); g.lineTo(cx, H * 0.9 + off * 1.5); g.closePath(); g.fill();
      }
    }
  });
}
function grainTexture(base, line, rep) {
  return canvasTex(256, 512, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) {
      g.strokeStyle = line.replace('A', rnd(0.05, 0.18).toFixed(2));
      g.lineWidth = rnd(0.5, 2);
      g.beginPath(); let x = Math.random() * W; g.moveTo(x, 0);
      for (let y = 0; y <= H; y += 32) { x += rnd(-1.5, 1.5); g.lineTo(x, y); }
      g.stroke();
    }
  }, { repeat: [1, rep] });
}

const cueMatCache = {};
function cueMaterial(name) {
  if (cueMatCache[name]) return cueMatCache[name];
  const P = (o) => new THREE.MeshPhysicalMaterial({ clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.7, ...o });
  const M = {
    tipBlue: () => new THREE.MeshStandardMaterial({ color: '#3a5f9e', roughness: 0.95 }),
    brass: () => new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 1, roughness: 0.28 }),
    steel: () => new THREE.MeshStandardMaterial({ color: '#d0d4d8', metalness: 1, roughness: 0.22 }),
    ivory: () => P({ color: '#f2eee4', roughness: 0.35 }),
    rubber: () => new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.9 }),
    ash: () => P({ map: grainTexture('#e6d2a0', 'rgba(120,85,40,A)', 6), roughness: 0.4, clearcoat: 0.4 }),
    maple: () => P({ map: grainTexture('#efdcaf', 'rgba(150,110,60,A)', 6), roughness: 0.35, clearcoat: 0.4 }),
    resSplice: () => P({ map: splicedTexture('#e6d2a0', '#141010', ['#f0e0b8', '#7a2a12', '#f0e0b8']), roughness: 0.3 }),
    ebony: () => P({ map: grainTexture('#161212', 'rgba(70,50,40,A)', 3), roughness: 0.28 }),
    carbon: () => P({ map: canvasTex(64, 64, (g, W, H) => {
      g.fillStyle = '#18181a'; g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
        g.fillStyle = ((x + y) / 8) % 2 ? '#222226' : '#141416'; g.fillRect(x, y, 8, 8);
      }
    }, { repeat: [6, 120] }), roughness: 0.3, clearcoat: 1 }),
    carbonGloss: () => P({ color: '#1c1c20', roughness: 0.2, clearcoat: 1 }),
    leather: () => new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, W, H) => { g.fillStyle = '#353537'; g.fillRect(0, 0, W, H); noise(g, W, H, 40); }, { repeat: [3, 10] }), roughness: 0.75 }),
    linen: () => new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, W, H) => {
      g.fillStyle = '#1e1e1e'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(230,230,230,${rnd(0.2, 0.6)})`; g.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2); }
    }, { repeat: [3, 12] }), roughness: 0.85 }),
    mapleForearm: () => P({ map: splicedTexture('#d9b77a', '#141010', ['#f2e2bd', '#2a5ea8']), roughness: 0.3 }),
    rosewood: () => P({ map: grainTexture('#5a2216', 'rgba(20,5,0,A)', 2), roughness: 0.3 }),
  };
  cueMatCache[name] = M[name]();
  return cueMatCache[name];
}

export function buildCueMesh(def) {
  const g = new THREE.Group();
  for (const [a, b, ra, rb, mat] of def.segs) {
    const geo = new THREE.CylinderGeometry(rb, ra, b - a, 32, 1);   // 旋转后 top 在 +Z（杆尾方向）
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, (a + b) / 2);
    const m = new THREE.Mesh(geo, cueMaterial(mat));
    m.castShadow = true;
    g.add(m);
  }
  // 皮头前端稍圆
  const cap = new THREE.Mesh(new THREE.SphereGeometry(def.tipR, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), cueMaterial('tipBlue'));
  cap.rotation.x = -Math.PI / 2; cap.scale.set(1, 0.35, 1);
  g.add(cap);
  return g;
}

// 光线从原点出发：矩形边界距离 / 与圆的交点
function rayRect(cx, cy, hx, hy) {
  const tx = cx !== 0 ? hx / Math.abs(cx) : Infinity;
  const ty = cy !== 0 ? hy / Math.abs(cy) : Infinity;
  return Math.min(tx, ty);
}
function rayCircle(cx, cy, px, py, r) {
  const b = cx * px + cy * py;
  const c = px * px + py * py - r * r;
  const d = b * b - c;
  if (d < 0) return null;
  const s = Math.sqrt(d);
  return [b - s, b + s];
}

// 库边截面：[往里缩多少 m, 高度 m]，从台面到顶部
// 鼻尖（球接触点）在 0.0363m = 球直径的 63.5%，下面往里凹，上面圆滑过渡到顶面
const CUSHION_PROFILE = [
  [0.014, 0.0], [0.011, 0.010], [0.0065, 0.022], [0.0025, 0.031], [0.0, 0.0363],
  [0.0007, 0.0395], [0.0025, 0.0425], [0.0055, 0.0442], [0.009, 0.0447],
];
const CUSH_TOP0 = 0.0447;

// 库边脚下暗影条：从库边底部往台面中间渐隐
function aoTexture() {
  return canvasTex(8, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.clearRect(0, 0, w, h); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}
function cushionAOGeometry(c) {
  const line = c.line, sign = c.sign, n = line.length;
  const segN = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = line[i + 1][0] - line[i][0], dy = line[i + 1][1] - line[i][1];
    const l = Math.hypot(dx, dy) || 1;
    segN.push([(-dy / l) * sign, (dx / l) * sign]);
  }
  const pos = [], uv = [], idx = [];
  const inner = 0.016, outer = 0.05;
  for (let i = 0; i < n; i++) {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    let x = a[0] + b[0], y = a[1] + b[1]; const l = Math.hypot(x, y) || 1; x /= l; y /= l;
    const p = line[i];
    pos.push(p[0] - x * inner, 0.0008, -(p[1] - y * inner)); uv.push(0, 1);
    pos.push(p[0] + x * outer, 0.0008, -(p[1] + y * outer)); uv.push(0, 0);
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function cushionGeometry(c) {
  const line = c.line, sign = c.sign;
  const sc = TABLE.noseH / 0.0363;   // 不同球台的库边高度按鼻尖高度缩放
  const CUSH_TOP = CUSH_TOP0 * sc;
  const n = line.length;
  // 每段朝球一侧的法线
  const segN = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = line[i + 1][0] - line[i][0], dy = line[i + 1][1] - line[i][1];
    const l = Math.hypot(dx, dy) || 1;
    segN.push([(-dy / l) * sign, (dx / l) * sign]);
  }
  // 顶点法线（斜接）
  const vN = line.map((_, i) => {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    let x = a[0] + b[0], y = a[1] + b[1];
    const l = Math.hypot(x, y) || 1; x /= l; y /= l;
    const k = 1 / Math.max(0.5, x * b[0] + y * b[1]);
    return [x * k, y * k];
  });
  const pos = [], uv = [], idx = [];
  const P = CUSHION_PROFILE.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i) acc += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    for (let k = 0; k < P; k++) {
      const back = CUSHION_PROFILE[k][0], z = CUSHION_PROFILE[k][1] * sc;
      const x = line[i][0] - vN[i][0] * back, y = line[i][1] - vN[i][1] * back;
      pos.push(x, z, -y);
      uv.push(acc * 8, k / (P - 1));
    }
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k + 1 < P; k++) {
    const a = i * P + k, b = (i + 1) * P + k;
    if (sign > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // 顶面：最上面一排 → 背面
  const topRow = line.map((p, i) => [p[0] - vN[i][0] * CUSHION_PROFILE[P - 1][0], p[1] - vN[i][1] * CUSHION_PROFILE[P - 1][0]]);
  const backs = c.poly.slice(-2);
  const shapePts = [...topRow, backs[0], backs[1]].map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(shapePts, []);
  const base = pos.length / 3;
  for (const [x, y] of shapePts.map((v) => [v.x, v.y])) { pos.push(x, CUSH_TOP, -y); uv.push(x * 8, y * 8); }
  for (const t of tris) {
    // 保证朝上
    const [i0, i1, i2] = t;
    const ax = shapePts[i1].x - shapePts[i0].x, ay = shapePts[i1].y - shapePts[i0].y;
    const bx = shapePts[i2].x - shapePts[i0].x, by = shapePts[i2].y - shapePts[i0].y;
    if (ax * by - ay * bx > 0) idx.push(base + i0, base + i1, base + i2); else idx.push(base + i0, base + i2, base + i1);
  }
  // 两端封口（在袋口里面）
  for (const [i, bk] of [[0, backs[1]], [n - 1, backs[0]]]) {
    const b0 = pos.length / 3;
    pos.push(bk[0], 0, -bk[1]); uv.push(0, 0);
    pos.push(bk[0], CUSH_TOP, -bk[1]); uv.push(0, 1);
    for (let k = 0; k + 1 < P; k++) idx.push(b0, i * P + k, i * P + k + 1, i * P + k, b0, i * P + k + 1);
    idx.push(b0, (i + 1) * P - 1, b0 + 1, b0 + 1, (i + 1) * P - 1, b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
export class TableView {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // 自适应分辨率：卡的时候自动降一点渲染分辨率，流畅了再升回来
    this.maxPR = Math.min(window.devicePixelRatio || 1, 1.75);
    this.pr = this.maxPR;
    renderer.setPixelRatio(this.pr);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.62;   // 整体亮度
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d0b0a');
    scene.fog = new THREE.Fog('#0d0b0a', 5, 12);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene = scene;
    this.frameMs = 16; this.prTimer = 0; this.qmode = 'auto';
    this.shadowDirty = true;
    renderer.shadowMap.autoUpdate = false;     // 只在画面有东西动的时候才重算阴影

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 30);
    this.camPos = new THREE.Vector3(-2.2, 1.0, 0);
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.camera.position.copy(this.camPos);

    this._buildRoom();
    this.tableGroup = new THREE.Group();
    scene.add(this.tableGroup);
    this._buildLights();
    this._buildTable();
    this._buildBalls();
    this._buildAimGraphics();
    this.cue = new THREE.Group();
    scene.add(this.cue);
    this.potAnims = [];
    this.markers = new Map();

  }

  _buildRoom() {
    const s = this.scene;
    const FY = -0.82, W = 10, D = 8, H = 3.6;
    const floorMat = new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1, envMapIntensity: 0.1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = FY;
    floor.receiveShadow = true;
    s.add(floor);
    // 墙：下半截深色木护墙板，上半截暗纹墙纸
    const wallTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#2b2a2c'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) { g.fillStyle = x % 32 ? 'rgba(255,255,255,.015)' : 'rgba(0,0,0,.06)'; g.fillRect(x, 0, 8, h); }
      const wy = h * 0.72;
      const grd = g.createLinearGradient(0, wy, 0, h); grd.addColorStop(0, '#3a2416'); grd.addColorStop(1, '#2a180e');
      g.fillStyle = grd; g.fillRect(0, wy, w, h - wy);
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3;
      for (let x = 0; x <= w; x += w / 4) { g.strokeRect(x + 10, wy + 14, w / 4 - 20, h - wy - 34); }
      g.fillStyle = '#1c0f08'; g.fillRect(0, wy - 6, w, 8); g.fillRect(0, h - 10, w, 10);
    }, { repeat: [1, 1] });
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, side: THREE.BackSide, envMapIntensity: 0.15 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: '#121212', roughness: 1, side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [wallMat, wallMat, ceilMat, ceilMat, wallMat, wallMat]);
    // 墙纸按墙宽重复
    room.position.y = FY + H / 2;
    room.layers.set(1);
    s.add(room);
    const props = new THREE.Group(); props.layers.set(1);
    // 墙上的木质计分板（端墙）
    const wood = new THREE.MeshPhysicalMaterial({ map: woodTexture(['#4a2412', '#5e3018', '#43200f'], [1, 1]), roughness: 0.4, clearcoat: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 1, roughness: 0.3 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 1.1), wood);
    board.position.set(W / 2 - 0.03, 0.75, 0); props.add(board);
    for (let i = 0; i < 4; i++) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.95, 8), brass);
      rod.rotation.x = Math.PI / 2; rod.position.set(W / 2 - 0.06, 0.58 + i * 0.11, 0); props.add(rod);
      for (let k = 0; k < 6; k++) {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshStandardMaterial({ color: k % 2 ? '#e8e0c8' : '#7a1c1f', roughness: 0.4 }));
        bead.position.set(W / 2 - 0.06, 0.58 + i * 0.11, -0.44 + k * 0.03 + (i % 2) * 0.5); props.add(bead);
      }
    }
    // 墙上的球杆架（侧墙）
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.06), wood);
    rack.position.set(-1.2, 0.2, -D / 2 + 0.04); props.add(rack);
    const rackTop = rack.clone(); rackTop.position.y = 1.35; props.add(rackTop);
    const cueMat = new THREE.MeshPhysicalMaterial({ map: woodTexture(['#d9b77a', '#e2c48f', '#c9a46a'], [1, 4]), roughness: 0.35, clearcoat: 0.5 });
    const buttMat = new THREE.MeshStandardMaterial({ color: '#1a0f0a', roughness: 0.4 });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.011, 0.9, 10), cueMat); shaft.position.y = 0.95; g.add(shaft);
      const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.015, 0.55, 10), buttMat); butt.position.y = 0.23; g.add(butt);
      g.position.set(-1.7 + i * 0.16, -0.05, -D / 2 + 0.09); g.rotation.z = (i - 3) * 0.01;
      props.add(g);
    }
    // 挂画 / 海报框
    for (const [x, z, ry] of [[1.8, -D / 2 + 0.02, 0], [-W / 2 + 0.02, -1.6, Math.PI / 2], [-W / 2 + 0.02, 1.6, Math.PI / 2]]) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.03), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 }));
      fr.position.set(x, 1.15, z); fr.rotation.y = ry; props.add(fr);
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ map: woodTexture(['#1d3b2a', '#24503a', '#183324'], [1, 1]), roughness: 0.9 }));
      pic.position.set(x + (ry ? 0.02 : 0), 1.15, z + (ry ? 0 : 0.02)); pic.rotation.y = ry; props.add(pic);
    }
    props.traverse((o) => o.layers.set(1));
    s.add(props);
  }

  // 切换球台（八球 / 斯诺克）：整张台、灯、球全部重建
  setTableStyle() {
    const dispose = (o) => o.traverse((c) => { c.geometry?.dispose?.(); });
    this.scene.remove(this.tableGroup); dispose(this.tableGroup);
    this.tableGroup = new THREE.Group();
    this.scene.add(this.tableGroup);
    for (const m of this.ballMeshes.values()) this.scene.remove(m);
    for (const m of this.ballShadows.values()) this.scene.remove(m);
    this.scene.remove(this.handRing);
    this.scene.remove(this.aimGroup);
    this._buildLights();
    this._buildTable();
    this._buildBalls();
    this._buildAimGraphics();
    this.potAnims = [];
    this.shadowDirty = true;
  }

  _buildLights() {
    const s = this.tableGroup;
    s.add(new THREE.HemisphereLight('#d6dce6', '#24180f', 0.55));   // 柔和的环境补光，让台面暗角不那么明显
    const lampY = 1.05;
    // 灯架
    const frameMat = new THREE.MeshStandardMaterial({ color: '#1c1f1d', metalness: 0.7, roughness: 0.35 });
    const snk = TABLE.kind === 'snooker';
    const lampXs = snk ? [-1.25, -0.42, 0.42, 1.25] : [-0.8, 0, 0.8];
    const frame = new THREE.Mesh(new THREE.BoxGeometry(snk ? 3.1 : 2.25, 0.05, 0.12), frameMat);
    frame.position.set(0, lampY + 0.2, 0); frame.layers.set(1); s.add(frame);
    const shadeGeo = new THREE.LatheGeometry([
      new THREE.Vector2(0.02, 0.17), new THREE.Vector2(0.05, 0.16), new THREE.Vector2(0.12, 0.1),
      new THREE.Vector2(0.19, 0.03), new THREE.Vector2(0.21, 0.0),
    ], 48);
    const shadeMat = new THREE.MeshStandardMaterial({ color: '#173a2a', metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide });
    // 阴影只用一盏正上方的平行光来投（原来每盏台灯都投阴影，很费性能）
    const sun = new THREE.DirectionalLight('#fff1d6', 0.6);
    sun.position.set(0.15, 3, 0.1); sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const ext = TABLE.HL + 0.35;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 5 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.01; sun.shadow.radius = 4;
    s.add(sun, sun.target);
    if (snk) {
      // 斯诺克：一整块长方形灯罩（比赛台常见），内侧发光
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.12, 1.15), new THREE.MeshStandardMaterial({ color: '#10261a', roughness: 0.8, side: THREE.DoubleSide }));
      canopy.position.set(0, lampY + 0.07, 0); canopy.layers.set(1); s.add(canopy);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.15, 1.0), new THREE.MeshBasicMaterial({ color: '#fff3dc' }));
      panel.rotation.x = Math.PI / 2; panel.position.set(0, lampY, 0); panel.layers.set(1); s.add(panel);
      const trimC = new THREE.Mesh(new THREE.BoxGeometry(3.32, 0.02, 1.17), frameMat);
      trimC.position.set(0, lampY + 0.005, 0); trimC.layers.set(1); s.add(trimC);
    }
    for (const x of lampXs) {
      // 灯光均匀：大角度、硬一点的边缘过渡、不随距离衰减，几盏灯互相叠加铺满整张台
      const L = new THREE.SpotLight('#fff1d6', snk ? LIGHT.snk : LIGHT.pool, 0, LIGHT.angle, LIGHT.pen, 0);
      L.position.set(x, lampY, 0);
      L.target.position.set(x, 0, 0);
      s.add(L, L.target);
      if (snk) continue;
      const shade = new THREE.Mesh(shadeGeo, shadeMat);
      shade.position.set(x, lampY - 0.02, 0); shade.layers.set(1); s.add(shade);
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.2, 40), new THREE.MeshBasicMaterial({ color: '#fff6e2' }));
      bulb.rotation.x = Math.PI / 2; bulb.position.set(x, lampY - 0.015, 0); bulb.layers.set(1); s.add(bulb);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2), frameMat);
      rod.position.set(x, lampY + 0.1, 0); rod.layers.set(1); s.add(rod);
    }
  }

  _buildTable() {
    const s = this.tableGroup;
    const { HL, HW, CW, pockets } = TABLE;
    const RAIL_W = TABLE.railW;
    const snk = TABLE.kind === 'snooker';
    // 中式黑八台：亮绿色台呢、黑色碳纤维库边、米白色袋角、白色网兜
    // 斯诺克台：深绿色台呢、桃花心木库边、黑色袋角、棕色网兜
    const cloth = clothMaps(snk ? '#106a35' : '#1c9636');
    const clothMat = new THREE.MeshStandardMaterial({
      map: cloth.map, normalMap: cloth.normal, normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.93, envMapIntensity: 0.08,
    });
    const cushMat = clothMat.clone();
    cushMat.map = clothMaps(snk ? '#0f6331' : '#1a8f33').map; cushMat.map.repeat.set(1, 1);
    cushMat.normalMap = null; cushMat.side = THREE.DoubleSide;
    const railMat = snk
      ? new THREE.MeshPhysicalMaterial({ map: woodTexture(['#3a1409', '#4a1c0d', '#300f07'], [6, 6]), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.8 })
      : new THREE.MeshPhysicalMaterial({ map: carbonTexture(), color: '#ffffff', roughness: 0.38, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.7 });
    const bodyMat = snk
      ? new THREE.MeshPhysicalMaterial({ map: woodTexture(['#2e1007', '#3b160a', '#260c05'], [3, 2]), roughness: 0.4, clearcoat: 0.8, envMapIntensity: 0.5 })
      : new THREE.MeshPhysicalMaterial({ color: '#141414', roughness: 0.4, metalness: 0.2, clearcoat: 0.6, envMapIntensity: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: snk ? '#c9a24a' : '#b8bcc0', metalness: 1, roughness: 0.25 });
    const capMat = snk
      ? new THREE.MeshPhysicalMaterial({ color: '#141210', roughness: 0.3, clearcoat: 0.8, envMapIntensity: 0.6 })
      : new THREE.MeshPhysicalMaterial({ color: '#e7dcc2', roughness: 0.35, clearcoat: 0.4, envMapIntensity: 0.6 });
    const netMat = new THREE.MeshStandardMaterial({ map: netTexture(), color: snk ? '#a07a52' : '#ffffff', transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });

    // ---- 台呢 ----
    const N = 2400;
    const clothPts = [];
    const ex = HL + CW, ey = HW + CW;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      let r = rayRect(cx, cy, ex, ey);
      for (const p of pockets) {
        const hit = rayCircle(cx, cy, p.x, p.y, p.r);
        if (hit && hit[0] > 0 && hit[0] < r) r = hit[0];
      }
      clothPts.push(new THREE.Vector2(cx * r, cy * r));
    }
    const clothGeo = new THREE.ShapeGeometry(new THREE.Shape(clothPts));
    clothGeo.rotateX(-Math.PI / 2);
    const uv = clothGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * HL + 0.1) + 0.5, uv.getY(i) / (2 * HW + 0.1) + 0.5);
    const clothMesh = new THREE.Mesh(clothGeo, clothMat);
    clothMesh.receiveShadow = true;
    s.add(clothMesh);

    // ---- 袋口：台呢包进洞口 + 白色网兜 + 米白色袋角 ----
    const rr = (p) => p.r + 0.014;
    for (const p of pockets) {
      const slate = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.03, 48, 1, true), clothMat);
      slate.position.copy(v3(p.x, p.y, -0.015));
      s.add(slate);
      const R0 = rr(p);
      const net = new THREE.Mesh(new THREE.LatheGeometry([
        new THREE.Vector2(R0 * 0.98, 0), new THREE.Vector2(R0 * 1.0, -0.04), new THREE.Vector2(R0 * 0.92, -0.1),
        new THREE.Vector2(R0 * 0.72, -0.16), new THREE.Vector2(R0 * 0.45, -0.2), new THREE.Vector2(R0 * 0.3, -0.21),
      ], 40), netMat);
      net.position.copy(v3(p.x, p.y, -0.03));
      s.add(net);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 * 0.3, 0.004, 8, 32), netMat);
      ring.rotation.x = Math.PI / 2; ring.position.copy(v3(p.x, p.y, -0.24));
      s.add(ring);

      // 袋角：围在袋口外侧的一圈米白色护角
      const center = p.kind === 'corner' ? Math.atan2(p.sy, p.sx) : Math.atan2(p.sy, 0);
      const half = ((p.kind === 'corner' ? 100 : 92) * Math.PI) / 180;
      const Ro = R0 + (snk ? 0.04 : 0.045);
      const cap = new THREE.Shape();
      cap.absarc(p.x, p.y, Ro, center - half, center + half, false);
      cap.absarc(p.x, p.y, R0, center + half, center - half, true);
      cap.closePath();
      const capGeo = new THREE.ExtrudeGeometry(cap, { depth: RAIL_TOP + 0.06, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 4, curveSegments: 48 });
      capGeo.rotateX(-Math.PI / 2);
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.position.y = -0.06;
      capMesh.castShadow = true; capMesh.receiveShadow = true;
      s.add(capMesh);
    }

    // ---- 巧克粉：放在开球端的库边上 ----
    const chalk = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), [
      new THREE.MeshStandardMaterial({ color: '#2f6fd1', roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: '#2f6fd1', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#1f4fa6', roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#2f6fd1', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#2f6fd1', roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: '#2f6fd1', roughness: 0.9 }),
    ]);
    chalk.position.copy(v3(-HL - CW - RAIL_W * 0.45, HW * 0.62, RAIL_TOP + 0.011));
    chalk.rotation.y = 0.4; chalk.castShadow = true;
    s.add(chalk);

    // ---- 库边：顶部鼻尖最突出，往下越来越往里凹（真实库边截面）----
    const aoMat = new THREE.MeshBasicMaterial({ map: aoTexture(), transparent: true, depthWrite: false, color: '#000000', opacity: 0.6, side: THREE.DoubleSide });
    for (const c of TABLE.cushions) {
      const m = new THREE.Mesh(cushionGeometry(c), cushMat);
      m.castShadow = true; m.receiveShadow = true;
      s.add(m);
      // 库边脚下的接触暗影（库边往里凹，底下天然更暗）
      const ao = new THREE.Mesh(cushionAOGeometry(c), aoMat);
      ao.renderOrder = 1;
      s.add(ao);
    }

    // ---- 碳纤维库边框 ----
    const ox = HL + CW + RAIL_W, oy = HW + CW + RAIL_W;
    const outer = new THREE.Shape([
      new THREE.Vector2(-ox, -oy), new THREE.Vector2(ox, -oy), new THREE.Vector2(ox, oy), new THREE.Vector2(-ox, oy)]);
    const holePts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      let r = rayRect(cx, cy, ex, ey);
      for (const p of pockets) {
        const hit = rayCircle(cx, cy, p.x, p.y, rr(p));
        if (hit && hit[1] > r && hit[0] < r + 0.001) r = hit[1];
      }
      holePts.push(new THREE.Vector2(cx * r, cy * r));
    }
    outer.holes.push(new THREE.Path(holePts.reverse()));
    const railH = RAIL_TOP + 0.05 - 0.008;
    const railGeo = new THREE.ExtrudeGeometry(outer, { depth: railH, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 5, curveSegments: 8 });
    railGeo.rotateX(-Math.PI / 2);
    // 碳纹按世界坐标铺
    const ruv = railGeo.attributes.uv, rpos = railGeo.attributes.position;
    for (let i = 0; i < ruv.count; i++) ruv.setXY(i, rpos.getX(i) / 4, rpos.getZ(i) / 4 + rpos.getY(i) / 4);
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.y = -0.05;
    rail.castShadow = true; rail.receiveShadow = true;
    s.add(rail);
    if (snk) railMat.map.repeat.set(3, 3);
    // 外沿金属饰条
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2 * ox + 0.018, 0.008, 2 * oy + 0.018), trimMat);
    trim.position.y = -0.055; s.add(trim);

    // ---- 黑色台身 + 台脚（网兜挂在台身外面）----
    const body = new THREE.Mesh(new THREE.BoxGeometry(2 * HL - 0.1, 0.24, 2 * HW - 0.1), bodyMat);
    body.position.y = -0.18; body.castShadow = true; body.receiveShadow = true;
    s.add(body);
    const under = new THREE.Mesh(new THREE.BoxGeometry(2 * ox - 0.02, 0.02, 2 * oy - 0.02), bodyMat);
    under.position.y = -0.068; s.add(under);
    for (const x of [-HL + 0.25, 0, HL - 0.25]) for (const z of [-HW + 0.2, HW - 0.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.52, 0.2), bodyMat);
      leg.position.set(x, -0.56, z); leg.castShadow = true;
      s.add(leg);
    }

    if (snk) {
      // 开球线、D 区、各彩球置球点
      const lm = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 });
      const bl = new THREE.Mesh(new THREE.PlaneGeometry(0.0016, 2 * HW), lm);
      bl.rotation.x = -Math.PI / 2; bl.position.copy(v3(TABLE.baulkX, 0, 0.0004));
      s.add(bl);
      const dArc = new THREE.Mesh(new THREE.RingGeometry(TABLE.dR - 0.0008, TABLE.dR + 0.0008, 96, 1, Math.PI / 2, Math.PI), lm);
      dArc.rotation.x = -Math.PI / 2; dArc.position.copy(v3(TABLE.baulkX, 0, 0.0004));
      s.add(dArc);
      const spotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 });
      for (const k of Object.keys(TABLE.spots)) {
        const [x, y] = TABLE.spots[k];
        const sp = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 12), spotMat);
        sp.rotation.x = -Math.PI / 2; sp.position.copy(v3(x, y, 0.0005));
        s.add(sp);
      }
    } else {
      // 开球线 + 置球点（很淡）
      const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12 });
      const head = new THREE.Mesh(new THREE.PlaneGeometry(0.0012, 2 * HW), lineMat);
      head.rotation.x = -Math.PI / 2; head.position.copy(v3(TABLE.headX, 0, 0.0004));
      s.add(head);
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), lineMat);
      spot.rotation.x = -Math.PI / 2; spot.position.copy(v3(TABLE.footX, 0, 0.0004));
      s.add(spot);
    }
  }

  _buildBalls() {
    this.ballMeshes = new Map();
    this.ballShadows = new Map();
    const geo = new THREE.SphereGeometry(R, 48, 32);
    const shGeo = new THREE.PlaneGeometry(R * 2.6, R * 2.6);
    shGeo.rotateX(-Math.PI / 2);
    const shMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 });
    const snk = TABLE.kind === 'snooker';
    for (let id = 0; id <= (snk ? 21 : 15); id++) {
      const mat = new THREE.MeshPhysicalMaterial({ map: snk ? snookerBallTexture(id) : ballTexture(id), roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.9 });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      this.scene.add(m);
      this.ballMeshes.set(id, m);
      const sh = new THREE.Mesh(shGeo, shMat);       // 接触阴影
      sh.renderOrder = 1;
      this.scene.add(sh);
      this.ballShadows.set(id, sh);
    }
    this.handRing = new THREE.Mesh(new THREE.RingGeometry(R * 1.25, R * 1.45, 48),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.8, depthWrite: false }));
    this.handRing.rotation.x = -Math.PI / 2;
    this.handRing.visible = false;
    this.scene.add(this.handRing);
  }

  setCueModel(def) {
    this.scene.remove(this.cue);
    this.cue = buildCueMesh(def);
    this.scene.add(this.cue);
  }

  _buildAimGraphics() {
    this.aimGroup = new THREE.Group();
    this.scene.add(this.aimGroup);
    this.lineMeshes = [];
    const colors = { cue: '#ffffff', object: '#ffe08a', tangent: '#9ad1ff', bounce: '#ffffff' };
    this.lineMats = {};
    for (const k in colors) this.lineMats[k] = new THREE.MeshBasicMaterial({ color: colors[k], transparent: true, opacity: k === 'bounce' ? 0.45 : 0.8, depthWrite: false });
    const ghostMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), ghostMat);
    this.ghostRing = new THREE.Mesh(new THREE.RingGeometry(R - 0.0016, R, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.ghost, this.ghostRing);
  }

  setAim(aim) {
    let i = 0;
    for (const L of aim.lines) {
      let m = this.lineMeshes[i];
      if (!m) {
        m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.lineMats.cue);
        this.aimGroup.add(m);
        this.lineMeshes.push(m);
      }
      const dx = L.x2 - L.x1, dy = L.y2 - L.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      m.material = this.lineMats[L.kind];
      m.visible = len > 0.001;
      m.position.copy(v3((L.x1 + L.x2) / 2, (L.y1 + L.y2) / 2, 0.0012 + i * 0.0001));
      m.scale.set(len, L.kind === 'cue' ? 0.003 : 0.0026, 1);
      m.rotation.set(-Math.PI / 2, 0, Math.atan2(dy, dx));
      i++;
    }
    for (; i < this.lineMeshes.length; i++) this.lineMeshes[i].visible = false;
    if (aim.ghost) {
      this.ghost.visible = this.ghostRing.visible = true;
      this.ghost.position.copy(v3(aim.ghost.x, aim.ghost.y, R));
      this.ghostRing.position.copy(v3(aim.ghost.x, aim.ghost.y, 0.0015));
    } else this.ghost.visible = this.ghostRing.visible = false;
  }

  showAim(on) { this.aimGroup.visible = on; }

  // 球杆：皮头位于母球表面后方 gap 处，对准 (a,b) 塞点；elev 为杆尾抬起的角度
  setCue(visible, cueBall, dx, dy, a = 0, b = 0, pull = 0, elev = CUE_ELEV) {
    this.cue.visible = visible;
    if (!visible) return;
    const ce = Math.cos(elev), se = Math.sin(elev);
    const sx = dy, sy = -dx;
    const ux = dx * se, uy = dy * se, uz = ce;
    const cx = dx * ce, cy = dy * ce, cz = -se;
    const k = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    const rx = (a * sx + b * ux - k * cx) * R, ry = (a * sy + b * uy - k * cy) * R, rz = (b * uz - k * cz) * R;
    const hit = v3(cueBall.x + rx, cueBall.y + ry, R + rz);
    const back = new THREE.Vector3(-cx, -cz, cy);
    const tip = hit.clone().addScaledVector(back, 0.012 + pull);
    this.cue.position.copy(tip);
    this.cue.lookAt(tip.clone().add(back));
  }

  setHandRing(visible, ball, t) {
    this.handRing.visible = visible;
    if (visible) {
      this.handRing.position.copy(v3(ball.x, ball.y, 0.0015));
      this.handRing.material.opacity = 0.5 + 0.35 * Math.sin(t * 5);
    }
  }

  // 教学用标记圈
  setMarker(id, m) {
    let mesh = this.markers.get(id);
    if (!m) { if (mesh) mesh.visible = false; return; }
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 64),
        new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh); this.markers.set(id, mesh);
    }
    mesh.visible = true;
    mesh.material.color.set(m.color || '#ffd166');
    mesh.scale.set(m.r, m.r, 1);
    mesh.position.copy(v3(m.x, m.y, 0.0016));
  }

  syncBalls(balls, simDt) {
    const q = new THREE.Quaternion(), axis = new THREE.Vector3();
    // 不在这一局里的球（教学关只摆了几颗）隐藏
    const present = new Set(balls.map((b) => b.id));
    for (const [id, m] of this.ballMeshes) if (!present.has(id)) { m.visible = false; this.ballShadows.get(id).visible = false; }
    for (const b of balls) {
      const m = this.ballMeshes.get(b.id);
      const sh = this.ballShadows.get(b.id);
      if (this.potAnims.some((p) => p.id === b.id)) { sh.visible = false; continue; }
      m.visible = sh.visible = b.on;
      if (!b.on) continue;
      m.position.copy(v3(b.x, b.y, R));
      sh.position.copy(v3(b.x, b.y, 0.0007));
      if (simDt > 0) {
        axis.set(b.wx, b.wz, -b.wy);
        const w = axis.length();
        if (w > 1e-6) {
          q.setFromAxisAngle(axis.multiplyScalar(1 / w), w * simDt);
          m.quaternion.premultiply(q);
        }
      }
    }
  }

  startPotAnim(ev) {
    const p = TABLE.pockets[ev.pocket];
    this.potAnims.push({ id: ev.a, x0: ev.x, y0: ev.y, px: p.x, py: p.y, t: 0 });
  }

  updatePotAnims(dt) {
    for (const a of this.potAnims) {
      a.t += dt;
      const k = Math.min(1, a.t / 0.4);
      const m = this.ballMeshes.get(a.id);
      const x = a.x0 + (a.px - a.x0) * Math.min(1, k * 1.3);
      const y = a.y0 + (a.py - a.y0) * Math.min(1, k * 1.3);
      m.visible = true;
      m.position.copy(v3(x, y, R - k * k * 0.13));
    }
    this.potAnims = this.potAnims.filter((a) => {
      if (a.t > 0.42) { this.ballMeshes.get(a.id).visible = false; return false; }
      return true;
    });
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // 视角：mode '3d' 第一视角；'top' 俯视
  updateCamera(mode, cueBall, dx, dy, pitch, dist, dt, snap = false, spinB = 0, elev = CUE_ELEV) {
    let pos, target, up;
    if (mode === 'top') this.camera.layers.disable(1); else this.camera.layers.enable(1);
    if (mode === 'top') {
      const aspect = this.camera.aspect;
      const needW = 2 * (TABLE.HL + 0.25), needH = 2 * (TABLE.HW + 0.25);
      const fov = (this.camera.fov * Math.PI) / 180;
      const h = Math.max(needH, needW / aspect) / 2 / Math.tan(fov / 2);
      pos = new THREE.Vector3(0, h, 0.0001);
      target = new THREE.Vector3(0, 0, 0);
      up = new THREE.Vector3(0, 0, -1);
    } else {
      const c = v3(cueBall.x, cueBall.y, R);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      // 眼睛始终在球杆正上方：算出球杆在眼睛位置的高度，眼睛至少高出它 4cm
      const hd = cp * dist;
      const cueTop = R + spinB * R + Math.max(0, hd - R * 0.5) * Math.tan(elev) + 0.016;
      const eyeY = Math.max(R + sp * dist, cueTop + 0.04);
      pos = new THREE.Vector3(c.x - dx * hd, eyeY, c.z + dy * hd);
      const extra = eyeY - (R + sp * dist);
      const ahead = (0.6 + dist * 1.2) / (1 + extra * 8);
      target = new THREE.Vector3(c.x + dx * ahead, 0, c.z - dy * ahead);
      up = new THREE.Vector3(0, 1, 0);
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 9);
    this.camPos.lerp(pos, k);
    this.camTarget.lerp(target, k);
    this.camera.up.lerp(up, k).normalize();
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  pick(clientX, clientY, rect) {
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
    const p = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, p)) return null;
    return { x: p.x, y: -p.z };
  }

  // 画质：auto 自动调分辨率 / high 高清 / fast 流畅
  setQuality(mode) {
    this.qmode = mode;
    const dpr = window.devicePixelRatio || 1;
    this.pr = mode === 'high' ? Math.min(dpr, 2) : mode === 'fast' ? Math.min(dpr, 1) * 0.85 : this.maxPR;
    this.renderer.setPixelRatio(this.pr);
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  render(dt = 0.016) {
    if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    // 自适应分辨率
    this.frameMs = this.frameMs * 0.9 + Math.max(dt * 1000, performance.now() - t0) * 0.1;
    this.prTimer += dt;
    if (this.qmode === 'auto' && this.prTimer > 1.2) {
      this.prTimer = 0;
      let pr = this.pr;
      if (this.frameMs > 24 && pr > 0.7) pr = Math.max(0.7, pr - 0.2);
      else if (this.frameMs < 18.5 && pr < this.maxPR) pr = Math.min(this.maxPR, pr + 0.1);
      if (pr !== this.pr) {
        this.pr = pr;
        this.renderer.setPixelRatio(pr);
        const c = this.renderer.domElement;
        this.renderer.setSize(c.clientWidth, c.clientHeight, false);
      }
    }
  }
}
