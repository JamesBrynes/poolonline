// 本地服务器（零依赖）。用法：node server.js  然后打开 http://localhost:3000
// · 静态文件
// · 联机：局域网 WebSocket 中转（/ws?code=XXXX&role=host|guest）。同一个 WiFi 的朋友打开 http://你的IP:3000 就能加入。
//   互联网联机走浏览器之间的 P2P，不经过这里。
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8' };

const rooms = new Map();     // code -> { host, guest }
const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/relay/ping') return json(res, { ok: true });
  if (u.pathname === '/relay/has') return json(res, { has: rooms.has(String(u.searchParams.get('code') || '').toUpperCase()) });
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store, must-revalidate' });
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
});

// ---- 极简 WebSocket（只收发文本帧）----
function wsSend(sock, text) {
  if (sock.destroyed) return;
  const data = Buffer.from(text);
  const n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  sock.write(Buffer.concat([head, data]));
}
function wsClose(sock) { if (!sock.destroyed) { try { sock.end(Buffer.from([0x88, 0])); } catch {} } }

server.on('upgrade', (req, sock) => {
  const u = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (u.pathname !== '/ws' || !key) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  sock.setNoDelay(true);

  const code = String(u.searchParams.get('code') || '').toUpperCase().slice(0, 8);
  const role = u.searchParams.get('role');
  let room = rooms.get(code);
  if (role === 'host') {
    if (room) { wsSend(sock, JSON.stringify({ _relay: 'taken' })); wsClose(sock); return; }
    room = { host: sock, guest: null };
    rooms.set(code, room);
  } else {
    if (!room || room.guest) { wsSend(sock, JSON.stringify({ t: 'full' })); wsClose(sock); return; }
    room.guest = sock;
    wsSend(room.host, JSON.stringify({ _relay: 'peer' }));
  }
  const other = () => (room.host === sock ? room.guest : room.host);

  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mOff = off; if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[mOff + (i & 3)];
      buf = buf.subarray(off + len);
      if (op === 1) { const o = other(); if (o) wsSend(o, payload.toString()); }
      else if (op === 8) { wsClose(sock); return; }
      else if (op === 9) { if (!sock.destroyed) sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); }
    }
  });
  const gone = () => {
    if (rooms.get(code) !== room) return;
    const o = other();
    if (o) { wsSend(o, JSON.stringify({ t: 'bye' })); wsClose(o); }
    rooms.delete(code);
  };
  sock.on('close', gone);
  sock.on('error', gone);
});

server.listen(PORT, () => {
  console.log(`🎱 打开 http://localhost:${PORT}`);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  if (ips.length) console.log(`   同一个 WiFi 的朋友可以打开：${ips.map((ip) => `http://${ip}:${PORT}`).join('  或  ')}`);
});
