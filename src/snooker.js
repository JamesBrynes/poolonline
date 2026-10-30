// ============================================================================
//  斯诺克规则（参照 WPBSA 官方规则，单局制，可连续打多局）
//  球 id：0 母球，1~15 红球，16 黄(2) 17 绿(3) 18 棕(4) 19 蓝(5) 20 粉(6) 21 黑(7)
//  纯逻辑，联机时放服务器上判定
// ============================================================================
import { R, TABLE, SNOOKER_COLOURS } from './physics.js';

export const isRed = (id) => id >= 1 && id <= 15;
export const isColour = (id) => id >= 16 && id <= 21;
export const valueOf = (id) => (isRed(id) ? 1 : isColour(id) ? SNOOKER_COLOURS[id - 16].value : 0);
export const nameOf = (id) => (isRed(id) ? '红球' : isColour(id) ? SNOOKER_COLOURS[id - 16].name : '母球');
export const keyOf = (id) => (isRed(id) ? 'red' : isColour(id) ? SNOOKER_COLOURS[id - 16].key : 'cue');
export const COLOUR_IDS = [16, 17, 18, 19, 20, 21];

export function newSnookerMatch(names, bestOf = 3) {
  return {
    players: names.map((name) => ({ name, score: 0, frames: 0, highBreak: 0 })),
    bestOf, frameNo: 1, breaker: 0,
    ...freshFrame(0),
  };
}
function freshFrame(breaker) {
  return {
    turn: breaker, on: 'red', seqId: 16,
    breakPts: 0, breakBalls: [],
    ballInHand: 'D', freeBall: false,
    missCount: [0, 0],
    frameOver: false, matchOver: false, frameWinner: null, respotBlack: false,
    foulChoice: null,     // 犯规后由对手选择：{ canReplace }
    shots: 0,
  };
}
export function nextFrame(m) {
  for (const p of m.players) p.score = 0;
  m.frameNo++;
  m.breaker = 1 - m.breaker;
  Object.assign(m, freshFrame(m.breaker));
}

export const redsOn = (balls) => balls.filter((b) => b.on && isRed(b.id)).length;
export function lowestColour(balls) {
  for (const id of COLOUR_IDS) if (balls[id] && balls[id].on) return id;
  return null;
}

// 当前"目标球"列表
export function ballsOn(m, balls) {
  if (m.on === 'red') return balls.filter((b) => b.on && isRed(b.id)).map((b) => b.id);
  if (m.on === 'colour') return COLOUR_IDS.filter((id) => balls[id].on);
  return m.seqId && balls[m.seqId].on ? [m.seqId] : [];
}
export function ballOnText(m) {
  if (m.on === 'red') return m.freeBall ? '自由球 / 红球' : '红球';
  if (m.on === 'colour') return '任意彩球';
  return (m.freeBall ? '自由球 / ' : '') + nameOf(m.seqId);
}

// 台面剩余分
export function remainingPoints(m, balls) {
  const reds = redsOn(balls);
  if (m.on === 'red') return reds * 8 + 27;
  if (m.on === 'colour') return 7 + reds * 8 + 27;
  let s = 0;
  for (const id of COLOUR_IDS) if (id >= m.seqId && balls[id].on) s += valueOf(id);
  return s;
}

// ---- 是否被斗住（snookered）：对每颗目标球，看母球能否直线打到它的左右两边缘 ----
function rayBlocked(balls, cx, cy, dx, dy, onSet) {
  let best = Infinity, who = null;
  for (const o of balls) {
    if (!o.on || o.id === 0) continue;
    const ox = o.x - cx, oy = o.y - cy;
    const b = ox * dx + oy * dy;
    if (b <= 0) continue;
    const c = ox * ox + oy * oy - 4 * R * R;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = b - Math.sqrt(disc);
    if (t < best) { best = t; who = o.id; }
  }
  return !onSet.has(who);    // 先碰到的是任意一颗目标球就不算被挡
}
export function isSnookered(balls, onIds) {
  const c = balls[0];
  if (!c.on) return false;
  const onSet = new Set(onIds);
  for (const id of onIds) {
    const o = balls[id];
    const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy);
    const base = Math.atan2(dy, dx);
    const half = Math.asin(Math.min(1, (2 * R) / d)) * 0.97;
    const ok = [-half, half].every((a) => !rayBlocked(balls, c.x, c.y, Math.cos(base + a), Math.sin(base + a), onSet));
    if (ok) return false;
  }
  return true;
}

// ---- 彩球复位：自己的点 → 最高分的空点 → 沿中线往顶库方向找空位 ----
export function respotColour(balls, id) {
  const free = (x, y) => balls.every((b) => !b.on || b.id === id || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * R + 0.0005) ** 2);
  const key = SNOOKER_COLOURS[id - 16].key;
  const b = balls[id];
  let [x, y] = TABLE.spots[key];
  if (!free(x, y)) {
    let placed = false;
    for (const c of [...SNOOKER_COLOURS].reverse()) {
      const [sx, sy] = TABLE.spots[c.key];
      if (free(sx, sy)) { x = sx; y = sy; placed = true; break; }
    }
    if (!placed) {
      const [ox, oy] = TABLE.spots[key];
      let found = false;
      for (let px = ox; px < TABLE.HL - R; px += 0.002) if (free(px, oy)) { x = px; y = oy; found = true; break; }
      if (!found) for (let px = ox; px > -TABLE.HL + R; px -= 0.002) if (free(px, oy)) { x = px; y = oy; break; }
    }
  }
  b.x = x; b.y = y; b.on = true; b.pocket = -1;
  b.vx = b.vy = b.wx = b.wy = b.wz = 0;
}

// ---- 判定一杆 ----
//  shot: summarizeShot 的结果；pre: { snookered }（出杆前母球是否被斗住）
export function judgeSnooker(m, balls, shot, pre) {
  const me = m.players[m.turn], oppIdx = 1 - m.turn, opp = m.players[oppIdx];
  const fh = shot.firstHit;
  const potted = shot.pocketed.filter((id) => id !== 0);
  const on = m.on, target = m.seqId;
  const free = m.freeBall;
  const res = { foul: null, penalty: 0, points: 0, potted, miss: false, msg: '', events: [] };

  // 本杆的"目标球分值"
  let valueOn = on === 'red' ? 1 : on === 'colour' ? (isColour(fh) ? valueOf(fh) : 0) : valueOf(target);
  const fouls = [];
  const addFoul = (why, pen) => fouls.push({ why, pen: Math.min(7, Math.max(4, pen)) });

  // 首个碰到的球
  let legalFirst = false;
  if (fh == null) addFoul('母球没有碰到任何球', valueOn);
  else {
    if (on === 'red') legalFirst = isRed(fh) || (free && isColour(fh));
    else if (on === 'colour') legalFirst = isColour(fh);
    else legalFirst = fh === target || (free && fh !== 0);
    if (!legalFirst) addFoul(`先碰到了${nameOf(fh)}（目标是${ballOnText(m)}）`, Math.max(valueOn, valueOf(fh)));
  }
  // 进袋的球
  const freeId = free && fh != null && !(on === 'red' ? isRed(fh) : fh === target) ? fh : null;   // 被选作自由球的那颗
  for (const id of potted) {
    let legal;
    if (on === 'red') legal = isRed(id) || id === freeId;
    else if (on === 'colour') legal = id === fh && isColour(fh);
    else legal = id === target || id === freeId;
    if (!legal) addFoul(`${nameOf(id)}进袋（不是目标球）`, Math.max(valueOn, valueOf(id)));
  }
  if (shot.scratch) addFoul('母球落袋', Math.max(valueOn, ...potted.map(valueOf), 4));

  const redsAfter = redsOn(balls);
  const respot = [];

  if (fouls.length) {
    const worst = fouls.reduce((a, b) => (b.pen > a.pen ? b : a));
    res.foul = worst.why; res.penalty = worst.pen;
    opp.score += worst.pen;
    // Miss：没有先碰到目标球，且出杆前没被斗住
    const missType = fh == null || !legalFirst;
    const onlyBlack = on === 'seq' && target === 21;
    if (missType && !pre.snookered && !onlyBlack) {
      res.miss = true;
      m.missCount[m.turn]++;
    } else m.missCount[m.turn] = 0;
    // 犯规进袋的彩球都要复位
    for (const id of potted) if (isColour(id)) respot.push(id);
    endBreak(m);
    // 三次 Miss 判负
    if (res.miss && m.missCount[m.turn] >= 3) {
      res.msg = `${me.name} 连续三次 Miss，本局判负`;
      finishFrame(m, oppIdx, res); applyRespots(balls, respot);
      return res;
    }
    // 只剩黑球时犯规：本局结束
    if (onlyBlack || m.respotBlack) {
      applyRespots(balls, respot);
      res.msg = `犯规：${worst.why}　${opp.name} +${worst.pen}`;
      decideEnd(m, balls, res, null);
      return res;
    }
    m.turn = oppIdx;
    m.on = redsAfter > 0 ? 'red' : 'seq';
    if (m.on === 'seq') m.seqId = on === 'seq' ? target : 16;
    m.ballInHand = shot.scratch ? 'D' : null;
    m.foulChoice = { canReplace: res.miss };
    res.msg = `犯规：${worst.why}　${opp.name} +${worst.pen}` + (res.miss ? '　MISS' : '');
    applyRespots(balls, respot);
    m.freeBall = false;   // 由 UI 在对手选择"自己打"后计算
    return res;
  }

  // ---- 合法 ----
  m.missCount[m.turn] = 0;
  let pts = 0;
  if (on === 'red') {
    pts = potted.filter(isRed).length + (freeId != null && potted.includes(freeId) ? 1 : 0);
    if (freeId != null && potted.includes(freeId)) respot.push(freeId);
  } else if (on === 'colour') {
    if (potted.includes(fh)) { pts = valueOf(fh); respot.push(fh); }
  } else {
    if (potted.includes(target)) pts = valueOf(target);
    else if (freeId != null && potted.includes(freeId)) { pts = valueOf(target); respot.push(freeId); }
  }
  m.freeBall = false;
  m.ballInHand = null;
  applyRespots(balls, respot);

  if (pts > 0) {
    me.score += pts; res.points = pts;
    m.breakPts += pts;
    for (const id of potted) m.breakBalls.push(isRed(id) ? 'red' : (on === 'red' && id === freeId) ? 'red' : keyOf(id));
    me.highBreak = Math.max(me.highBreak, m.breakPts);
    // 下一颗目标球
    if (on === 'red') m.on = 'colour';
    else if (on === 'colour') { m.on = redsAfter > 0 ? 'red' : 'seq'; m.seqId = 16; }
    else {
      if (target === 21) { res.msg = `+${pts}`; decideEnd(m, balls, res, null); return res; }
      m.seqId = lowestColour(balls);
      if (m.seqId == null) { decideEnd(m, balls, res, null); return res; }
    }
    res.msg = `+${pts}`;
    return res;
  }

  // 没进球：换人
  endBreak(m);
  m.turn = oppIdx;
  if (on === 'colour') { m.on = redsAfter > 0 ? 'red' : 'seq'; m.seqId = 16; }
  else if (on === 'red' && redsAfter === 0) { m.on = 'seq'; m.seqId = 16; }
  res.msg = `轮到 ${opp.name}`;
  return res;
}

function applyRespots(balls, ids) {
  // 分值高的先复位
  [...new Set(ids)].sort((a, b) => b - a).forEach((id) => respotColour(balls, id));
}
function endBreak(m) {
  const p = m.players[m.turn];
  p.highBreak = Math.max(p.highBreak, m.breakPts);
  m.lastBreak = m.breakPts;
  m.breakPts = 0; m.breakBalls = [];
}

// 局末：比分不同 → 结束；平分 → 黑球复位决胜
function decideEnd(m, balls, res, forcedWinner) {
  const [a, b] = m.players;
  if (forcedWinner == null && a.score === b.score) {
    respotColour(balls, 21);
    m.respotBlack = true;
    m.on = 'seq'; m.seqId = 21;
    endBreak(m);
    m.turn = Math.random() < 0.5 ? 0 : 1;
    m.ballInHand = 'D';
    res.msg = (res.msg ? res.msg + '。' : '') + `比分 ${a.score}:${b.score} 打平！黑球复位决胜，抽签由 ${m.players[m.turn].name} 先打`;
    res.respotBlack = true;
    return;
  }
  const w = a.score === b.score ? forcedWinner : a.score > b.score ? 0 : 1;
  finishFrame(m, w, res);
}
function finishFrame(m, w, res) {
  endBreak(m);
  m.frameOver = true; m.frameWinner = w;
  m.players[w].frames++;
  res.frameOver = true;
  const need = Math.ceil(m.bestOf / 2);
  if (m.players[w].frames >= need) { m.matchOver = true; res.matchOver = true; }
  res.msg = (res.msg && !res.msg.startsWith('+') ? res.msg + '。' : '') + `${m.players[w].name} 赢下第 ${m.frameNo} 局`;
}
