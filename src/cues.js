// ============================================================================
//  球杆定义：外观（分段）+ 物理参数
//  每段：[起点 m, 终点 m, 起点半径, 终点半径, 材质名]，从皮头 (0) 往杆尾
// ============================================================================

export const CUES = {
  // 莱利 RES 系列英式八球杆（参考 Riley RES-7FR：9mm 皮头、57 寸 / 145cm、
  // 8mm 铜箍、北美白蜡木前节、乌木色手工接驳杆尾、蛇纹木 + 枫木贴皮、快拆铜接头、无握把缠绕）
  res: {
    id: 'res', name: '小头杆', model: 'Riley RES 风格 · 英式八球杆',
    specs: ['皮头 9mm', '长 145cm', '白蜡木前节', '乌木接驳杆尾', '铜箍 · 铜接头'],
    note: '杆头细、准度高，加塞时母球偏移适中',
    squirt: 0.032,
    tipR: 0.0045,
    segs: [
      [0, 0.010, 0.0045, 0.0045, 'tipBlue'],
      [0.010, 0.018, 0.0046, 0.0046, 'brass'],
      [0.018, 0.82, 0.0046, 0.0108, 'ash'],
      [0.82, 1.075, 0.0108, 0.0128, 'resSplice'],
      [1.075, 1.087, 0.0129, 0.0129, 'brass'],
      [1.087, 1.43, 0.0129, 0.0147, 'ebony'],
      [1.43, 1.45, 0.0147, 0.0145, 'rubber'],
    ],
  },
  // 碳纤维前节：低偏移
  carbon: {
    id: 'carbon', name: '碳纤维杆', model: '碳纤维前节 · 低偏移美式杆',
    specs: ['皮头 12.4mm', '长 147cm', '碳纤维前节', '径向接头', '皮革握把'],
    note: '前节轻，加塞时母球几乎不偏，最容易打准',
    squirt: 0.016,
    tipR: 0.0062,
    segs: [
      [0, 0.012, 0.0062, 0.0062, 'tipBlue'],
      [0.012, 0.016, 0.0063, 0.0063, 'ivory'],
      [0.016, 0.74, 0.0063, 0.0106, 'carbon'],
      [0.74, 0.765, 0.0107, 0.0108, 'steel'],
      [0.765, 1.06, 0.0108, 0.0124, 'carbonGloss'],
      [1.06, 1.32, 0.0124, 0.0134, 'leather'],
      [1.32, 1.45, 0.0136, 0.0147, 'carbonGloss'],
      [1.45, 1.47, 0.0147, 0.0145, 'rubber'],
    ],
  },
  // 传统大头美式杆：13mm 枫木前节
  big: {
    id: 'big', name: '大头杆', model: '枫木前节 · 传统美式杆',
    specs: ['皮头 13mm', '长 147cm', '枫木前节', '钢接头', '爱尔兰麻握把'],
    note: '杆头大、手感扎实，加塞时母球偏移最大，需要修正瞄点',
    squirt: 0.042,
    tipR: 0.0065,
    segs: [
      [0, 0.012, 0.0065, 0.0065, 'tipBlue'],
      [0.012, 0.037, 0.0066, 0.0066, 'ivory'],
      [0.037, 0.74, 0.0066, 0.0106, 'maple'],
      [0.74, 0.765, 0.0108, 0.0108, 'steel'],
      [0.765, 1.06, 0.0108, 0.0124, 'mapleForearm'],
      [1.06, 1.32, 0.0124, 0.0134, 'linen'],
      [1.32, 1.45, 0.0136, 0.0147, 'rosewood'],
      [1.45, 1.47, 0.0147, 0.0145, 'rubber'],
    ],
  },
};
export const CUE_IDS = ['res', 'carbon', 'big'];

// 距皮头 t 米处的球杆半径（避让计算用）
export function cueRadiusAt(def, t) {
  for (const [a, b, ra, rb] of def.segs) if (t <= b) return ra + ((Math.max(a, t) - a) / (b - a)) * (rb - ra);
  return def.segs[def.segs.length - 1][3];
}
export const cueLength = (def) => def.segs[def.segs.length - 1][1];

// 菜单里用的示意色
const SWATCH = {
  tipBlue: '#3a5f9e', brass: '#c9a24a', ash: '#e8d5a6', resSplice: '#8a3a1c', ebony: '#141010', rubber: '#0b0b0b',
  ivory: '#f2eee4', carbon: '#1b1b1d', steel: '#c8ccd0', carbonGloss: '#222226', leather: '#3a3a3c',
  maple: '#ecd8a8', mapleForearm: '#d9b77a', linen: '#202020', rosewood: '#5a2216',
};

export function cueSVG(def, w = 520, h = 34) {
  const L = cueLength(def);
  const maxR = 0.0148;
  const sx = (t) => (t / L) * (w - 8) + 4;
  const sy = (r) => (r / maxR) * (h / 2 - 2);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
  for (const [a, b, ra, rb, m] of def.segs) {
    const x1 = sx(a), x2 = sx(b), c = h / 2;
    s += `<polygon points="${x1},${c - sy(ra)} ${x2},${c - sy(rb)} ${x2},${c + sy(rb)} ${x1},${c + sy(ra)}" fill="${SWATCH[m]}"/>`;
    if (m === 'resSplice') {
      for (const k of [0, 1]) {
        const y = c + (k ? 1 : -1) * sy(rb) * 0.15;
        s += `<polygon points="${x1 + (x2 - x1) * 0.05},${c} ${x2},${y - sy(rb) * 0.7} ${x2},${y + sy(rb) * 0.7}" fill="#141010" opacity=".9"/>`;
      }
    }
    if (m === 'mapleForearm') s += `<polygon points="${x1 + (x2 - x1) * 0.15},${c} ${x2},${c - sy(rb)} ${x2},${c + sy(rb)}" fill="#141010"/>`;
  }
  s += `<rect x="4" y="1" width="${w - 8}" height="${h * 0.22}" fill="white" opacity=".12"/></svg>`;
  return s;
}
