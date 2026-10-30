// ============================================================================
//  全屏结算画面（科技感动画）
//  showResult({ kicker, title, winner, sub, accent, players:[{name,score}], winnerIdx,
//               stats:[{label, values:[a,b], suffix}], primary:{text,onClick}, secondary:{text,onClick} })
// ============================================================================
const $ = (s) => document.querySelector(s);
let raf = 0, parts = [], streaks = [], t0 = 0, rainbowFx = false;

export function showResult(o) {
  const el = $('#result');
  const ps = o.players || [];
  const w = o.winnerIdx ?? 0;
  const winR = w === 1;
  const winScore = ps[w]?.score ?? 0;
  // 赢方分数过百 → 金色；否则 赢=蓝 / 输=红
  const gold = o.gold ?? winScore >= 100;
  el.classList.toggle('gold', gold && !o.rainbow);
  el.classList.toggle('rainbow', !!o.rainbow);
  el.classList.toggle('winR', winR);
  const accent = gold ? '#e2b25a' : '#5ad2ff';

  $('#rsKicker').textContent = o.kicker || 'RESULT';
  const title = o.rainbow ? 'MAXIMUM 147' : (gold && o.centuryTitle) ? o.centuryTitle : o.title;
  rainbowFx = !!o.rainbow;
  const t = $('#rsTitle'); t.textContent = title; t.dataset.text = title;
  $('#rsSub').textContent = o.sub || '';

  // 左右两半
  const sides = [['L', 0], ['R', 1]];
  for (const [S, i] of sides) {
    const half = $('.sx-' + S.toLowerCase());
    const isWin = i === w;
    half.classList.toggle('win', isWin);
    half.classList.toggle('lose', !isWin);
    const p = ps[i];
    const num = $('#sxNum' + S);
    num.dataset.to = p ? p.score : '';
    num.textContent = p ? '0' : (o.rightWord || '');
    if (!p && o.rightWord) num.dataset.to = '';
    // 信息块：赢方在下，输方在上
    const info = $('#sxInfo' + S);
    info.className = `sx-info sx-info-${S.toLowerCase()} ${isWin ? 'win bottom' : 'lose top'}`;
    if (!p) { info.innerHTML = ''; continue; }
    const list = (o.stats || []).map((st) => `<span>${st.label}<b>${st.values[i] ?? ''}${st.suffix || ''}</b></span>`).join('');
    info.innerHTML = `
      <div class="sx-tag">${p.tag || `PLAYER ${i + 1}`}</div>
      <div class="sx-name"><span>${esc(p.name)}</span>${isWin && o.badge !== false ? `<span class="sx-badge">${o.badge || 'WINNER'}</span>` : ''}</div>
      <div class="sx-list">${list}</div>`;
  }

  const pb = $('#rsPrimary'), sb = $('#rsSecondary');
  pb.textContent = o.primary?.text || '继续';
  sb.textContent = o.secondary?.text || '主菜单';
  pb.disabled = !!o.primary?.disabled;
  pb.onclick = () => { if (pb.disabled) return; hideResult(); o.primary?.onClick?.(); };
  sb.onclick = () => { hideResult(); o.secondary?.onClick?.(); };

  el.classList.remove('hidden', 'play');
  void el.offsetWidth;
  el.classList.add('play');
  setTimeout(() => countUp(), 1000);
  startFx(accent);
}

export function hideResult() {
  $('#result').classList.add('hidden');
  $('#result').classList.remove('play');
  cancelAnimationFrame(raf); raf = 0;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function countUp() {
  document.querySelectorAll('#result .sx-num').forEach((n) => {
    if (n.dataset.to === '') return;
    const to = +n.dataset.to, start = performance.now(), dur = 1100;
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      n.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ---- 粒子特效：中心爆开的光线 + 缓缓上升的金色光点 ----
function startFx(accent) {
  const cv = $('#rsFx');
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const resize = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  resize();
  window.addEventListener('resize', resize, { once: true });
  parts = []; streaks = [];
  const W = () => cv.width, H = () => cv.height;
  for (let i = 0; i < 110; i++) parts.push(newPart(W(), H(), true));
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    streaks.push({ a, v: 900 + Math.random() * 1600, len: 60 + Math.random() * 220, d: Math.random() * 0.25 });
  }
  t0 = performance.now();
  cancelAnimationFrame(raf);
  const tick = (now) => {
    const t = (now - t0) / 1000;
    const w = W(), h = H();
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // 爆开的光线（前 1.6 秒）
    if (t < 1.8) {
      const cx = w / 2, cy = h * 0.36;
      for (const s of streaks) {
        const tt = t - 0.5 - s.d;
        if (tt < 0) continue;
        const r1 = tt * s.v * dpr, r0 = Math.max(0, r1 - s.len * dpr);
        const alpha = Math.max(0, 1 - tt / 1.1);
        const g = ctx.createLinearGradient(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0, cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, rainbowFx ? `hsla(${(s.a * 57 + t * 200) % 360},100%,65%,${alpha})` : hexA(accent, alpha));
        ctx.strokeStyle = g; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0); ctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); ctx.stroke();
      }
    }
    // 上升的光点
    for (const p of parts) {
      p.y -= p.vy * dpr; p.x += Math.sin(t * p.f + p.ph) * 0.3 * dpr;
      p.life -= 0.004;
      if (p.y < -10 || p.life <= 0) Object.assign(p, newPart(w, h, false));
      const a = Math.min(1, p.life) * p.al * Math.min(1, t / 0.8);
      ctx.fillStyle = rainbowFx ? `hsla(${(p.ph * 60 + t * 90) % 360},100%,68%,${a})` : p.cyan ? `rgba(90,210,255,${a})` : hexA(accent, a);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * dpr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function newPart(w, h, any) {
  return {
    x: Math.random() * w, y: any ? Math.random() * h : h + Math.random() * 40,
    vy: 0.25 + Math.random() * 0.9, r: 0.6 + Math.random() * 1.8, al: 0.25 + Math.random() * 0.6,
    f: 0.5 + Math.random() * 1.5, ph: Math.random() * 6, life: 1 + Math.random() * 1.5, cyan: Math.random() < 0.25,
  };
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
