// ============================================================================
//  教学关：一步一步教会所有按键，每一步用专门摆好的球形
// ============================================================================
import { R, TABLE, castBall } from './physics.js';

const deg = (r) => (r * 180) / Math.PI;
const HL = TABLE.HL, HW = TABLE.HW;

// 沿 "目标球 → 袋口" 的直线往后摆母球，返回 {cue, ball, angle}
function straightIn(ball, pocket, back) {
  let ux = pocket[0] - ball[0], uy = pocket[1] - ball[1];
  const l = Math.hypot(ux, uy); ux /= l; uy /= l;
  return { cue: [ball[0] - ux * back, ball[1] - uy * back], ball, angle: Math.atan2(uy, ux) };
}
const BR_POCKET = [HL - 0.005, -HW + 0.005];   // 右下角袋（瞄袋口中心略里）

export const STEPS = [
  {
    title: '锁定鼠标',
    text: '欢迎！先<b>点一下画面</b>，把鼠标锁定在游戏里（之后按 <b>Esc</b> 可以打开菜单）。',
    setup: (api) => api.layout({ cue: [-0.5, 0], balls: { 1: [0.4, 0.2] }, angle: -0.35 }),
    frame: (api) => api.locked(),
  },
  {
    title: '转向瞄准',
    text: '<b>左右移动鼠标</b>转动球杆，把瞄准线对准 <b>1 号球</b>（黄色）。按住 <b>Shift</b> 可以微调。',
    frame: (api, dt, st) => {
      st.t = api.aimHits(1) ? (st.t || 0) + dt : 0;
      return st.t > 0.6;
    },
  },
  {
    title: '抬头 / 低头',
    text: '<b>前后移动鼠标</b>：往后（往自己方向）移动是<b>抬头</b>看全局，往前移动是<b>低头</b>。先抬头，再低头回来。',
    frame: (api, dt, st) => {
      if (api.S.pitch > 0.7) st.high = true;
      return st.high && api.S.pitch < 0.3;
    },
  },
  {
    title: '出杆',
    text: '<b>按住 S</b>，方向会锁定。然后鼠标<b>往后拉</b>（杆往后），再<b>往前推</b>，杆头碰到母球就出杆，<b>推得越快越有力</b>。没碰到球之前可以来回试杆。把 1 号球打进右下角袋！',
    setup: (api) => { const L = straightIn([0.85, -0.42], BR_POCKET, 0.5); api.layout({ cue: L.cue, balls: { 1: L.ball }, angle: L.angle }); },
    shot: (api, info) => {
      if (info.potted.includes(0)) return { ok: false, msg: '母球也掉袋了，轻一点再试一次' };
      if (info.potted.includes(1)) return { ok: true, msg: '漂亮！' };
      return { ok: false, msg: info.firstHit === 1 ? '碰到了但没进，再试一次（瞄准线对准球的正中）' : '没碰到 1 号球，再试一次' };
    },
  },
  {
    title: '加塞：低杆（缩杆）',
    text: '<b>按住 E</b> 再移动鼠标，可以移动杆头打在母球上的位置（看左下角）。<b>往后移</b>把杆头放到母球<b>下半部</b>，这就是低杆。打进 1 号球，同时让母球<b>往回缩</b>。',
    setup: (api) => { const L = straightIn([0.9, -0.44], BR_POCKET, 0.42); api.layout({ cue: L.cue, balls: { 1: L.ball }, angle: L.angle }); },
    shot: (api, info) => {
      if (info.b > -0.18) return { ok: false, msg: `这一杆没有加低杆（杆头在中间偏上）。先按住 E 往后拉鼠标，再出杆` };
      if (!info.potted.includes(1) || info.potted.includes(0)) return { ok: false, msg: '球没进或母球掉袋，再试一次' };
      const back = (info.cueEnd.x - info.cueStart.x) * info.dx + (info.cueEnd.y - info.cueStart.y) * info.dy;
      const reach = info.distToBall - 2 * R;
      if (back < reach - 0.08) return { ok: true, msg: '母球缩回来了！' };
      return { ok: false, msg: '球进了，但母球没怎么缩。杆头再低一点、出杆再快一点' };
    },
  },
  {
    title: '加塞：左右塞',
    text: '<b>按住 E 左右移动鼠标</b>加左塞或右塞，把母球打向库边，看看<b>反弹角度</b>和不加塞时有什么不同。',
    setup: (api) => api.layout({ cue: [-0.4, 0.1], balls: {}, angle: -0.75 }),
    shot: (api, info) => {
      if (Math.abs(info.a) < 0.18) return { ok: false, msg: '这一杆没有左右塞。按住 E 往左或往右移鼠标' };
      if (!info.cushion) return { ok: false, msg: '母球要碰到库边才看得出效果，力度大一点' };
      return { ok: true, msg: info.a > 0 ? '右塞：碰库后往右"拐"' : '左塞：碰库后往左"拐"' };
    },
  },
  {
    title: '抬杆尾：扎杆',
    text: '<b>按住 B，鼠标往前推</b>，把杆尾抬高（左下角显示仰角）。抬到 <b>25° 以上</b>，再用 E 加一点<b>左右塞</b>出杆：母球会<b>走弧线</b>，这叫扎杆。',
    setup: (api) => api.layout({ cue: [-0.6, 0], balls: {}, angle: 0 }),
    shot: (api, info) => {
      if (deg(info.elev) < 25) return { ok: false, msg: `仰角只有 ${Math.round(deg(info.elev))}°，按住 B 往前推到 25° 以上` };
      if (Math.abs(info.a) < 0.15) return { ok: false, msg: '抬杆了，但没加左右塞，母球不会走弧线。按住 E 左右移一点' };
      return { ok: true, msg: '看到弧线了吗？这就是扎杆' };
    },
  },
  {
    title: '贴库球：自动避让',
    text: '母球<b>贴着库边</b>时，球杆会<b>自动加高杆</b>从库边上方过；离库边<b>一点点</b>时会<b>自动抬杆尾</b>，杆子不会穿进库边（看左下角的黄色提示）。打一杆试试。',
    setup: (api) => api.layout({ cue: [0.25, -HW + R + 0.0004], balls: { 3: [0.75, -0.3] }, angle: Math.atan2(-0.3 + HW - R, 0.5) }),
    shot: () => ({ ok: true, msg: '贴库球就是这样打' }),
  },
  {
    title: '自由球',
    text: '对手犯规后你会得到自由球。<b>按住 M 移动鼠标</b>，把母球移进<b>黄色圈</b>里。',
    setup: (api) => {
      api.layout({ cue: [-0.7, 0.25], balls: { 1: [0.6, 0.0] }, angle: 0, ballInHand: 'anywhere' });
      api.marker('tut', { x: -0.25, y: -0.2, r: 0.05 });
    },
    frame: (api) => {
      const c = api.S.balls[0];
      return Math.hypot(c.x + 0.25, c.y + 0.2) < 0.035;
    },
    leave: (api) => { api.marker('tut', null); api.S.match.ballInHand = null; },
  },
  {
    title: '视角和辅助线',
    text: '按 <b>V</b> 切到俯视，再按 <b>V</b> 切回第一视角。再按 <b>G</b> 切换辅助线（关 / 半 / 全）：<b>半</b>只告诉你会撞到哪，<b>全</b>还会画出目标球的走向。<b>滚轮</b>可以调眼睛离球的远近。',
    event: (api, name, st) => {
      if (name === 'cam') st.v = (st.v || 0) + 1;
      if (name === 'aim') st.g = true;
      return st.v >= 2 && st.g && api.S.camMode === '3d';
    },
  },
  {
    title: '菜单和换杆',
    text: '按 <b>Esc</b> 打开菜单，在「球杆」里<b>换一支杆</b>（小头杆 / 碳纤维 / 大头杆），然后点<b>「继续」</b>。',
    event: (api, name, st) => {
      if (name === 'cue') st.changed = true;
      return st.changed && name === 'resume';
    },
  },
];

export class Tutorial {
  constructor(api) {
    this.api = api;
    this.i = -1;
    this.st = {};
    this.done = false;
    this.waiting = false;
  }

  start() { this.i = -1; this.done = false; this.next(); }

  get step() { return STEPS[this.i]; }

  next() {
    const prev = STEPS[this.i];
    prev?.leave?.(this.api);
    this.i++;
    this.st = {};
    this.waiting = false;
    if (this.i >= STEPS.length) {
      this.done = true;
      this.api.panel({ title: '教学完成！', text: '所有操作都学会了。现在可以去<b>单人练习</b>或者找朋友<b>双人对战</b>。', idx: STEPS.length, total: STEPS.length, fb: '' });
      setTimeout(() => this.api.finish(), 2200);
      return;
    }
    const s = this.step;
    s.setup?.(this.api);
    this.api.panel({ title: s.title, text: s.text, idx: this.i, total: STEPS.length, fb: '' });
  }

  succeed(msg) {
    if (this.waiting) return;
    this.waiting = true;
    this.api.feedback('✓ ' + (msg || '完成！'), 'good');
    setTimeout(() => this.next(), 1300);
  }

  frame(dt) {
    if (this.done || this.waiting || !this.step?.frame) return;
    if (this.step.frame(this.api, dt, this.st)) this.succeed();
  }

  event(name) {
    if (this.done || this.waiting || !this.step?.event) return;
    if (this.step.event(this.api, name, this.st)) this.succeed();
  }

  // 返回 true 表示教学接管了这一杆的善后
  shot(info) {
    if (this.done) return;
    const s = this.step;
    if (this.waiting) return;
    if (s?.shot) {
      const r = s.shot(this.api, info);
      if (r.ok) { this.succeed(r.msg); return; }
      this.api.feedback(r.msg, 'bad');
    }
    // 没完成：把这一步的球形摆回去
    setTimeout(() => { if (!this.waiting && STEPS[this.i] === s) s?.setup?.(this.api); }, 900);
  }
}

export { castBall };
