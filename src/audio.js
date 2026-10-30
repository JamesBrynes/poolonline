// ============================================================================
//  音效：真实录音采样（assets/sounds，均为 Freesound CC0），加载失败时退回合成音
//  · 出杆：皮头击球    · 球碰球：清脆的"咔"
//  · 碰库：闷响        · 碰袋角：较脆的库边声（响袋）
//  · 进袋：球砸进袋口（大力时是"响袋"）+ 落进网兜的滚动声（落袋）
// ============================================================================
const SAMPLES = {
  cue: ['cue1', 'cue2', 'cue3', 'cue4', 'cue5'],
  clack: ['clack1', 'clack2', 'clack3', 'clack4'],
  cushion: ['cushion1'],
  pocket: ['pocket1', 'pocket2'],
  pocketHard: ['pocket3'],
  drop: ['drop1'],
};

export class Sfx {
  constructor() {
    this.ctx = null; this.enabled = true; this.lastT = 0; this.count = 0;
    this.buf = {}; this.pitch = 1;      // 斯诺克球小一点，音调略高
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      // 轻微房间混响，让声音不那么"干"
      const conv = this.ctx.createConvolver();
      conv.buffer = this._impulse(0.6);
      const wet = this.ctx.createGain(); wet.gain.value = 0.12;
      this.master.connect(this.ctx.destination);
      this.master.connect(conv); conv.connect(wet); wet.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._load();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _impulse(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
    return b;
  }

  async _load() {
    const names = [...new Set(Object.values(SAMPLES).flat())];
    await Promise.all(names.map(async (n) => {
      try {
        const r = await fetch(`./assets/sounds/${n}.mp3`);
        if (!r.ok) return;
        this.buf[n] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch { /* 用合成音兜底 */ }
    }));
  }

  _ok() {
    if (!this.enabled || !this.ctx) return false;
    const now = this.ctx.currentTime;
    if (now - this.lastT > 0.03) { this.lastT = now; this.count = 0; }
    return ++this.count <= 5;   // 同一时刻最多 5 个音，开球时不爆音
  }

  // 播放采样；成功返回 true
  _play(kind, gain, rate = 1, delay = 0) {
    const list = SAMPLES[kind].filter((n) => this.buf[n]);
    if (!list.length) return false;
    const b = this.buf[list[(Math.random() * list.length) | 0]];
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = b;
    src.playbackRate.value = rate * this.pitch * (0.96 + Math.random() * 0.08);
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(this.master);
    src.start(c.currentTime + delay);
    return true;
  }

  // ---- 合成兜底 ----
  _noise(t, dur, freq, q, gain, type = 'bandpass') {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
  }
  _tone(t, dur, freq, gain, type = 'sine', freqEnd) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  ball(speed) {
    if (!this._ok()) return;
    const v = Math.min(1, speed / 5) ** 0.8;
    if (this._play('clack', 0.15 + 0.85 * v, 0.97 + v * 0.06)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.035, 3100 + Math.random() * 500, 0.5 * v);
    this._noise(t, 0.02, 4500, 1.2, 0.5 * v);
  }

  cushion(speed, jaw = false) {
    if (!this._ok()) return;
    const v = Math.min(1, speed / 4);
    if (jaw) {
      // 碰袋角（响袋）：更脆、更短
      if (this._play('cushion', 0.4 + 0.6 * v, 1.35)) { this._play('clack', 0.12 * v, 0.7); return; }
    } else if (this._play('cushion', 0.3 + 0.7 * v, 0.95)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.09, jaw ? 700 : 260, 0.9, 0.9 * v, 'lowpass');
  }

  pocket(speed) {
    if (!this._ok()) return;
    const v = Math.min(1, 0.35 + speed / 3);
    // 大力进袋 = 响袋；轻推进袋 = 闷闷地落袋
    const hard = speed > 1.6;
    const ok = this._play(hard ? 'pocketHard' : 'pocket', 0.4 + 0.6 * v, hard ? 1 : 0.95);
    this._play('drop', 0.35 + 0.3 * v, 1, hard ? 0.18 : 0.1);
    if (ok) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.12, 380, 1.5, 0.9 * v, 'lowpass');
    this._tone(t, 0.18, 110, 0.4 * v, 'sine', 60);
  }

  // ---- 147 过场用的合成音效 ----
  whoosh() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(3500, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.6);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.75);
  }
  heartbeat() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.18, 70, 0.9, 'sine', 40);
    this._tone(t + 0.2, 0.16, 62, 0.6, 'sine', 38);
  }
  riser(dur = 1.8) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + dur); g.gain.setValueAtTime(0.0001, t + dur + 0.02);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.08, t + dur); og.gain.setValueAtTime(0.0001, t + dur + 0.02);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  boom() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._tone(t, 1.6, 90, 1.0, 'sine', 28);
    this._tone(t, 0.9, 180, 0.4, 'triangle', 50);
    this._noise(t, 0.9, 400, 0.7, 0.9, 'lowpass');
  }
  sparkle() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 14; i++) this._tone(t + i * 0.045, 0.35, 1800 + Math.random() * 3200, 0.07, 'sine');
  }

  cue(power) {
    if (!this._ok()) return;
    const v = 0.3 + 0.7 * power;
    if (this._play('cue', v, 0.95 + power * 0.1)) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.03, 1800, 0.35 * v);
    this._noise(t, 0.025, 2500, 1, 0.4 * v);
  }
}
