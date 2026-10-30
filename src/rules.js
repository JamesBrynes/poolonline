// ============================================================================
//  八球规则（参照 WPA 国际规则，不叫袋版）
//  纯逻辑、无渲染依赖 —— 联机时放在服务器上做权威判定
// ============================================================================

export const isSolid = (id) => id >= 1 && id <= 7;
export const isStripe = (id) => id >= 9 && id <= 15;
export const groupOf = (id) => (isSolid(id) ? 'solid' : isStripe(id) ? 'stripe' : null);
export const GROUP_NAME = { solid: '全色', stripe: '花色' };

export function newMatch(names = ['玩家 1', '玩家 2']) {
  return {
    players: names.map((name) => ({ name, group: null })),
    turn: 0,
    open: true,               // 花色未定
    isBreak: true,
    ballInHand: 'kitchen',    // 'kitchen' 开球线后 / 'anywhere' 任意位置 / null
    winner: null,
    shotCount: 0,
  };
}

export function remainingOf(balls, group) {
  return balls.filter((b) => b.on && groupOf(b.id) === group).length;
}

// 从模拟事件里提取一杆的关键信息
export function summarizeShot(events) {
  let firstHit = null, firstHitT = Infinity;
  const pocketed = [];
  let railAfterContact = false;
  const railBalls = new Set();
  for (const e of events) {
    if (e.type === 'ball' && firstHit === null && (e.a === 0 || e.b === 0)) {
      firstHit = e.a === 0 ? e.b : e.a; firstHitT = e.t;
    }
  }
  for (const e of events) {
    if (e.type === 'cushion') {
      if (e.t >= firstHitT) railAfterContact = true;
      if (e.a !== 0) railBalls.add(e.a);
    }
    if (e.type === 'pocket') pocketed.push(e.a);
  }
  return { firstHit, railAfterContact, pocketed, scratch: pocketed.includes(0), railBalls: railBalls.size };
}

// 判定一杆；balls 是这一杆结束后的球状态。返回结果并更新 match（就地修改）
export function judge(match, balls, shot) {
  const me = match.players[match.turn];
  const opp = match.players[1 - match.turn];
  const myGroupBefore = me.group;
  const objPotted = shot.pocketed.filter((id) => id !== 0 && id !== 8);
  const eightIn = shot.pocketed.includes(8);
  // 这一杆之前自己花色还剩几颗（把本杆打进的加回去）
  const myRemainBefore = myGroupBefore
    ? remainingOf(balls, myGroupBefore) + objPotted.filter((id) => groupOf(id) === myGroupBefore).length
    : 7;

  let foul = null;
  if (shot.scratch) foul = '母球落袋';
  else if (shot.firstHit === null) foul = '母球没有碰到任何球';
  else if (!match.isBreak) {
    if (match.open) {
      if (shot.firstHit === 8) foul = '花色未定时不能先碰黑八';
    } else if (myRemainBefore > 0) {
      if (groupOf(shot.firstHit) !== myGroupBefore) foul = `必须先碰到自己的球（${GROUP_NAME[myGroupBefore]}）`;
    } else if (shot.firstHit !== 8) foul = '必须先碰到黑八';
    if (!foul && shot.pocketed.length === 0 && !shot.railAfterContact) foul = '碰球后没有任何球碰库';
  } else if (!foul && shot.pocketed.length === 0 && shot.railBalls < 4) {
    foul = '开球犯规：至少 4 颗球碰库或有球进袋';
  }

  const result = { foul, msg: '', keepTurn: false, respot8: false, gameOver: false };
  const wasBreak = match.isBreak;
  match.isBreak = false;
  match.shotCount++;

  // ---- 黑八 ----
  if (eightIn) {
    if (wasBreak) {
      result.respot8 = true;
      result.msg = '开球打进黑八，黑八摆回置球点';
    } else if (foul || match.open || myRemainBefore > 0) {
      match.winner = 1 - match.turn;
      result.gameOver = true;
      result.msg = foul ? `${me.name} 打进黑八时犯规（${foul}），判负` : `${me.name} 提前打进黑八，判负`;
      return result;
    } else {
      match.winner = match.turn;
      result.gameOver = true;
      result.msg = `${me.name} 打进黑八，获胜！`;
      return result;
    }
  }

  // ---- 定花色（开球后第一个合法进球）----
  if (!foul && match.open && !wasBreak && objPotted.length > 0) {
    const g = groupOf(objPotted[0]);
    me.group = g;
    opp.group = g === 'solid' ? 'stripe' : 'solid';
    match.open = false;
    result.msg = `${me.name} 定为${GROUP_NAME[g]}`;
  }

  if (foul) {
    match.turn = 1 - match.turn;
    match.ballInHand = wasBreak && shot.scratch ? 'kitchen' : 'anywhere';
    result.msg = `犯规：${foul}。${match.players[match.turn].name} 获得自由球`;
    return result;
  }

  match.ballInHand = null;
  if (wasBreak) result.keepTurn = objPotted.length > 0 || result.respot8;
  else if (me.group) result.keepTurn = objPotted.some((id) => groupOf(id) === me.group);
  if (!result.keepTurn) match.turn = 1 - match.turn;
  if (!result.msg) result.msg = result.keepTurn ? `${me.name} 继续击球` : `轮到 ${match.players[match.turn].name}`;
  return result;
}
