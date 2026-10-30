// ============================================================================
//  辅助线计算（几何预测，不跑物理）
//  mode: 'off' | 'half' | 'full'
//    half：母球路径 + 撞击位置的虚影球（不告诉你目标球往哪走）
//    full：再加 目标球出球方向、母球分离（切线）方向、一次库边反弹
// ============================================================================
import { R, castBall } from './physics.js';

export function computeAim(mode, balls, dx, dy) {
  const out = { lines: [], ghost: null, target: null };
  if (mode === 'off') return out;
  const cue = balls[0];
  if (!cue || !cue.on) return out;
  const hit = castBall(cue.x, cue.y, dx, dy, balls, 0);
  out.lines.push({ x1: cue.x, y1: cue.y, x2: hit.x, y2: hit.y, kind: 'cue' });

  if (hit.type === 'ball') {
    out.ghost = { x: hit.x, y: hit.y };
    out.target = hit.ball.id;
    if (mode === 'full') {
      const o = hit.ball;
      const nx = (o.x - hit.x) / (2 * R), ny = (o.y - hit.y) / (2 * R);
      const cosA = dx * nx + dy * ny;
      // 目标球方向：沿撞击法线，长度随厚薄变化，并截断到第一个障碍
      const len = 0.12 + 0.75 * cosA;
      const oh = castBall(o.x, o.y, nx, ny, balls, o.id, len);
      out.lines.push({ x1: o.x, y1: o.y, x2: oh.x, y2: oh.y, kind: 'object' });
      // 母球分离方向（定杆切线）
      let tx = dx - cosA * nx, ty = dy - cosA * ny;
      const tl = Math.sqrt(tx * tx + ty * ty);
      if (tl > 0.02) {
        tx /= tl; ty /= tl;
        const ch = castBall(hit.x, hit.y, tx, ty, balls, 0, 0.08 + 0.45 * tl);
        out.lines.push({ x1: hit.x, y1: hit.y, x2: ch.x, y2: ch.y, kind: 'tangent' });
      }
    }
  } else if (hit.type === 'cushion' && mode === 'full') {
    const d = dx * hit.nx + dy * hit.ny;
    const rx = dx - 2 * d * hit.nx, ry = dy - 2 * d * hit.ny;
    const h2 = castBall(hit.x + rx * 1e-4, hit.y + ry * 1e-4, rx, ry, balls, 0, 0.6);
    out.lines.push({ x1: hit.x, y1: hit.y, x2: h2.x, y2: h2.y, kind: 'bounce' });
    if (h2.type === 'ball') out.ghost = { x: h2.x, y: h2.y };
  }
  return out;
}
