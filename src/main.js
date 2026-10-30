// ============================================================================
//  游戏主程序：模式（主菜单 / 教学 / 练习 / 双人）、输入、出杆、模拟、规则、界面
// ============================================================================
import { TableView, BALL_COLORS, snookerColorOf } from './render.js';
import { Sim, rackBalls, rackSnooker, strike, makeBall, castBall, setTable, R, TABLE, DT } from './physics.js';
import * as SNK from './snooker.js';
import { computeAim } from './aim.js';
import { newMatch, summarizeShot, judge, GROUP_NAME } from './rules.js';
import { Sfx } from './audio.js';
import { CUES, CUE_IDS, cueSVG } from './cues.js';
import { solveCue, ELEV_MAX } from './clearance.js';
import { Tutorial } from './tutorial.js';
import { showResult, hideResult } from './result.js';
import { Cinematic147 } from './cinematic.js';
import { NetRoom, NET_VERSION, cleanCode } from './net.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const canvas = $('#c');
const view = new TableView(canvas);
const sfx = new Sfx();
const cine = new Cinematic147(view, sfx);

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const DEFAULT_ELEV = 0.07;
const ELEV_MIN = 0.03;
const MAX_SPIN = 0.55;

const S = {
  mode: 'menu',               // menu | tutorial | practice | match
  balls: [], sim: null, match: null,
  phase: 'aim',               // aim | stroke | roll | over
  angle: 0, spinA: 0, spinB: 0, elev: DEFAULT_ELEV,
  eff: { a: 0, b: 0, elev: DEFAULT_ELEV, autoB: false, autoElev: false },   // 自动避让后实际使用的值
  power: 0, charging: false,
  aimMode: store.get('pool.aim', 'full'),
  camMode: store.get('pool.cam', '3d'),
  cueId: CUES[store.get('pool.cue', 'res')] ? store.get('pool.cue', 'res') : 'res',
  sens: parseFloat(store.get('pool.sens', '1')) || 1,
  powerSens: parseFloat(store.get('pool.psens', '1')) || 1,
  pitch: 0.2, dist: 0.6,
  acc: 0, evIdx: 0, rollT: 0, stroke: null,
  paused: false,
  stats: null,                 // 每位玩家：出杆 / 进球 / 犯规（结算画面用）
  modal: false,                // 斯诺克犯规选择 / 局终弹窗打开时不能出杆
  snk: null, preShot: null,
  shotInfo: null,
  net: null,                   // 联机：{ room, me: 0 房主 / 1 加入者, names, code, queue, ... }
};
const cueDef = () => CUES[S.cueId];
const speedOf = (p) => 0.25 + 10.75 * Math.pow(p, 1.8);
const dir = () => [Math.cos(S.angle), Math.sin(S.angle)];
const cue = () => S.balls[0];
const inGame = () => S.mode !== 'menu';
// 联机：现在是不是轮到我；观战的一方固定俯视
const myTurn = () => !S.net || !S.match || S.match.turn === S.net.me;
const effCam = () => (S.net && inGame() && !myTurn() ? 'top' : S.camMode);

// ---------------------------------------------------------------------------
//  模式切换
// ---------------------------------------------------------------------------
function resetShotState() {
  S.phase = 'aim'; S.sim = null; S.power = 0; S.charging = false;
  S.camBlend = 0.6; S.vis = null;
  S.spinA = 0; S.spinB = 0; S.elev = DEFAULT_ELEV;
  view.potAnims = [];
  updateSpinDot();
}

// 切换球台（八球 / 斯诺克）
function ensureTable(kind) {
  if (TABLE.kind !== kind) { setTable(kind); view.setTableStyle(); }
  sfx.pitch = kind === 'snooker' ? 1.07 : 1;
}

function startMatch(names, balls, breaker = 0) {
  ensureTable('pool');
  S.mode = 'match';
  S.balls = balls ? cloneBalls(balls) : rackBalls((Math.random() * 2 ** 31) | 0);
  S.match = newMatch(names);
  S.match.turn = breaker;
  S.stats = newStats(2);
  S.angle = 0;
  resetShotState();
  hideAllOverlays();
  updateHUD();
  toast(`${names[breaker]} 开球！母球可以在开球线后摆位（按住 M）`);
  netTurnChanged();
}

function startPractice() {
  ensureTable('pool');
  S.mode = 'practice';
  S.balls = rackBalls((Math.random() * 2 ** 31) | 0);
  S.match = newMatch([store.get('pool.name0', '我')]);
  S.stats = newStats(1);
  S.angle = 0;
  resetShotState();
  hideAllOverlays();
  updateHUD();
  toast('单人练习：随便打，不计犯规');
}

let tutorial = null;
function startTutorial() {
  ensureTable('pool');
  S.mode = 'tutorial';
  S.match = newMatch(['教学']);
  S.match.ballInHand = null;
  S.balls = [makeBall(0, -0.5, 0)];
  resetShotState();
  hideAllOverlays();
  setAimMode('full', true);
  setCam('3d', true);
  tutorial = new Tutorial(tutApi);
  $('#tut').classList.remove('hidden');
  updateHUD();
  tutorial.start();
}

function showMainMenu() {
  netLeave();
  ensureTable('pool');
  S.mode = 'menu';
  if (locked()) unlock();
  hideAllOverlays();
  $('#mainMenu').classList.remove('hidden');
  // 背景放一个摆好的球堆
  S.balls = rackBalls(7);
  S.match = newMatch(['', '']);
  S.match.ballInHand = null;
  resetShotState();
  updateHUD();
}

// ---- 斯诺克 ----
function startSnooker(names, bestOf, keepMatch, balls) {
  ensureTable('snooker');
  S.mode = 'snooker';
  if (!keepMatch) S.snk = SNK.newSnookerMatch(names, bestOf);
  S.match = S.snk;
  S.stats = newStats(2);
  S.max147 = null;          // 这一局有没有人打出 147
  S.balls = balls ? cloneBalls(balls) : rackSnooker((Math.random() * 2 ** 31) | 0);
  S.angle = Math.atan2(S.balls[1].y - S.balls[0].y, S.balls[1].x - S.balls[0].x);
  S.dist = 0.75;
  resetShotState();
  hideAllOverlays();
  updateHUD();
  banner(`FRAME ${S.snk.frameNo}`, `${S.snk.players[S.snk.turn].name} 开球 · 母球放在 D 区内（按住 M 摆位）`, '#e2b25a');
  netTurnChanged();
}
const cloneBalls = (bs) => bs.map((b) => ({ ...b }));

const newStats = (n = 2) => Array.from({ length: n }, () => ({ shots: 0, pots: 0, fouls: 0 }));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function hideAllOverlays() {
  hideResult();
  for (const id of ['#mainMenu', '#nameModal', '#onlineModal', '#netLost', '#pause', '#over', '#foulModal', '#frameModal']) $(id).classList.add('hidden');
  S.modal = false;
  document.body.classList.toggle('snk', S.mode === 'snooker');
  $('#snkUI').classList.toggle('hidden', S.mode !== 'snooker');
  $('#tut').classList.toggle('hidden', S.mode !== 'tutorial');
  document.body.classList.toggle('tut', S.mode === 'tutorial');
  S.paused = false;
}

// ---- 教学 API ----
const tutApi = {
  S,
  locked: () => locked(),
  layout({ cue: c, balls, angle, ballInHand = null }) {
    const list = [makeBall(0, c[0], c[1])];
    for (const [id, p] of Object.entries(balls)) list.push(makeBall(+id, p[0], p[1]));
    S.balls = list.sort((a, b) => a.id - b.id);
    if (angle !== undefined) S.angle = angle;
    S.match.ballInHand = ballInHand;
    resetShotState();
    updateHUD();
  },
  aimHits(id) {
    const [dx, dy] = dir();
    const h = castBall(cue().x, cue().y, dx, dy, S.balls, 0);
    return h.type === 'ball' && h.ball.id === id;
  },
  marker: (id, m) => view.setMarker(id, m),
  panel({ title, text, idx, total, fb }) {
    $('#tutTitle').textContent = title;
    $('#tutText').innerHTML = text;
    $('#tutStep').textContent = idx < total ? `第 ${idx + 1} / ${total} 步` : '完成';
    $('#tutBar').style.width = `${(Math.min(idx, total) / total) * 100}%`;
    tutApi.feedback(fb || '', '');
  },
  feedback(msg, cls) {
    const el = $('#tutFb');
    el.textContent = msg; el.className = cls || '';
  },
  finish() {
    store.set('pool.tutDone', '1');
    $('#tut').classList.add('hidden');
    tutorial = null;
    showMainMenu();
  },
};
const tutForced = () => store.get('pool.tutDone', '0') !== '1';

// ---------------------------------------------------------------------------
//  摆球工具
// ---------------------------------------------------------------------------
function validCuePos(x, y) {
  if (Math.abs(x) > TABLE.HL - R - 0.002 || Math.abs(y) > TABLE.HW - R - 0.002) return false;
  if (S.match.ballInHand === 'kitchen' && x > TABLE.headX) return false;
  if (S.match.ballInHand === 'D' && (x > TABLE.baulkX || (x - TABLE.baulkX) ** 2 + y * y > TABLE.dR ** 2)) return false;
  for (const b of S.balls) {
    if (b.id === 0 || !b.on) continue;
    if ((b.x - x) ** 2 + (b.y - y) ** 2 < (2 * R + 0.001) ** 2) return false;
  }
  return true;
}

function freeSpotNear(x, y, ok) {
  if (ok(x, y)) return [x, y];
  for (let r = 0.01; r < 1.5; r += 0.01)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (ok(px, py)) return [px, py];
    }
  return [x, y];
}

// ---------------------------------------------------------------------------
//  出杆
// ---------------------------------------------------------------------------
function canShoot() { return inGame() && !S.paused && !S.modal && S.phase === 'aim' && cue().on && myTurn(); }
// 出杆只能在第一视角（俯视只用来看全局，不然太占便宜）
function canStroke() {
  if (!canShoot()) return false;
  if (effCam() !== '3d') { toast('俯视只能看台面，按 V 切回第一视角才能出杆'); return false; }
  return true;
}

function beginStroke() {
  if (!canStroke() || S.power < 0.01) { S.power = 0; S.charging = false; return; }
  S.phase = 'stroke';
  S.stroke = { t: 0, power: S.power, dur: 0.16 - 0.08 * S.power };
  S.charging = false;
}

function doStrike(speedOverride, remote) {
  const c = cue();
  const e = S.eff;
  // 击球参数：自己打的现场算；联机对手打的直接用对方发来的（两边完全一样）
  const P = remote ? remote.p : (() => {
    const [dx, dy] = dir();
    return { dx, dy, speed: speedOverride ?? speedOf(S.stroke.power), a: e.a, b: e.b, ce: Math.cos(e.elev), se: Math.sin(e.elev), squirt: cueDef().squirt };
  })();
  const { dx, dy, speed } = P;
  S.shotBy = S.match.turn;
  if (S.net && !remote) {
    S.net.seq++;
    netSend({ t: 'shot', seq: S.net.seq, balls: cloneBalls(S.balls), angle: S.angle, eff: { ...S.eff }, p: P, bih: S.match.ballInHand });
  }
  // 记录这一杆（教学判断用）
  const tgt = castBall(c.x, c.y, dx, dy, S.balls, 0);
  S.shotInfo = { a: e.a, b: e.b, elev: e.elev, dx, dy, cueStart: { x: c.x, y: c.y }, distToBall: tgt.type === 'ball' ? Math.hypot(tgt.ball.x - c.x, tgt.ball.y - c.y) : 0 };
  if (S.mode === 'snooker') {
    // 出杆前：记下球位（MISS 可以摆回原位）和是否被斗住（判 MISS 用）
    S.preShot = {
      balls: S.balls.map((b) => ({ ...b })),
      on: S.snk.on, seqId: S.snk.seqId, freeBall: S.snk.freeBall, ballInHand: S.snk.ballInHand, turn: S.snk.turn,
      snookered: !S.snk.ballInHand && SNK.isSnookered(S.balls, SNK.ballsOn(S.snk, S.balls)),
    };
  }
  strike(c, P);
  S.sim = new Sim(S.balls);
  S.evIdx = 0; S.acc = 0; S.rollT = 0;
  S.phase = 'roll';
  S.match.ballInHand = null;
  sfx.cue(Math.min(1, speed / 11));
  S.power = 0;
  updateHUD();
}

function respawnCue(where = 'anywhere') {
  const c = cue();
  c.on = true; c.pocket = -1;
  S.match.ballInHand = where;
  const [x, y] = TABLE.kind === 'snooker' ? freeSpotNear(TABLE.baulkX - 0.08, 0.1, validCuePos) : freeSpotNear(TABLE.headX - 0.05, 0, validCuePos);
  c.x = x; c.y = y;
}

function endShot() {
  endShotLocal();
  // 联机：打这一杆的人把结算后的状态发给对方核对（两边物理本来就一致，这里是保险）
  if (S.net) {
    if (S.shotBy === S.net.me) netSend({ t: 'sync', seq: S.net.seq, ...snapshotState() });
    netTurnChanged();
  }
}
function endShotLocal() {
  const shot = summarizeShot(S.sim.events);
  for (const b of S.balls) { b.vx = b.vy = b.wx = b.wy = b.wz = 0; }
  S.sim = null;

  if (S.mode === 'snooker') { endSnookerShot(shot); return; }

  if (S.mode === 'tutorial') {
    const info = { ...S.shotInfo, potted: shot.pocketed, firstHit: shot.firstHit, cushion: S.lastEvents.some((e) => e.type === 'cushion' && e.a === 0), cueEnd: { x: cue().x, y: cue().y } };
    if (shot.scratch) respawnCue(null);
    S.phase = 'aim';
    tutorial?.shot(info);
    resetSpinAfterShot();
    return;
  }

  if (S.mode === 'practice') {
    S.stats[0].shots++;
    S.stats[0].pots += shot.pocketed.filter((id) => id !== 0).length;
    if (shot.scratch) { S.stats[0].fouls++; respawnCue('anywhere'); toast('母球落袋，自由球（按住 M 摆位）'); }
    const left = S.balls.filter((b) => b.on && b.id).length;
    if (left === 0) {
      S.phase = 'over';
      unlock();
      const st = S.stats[0];
      setTimeout(() => showResult({
        kicker: 'PRACTICE COMPLETE', title: 'CLEARED', winner: S.match.players[0].name, sub: `${st.shots} 杆清台`,
        players: [{ name: S.match.players[0].name, score: st.shots, tag: 'SHOTS · 出杆数' }], winnerIdx: 0, rightWord: 'CLEAR', badge: 'CLEARED',
        stats: [{ label: '进球', values: [st.pots] }, { label: '母球落袋', values: [st.fouls] }, { label: '平均每杆进球 %', values: [pct(st.pots, st.shots)] }],
        primary: { text: '再练一局', onClick: startPractice }, secondary: { text: '主菜单', onClick: showMainMenu },
      }), 600);
    } else S.phase = 'aim';
    resetSpinAfterShot();
    updateHUD();
    return;
  }

  // ---- 双人对战：规则判定 ----
  const shooter = S.match.turn;
  const res = judge(S.match, S.balls, shot);
  S.stats[shooter].shots++;
  S.stats[shooter].pots += res.foul ? 0 : shot.pocketed.filter((id) => id !== 0).length;
  if (res.foul) S.stats[shooter].fouls++;
  if (res.respot8) {
    const b8 = S.balls[8];
    const ok = (x, y) => S.balls.every((b) => !b.on || b.id === 8 || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * R + 0.001) ** 2);
    let x = TABLE.footX, y = 0;
    while (!ok(x, 0) && x < TABLE.HL - R) x += 0.005;
    if (!ok(x, 0)) [x, y] = freeSpotNear(TABLE.footX, 0, ok);
    b8.x = x; b8.y = y; b8.on = true; b8.pocket = -1;
  }
  if (shot.scratch) respawnCue(S.match.ballInHand);
  resetSpinAfterShot();
  if (res.gameOver) {
    S.phase = 'over';
    unlock();
    const m = S.match, st = S.stats, w = m.winner;
    const left = (g) => (g ? S.balls.filter((b) => b.on && (g === 'solid' ? b.id >= 1 && b.id <= 7 : b.id >= 9 && b.id <= 15)).length : 7);
    setTimeout(() => showResult({
      kicker: 'EIGHT BALL · MATCH RESULT', title: 'VICTORY', winner: m.players[w].name, sub: res.msg,
      players: m.players.map((p, i) => ({ name: p.name + (p.group ? `（${GROUP_NAME[p.group]}）` : ''), score: 7 - left(p.group) + (i === w ? 1 : 0) })),
      winnerIdx: w, scoreLabel: '进球数',
      stats: [
        { label: '出杆', values: st.map((x) => x.shots) },
        { label: '进球', values: st.map((x) => x.pots) },
        { label: '犯规', values: st.map((x) => x.fouls) },
        { label: '进球率 %', values: st.map((x) => pct(x.pots, x.shots)) },
      ],
      ...resultButtons('再来一局', () => startMatch(m.players.map((p) => p.name)), () => netRestart('rematch')),
    }), 900);
  } else {
    S.phase = 'aim';
    toast(S.match.ballInHand ? res.msg + '（按住 M 摆母球）' : res.msg);
  }
  updateHUD();
}

function resetSpinAfterShot() {
  S.camBlend = 0.6;     // 一杆打完，镜头平滑飞回母球后面
  S.spinA = 0; S.spinB = 0; S.elev = DEFAULT_ELEV;
  updateSpinDot();
}

// ---------------------------------------------------------------------------
//  主循环
// ---------------------------------------------------------------------------
let last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; clock += dt;
  // 147 过场动画播放中：由它接管镜头和球
  if (cine.active) { cine.update(); view.render(dt); requestAnimationFrame(frame); return; }
  let simDt = 0;

  netPump();
  if (S.phase === 'stroke') {
    S.stroke.t += dt;
    if (S.stroke.t >= S.stroke.dur) { const r = S.stroke.remote; S.stroke.remote = null; doStrike(undefined, r); }
  }
  if (S.phase === 'roll') {
    S.acc += dt; S.rollT += dt;
    let n = 0;
    while (S.acc >= DT && n < 60) { S.sim.step(); S.acc -= DT; n++; simDt += DT; }
    if (n === 60) S.acc = 0;
    const evs = S.sim.events;
    for (; S.evIdx < evs.length; S.evIdx++) {
      const e = evs[S.evIdx];
      if (e.type === 'ball') sfx.ball(e.speed);
      else if (e.type === 'cushion') sfx.cushion(e.speed, e.jaw);
      else if (e.type === 'pocket') { sfx.pocket(e.speed); view.startPotAnim(e); }
    }
    if (!S.sim.moving() && view.potAnims.length === 0) { S.lastEvents = S.sim.events; endShot(); }
  }

  view.updatePotAnims(dt);
  view.syncBalls(S.balls, simDt);

  const [dx, dy] = dir();
  const aiming = S.phase === 'aim' || S.phase === 'stroke';
  // 球杆避让（贴库自动加高杆 / 靠库自动抬杆尾 / 避开其它球）
  const spectating = S.net && inGame() && !myTurn();
  if (spectating && aiming) netApplyAim(dt);
  else if (aiming && cue().on) {
    S.eff = solveCue(S.balls, dx, dy, S.spinA, S.spinB, S.elev, cueDef());
    // 画面上用的杆头位置 / 仰角做一点平滑：自动抬杆、贴库加高杆这类"跳变"会在约 0.1 秒内过渡过去，
    // 镜头跟着平滑移动，不会突然瞬移（出杆用的仍是精确值）
    const kv = 1 - Math.exp(-dt * 22);
    if (!S.vis) S.vis = { ...S.eff };
    S.vis.a += (S.eff.a - S.vis.a) * kv;
    S.vis.b += (S.eff.b - S.vis.b) * kv;
    S.vis.elev += (S.eff.elev - S.vis.elev) * kv;
    updateSpinDot();
  }
  if (S.phase === 'aim' && inGame()) view.setAim(computeAim(S.aimMode, S.balls, dx, dy));
  view.showAim(S.phase === 'aim' && inGame() && S.aimMode !== 'off' && cue().on);

  // 球杆
  let pull = 0;
  if (S.phase === 'aim') pull = spectating ? (S.net.aim?.pull ?? 0.02) : stroke.held ? stroke.pull : 0.02 + S.power * 0.26;
  else if (S.phase === 'stroke') {
    const k = Math.min(1, S.stroke.t / S.stroke.dur);
    pull = (0.02 + S.stroke.power * 0.26) * (1 - k * k);
  } else if (S.phase === 'roll' && S.rollT < 0.2) pull = -Math.min(0.06, S.rollT * 0.5);
  const cueShown = inGame() && cue().on && (aiming || (S.phase === 'roll' && S.rollT < 0.2));
  if (S.phase !== 'roll') S.cueAnchor = { x: cue().x, y: cue().y };
  const V = S.vis || S.eff;
  view.setCue(cueShown, S.phase === 'roll' ? S.cueAnchor : cue(), dx, dy, V.a, V.b, pull, V.elev);
  view.setHandRing(S.phase === 'aim' && inGame() && !!S.match.ballInHand, cue(), clock);
  if (S.net && !spectating && aiming && inGame()) netSendAim(pull, V);

  // 镜头
  if (S.mode === 'menu') {
    const a = clock * 0.08;
    view.camera.position.set(Math.cos(a) * 2.6, 1.25, Math.sin(a) * 2.0);
    view.camera.up.set(0, 1, 0);
    view.camera.layers.enable(1);
    view.camera.lookAt(0, -0.1, 0);
    view.camPos.copy(view.camera.position);
  } else {
    const cm = effCam();
    if (cm !== S._lastCam) { S.camBlend = 0.6; S._lastCam = cm; if (cm !== '3d') unlock(); updateHUD(); }
    if (!(S.phase === 'roll' && cm === '3d')) {
      // 瞄准时镜头直接锁在球杆上（不做平滑），球杆和画面完全同步；只有切视角 / 一杆打完回到母球时才平滑过渡
      S.camBlend = Math.max(0, (S.camBlend || 0) - dt);
      const lockCam = cm === '3d' && (S.phase === 'aim' || S.phase === 'stroke') && S.camBlend <= 0;
      view.updateCamera(cm, cue(), dx, dy, S.pitch, S.dist, dt, lockCam, V.b, V.elev);
    }
  }

  // 力度条
  if (stroke.held) {
    $('#powerFill').style.height = `${(Math.max(0, stroke.pull) / STROKE.maxPull) * 100}%`;
    const v = cueSpeedNow();
    $('#powerVal').textContent = v > 0.05 ? `${Math.min(STROKE.maxSpeed, v * STROKE.gain * S.powerSens).toFixed(1)} m/s` : '拉杆';
  } else {
    $('#powerFill').style.height = `${S.power * 100}%`;
    $('#powerVal').textContent = S.power > 0 ? `${speedOf(S.power).toFixed(1)} m/s` : '';
  }
  if (S.charging && S.keyCharge) S.power = Math.min(1, S.power + dt / 1.6);

  tutorial?.frame(dt);

  // 有东西在动才重算阴影（省性能）
  const sig = `${S.phase}|${S.angle.toFixed(4)}|${pull.toFixed(4)}|${S.eff.a.toFixed(3)},${S.eff.b.toFixed(3)},${S.eff.elev.toFixed(3)}|${cue().x.toFixed(4)},${cue().y.toFixed(4)}|${cueShown}`;
  if (S.phase === 'roll' || S.phase === 'stroke' || view.potAnims.length || sig !== S._sig) view.shadowDirty = true;
  S._sig = sig;

  // 结算画面盖住整个屏幕时不渲染 3D 场景（省性能）
  if (document.getElementById('result').classList.contains('hidden')) view.render(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
//  鼠标锁定
// ---------------------------------------------------------------------------
const locked = () => document.pointerLockElement === canvas;
let expectUnlock = false;      // 程序主动解锁（不弹菜单）
let ownLock = false;           // 俯视时按键临时锁定，松键后释放
function lock() { if (!locked() && inGame() && !S.paused) canvas.requestPointerLock?.(); }
function unlock() { if (locked()) { expectUnlock = true; document.exitPointerLock(); } }

let lockedAt = 0;
document.addEventListener('pointerlockchange', () => {
  if (locked()) lockedAt = performance.now();
  $('#lockHint').classList.toggle('show', inGame() && effCam() === '3d' && !locked() && !S.paused && S.phase !== 'over');
  if (!locked()) {
    hold.E = hold.B = hold.M = false; stroke.held = false; stroke.pull = STROKE.rest; ownLock = false;
    // 玩家按 Esc 解锁 → 打开菜单
    if (!expectUnlock && inGame() && !S.paused && S.phase !== 'over') openPause();
    expectUnlock = false;
  }
});

// ---- S 键出杆 ----
const STROKE = {
  pxToM: 0.0007,     // 鼠标每移动 1 像素，杆移动多少米
  maxPull: 0.32,     // 最多往后拉多少米
  rest: 0.02,        // 架杆时杆头离母球的距离
  gain: 2.0,         // 杆头速度 → 母球初速 的放大系数（再乘以菜单里的「出杆力度灵敏度」）
  maxSpeed: 11,      // 母球最大初速 m/s
  window: 70,        // 测速窗口 ms
};
const stroke = { held: false, pull: STROKE.rest, samples: [] };
const cueSpeedNow = () => {
  const ss = stroke.samples;
  if (ss.length < 2) return 0;
  const a = ss[0], b = ss[ss.length - 1];
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? (a.pull - b.pull) / dt : 0;
};
const hold = { E: false, B: false, M: false };
function ensureLock() {
  if (!locked()) { canvas.requestPointerLock?.(); ownLock = effCam() !== '3d'; }
}
function releaseLockIfOwn() {
  if (ownLock && locked() && !stroke.held && !hold.E && !hold.B && !hold.M) { ownLock = false; unlock(); }
}
function strokeStart() {
  if (stroke.held || !canStroke()) return;
  stroke.held = true; stroke.pull = STROKE.rest; stroke.samples = [];
  ensureLock();
}
function strokeEnd() {
  if (!stroke.held) return;
  stroke.held = false; stroke.pull = STROKE.rest; stroke.samples = [];
  releaseLockIfOwn();
}

document.addEventListener('mousemove', (e) => {
  if (!locked() || !canShoot()) return;
  // Chrome 在鼠标锁定时偶尔会报出一个异常大的位移（尤其刚锁定、或 Windows 上切窗口后），直接丢掉，避免镜头瞬移
  if (Math.abs(e.movementX) > 180 || Math.abs(e.movementY) > 180) return;
  if (performance.now() - lockedAt < 80) return;
  if (stroke.held) {
    const now = performance.now();
    stroke.pull = Math.min(STROKE.maxPull, stroke.pull + e.movementY * STROKE.pxToM);
    stroke.samples.push({ t: now, pull: stroke.pull });
    while (stroke.samples.length > 2 && now - stroke.samples[0].t > STROKE.window) stroke.samples.shift();
    if (stroke.pull <= 0) {
      const v = cueSpeedNow();
      if (v > 0.03) {
        const speed = Math.min(STROKE.maxSpeed, v * STROKE.gain * S.powerSens);
        stroke.held = false; stroke.samples = [];
        doStrike(speed);
        releaseLockIfOwn();
      } else stroke.pull = 0;
    }
    return;
  }
  const fine = (e.shiftKey ? 0.15 : 1) * S.sens;
  if (hold.E) {
    let a = S.spinA + e.movementX * 0.003 * fine, b = S.spinB - e.movementY * 0.003 * fine;
    const l = Math.sqrt(a * a + b * b);
    if (l > MAX_SPIN) { a *= MAX_SPIN / l; b *= MAX_SPIN / l; }
    S.spinA = a; S.spinB = b;
    return;
  }
  if (hold.B) {
    S.elev = Math.max(ELEV_MIN, Math.min(ELEV_MAX, S.elev - e.movementY * 0.0025 * fine));
    return;
  }
  if (hold.M) {
    if (!S.match.ballInHand) return;
    const c = cue();
    let mx, my;
    if (effCam() === '3d') {
      const [dx, dy] = dir();
      const k = 0.0006 * fine;
      mx = (e.movementX * dy - e.movementY * dx) * k;
      my = (-e.movementX * dx - e.movementY * dy) * k;
    } else { mx = e.movementX * 0.0012 * fine; my = -e.movementY * 0.0012 * fine; }
    if (validCuePos(c.x + mx, c.y + my)) { c.x += mx; c.y += my; }
    else if (validCuePos(c.x + mx, c.y)) c.x += mx;
    else if (validCuePos(c.x, c.y + my)) c.y += my;
    return;
  }
  S.angle -= e.movementX * 0.0012 * fine;
  S.pitch = Math.max(0.05, Math.min(1.2, S.pitch + e.movementY * 0.0015 * fine));
});

// ---- 鼠标（未锁定：俯视拖动瞄准 / 拖动自由球）----
let drag = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (!inGame() || S.paused || locked()) return;
  if (!myTurn()) return;           // 联机观战：只看不能动
  if (effCam() === '3d') { lock(); return; }
  if (S.phase !== 'aim') return;
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect();
  const p = view.pick(e.clientX, e.clientY, rect);
  const c = cue();
  if (e.button === 0 && S.match.ballInHand && p && (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < (2.6 * R) ** 2) { drag = { kind: 'cue' }; return; }
  drag = { kind: 'aim', x: e.clientX, angle: S.angle };
  if (p && !e.shiftKey) S.angle = Math.atan2(p.y - c.y, p.x - c.x);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = view.pick(e.clientX, e.clientY, canvas.getBoundingClientRect());
  if (drag.kind === 'cue') {
    if (!p) return;
    let x = Math.max(-TABLE.HL + R + 0.003, Math.min(TABLE.HL - R - 0.003, p.x));
    const y = Math.max(-TABLE.HW + R + 0.003, Math.min(TABLE.HW - R - 0.003, p.y));
    if (S.match.ballInHand === 'kitchen') x = Math.min(x, TABLE.headX);
    if (validCuePos(x, y)) { cue().x = x; cue().y = y; }
    return;
  }
  if (e.shiftKey) S.angle = drag.angle - (e.clientX - drag.x) * 0.0004;
  else if (p) S.angle = Math.atan2(p.y - cue().y, p.x - cue().x);
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!inGame() || S.paused) return;
  S.dist = Math.max(0.3, Math.min(2.5, S.dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });

// ---- 力度条（备用出杆方式）----
const pbar = $('#power');
let pdrag = null;
pbar.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (!canStroke()) return;
  pbar.setPointerCapture(e.pointerId);
  pdrag = { y: e.clientY, h: pbar.getBoundingClientRect().height };
  S.charging = true;
});
pbar.addEventListener('pointermove', (e) => {
  if (!pdrag) return;
  S.power = Math.max(0, Math.min(1, (e.clientY - pdrag.y) / (pdrag.h * 0.85)));
});
pbar.addEventListener('pointerup', () => { if (!pdrag) return; pdrag = null; beginStroke(); });
pbar.addEventListener('pointercancel', () => { pdrag = null; S.power = 0; S.charging = false; });

// ---- 塞（击球点）图 ----
const spinEl = $('#spin');
function setSpinFromEvent(e) {
  const r = spinEl.getBoundingClientRect();
  let a = ((e.clientX - r.left) / r.width) * 2 - 1;
  let b = -(((e.clientY - r.top) / r.height) * 2 - 1);
  const l = Math.sqrt(a * a + b * b);
  if (l > MAX_SPIN) { a *= MAX_SPIN / l; b *= MAX_SPIN / l; }
  S.spinA = a; S.spinB = b;
}
let lastSpinKey = '';
function updateSpinDot() {
  const e = S.eff;
  const key = `${S.spinA.toFixed(3)},${S.spinB.toFixed(3)},${S.elev.toFixed(3)},${e.a.toFixed(3)},${e.b.toFixed(3)},${e.elev.toFixed(3)},${S.cueId}`;
  if (key === lastSpinKey) return;
  lastSpinKey = key;
  $('#spinDot').style.left = `${50 + e.a * 50}%`;
  $('#spinDot').style.top = `${50 - e.b * 50}%`;
  const showUser = e.autoB;
  $('#spinUser').style.display = showUser ? 'block' : 'none';
  $('#spinUser').style.left = `${50 + S.spinA * 50}%`;
  $('#spinUser').style.top = `${50 - S.spinB * 50}%`;
  const names = [];
  if (e.b > 0.08) names.push('高杆'); else if (e.b < -0.08) names.push('低杆');
  if (e.a > 0.08) names.push('右塞'); else if (e.a < -0.08) names.push('左塞');
  $('#spinLabel').textContent = (names.length ? names.join(' + ') : '中杆') + ` · 仰角 ${Math.round((e.elev * 180) / Math.PI)}°`;
  const badge = $('#autoBadge');
  const tips = [];
  if (e.autoB) tips.push('贴库：自动加高杆');
  if (e.autoElev) tips.push('自动抬杆尾');
  badge.textContent = tips.join(' · ');
  badge.classList.toggle('hidden', !tips.length);
  $('#cueName').textContent = cueDef().name + ' · ' + cueDef().specs[0];
}
let sdrag = false;
spinEl.addEventListener('pointerdown', (e) => { if (!canShoot()) return; sdrag = true; spinEl.setPointerCapture(e.pointerId); setSpinFromEvent(e); });
spinEl.addEventListener('pointermove', (e) => { if (sdrag) setSpinFromEvent(e); });
spinEl.addEventListener('pointerup', () => { sdrag = false; });
spinEl.addEventListener('dblclick', () => { S.spinA = 0; S.spinB = 0; S.elev = DEFAULT_ELEV; });

// ---- 键盘 ----
let pauseOpenedAt = 0;
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  sfx.unlock();
  if (cine.active && (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); cine.skip(); return; }
  if (e.code === 'Escape') {
    if (performance.now() - pauseOpenedAt < 300) return;
    if (!$('#result').classList.contains('hidden')) return;   // 结算画面上不弹菜单
    if (S.paused) closePause();
    else if (inGame() && S.phase !== 'over') openPause();
    return;
  }
  if (!inGame() || S.paused) return;
  if (e.code === 'KeyV' && S.net && !myTurn()) { toast('观战时固定俯视，轮到你时恢复你选的视角'); return; }
  if (!myTurn() && e.code !== 'KeyG' && e.code !== 'KeyV') return;
  const step = e.shiftKey ? 0.0006 : 0.006;
  if (e.code === 'ArrowLeft') { S.angle += step; e.preventDefault(); }
  else if (e.code === 'ArrowRight') { S.angle -= step; e.preventDefault(); }
  else if (e.code === 'ArrowUp') { S.pitch = Math.min(1.2, S.pitch + 0.03); e.preventDefault(); }
  else if (e.code === 'ArrowDown') { S.pitch = Math.max(0.05, S.pitch - 0.03); e.preventDefault(); }
  else if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat && canStroke() && !S.charging) { S.charging = true; S.keyCharge = true; S.power = 0; }
  }
  else if (e.code === 'KeyS') { e.preventDefault(); if (!e.repeat) strokeStart(); }
  else if (e.code === 'KeyE' || e.code === 'KeyB' || e.code === 'KeyM') {
    e.preventDefault();
    if (!e.repeat && canShoot()) { hold[e.code[3]] = true; ensureLock(); }
  }
  else if (e.code === 'KeyV') setCam(S.camMode === '3d' ? 'top' : '3d');
  else if (e.code === 'KeyG') setAimMode({ off: 'half', half: 'full', full: 'off' }[S.aimMode]);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyS') strokeEnd();
  if (e.code === 'KeyE' || e.code === 'KeyB' || e.code === 'KeyM') { hold[e.code[3]] = false; releaseLockIfOwn(); }
  if (e.code === 'Space' && S.keyCharge) { S.keyCharge = false; beginStroke(); }
});

// ---------------------------------------------------------------------------
//  菜单 / 设置
// ---------------------------------------------------------------------------
function openPause() {
  S.paused = true;
  pauseOpenedAt = performance.now();
  stroke.held = false; S.charging = false; S.keyCharge = false; S.power = 0;
  unlock();
  renderCueList();
  const forced = S.mode === 'tutorial' && tutForced();
  $('#pTutorial').classList.toggle('hidden', S.mode === 'tutorial');
  $('#pRestart').classList.toggle('hidden', S.mode === 'tutorial' || !!S.net);
  $('#pMain').classList.toggle('hidden', forced);
  $('#pMain').textContent = S.net ? '离开房间' : '返回主菜单';
  $('#pauseTitle').textContent = forced ? '菜单（完成教学后解锁更多）' : '菜单';
  $('#pause').classList.remove('hidden');
  $('#lockHint').classList.remove('show');
}
function closePause() {
  $('#pause').classList.add('hidden');
  S.paused = false;
  tutorial?.event('resume');
  if (effCam() === '3d' && inGame()) lock();
}

function renderCueList() {
  $('#cueList').innerHTML = CUE_IDS.map((id) => {
    const d = CUES[id];
    return `<button class="cuecard ${id === S.cueId ? 'on' : ''}" data-cue="${id}">
      <div class="t"><b>${d.name}</b><span>${d.model}</span></div>
      ${cueSVG(d)}
      <div class="specs">${d.specs.map((s) => `<i>${s}</i>`).join('')}</div>
      <div class="note">${d.note}</div>
      ${id === S.cueId ? '<div class="eq">✓ 正在使用</div>' : ''}
    </button>`;
  }).join('');
  $$('#cueList [data-cue]').forEach((b) => b.addEventListener('click', () => setCueType(b.dataset.cue)));
}
function setCueType(id) {
  if (!CUES[id]) return;
  const changed = id !== S.cueId;
  S.cueId = id; store.set('pool.cue', id);
  view.setCueModel(CUES[id]);
  renderCueList();
  updateSpinDot();
  if (changed) tutorial?.event('cue');
}

function setAimMode(m, silent) {
  S.aimMode = m; store.set('pool.aim', m);
  $$('[data-aim]').forEach((b) => b.classList.toggle('on', b.dataset.aim === m));
  if (!silent) { toast(`辅助线：${{ off: '关', half: '半', full: '全' }[m]}`); tutorial?.event('aim'); }
}
function setCam(m, silent) {
  S.camMode = m; store.set('pool.cam', m);
  if (m !== '3d') { stroke.held = false; stroke.pull = STROKE.rest; S.charging = false; S.keyCharge = false; S.power = 0; }
  S.camBlend = 0.6;
  if (m !== '3d') unlock();
  $('#lockHint').classList.toggle('show', inGame() && m === '3d' && !locked() && !S.paused);
  $$('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
  if (!silent) tutorial?.event('cam');
}
function setSound(on) {
  sfx.enabled = on; store.set('pool.snd', on ? '1' : '0');
  $$('[data-snd]').forEach((b) => b.classList.toggle('on', (b.dataset.snd === '1') === on));
}
$$('[data-aim]').forEach((b) => b.addEventListener('click', () => setAimMode(b.dataset.aim)));
$$('[data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
$$('[data-snd]').forEach((b) => b.addEventListener('click', () => setSound(b.dataset.snd === '1')));
function setQuality(q) {
  store.set('pool.q', q); view.setQuality(q);
  $$('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
}
$$('[data-q]').forEach((b) => b.addEventListener('click', () => setQuality(b.dataset.q)));
$('#sens').value = S.sens;
$('#psens').value = S.powerSens;
$('#psens').addEventListener('input', (e) => { S.powerSens = parseFloat(e.target.value); store.set('pool.psens', String(S.powerSens)); });
$('#sens').addEventListener('input', (e) => { S.sens = parseFloat(e.target.value); store.set('pool.sens', String(S.sens)); });

$('#menuBtn').addEventListener('click', () => { if (inGame()) (S.paused ? closePause() : openPause()); });
$('#pResume').addEventListener('click', () => { if (S.mode === 'menu') { S.paused = false; $('#pause').classList.add('hidden'); } else closePause(); });
$('#pMain').addEventListener('click', showMainMenu);
$('#pTutorial').addEventListener('click', startTutorial);
$('#pRestart').addEventListener('click', () => { if (S.mode === 'snooker') startSnooker(S.snk.players.map((p) => p.name), S.snk.bestOf); else if (S.mode === 'match') startMatch(S.match.players.map((p) => p.name)); else startPractice(); });

// 主菜单
$$('[data-go]').forEach((b) => b.addEventListener('click', () => {
  sfx.unlock();
  const go = b.dataset.go;
  if (go === 'practice') startPractice();
  else if (go === 'tutorial') startTutorial();
  else if (go === 'match') openNameModal('match');
  else if (go === 'snooker') openNameModal('snooker');
  else if (go === 'online') openOnline();
  else if (go === 'settings') { S.paused = true; renderCueList(); $('#pTutorial').classList.add('hidden'); $('#pRestart').classList.add('hidden'); $('#pMain').classList.add('hidden'); $('#pauseTitle').textContent = '设置 / 球杆'; $('#pause').classList.remove('hidden'); }
}));

// 输入用户名
let nameFor = 'match', bestOf = parseInt(store.get('pool.bo', '3'), 10) || 3;
function setBo(n) { bestOf = n; store.set('pool.bo', String(n)); $$('#boSeg [data-bo]').forEach((b) => b.classList.toggle('on', +b.dataset.bo === n)); }
$$('#boSeg [data-bo]').forEach((b) => b.addEventListener('click', () => setBo(+b.dataset.bo)));
function openNameModal(kind = 'match') {
  nameFor = kind;
  $('#nameTitle').textContent = kind === 'snooker' ? '斯诺克 · 输入用户名' : '中式八球 · 输入用户名';
  $('#boRow').classList.toggle('hidden', kind !== 'snooker');
  setBo(bestOf);
  $('#mainMenu').classList.add('hidden');
  $('#nameModal').classList.remove('hidden');
  $('#name0').value = store.get('pool.name0', '');
  $('#name1').value = store.get('pool.name1', '');
  $('#nameErr').textContent = '';
  $$('#nameModal input').forEach((i) => i.classList.remove('err'));
  setTimeout(() => $('#name0').focus(), 50);
}
function submitNames() {
  const n = [$('#name0').value.trim(), $('#name1').value.trim()];
  $$('#nameModal input').forEach((i, k) => i.classList.toggle('err', !n[k]));
  if (!n[0] || !n[1]) { $('#nameErr').textContent = '两位玩家都要输入用户名'; return; }
  if (n[0] === n[1]) { $('#nameErr').textContent = '两个用户名不能一样'; $('#name1').classList.add('err'); return; }
  store.set('pool.name0', n[0]); store.set('pool.name1', n[1]);
  if (nameFor === 'snooker') startSnooker(n, bestOf); else startMatch(n);
}
$('#nameGo').addEventListener('click', submitNames);
$$('#nameModal input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitNames(); }));
$('#nameBack').addEventListener('click', showMainMenu);

$('#again').addEventListener('click', () => { if (S.mode === 'match') startMatch(S.match.players.map((p) => p.name)); else startPractice(); });
$('#overMain').addEventListener('click', showMainMenu);

// ---------------------------------------------------------------------------
//  界面
// ---------------------------------------------------------------------------
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}

function ballChip(id, gone) {
  const c = BALL_COLORS[id > 8 ? id - 8 : id];
  const bg = id > 8 ? `linear-gradient(#f6f1e3 0 26%, ${c} 26% 74%, #f6f1e3 74%)` : c;
  return `<span class="chip ${gone ? 'gone' : ''}" style="background:${bg}"><i>${id}</i></span>`;
}

function updateHUD() {
  const m = S.match;
  const game = inGame();
  $('#players').classList.toggle('hidden', S.mode !== 'match');
  if (S.mode === 'snooker') updateSnookerBoard();
  $('#modeTag').classList.toggle('hidden', S.mode !== 'practice');
  $('#modeTag').textContent = '单人练习';
  for (const id of ['#powerWrap', '#spinWrap', '#hint', '#menuBtn']) $(id).classList.toggle('hidden', !game);
  if (S.mode === 'match') {
    m.players.forEach((p, i) => {
      const el = $(`#p${i}`);
      el.classList.toggle('active', m.turn === i && S.phase !== 'over');
      el.querySelector('.name').textContent = p.name;
      let html = '';
      if (!p.group) html = `<span class="tag">${m.isBreak ? '待开球' : '花色未定'}</span>`;
      else {
        const ids = p.group === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
        html = ids.map((id) => ballChip(id, !S.balls[id].on)).join('');
        if (ids.every((id) => !S.balls[id].on)) html += ballChip(8, !S.balls[8].on);
      }
      el.querySelector('.balls').innerHTML = html;
      el.querySelector('.group').textContent = p.group ? GROUP_NAME[p.group] : '';
    });
  }
  const bih = game && m && m.ballInHand && S.phase === 'aim';
  $('#bih').textContent = bih && !myTurn() ? `${m.players[m.turn].name} 正在摆母球…` : bih ? (m.ballInHand === 'kitchen' ? '自由球：开球线后（按住 M 摆位）' : m.ballInHand === 'D' ? '母球在手：放在 D 区内（按住 M 摆位）' : '自由球：任意位置（按住 M 摆位）') : '';
  $('#bih').classList.toggle('show', !!bih);
  $('#lockHint').classList.toggle('show', game && effCam() === '3d' && !locked() && !S.paused && S.phase !== 'over');
  updateNetTag();
}

// ---------------------------------------------------------------------------
//  斯诺克：一杆结束后的流程 + 转播风格界面
// ---------------------------------------------------------------------------
const ballCss = (id) => {
  const c = typeof id === 'string' ? (id === 'red' ? snookerColorOf(1) : snookerColorOf(16 + ['yellow', 'green', 'brown', 'blue', 'pink', 'black'].indexOf(id))) : snookerColorOf(id);
  return `background:${c}`;
};

function endSnookerShot(shot) {
  const m = S.snk;
  const prevTurn = m.turn;
  const res = SNK.judgeSnooker(m, S.balls, shot, S.preShot);
  S.stats[prevTurn].shots++;
  if (res.foul) S.stats[prevTurn].fouls++; else S.stats[prevTurn].pots += res.potted.length;
  if (shot.scratch || !cue().on) respawnCue('D');
  S.phase = 'aim';
  resetSpinAfterShot();

  if (res.points > 0) {
    const lastId = res.potted[res.potted.length - 1];
    floatPoints(`+${res.points}`, snookerColorOf(lastId), prevTurn);
    bump(prevTurn);
    if (m.breakPts >= 100 && m.breakPts - res.points < 100) banner('CENTURY', `${m.players[prevTurn].name} 单杆破百！`, '#e2b25a');
    if (m.breakPts === 147) S.max147 = prevTurn;      // 过场动画会接管，不弹横幅
  }
  if (res.foul) {
    floatPoints(`+${res.penalty}`, '#ff6b6b', 1 - prevTurn);
    bump(1 - prevTurn);
    banner(res.miss ? 'FOUL & MISS' : 'FOUL', res.foul + `　罚 ${res.penalty} 分`, '#ff5a5a');
  }
  if (res.respotBlack) setTimeout(() => banner('RE-SPOTTED BLACK', '黑球复位决胜', '#e2b25a'), 2400);
  updateHUD();

  if (res.frameOver) {
    if (S.max147 != null) {
      // 147：先播专属过场，再进结算
      S.modal = true; unlock();
      setTimeout(() => cine.play({ name: m.players[S.max147].name, onDone: () => showFrameOver(res) }), 500);
      return;
    }
    setTimeout(() => showFrameOver(res), res.foul ? 2300 : 900);
    return;
  }
  if (res.foul && m.foulChoice) { setTimeout(showFoulChoice, 1600); return; }
  if (!res.points && !res.foul) toast(res.msg);
}

function showFoulChoice() {
  const m = S.snk;
  if (!m.foulChoice) return;                    // 联机：对方已经选好了
  if (S.net && m.turn !== S.net.me) { toast(`${m.players[m.turn].name} 正在选择：自己打还是让你再打…`); return; }
  S.modal = true; unlock();
  const me = m.players[m.turn], off = m.players[1 - m.turn];
  // 自由球：对手犯规后，你被斗住了
  const freeBall = !m.ballInHand && SNK.isSnookered(S.balls, SNK.ballsOn(m, S.balls));
  $('#foulTitle').textContent = `${off.name} 犯规，${me.name} 来选择`;
  $('#foulSub').textContent = freeBall ? '你被斗住了 —— 如果自己打，可以任选一颗球当作自由球（FREE BALL）。' : '可以自己打，也可以让对方从这里再打一杆。';
  $('#fPlaySub').textContent = freeBall ? '获得自由球（FREE BALL）' : '从现在的位置继续';
  $('#fReplace').classList.toggle('hidden', !m.foulChoice?.canReplace);
  $('#foulModal').classList.remove('hidden');
  S._freeBallPending = freeBall;
}
function closeFoul(choice, fromNet) {
  const m = S.snk;
  if (!m.foulChoice) return;
  if (S.net && !fromNet) netSend({ t: 'foul', choice });
  if (fromNet) S._freeBallPending = !m.ballInHand && SNK.isSnookered(S.balls, SNK.ballsOn(m, S.balls));
  $('#foulModal').classList.add('hidden');
  S.modal = false;
  m.foulChoice = null;
  if (choice === 'play') {
    m.freeBall = S._freeBallPending;
    if (m.freeBall) banner('FREE BALL', '任选一颗球当作目标球，打进按目标球计分', '#4dd0ff');
  } else {
    m.turn = 1 - m.turn;   // 犯规的一方再打
    m.freeBall = false;
    if (choice === 'replace' && S.preShot) {
      const p = S.preShot;
      S.balls = p.balls.map((b) => ({ ...b }));
      m.on = p.on; m.seqId = p.seqId; m.ballInHand = p.ballInHand;
      toast('所有球已摆回原位，犯规方重打');
    }
  }
  updateHUD();
  netTurnChanged();
  if (effCam() === '3d' && myTurn()) lock();
}
$('#fPlay').addEventListener('click', () => closeFoul('play'));
$('#fAgain').addEventListener('click', () => closeFoul('again'));
$('#fReplace').addEventListener('click', () => closeFoul('replace'));

function showFrameOver(res) {
  const m = S.snk, st = S.stats;
  S.modal = true; unlock();
  const w = m.frameWinner;
  const need = Math.ceil(m.bestOf / 2);
  showResult({
    kicker: m.matchOver ? `SNOOKER · BEST OF ${m.bestOf}` : `SNOOKER · FRAME ${m.frameNo}`,
    rainbow: S.max147 != null,
    title: m.matchOver ? 'CHAMPION' : 'FRAME WON',
    centuryTitle: m.matchOver ? 'CENTURY CHAMPION' : 'CENTURY FRAME',
    winner: m.players[w].name,
    sub: m.matchOver ? `以 ${m.players[w].frames} : ${m.players[1 - w].frames} 赢得比赛` : `赢下第 ${m.frameNo} 局 · 局分 ${m.players[0].frames} : ${m.players[1].frames}（${m.bestOf} 局 ${need} 胜）`,
    players: m.players.map((p) => ({ name: p.name, score: p.score })), winnerIdx: w, scoreLabel: m.matchOver ? '决胜局比分' : '本局比分',
    stats: [
      { label: '局分', values: m.players.map((p) => p.frames) },
      { label: '最高单杆', values: m.players.map((p) => p.highBreak) },
      { label: '出杆', values: st.map((x) => x.shots) },
      { label: '进球', values: st.map((x) => x.pots) },
      { label: '犯规', values: st.map((x) => x.fouls) },
    ],
    ...resultButtons(m.matchOver ? '再来一场' : '下一局',
      () => { S.modal = false; if (m.matchOver) startSnooker(m.players.map((p) => p.name), m.bestOf); else { SNK.nextFrame(m); startSnooker(null, null, true); } },
      () => netRestart(m.matchOver ? 'rematch' : 'next')),
  });
}


let bannerTimer = 0;
function banner(big, small, color, rainbow = false) {
  const el = $('#snkBanner');
  el.classList.toggle('bn-rainbow', rainbow);
  $('#bnBig').textContent = big; $('#bnSmall').textContent = small || '';
  el.style.setProperty('--bn', color || '#e2b25a');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 2700);
}
function floatPoints(txt, color, who) {
  const box = $('#sbS' + who).getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'pf'; el.textContent = txt; el.style.setProperty('--c', color);
  el.style.left = `${box.left + box.width / 2 - 20}px`; el.style.top = `${box.bottom + 40}px`;
  $('#ptsFloat').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}
function bump(who) {
  const el = $('#sbS' + who);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

function updateSnookerBoard() {
  const m = S.snk;
  if (!m) return;
  m.players.forEach((p, i) => {
    const el = $('#sbP' + i);
    el.querySelector('.sb-name').textContent = p.name;
    el.querySelector('.sb-fr').textContent = p.frames;
    el.classList.toggle('on', m.turn === i && !m.frameOver);
    $('#sbS' + i).textContent = p.score;
  });
  $('#sbBo').textContent = `BEST OF ${m.bestOf}`;
  $('#sbFrame').textContent = `FRAME ${m.frameNo}`;
  $('#sbBreakN').textContent = m.breakPts;
  $('#sbBreak').classList.toggle('hot', m.breakPts >= 50);
  $('#sbBreakBalls').innerHTML = m.breakBalls.slice(-20).map((k) => `<i style="${ballCss(k)}"></i>`).join('');
  const rem = SNK.remainingPoints(m, S.balls);
  $('#sbRem').textContent = rem;
  const diff = Math.abs(m.players[0].score - m.players[1].score);
  $('#sbDiff').textContent = diff;
  // 落后方是否需要斗球
  const trail = m.players[0].score < m.players[1].score ? 0 : m.players[1].score < m.players[0].score ? 1 : -1;
  const need = trail >= 0 && diff > rem;
  $('#sbReq').classList.toggle('hidden', !need);
  if (need) $('#sbReq').textContent = `${m.players[trail].name} 需要斗球`;
  // 目标球
  const onIds = SNK.ballsOn(m, S.balls);
  const dots = m.on === 'red' ? ['red'] : m.on === 'colour' ? ['yellow', 'green', 'brown', 'blue', 'pink', 'black'] : onIds.map((id) => SNK.keyOf(id));
  $('#ballOnDots').innerHTML = dots.map((k) => `<i style="${ballCss(k)}"></i>`).join('');
  $('#ballOnTxt').textContent = SNK.ballOnText(m) + (m.on === 'colour' ? '（以第一颗碰到的为准）' : '');
  $('#hb0').textContent = `${m.players[0].name}　${m.players[0].highBreak}`;
  $('#hb1').textContent = `${m.players[1].name}　${m.players[1].highBreak}`;
}

// ---------------------------------------------------------------------------
//  联机（房间码 + 用户名）
//  · 房主 = 玩家 1（先开球），加入的人 = 玩家 2
//  · 打球的一方把每一杆的参数和出杆前的球位发过去，两边用同一套确定性物理各算一遍；
//    打完再把结算后的状态发过去核对。观战的一方固定俯视，能看到对手的球杆和瞄准。
// ---------------------------------------------------------------------------
function netSend(o) { S.net?.room.link?.send(o); }

function snapshotState() {
  return { balls: cloneBalls(S.balls), match: JSON.parse(JSON.stringify(S.match)), stats: JSON.parse(JSON.stringify(S.stats)) };
}
function applyState(st) {
  if (JSON.stringify(st.balls) === JSON.stringify(S.balls) && JSON.stringify(st.match) === JSON.stringify(S.match)) return;
  console.warn('[联机] 两边状态有出入，已按打球方的结果校正');
  S.balls = cloneBalls(st.balls);
  for (const k of Object.keys(S.match)) delete S.match[k];
  Object.assign(S.match, st.match);
  S.stats = st.stats;
  updateHUD();
}

function netTurnChanged() {
  const n = S.net;
  if (!n) return;
  const mine = myTurn();
  if (mine !== n.wasMine) {
    n.wasMine = mine; n.aim = null;
    if (!mine) { stroke.held = false; hold.E = hold.B = hold.M = false; S.charging = false; S.keyCharge = false; S.power = 0; unlock(); }
    const el = $('#netTag');
    el.classList.remove('flash'); void el.offsetWidth; if (mine) el.classList.add('flash');
  }
  updateNetTag();
}

function updateNetTag() {
  const el = $('#netTag');
  const n = S.net, on = !!n && inGame();
  el.classList.toggle('hidden', !on);
  if (!on) return;
  const mine = myTurn();
  el.classList.toggle('mine', mine && S.phase !== 'over');
  const opp = n.names?.[1 - n.me] || '对手';
  const state = S.phase === 'over' ? '本局结束' : mine ? '你的回合' : `${opp} 的回合 · 观战（俯视）`;
  el.innerHTML = `<div class="nt-top"><i class="nt-dot"></i><b>房间 ${n.code}</b><span>${n.kind === 'ws' ? '局域网' : 'P2P'}${n.rtt != null ? ` · ${n.rtt} ms` : ''}</span></div><div class="nt-state">${esc(state)}</div>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 打球的一方：瞄准状态每 60ms 发一次（观战方看得到杆怎么动）
function netSendAim(pull, V) {
  const now = performance.now();
  if (now - (S.net.aimT || 0) < 60) return;
  S.net.aimT = now;
  const c = cue();
  netSend({ t: 'aim', ang: S.angle, a: V.a, b: V.b, el: V.elev, pull, x: c.x, y: c.y });
}
// 观战方：平滑跟上对手的瞄准
function netApplyAim(dt) {
  const a = S.net.aim;
  if (!a || S.phase !== 'aim') return;
  const k = 1 - Math.exp(-dt * 14);
  let d = a.ang - S.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
  S.angle += d * k;
  if (!S.vis) S.vis = { ...S.eff };
  S.vis.a += (a.a - S.vis.a) * k; S.vis.b += (a.b - S.vis.b) * k; S.vis.elev += (a.el - S.vis.elev) * k;
  S.eff = { ...S.eff, a: a.a, b: a.b, elev: a.el };
  if (S.match.ballInHand && cue().on) { const c = cue(); c.x += (a.x - c.x) * k; c.y += (a.y - c.y) * k; }
  updateSpinDot();
}

function startRemoteShot(m) {
  S.balls = cloneBalls(m.balls);
  S.match.ballInHand = m.bih;
  S.angle = m.angle;
  S.eff = { ...m.eff }; S.vis = { ...m.eff };
  const power = Math.min(1, Math.pow(Math.max(0, (m.p.speed - 0.25) / 10.75), 1 / 1.8));
  S.phase = 'stroke';
  S.stroke = { t: 0, power, dur: 0.12, remote: m };
}
// 窗口在后台时动画会停，落后一整杆就直接算完
function fastForward() {
  if (!S.sim) return;
  let guard = 0;
  while (S.sim.moving() && guard++ < 300000) S.sim.step();
  view.potAnims = [];
  S.evIdx = S.sim.events.length;
  S.lastEvents = S.sim.events;
  endShot();
}

function netPump() {
  const n = S.net;
  if (!n || !n.queue.length) return;
  if (S.phase === 'roll' && n.queue.some((m) => m.t === 'shot' || m.t === 'restart')) fastForward();
  const busy = () => S.phase === 'roll' || S.phase === 'stroke';
  while (n.queue.length) {
    const m = n.queue[0];
    if (m.t === 'shot') {
      if (S.phase !== 'aim' || cine.active || S.modal) return;
      n.queue.shift(); startRemoteShot(m); return;
    }
    if (busy()) return;
    if (m.t === 'sync') { n.queue.shift(); applyState(m); netTurnChanged(); continue; }
    if (m.t === 'foul') { if (!S.snk?.foulChoice) return; n.queue.shift(); closeFoul(m.choice, true); continue; }
    if (m.t === 'restart') { if (cine.active) return; n.queue.shift(); doRestart(m.kind, m.balls); continue; }
    n.queue.shift();
  }
}

// 结算画面按钮：联机时只有房主能开下一局
function resultButtons(text, local, viaNet) {
  if (!S.net) return { primary: { text, onClick: local }, secondary: { text: '主菜单', onClick: showMainMenu } };
  if (S.net.me === 0) return { primary: { text, onClick: viaNet }, secondary: { text: '离开房间', onClick: showMainMenu } };
  return { primary: { text: `等房主开始${text}…`, disabled: true }, secondary: { text: '离开房间', onClick: showMainMenu } };
}
function netRestart(kind) {
  const seed = (Math.random() * 2 ** 31) | 0;
  const balls = S.mode === 'snooker' ? rackSnooker(seed) : rackBalls(seed);
  netSend({ t: 'restart', kind, balls });
  doRestart(kind, balls);
}
function doRestart(kind, balls) {
  hideResult(); S.modal = false;
  if (S.mode === 'snooker') {
    const m = S.snk;
    if (kind === 'next') { SNK.nextFrame(m); startSnooker(null, null, true, balls); }
    else startSnooker(m.players.map((p) => p.name), m.bestOf, false, balls);
  } else {
    S.net.games++;
    startMatch(S.net.names, balls, S.net.games % 2);   // 再来一局：轮流开球
  }
}

function onNetMsg(m) {
  const n = S.net;
  if (!n || !m || typeof m !== 'object') return;
  switch (m.t) {
    case 'ping': netSend({ t: 'pong', ts: m.ts }); return;
    case 'pong': n.rtt = Math.round(performance.now() - m.ts); updateNetTag(); return;
    case 'hello': {
      if (n.me !== 0 || n.names) return;
      if (m.ver !== NET_VERSION) { netSend({ t: 'reject', why: '双方游戏版本不一样，都更新到最新再试' }); return; }
      const guest = String(m.name || '').trim().slice(0, 12);
      if (!guest || guest === n.myName) { netSend({ t: 'reject', why: '你的用户名和房主一样，换一个再加入' }); return; }
      n.names = [n.myName, guest];
      const kind = lobby.game;
      ensureTable(kind === 'snooker' ? 'snooker' : 'pool');
      const seed = (Math.random() * 2 ** 31) | 0;
      const balls = kind === 'snooker' ? rackSnooker(seed) : rackBalls(seed);
      netSend({ t: 'start', game: kind, bestOf: lobby.bo, names: n.names, balls });
      beginOnline(kind, lobby.bo, balls);
      return;
    }
    case 'start':
      if (n.me !== 1) return;
      n.names = m.names;
      beginOnline(m.game, m.bestOf, m.balls);
      return;
    case 'reject': lobbyStatus(m.why, true); netLeave(); lobbyIdle(); return;
    case 'full': lobbyStatus('这个房间已经满了', true); netLeave(); lobbyIdle(); return;
    case 'bye': onNetClose(true); return;
    case 'aim': if (!myTurn()) n.aim = m; return;
    case 'shot': case 'sync': case 'foul': case 'restart': n.queue.push(m); return;
  }
}
function beginOnline(kind, bo, balls) {
  const n = S.net;
  n.wasMine = null;
  toast(`已连接：${n.names[0]} vs ${n.names[1]}`);
  if (kind === 'snooker') startSnooker(n.names, bo, false, balls);
  else startMatch(n.names, balls, 0);
}
function onNetClose(byPeer) {
  const n = S.net;
  if (!n) return;
  clearInterval(n.pingT);
  S.net = null;
  const opp = n.names?.[1 - n.me];
  if (inGame()) {
    unlock(); S.modal = true;
    $('#netLostTxt').textContent = byPeer ? `${opp || '对手'} 离开了房间` : `和 ${opp || '对手'} 的连接断开了`;
    $('#netLost').classList.remove('hidden');
    updateNetTag();
  } else { lobbyStatus(byPeer ? '对方离开了' : '连接断开了', true); lobbyIdle(); }
  try { n.room.close(); } catch {}
}
function netLeave() {
  if (lobby.room && (!S.net || S.net.room !== lobby.room)) { try { lobby.room.close(); } catch {} }
  lobby.room = null;
  const n = S.net;
  if (!n) return;
  clearInterval(n.pingT);
  S.net = null;
  try { n.room.close(); } catch {}
  updateNetTag();
}
function attachLink(room, link, me, myName) {
  const n = S.net = { room, me, code: room.code, kind: link.kind, queue: [], seq: 0, names: null, rtt: null, wasMine: null, myName, games: 0, aim: null };
  link.onmessage = onNetMsg;
  link.onclose = () => { if (S.net === n) onNetClose(false); };
  n.pingT = setInterval(() => netSend({ t: 'ping', ts: performance.now() }), 2000);
  if (me === 1) { netSend({ t: 'hello', name: myName, ver: NET_VERSION }); lobbyStatus('已连上房间，等房主开局…'); }
  else lobbyStatus('对手已连接，正在开局…');
}

// ---- 联机大厅 ----
const lobby = { room: null, tab: 'create', game: store.get('pool.ngame', 'pool'), bo: parseInt(store.get('pool.nbo', '3'), 10) || 3 };
function openOnline() {
  $('#mainMenu').classList.add('hidden');
  $('#onlineModal').classList.remove('hidden');
  $('#onName').value = store.get('pool.myname', store.get('pool.name0', ''));
  $('#onName').classList.remove('err');
  setLobbyTab(lobby.tab); setLobbyGame(lobby.game); setLobbyBo(lobby.bo);
  lobbyIdle(); lobbyStatus('');
  setTimeout(() => (!$('#onName').value ? $('#onName') : lobby.tab === 'join' ? $('#onJoinCode') : $('#onName')).focus(), 50);
}
function setLobbyTab(t) {
  if (lobby.room) return;
  lobby.tab = t;
  $$('#onTabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('#onCreatePane').classList.toggle('hidden', t !== 'create');
  $('#onJoinPane').classList.toggle('hidden', t !== 'join');
  lobbyStatus('');
}
function setLobbyGame(g) { lobby.game = g; store.set('pool.ngame', g); $$('#onGame [data-g]').forEach((b) => b.classList.toggle('on', b.dataset.g === g)); $('#onBoRow').classList.toggle('hidden', g !== 'snooker'); }
function setLobbyBo(n) { lobby.bo = n; store.set('pool.nbo', String(n)); $$('#onBo [data-bo2]').forEach((b) => b.classList.toggle('on', +b.dataset.bo2 === n)); }
function lobbyStatus(t, bad) { const el = $('#onStatus'); el.textContent = t; el.classList.toggle('bad', !!bad); }
function lobbyIdle() {
  $('#onCodeBox').classList.add('hidden');
  $('#onCreate').disabled = false; $('#onJoin').disabled = false;
  $('#onCreate').textContent = '创建房间'; $('#onJoin').textContent = '加入';
  $('#onName').disabled = false;
}
function needName() {
  const v = $('#onName').value.trim();
  $('#onName').classList.toggle('err', !v);
  if (!v) { lobbyStatus('先输入你的用户名（1~12 个字）', true); $('#onName').focus(); return null; }
  store.set('pool.myname', v);
  return v;
}
async function lobbyCreate() {
  if (lobby.room) { netLeave(); lobbyIdle(); lobbyStatus('已取消'); return; }   // 再按一次 = 取消
  const name = needName(); if (!name) return;
  const room = new NetRoom();
  lobby.room = room;
  $('#onCreate').textContent = '取消房间'; $('#onJoin').disabled = true; $('#onName').disabled = true;
  lobbyStatus('正在开房间…');
  try {
    const link = await room.host((code, info) => {
      if (lobby.room !== room) return;
      $('#onCode').textContent = code;
      $('#onCodeBox').classList.remove('hidden');
      lobbyStatus(info.lanOnly ? '外网联机服务器连不上，现在只有同一个 WiFi 的朋友能加入' : '把联机码发给朋友，等待对方加入…');
    });
    if (lobby.room !== room) { link.close(); return; }
    attachLink(room, link, 0, name);
  } catch (e) {
    if (lobby.room !== room) return;
    lobby.room = null; lobbyIdle(); lobbyStatus(e.message || '开房间失败', true);
  }
}
async function lobbyJoin() {
  if (lobby.room) return;
  const name = needName(); if (!name) return;
  const code = cleanCode($('#onJoinCode').value);
  $('#onJoinCode').value = code;
  if (code.length !== 4) { lobbyStatus('联机码是 4 位字母 / 数字', true); $('#onJoinCode').focus(); return; }
  const room = new NetRoom();
  lobby.room = room;
  room.onstatus = (t) => { if (lobby.room === room) lobbyStatus(t); };
  $('#onJoin').disabled = true; $('#onCreate').disabled = true; $('#onName').disabled = true; $('#onJoin').textContent = '连接中…';
  lobbyStatus('正在连接…');
  try {
    const link = await room.join(code);
    if (lobby.room !== room) { link.close(); return; }
    attachLink(room, link, 1, name);
  } catch (e) {
    if (lobby.room !== room) return;
    lobby.room = null; lobbyIdle(); lobbyStatus(e.message || '连接失败', true);
  }
}
$$('#onTabs [data-tab]').forEach((b) => b.addEventListener('click', () => setLobbyTab(b.dataset.tab)));
$$('#onGame [data-g]').forEach((b) => b.addEventListener('click', () => { if (!lobby.room) setLobbyGame(b.dataset.g); }));
$$('#onBo [data-bo2]').forEach((b) => b.addEventListener('click', () => { if (!lobby.room) setLobbyBo(+b.dataset.bo2); }));
$('#onCreate').addEventListener('click', lobbyCreate);
$('#onJoin').addEventListener('click', lobbyJoin);
$('#onJoinCode').addEventListener('input', (e) => { const v = cleanCode(e.target.value); if (v !== e.target.value) e.target.value = v; });
$('#onJoinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') lobbyJoin(); });
$('#onName').addEventListener('keydown', (e) => { if (e.key === 'Enter') (lobby.tab === 'join' ? lobbyJoin : lobbyCreate)(); });
$('#onBack').addEventListener('click', showMainMenu);
$('#onCopy').addEventListener('click', async () => {
  const code = $('#onCode').textContent;
  try { await navigator.clipboard.writeText(code); $('#onCopy').textContent = '已复制 ✓'; } catch { $('#onCopy').textContent = code; }
  setTimeout(() => { $('#onCopy').textContent = '复制'; }, 1500);
});
$('#netLostBtn').addEventListener('click', showMainMenu);

// ---------------------------------------------------------------------------
//  启动
// ---------------------------------------------------------------------------
function resize() { view.resize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', resize);
resize();
view.setCueModel(cueDef());
setAimMode(S.aimMode, true);
setCam(S.camMode, true);
setSound(store.get('pool.snd', '1') === '1');
setQuality(store.get('pool.q', 'auto'));
if (tutForced()) startTutorial();        // 第一次进入：强制教学
else showMainMenu();
view.updateCamera(S.camMode, cue(), 1, 0, S.pitch, S.dist, 0, true);
requestAnimationFrame(frame);

// 结算画面右上角的时间
setInterval(() => { const el = document.querySelector('#rsClock'); if (el && !document.querySelector('#result').classList.contains('hidden')) el.textContent = new Date().toLocaleTimeString('en-GB') + ' · REC'; }, 500);

// 预览结算画面：在地址后面加 ?preview=blue / gold / 147
{
  const pv = new URLSearchParams(location.search).get('preview');
  const demo = {
    blue: { sub: 'James 以 2 : 1 赢得比赛', players: [{ name: 'James', score: 78 }, { name: 'Ronnie', score: 45 }], winnerIdx: 0,
      stats: [{ label: '局分', values: [2, 1] }, { label: '最高单杆', values: [64, 38] }, { label: '进球', values: [22, 14] }, { label: '犯规', values: [1, 3] }] },
    gold: { sub: 'Ronnie 以 2 : 1 赢得比赛', players: [{ name: 'James', score: 45 }, { name: 'Ronnie', score: 112 }], winnerIdx: 1,
      stats: [{ label: '局分', values: [1, 2] }, { label: '最高单杆', values: [38, 104] }, { label: '进球', values: [14, 31] }, { label: '犯规', values: [3, 0] }] },
    147: { sub: 'James 打出 147 满分杆！', rainbow: true, players: [{ name: 'James', score: 147 }, { name: 'Ronnie', score: 0 }], winnerIdx: 0,
      stats: [{ label: '局分', values: [2, 1] }, { label: '最高单杆', values: [147, 38] }, { label: '进球', values: [36, 14] }, { label: '犯规', values: [0, 3] }] },
  }[pv];
  if (pv === '147cine') setTimeout(() => {
    startSnooker(['James', 'Ronnie'], 3);
    S.balls.forEach((b) => { if (b.id) b.on = false; });
    S.modal = true;
    if (new URLSearchParams(location.search).has('manual')) cine.manual = 0;   // 逐帧录制用
    cine.play({ name: 'James', onDone: () => showResult({ kicker: 'SNOOKER · BEST OF 3 · FRAME 3', title: 'CHAMPION', sub: 'James 打出 147 满分杆！', rainbow: true,
      players: [{ name: 'James', score: 147 }, { name: 'Ronnie', score: 0 }], winnerIdx: 0,
      stats: [{ label: '局分', values: [2, 1] }, { label: '最高单杆', values: [147, 38] }, { label: '进球', values: [36, 14] }, { label: '犯规', values: [0, 3] }],
      primary: { text: '再看一遍', onClick: () => location.reload() }, secondary: { text: '主菜单', onClick: () => { location.href = location.pathname; } } }) });
  }, 600);
  if (demo) setTimeout(() => showResult({ kicker: 'SNOOKER · BEST OF 3 · FRAME 3', title: 'CHAMPION', centuryTitle: 'CENTURY CHAMPION',
    primary: { text: '再看一遍', onClick: () => location.reload() }, secondary: { text: '主菜单', onClick: () => { location.href = location.pathname; } }, ...demo }), 600);
}

// 调试用
window.__pool = S;
window.__net = { fastForward, myTurn, effCam, lobby };
window.__view = view;
window.__cine = cine;
window.__poolShoot = (p) => { S.power = p; beginStroke(); };
window.__poolApi = { showResult, startPractice, startMatch, startTutorial, startSnooker, showMainMenu, openPause, closePause, setCueType, endSnookerShot, tutorial: () => tutorial };
