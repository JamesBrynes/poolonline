// ============================================================================
//  联机：房间码 + 两种连接方式
//  · 互联网：WebRTC 点对点（PeerJS 公共信令服务器配对，自带 STUN/TURN），不用开端口
//  · 局域网：同一个 WiFi 下，朋友直接打开 http://你的IP:3000，走本地 server.js 的 WebSocket 中转
//  房主两种都挂上，谁先连进来就用谁。消息都是 JSON（数字精确往返，物理才能两边一致）。
// ============================================================================
export const NET_VERSION = 'pool-net-1';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉了容易看错的 0 O 1 I
const PEER_PREFIX = 'pool3d-room-';
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

export const randomCode = () => Array.from({ length: 4 }, () => ALPHA[(Math.random() * ALPHA.length) | 0]).join('');
export const cleanCode = (s) => String(s || '').toUpperCase().split('').filter((c) => ALPHA.includes(c)).join('').slice(0, 4);

let peerLib = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLib) return peerLib;
  peerLib = new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL; s.async = true;
    s.onload = () => (window.Peer ? ok(window.Peer) : bad(new Error('peerjs')));
    s.onerror = () => { peerLib = null; bad(new Error('peerjs')); };
    document.head.appendChild(s);
  });
  return peerLib;
}

async function relayOk() {
  if (!/^https?:$/.test(location.protocol)) return false;
  if (new URLSearchParams(location.search).has('p2p')) return false;   // 调试：强制走 P2P
  try {
    const r = await fetch('/relay/ping', { cache: 'no-store' });
    return r.ok && (await r.json()).ok === true;
  } catch { return false; }
}
async function relayHas(code) {
  try { const r = await fetch('/relay/has?code=' + code, { cache: 'no-store' }); return (await r.json()).has === true; } catch { return false; }
}
const wsURL = (code, role) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?code=${code}&role=${role}`;

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, bad) => setTimeout(() => bad(new Error(msg)), ms))]);

// 一条已连通的通道（PeerJS DataConnection 或 WebSocket）统一成同一个接口
class Link {
  constructor(kind, raw) {
    this.kind = kind; this.raw = raw; this.open = true;
    this.onmessage = null; this.onclose = null;
    const msg = (o) => { if (this.open) this.onmessage?.(o); };
    const closed = () => { if (!this.open) return; this.open = false; this.onclose?.(); };
    if (kind === 'ws') {
      raw.onmessage = (e) => { try { msg(JSON.parse(e.data)); } catch {} };
      raw.onclose = closed; raw.onerror = closed;
    } else {
      raw.on('data', (d) => msg(typeof d === 'string' ? JSON.parse(d) : d));
      raw.on('close', closed); raw.on('error', closed);
      // 有些浏览器断网时不触发 close，靠 ICE 状态兜底
      const pc = raw.peerConnection;
      if (pc) pc.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') closed(); });
    }
  }
  send(o) {
    if (!this.open) return;
    try { this.kind === 'ws' ? this.raw.send(JSON.stringify(o)) : this.raw.send(o); } catch {}
  }
  close() {
    if (!this.open) return;
    this.open = false;
    try { this.raw.close(); } catch {}
  }
}

export class NetRoom {
  constructor() {
    this.code = null; this.isHost = false; this.link = null;
    this.peer = null; this.ws = null; this.lanOnly = false;
    this.onstatus = null;          // (text) 连接过程中的提示
  }

  // 房主：开房间，等对手；resolve 一个 Link
  async host(onCode) {
    this.isHost = true;
    const lan = await relayOk();
    let lastErr = null;
    for (let tries = 0; tries < 6; tries++) {
      const code = randomCode();
      if (lan && (await relayHas(code))) continue;
      this.code = code;
      const waits = [];
      // 局域网中转
      if (lan) {
        waits.push(new Promise((ok, bad) => {
          const ws = new WebSocket(wsURL(code, 'host'));
          this.ws = ws;
          ws.onmessage = (e) => {
            let o; try { o = JSON.parse(e.data); } catch { return; }
            if (o._relay === 'peer') { ws.onmessage = null; ok(new Link('ws', ws)); }
            else if (o._relay === 'taken') bad(new Error('taken'));
          };
          ws.onerror = () => bad(new Error('ws'));
        }));
      }
      // 互联网 P2P
      let peerReady;
      waits.push(new Promise((ok, bad) => {
        peerReady = loadPeer().then((Peer) => new Promise((ready, fail) => {
          const peer = new Peer(PEER_PREFIX + code, { config: { iceServers: ICE }, debug: 0 });
          this.peer = peer;
          peer.on('open', () => ready());
          peer.on('error', (e) => { if (e.type === 'unavailable-id') { fail(new Error('taken')); bad(new Error('taken')); } else { fail(e); if (!lan) bad(e); } });
          peer.on('connection', (conn) => {
            if (this.link) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
            conn.on('open', () => ok(new Link('peer', conn)));
          });
        }));
        peerReady.catch(() => { if (!lan) bad(new Error('peer')); });
      }));
      try {
        await peerReady;
      } catch (e) {
        if (e.message === 'taken') { this._cleanup(); continue; }
        if (!lan) { this._cleanup(); throw new Error('连不上联机服务器（PeerJS），检查一下网络'); }
        this.lanOnly = true;       // 外网不通，只能局域网
      }
      onCode?.(code, { lan, lanOnly: this.lanOnly });
      try {
        const link = await Promise.any(waits);
        this.link = link;
        // 另一条通道不用了
        if (link.kind === 'ws') { try { this.peer?.destroy(); } catch {} this.peer = null; }
        else { try { this.ws?.close(); } catch {} this.ws = null; }
        return link;
      } catch (e) { lastErr = e; this._cleanup(); if (String(e?.errors?.[0]?.message || e.message) === 'taken') continue; break; }
    }
    throw new Error(lastErr ? '开房间失败，请重试' : '开房间失败，请重试');
  }

  // 加入：按房间码连过去
  async join(codeIn) {
    const code = cleanCode(codeIn);
    if (code.length !== 4) throw new Error('联机码是 4 位');
    this.code = code; this.isHost = false;
    if (await relayOk() && (await relayHas(code))) {
      const ws = new WebSocket(wsURL(code, 'guest'));
      this.ws = ws;
      await withTimeout(new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('局域网连接失败')); }), 6000, '局域网连接超时');
      this.link = new Link('ws', ws);
      return this.link;
    }
    this.onstatus?.('正在连接联机服务器…');
    let Peer;
    try { Peer = await withTimeout(loadPeer(), 12000, 'x'); } catch { throw new Error('连不上联机服务器（PeerJS），检查一下网络'); }
    const peer = new Peer({ config: { iceServers: ICE }, debug: 0 });
    this.peer = peer;
    try {
      await withTimeout(new Promise((ok, bad) => { peer.on('open', ok); peer.on('error', bad); }), 12000, '连不上联机服务器');
    } catch (e) { this._cleanup(); throw new Error('连不上联机服务器（PeerJS），检查一下网络'); }
    this.onstatus?.('找到服务器，正在找房间…');
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    try {
      await withTimeout(new Promise((ok, bad) => {
        conn.on('open', ok);
        peer.on('error', (e) => bad(new Error(e.type === 'peer-unavailable' ? '没有这个房间（联机码不对，或者房主已经关了）' : '连接失败：' + (e.type || e.message))));
        conn.on('error', () => bad(new Error('连接失败')));
      }), 20000, '连接超时：双方网络可能互相打不通（公司 / 学校网络常见），可以换个网络或用手机热点试试');
    } catch (e) { this._cleanup(); throw e; }
    this.link = new Link('peer', conn);
    return this.link;
  }

  _cleanup() {
    try { this.ws?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.ws = null; this.peer = null;
  }
  close() {
    try { this.link?.send({ t: 'bye' }); } catch {}
    const l = this.link; this.link = null;
    setTimeout(() => { try { l?.close(); } catch {} this._cleanup(); }, 150);
  }
}
