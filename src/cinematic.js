// ============================================================================
//  147 满分杆专属过场动画（约 14.5 秒，点击 / Esc / 空格跳过）
//  全部动画都由时间 t 直接算出来（不依赖 CSS 动画），所以可以任意跳到某一时刻、逐帧渲染
//
//  分镜：
//   0.0  定格 → 回放：电影黑边推入、REPLAY 时间码
//   0.6  高空摇臂俯拍整台球，下方字幕条：球员名 / MAXIMUM BREAK
//   2.6  快切进袋蒙太奇：红、黑、红、黑……低机位袋口特写，计分器飞涨
//   6.0  清彩球：黄 绿 棕 蓝 粉，越切越快
//   7.6  最后一颗黑球：超低机位慢动作，心跳，「FOR 147」
//  10.2  落袋：白闪、震屏、轰鸣，巨型彩虹 147 砸下，冲击波、光芒、彩带
//  14.0  淡出 → 结算画面
// ============================================================================
import * as THREE from 'three';
import { TABLE, R, rackSnooker } from './physics.js';

const T_SLAM = 10.2, T_END = 14.6;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const expOut = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const COLOR_ID = { red: 1, yellow: 16, green: 17, brown: 18, blue: 19, pink: 20, black: 21 };
const CHIP = { red: '#c3141e', yellow: '#f4c414', green: '#13843f', brown: '#7a4322', blue: '#2453d6', pink: '#f585ad', black: '#0d0d0d' };
const VAL = { red: 1, yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };

// 蒙太奇镜头：哪颗球、进哪个袋（TABLE.pockets 的序号）、从哪个角度滚进去
const SHOTS = [
  { t0: 2.60, dur: 0.66, ball: 'red', pocket: 2, ang: 0.18, side: 1 },
  { t0: 3.26, dur: 0.62, ball: 'black', pocket: 3, ang: -0.12, side: -1 },
  { t0: 3.88, dur: 0.58, ball: 'red', pocket: 4, ang: 0.22, side: 1 },
  { t0: 4.46, dur: 0.54, ball: 'black', pocket: 3, ang: 0.06, side: 1 },
  { t0: 5.00, dur: 0.52, ball: 'red', pocket: 0, ang: -0.2, side: -1 },
  { t0: 5.52, dur: 0.48, ball: 'black', pocket: 2, ang: 0.2, side: -1 },
  { t0: 6.00, dur: 0.34, ball: 'yellow', pocket: 1, ang: 0.1, side: 1 },
  { t0: 6.34, dur: 0.32, ball: 'green', pocket: 5, ang: -0.18, side: -1 },
  { t0: 6.66, dur: 0.30, ball: 'brown', pocket: 0, ang: 0.15, side: 1 },
  { t0: 6.96, dur: 0.30, ball: 'blue', pocket: 4, ang: 0.0, side: -1 },
  { t0: 7.26, dur: 0.34, ball: 'pink', pocket: 3, ang: -0.1, side: 1 },
];

// 一杆 147 的进球顺序 → 每颗球落袋的时刻（计分器用）
const SEQ = [];
for (let i = 0; i < 15; i++) { SEQ.push('red', 'black'); }
SEQ.push('yellow', 'green', 'brown', 'blue', 'pink', 'black');
const SEQ_T = SEQ.map((k, i) => {
  if (i < 30) return 2.6 + ((i + 1) * 3.4) / 30;
  if (i < 35) { const s = SHOTS[6 + (i - 30)]; return s.t0 + s.dur * 0.72; }
  return T_SLAM;
});

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Cinematic147 {
  constructor(view, sfx) {
    this.view = view; this.sfx = sfx;
    this.active = false; this.manual = null;
    this.el = document.getElementById('cine');
    this.cv = document.getElementById('cineFx');
    this.ctx = this.cv.getContext('2d');
    const rnd = mulberry(147);
    this.confetti = Array.from({ length: 260 }, () => ({
      x: rnd(), y: -0.1 - rnd() * 0.9, vy: 0.18 + rnd() * 0.35, sway: 0.02 + rnd() * 0.05, f: 2 + rnd() * 4, ph: rnd() * 6,
      w: 6 + rnd() * 10, h: 3 + rnd() * 6, rot: rnd() * 6, vr: (rnd() - 0.5) * 12, hue: rnd() * 360, delay: rnd() * 0.6,
    }));
    this.sparks = Array.from({ length: 140 }, () => ({ a: rnd() * Math.PI * 2, v: 0.25 + rnd() * 0.9, hue: rnd() * 360, r: 1 + rnd() * 2.5 }));
    this.decor = Array.from({ length: 6 }, () => [rnd(), rnd()]);
    this._buildChips();
    this.el.addEventListener('pointerdown', () => this.skip());
  }

  _buildChips() {
    // 立体 147：后面叠十几层深色"厚度"，最前面一层是彩虹
    const big = document.getElementById('cnBig');
    let h = '';
    for (let i = 14; i >= 1; i--) h += `<div class="cn-ext" style="transform:translate(${i * 1.4}px, ${i * 1.9}px); opacity:${0.35 + (14 - i) * 0.045}">147</div>`;
    h += '<div class="cn-front">147</div><div class="cn-shine">147</div>';
    big.innerHTML = h;
    document.getElementById('cnChips').innerHTML = SEQ.map((k) => `<i style="background:${CHIP[k]}"></i>`).join('');
    document.getElementById('cnBigTxt').innerHTML = 'MAXIMUM BREAK'.split('').map((c) => `<span>${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  }

  play({ name = '', onDone } = {}) {
    this.name = name; this.onDone = onDone;
    document.getElementById('cnName').textContent = name;
    document.getElementById('cnName2').textContent = name;
    this.active = true; this.t0 = performance.now(); this.lastT = -1;
    this.savedFov = this.view.camera.fov;
    this.view.camera.fov = 40; this.view.camera.updateProjectionMatrix();
    // 摆出开局的球形（摇臂镜头里看得到整台球）
    this.layout = rackSnooker(7);
    this.el.classList.remove('hidden');
    document.body.classList.add('cine-on');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.cv.width = innerWidth * dpr; this.cv.height = innerHeight * dpr; this.dpr = dpr;
  }

  skip() { if (this.active) this.finish(); }

  finish() {
    this.active = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('cine-on');
    this.view.camera.layers.enable(1);
    document.getElementById('c').style.filter = '';
    document.getElementById('c').style.transform = '';
    this.view.camera.fov = this.savedFov; this.view.camera.updateProjectionMatrix();
    const cb = this.onDone; this.onDone = null;
    cb?.();
  }

  // 每帧调用
  update() {
    const t = this.manual ?? (performance.now() - this.t0) / 1000;
    if (this.manual == null) this._cues(this.lastT, t);
    this.lastT = t;
    this.apply(t);
    if (this.manual == null && t >= T_END) this.finish();
  }

  // ---------------- 声音提示点 ----------------
  _cues(a, b) {
    const hit = (x) => a < x && b >= x;
    const s = this.sfx;
    if (hit(0.02)) s.whoosh?.();
    for (const sh of SHOTS) {
      if (hit(sh.t0 + 0.02)) s.ball(1.6 + Math.random());
      if (hit(sh.t0 + sh.dur * 0.72)) s.pocket(2.4);
    }
    for (const x of [7.9, 8.7, 9.4, 9.95]) if (hit(x)) s.heartbeat?.();
    if (hit(8.4)) s.riser?.(1.8);
    if (hit(T_SLAM)) { s.pocket(4); s.boom?.(); }
    if (hit(T_SLAM + 0.15)) s.sparkle?.();
  }

  // ---------------- 一帧画面 ----------------
  apply(t) {
    const v = this.view;
    v.shadowDirty = true;
    // 高空镜头时隐藏灯罩和房间（不然会挡住镜头）
    if (t < 2.6 || t >= T_SLAM + 0.3) v.camera.layers.disable(1); else v.camera.layers.enable(1);
    const $ = (id) => document.getElementById(id);
    const set = (id, css) => Object.assign($(id).style, css);

    // ---- 3D 镜头 + 球 ----
    if (t < 2.6) this._crane(t);
    else if (t < 7.6) this._montage(t);
    else if (t < T_SLAM + 0.3) this._finalBlack(t);
    else this._outro(t);

    // ---- 画面调色 / 震屏 ----
    const cvs = $('c');
    const ts = t - T_SLAM;
    const shake = ts > 0 ? 16 * Math.exp(-ts * 4.5) : 0;
    const sx = shake * Math.sin(t * 93), sy = shake * Math.cos(t * 71);
    const slow = t > 7.6 && t < T_SLAM ? clamp((t - 7.6) / 0.6) : 0;
    cvs.style.filter = `saturate(${1 - 0.45 * slow + (ts > 0 ? 0.3 * Math.exp(-ts) : 0)}) contrast(${1 + 0.12 * slow}) brightness(${1 - 0.15 * slow})`;
    cvs.style.transform = `translate(${sx}px, ${sy}px)`;
    this.el.style.transform = `translate(${sx * 0.6}px, ${sy * 0.6}px)`;

    // ---- 黑边 / REPLAY ----
    const bars = easeOut(clamp(t / 0.5)) * (1 - easeOut(clamp((t - 14.0) / 0.5)));
    set('cnBarT', { height: `${11 * bars}vh` }); set('cnBarB', { height: `${11 * bars}vh` });
    set('cnRec', { opacity: t < T_SLAM ? clamp(t / 0.4) : clamp(1 - ts / 0.3) });
    const tc = Math.max(0, t);
    $('cnTC').textContent = `00:${String(Math.floor(tc)).padStart(2, '0')}:${String(Math.floor((tc % 1) * 25)).padStart(2, '0')}`;
    set('cnDot', { opacity: Math.floor(t * 2) % 2 ? 0.2 : 1 });
    // 开场定格白闪 + 扫描线
    set('cnFreeze', { opacity: clamp(1 - t / 0.35) * 0.8 });

    // ---- 字幕条（摇臂镜头）----
    const lt = clamp((t - 0.9) / 0.4) * (1 - clamp((t - 2.45) / 0.2));
    set('cnLower', { opacity: lt, transform: `translateX(${(1 - easeOut(clamp((t - 0.9) / 0.5))) * -60}px)` });

    // ---- 计分器 ----
    let pts = 0, n = 0;
    for (let i = 0; i < SEQ.length; i++) if (t >= SEQ_T[i]) { pts += VAL[SEQ[i]]; n = i + 1; }
    const tickOn = clamp((t - 2.4) / 0.3) * (1 - clamp((t - (T_SLAM - 0.05)) / 0.15));
    set('cnTicker', { opacity: tickOn, transform: `translateY(${(1 - tickOn) * 20}px)` });
    $('cnPts').textContent = pts;
    const chips = $('cnChips').children;
    for (let i = 0; i < chips.length; i++) {
      const k = clamp((t - SEQ_T[i]) / 0.15);
      chips[i].style.opacity = k; chips[i].style.transform = `scale(${0.4 + 0.6 * easeOut(k)})`;
    }
    // 刚进一颗：分数跳一下
    const lastHit = n ? t - SEQ_T[n - 1] : 9;
    $('cnPts').style.transform = `scale(${1 + 0.35 * Math.exp(-lastHit * 10)})`;

    // ---- 最后一颗黑球：FOR 147 ----
    const forK = clamp((t - 8.0) / 0.5) * (1 - clamp((t - (T_SLAM - 0.25)) / 0.2));
    set('cnFor', { opacity: forK, letterSpacing: `${lerp(40, 14, easeOut(clamp((t - 8.0) / 1.2)))}px` });
    const beat = [7.9, 8.7, 9.4, 9.95].reduce((m, x) => Math.max(m, t > x ? Math.exp(-(t - x) * 6) : 0), 0);
    set('cnVig', { opacity: slow * (0.55 + 0.35 * beat) });

    // ---- 落袋爆发 ----
    set('cnFlash', { opacity: ts > 0 ? clamp(1 - ts / 0.55) : 0 });
    const slamK = expOut(clamp(ts / 0.38));
    const big = $('cnBig');
    big.style.opacity = ts > 0 ? clamp(ts / 0.08) * (1 - clamp((t - 14.0) / 0.5)) : 0;
    big.style.transform = `translate(-50%, -54%) scale(${ts > 0 ? lerp(3.4, 1, slamK) * (1 + 0.012 * Math.sin(t * 3)) : 3})`;
    big.style.filter = `hue-rotate(${(t * 140) % 360}deg) blur(${ts > 0 ? 8 * (1 - slamK) : 0}px)`;
    set('cnRays', { opacity: ts > 0 ? clamp(ts / 0.5) * 0.6 * (1 - clamp((t - 14.0) / 0.5)) : 0, transform: `translate(-50%, -50%) rotate(${t * 16}deg)` });
    for (let i = 0; i < 4; i++) {
      const r = $('cnRing' + i), k = ts - i * 0.17;
      r.style.opacity = k > 0 ? clamp(1 - k / 1.3) : 0;
      r.style.transform = `translate(-50%, -50%) scale(${k > 0 ? 0.2 + k * 2.2 : 0})`;
      r.style.borderWidth = `${k > 0 ? Math.max(1, 14 * (1 - k / 1.3)) : 0}px`;
    }
    const letters = $('cnBigTxt').children;
    for (let i = 0; i < letters.length; i++) {
      const k = easeOut(clamp((ts - 0.45 - i * 0.055) / 0.35));
      letters[i].style.opacity = k * (1 - clamp((t - 14.0) / 0.5));
      letters[i].style.transform = `translateY(${(1 - k) * -70}px) rotateX(${(1 - k) * 90}deg)`;
    }
    const nk = easeOut(clamp((ts - 1.4) / 0.5));
    set('cnName2', { opacity: nk * (1 - clamp((t - 14.0) / 0.5)), transform: `translateY(${(1 - nk) * 16}px)` });
    set('cnSkip', { opacity: t < 13.5 ? 0.55 : 0 });
    this.el.style.opacity = 1 - clamp((t - 14.1) / 0.5);

    this._drawFx(t);
  }

  // 摆台：只显示指定的球，其余隐藏
  _show(map) {
    const v = this.view;
    for (const [id, m] of v.ballMeshes) {
      const p = map.get(id);
      const sh = v.ballShadows.get(id);
      m.visible = !!p; sh.visible = !!p && p[2] > -0.001;
      if (!p) continue;
      m.position.set(p[0], R + p[2], -p[1]);
      sh.position.set(p[0], 0.0007, -p[1]);
      if (p[3]) m.quaternion.copy(p[3]);
    }
  }

  _crane(t) {
    const v = this.view, cam = v.camera;
    const k = easeInOut(clamp(t / 2.6));
    const a = lerp(-0.9, -0.2, k);
    const r = lerp(2.4, 2.9, k), h = lerp(3.2, 2.5, k);
    cam.position.set(Math.cos(a) * r, h, Math.sin(a) * r * 0.7);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    const map = new Map();
    for (const b of this.layout) map.set(b.id, [b.x, b.y, 0]);
    this._show(map);
  }

  // 一颗球滚进袋：返回球位置 [x, y, z, quat]
  _roll(ball, pocket, ang, len, k, dropK) {
    const P = TABLE.pockets[pocket];
    let dx, dy;
    if (P.kind === 'corner') { const l = Math.SQRT2; dx = P.sx / l; dy = P.sy / l; }
    else { dx = 0; dy = P.sy; }
    const c = Math.cos(ang), s = Math.sin(ang);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    const S = [P.x - rx * len, P.y - ry * len];
    const d = len * k;
    const x = S[0] + rx * d, y = S[1] + ry * d;
    const z = -dropK * dropK * 0.12;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-ry, 0, -rx).normalize(), d / R);
    return { pos: [x, y, z, q], dir: [rx, ry], P, S };
  }

  _montage(t) {
    const v = this.view, cam = v.camera;
    let sh = SHOTS[0];
    for (const s of SHOTS) if (t >= s.t0) sh = s;
    const lk = clamp((t - sh.t0) / sh.dur);
    // 球：前 72% 滚到袋口，后面掉下去
    const rollK = easeOut(clamp(lk / 0.72));
    const dropK = clamp((lk - 0.66) / 0.34);
    const len = 0.55;
    const r = this._roll(sh.ball, sh.pocket, sh.ang, len, rollK, dropK);
    const map = new Map([[COLOR_ID[sh.ball], r.pos]]);
    // 背景里摆几颗静止的红球，画面不空
    this.decor.forEach(([u, w], i) => {
      const bx = r.S[0] - r.dir[0] * (0.25 + u * 0.6) + r.dir[1] * (w - 0.5) * 0.7;
      const by = r.S[1] - r.dir[1] * (0.25 + u * 0.6) - r.dir[0] * (w - 0.5) * 0.7;
      if (Math.abs(bx) < TABLE.HL - 0.05 && Math.abs(by) < TABLE.HW - 0.05) map.set(2 + i, [bx, by, 0]);
    });
    this._show(map);
    // 镜头：袋口侧面低机位，跟着球轻推
    const [dx, dy] = r.dir;
    const P = r.P;
    const side = sh.side;
    const back = lerp(0.42, 0.3, lk);
    const ex = P.x - dx * back + -dy * side * 0.26, ey = P.y - dy * back + dx * side * 0.26;
    cam.position.set(ex, 0.075 + 0.02 * lk, -ey);
    const lx = P.x - dx * 0.16, ly = P.y - dy * 0.16;
    cam.up.set(0, 1, 0);
    cam.lookAt(lx, 0.02, -ly);
  }

  _finalBlack(t) {
    const v = this.view, cam = v.camera;
    const P = TABLE.pockets[3];               // 右上角袋
    const S = TABLE.spots.black;
    let dx = P.x - S[0], dy = P.y - S[1];
    const L = Math.hypot(dx, dy); dx /= L; dy /= L;
    // 慢动作：先慢慢滚，最后 0.4 秒掉进去
    const k = clamp((t - 7.6) / (T_SLAM - 7.6));
    const rollK = Math.min(1, easeInOut(k) * 1.0);
    const dropK = clamp((t - (T_SLAM - 0.05)) / 0.3);
    const d = (L - 0.02) * rollK;
    const x = S[0] + dx * d, y = S[1] + dy * d;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-dy, 0, -dx).normalize(), d / R);
    const map = new Map([[21, [x, y, -dropK * dropK * 0.14, q]]]);
    // 母球留在后面
    map.set(0, [S[0] - dx * 0.5, S[1] - dy * 0.5, 0]);
    this._show(map);
    // 镜头：袋口后方超低机位，正对着滚过来的黑球，慢慢往下压
    const cx = P.x + dx * 0.2, cy = P.y + dy * 0.2;
    cam.position.set(cx + -dy * 0.03, lerp(0.13, 0.095, easeInOut(k)), -(cy + dx * 0.03));
    cam.up.set(0, 1, 0);
    cam.lookAt(x, R * 0.8, -y);
  }

  _outro(t) {
    const v = this.view, cam = v.camera;
    const ts = t - T_SLAM;
    const k = easeOut(clamp(ts / 4));
    const a = lerp(0.6, 1.4, k);
    cam.position.set(Math.cos(a) * lerp(1.2, 3.0, k), lerp(0.25, 2.2, k), Math.sin(a) * lerp(1.0, 2.2, k));
    cam.up.set(0, 1, 0);
    cam.lookAt(TABLE.pockets[3].x * (1 - k), 0, -TABLE.pockets[3].y * (1 - k));
    this._show(new Map());
  }

  // 彩带 + 爆开的火花（canvas）
  _drawFx(t) {
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height, dpr = this.dpr;
    ctx.clearRect(0, 0, W, H);
    const ts = t - T_SLAM;
    if (ts <= 0) return;
    const fade = 1 - clamp((t - 14.0) / 0.5);
    // 火花：从屏幕中心炸开
    ctx.globalCompositeOperation = 'lighter';
    const cx = W / 2, cy = H * 0.46;
    for (const s of this.sparks) {
      const rr = s.v * Math.min(W, H) * (1 - Math.exp(-ts * 3));
      const al = clamp(1 - ts / 1.6) * fade;
      if (al <= 0) break;
      ctx.fillStyle = `hsla(${(s.hue + t * 120) % 360},100%,65%,${al})`;
      ctx.beginPath(); ctx.arc(cx + Math.cos(s.a) * rr, cy + Math.sin(s.a) * rr * 0.8, s.r * dpr * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // 彩带从天而降
    for (const c of this.confetti) {
      const tt = ts - 0.15 - c.delay;
      if (tt < 0) continue;
      const y = (c.y + c.vy * tt) * H;
      if (y > H + 20) continue;
      const x = (c.x + Math.sin(tt * c.f + c.ph) * c.sway) * W;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(c.rot + c.vr * tt);
      ctx.scale(1, Math.abs(Math.cos(tt * c.f * 1.3 + c.ph)) + 0.15);
      ctx.fillStyle = `hsla(${(c.hue + t * 60) % 360},95%,62%,${0.95 * fade})`;
      ctx.fillRect(-c.w * dpr / 2, -c.h * dpr / 2, c.w * dpr, c.h * dpr);
      ctx.restore();
    }
  }
}
