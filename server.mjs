/* ============================================================
   ASTROTRAITORS — game server
   Serves the game and relays messages between players.

   The relay is deliberately dumb: it knows about rooms and who is in
   them, nothing about the game. One player's browser is the HOST and
   runs the simulation (bots, kills, meetings, win conditions); everyone
   else is a guest whose client sends input and renders what the host
   reports. That keeps a single source of truth without reimplementing
   the whole game on the server.

   Run:  node server.mjs [port]
   ============================================================ */
import { createServer } from 'node:http';
import { createServer as createTLS } from 'node:https';
import { existsSync, mkdirSync, readFileSync as readCert, writeFileSync as writeCert } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import selfsigned from 'selfsigned';

const ROOT = dirname(fileURLToPath(import.meta.url));
// take the first plain-number argument as the port, so flags like --http-only don't get
// mistaken for one. On a host like Render/Railway the port comes in through process.env.PORT.
const portArg = process.argv.slice(2).find(a => /^\d+$/.test(a));
const PORT = Number(portArg || process.env.PORT || 8080);
const TLS_PORT = PORT + 363;                   // 8443 by default
const REDIRECT = process.argv.includes('--force-https');   // off: no certificate warning
const HTTP_ONLY = process.argv.includes('--http-only');
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
                '.css':'text/css', '.json':'application/json', '.md':'text/markdown; charset=utf-8',
                '.txt':'text/plain; charset=utf-8',   // ads.txt for AdSense
                '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

/* ---------------- static files ---------------- */
const serve = async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.toLowerCase().startsWith(ROOT.toLowerCase())){ res.writeHead(403).end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404, {'content-type':'text/plain'}).end('404'); }
};
let https = null;
const http = createServer((req, res) => {
  // Bounce to https so the mic is always available. Anyone who genuinely wants plain http
  // (no certificate warning, no voice) can pass --http-only.
  const host = String(req.headers.host || '').split(':')[0];
  // localhost is ALREADY a secure context — the mic works there over plain http, so putting
  // the person hosting the game through a certificate warning would be pure friction. Only
  // the addresses that genuinely cannot have a microphone get forwarded.
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (https && !HTTP_ONLY && !isLocal && REDIRECT){
    res.writeHead(302, { location: `https://${host}:${TLS_PORT}${req.url}` });
    res.end();
    return;
  }
  serve(req, res);
});

/* ---------------- https ----------------
   Browsers only hand over a microphone in a "secure context": https, or localhost. So over
   http://<lan-ip> — exactly how a phone reaches this — navigator.mediaDevices does not even
   exist and voice can never work. A self-signed certificate fixes that: the browser shows a
   warning once, you accept it, and the mic is available from then on.                       */
const CERT_DIR = join(ROOT, '.cert');
async function tlsOptions(){
  const keyPath = join(CERT_DIR, 'key.pem'), certPath = join(CERT_DIR, 'cert.pem');
  if (existsSync(keyPath) && existsSync(certPath))
    return { key: readCert(keyPath), cert: readCert(certPath) };
  const ips = lanIPs();
  const pems = await selfsigned.generate([{ name:'commonName', value:'astrotraitors.local' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        ...ips.map(ip => ({ type: 7, ip }))     // so the cert covers the address phones use
      ]
    }]
  });
  mkdirSync(CERT_DIR, { recursive: true });
  writeCert(keyPath, pems.private); writeCert(certPath, pems.cert);
  console.log('  (generated a self-signed certificate in .cert/)');
  return { key: pems.private, cert: pems.cert };
}

/* ---------------- the lobby ----------------
   One server, one game. No room codes: everyone who opens the page lands in the same
   lobby, and the first to join hosts it. Codes only earn their keep when one server
   runs many games at once — here they were a step between the player and the game.   */
// There is always exactly ONE open lobby, plus however many games are already running.
// The moment a host starts, that group becomes a running game and a fresh lobby opens — so
// someone arriving mid-round is never locked out, they just can't walk into a round in
// progress. Size is fixed by whoever opens a lobby; everyone in it must agree on it.
const newRoom = () => ({ hostId: null, members: new Map(), started: false, size: null });
let lobby = newRoom();
const games = new Set();                       // rounds already under way
let nextId = 1;
const sockets = new Set();                     // every connection, joined or just looking

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const PALETTE = 12;                            // must match COLORS[] in index.html
// Everyone defaults to red, so without this a whole lobby shows up as the same bean.
const freeColor = (room, want) => {
  const taken = new Set([...room.members.values()].map(m => m.colorIdx));
  if (!taken.has(want)) return want;
  for (let i = 0; i < PALETTE; i++) if (!taken.has(i)) return i;
  return want;
};
// ...and the name box defaults to "You", so without this you get "You (you)" next to "You"
const freeName = (room, want) => {
  const taken = new Set([...room.members.values()].map(m => m.name.toLowerCase()));
  if (!taken.has(want.toLowerCase())) return want;
  for (let i = 2; i < 12; i++) if (!taken.has((want + i).toLowerCase())) return want + i;
  return want;
};
const roster = room => [...room.members].map(([id, m]) => ({ id, name:m.name, colorIdx:m.colorIdx, host:id === room.hostId }));

// everyone who has the page open sees the live count, not just those already in the lobby —
// that is what the menu button reads
function pushAll(){
  // anyone not already in a round is looking at the open lobby
  const status = { t:'lobby', n: lobby.members.size, size: lobby.size, started: false };
  for (const ws of sockets) if (!ws.room || ws.room === lobby) send(ws, status);
  for (const r of [lobby, ...games]){
    const list = roster(r);
    for (const m of r.members.values()) send(m.ws, { t:'peers', list });
  }
}

const log = m => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);

function leave(ws){
  const room = ws.room;
  if (!room || !room.members.has(ws.id)) return;
  const wasHost = ws.id === room.hostId;
  room.members.delete(ws.id);
  ws.room = null;
  log(`${ws.name} left ${room.started ? 'a game' : 'the lobby'} (${room.members.size} left)`);
  if (wasHost){
    // the host's browser IS the simulation, so the round cannot outlive it
    for (const m of room.members.values()){
      send(m.ws, {t:'closed', m:'The host left the game.'});
      m.ws.room = null;
    }
    room.members.clear(); room.hostId = null;
  } else {
    const h = room.members.get(room.hostId);
    if (h) send(h.ws, {t:'gone', id:ws.id});
  }
  if (room === lobby){
    if (room.members.size === 0){ room.size = null; room.hostId = null; }
  } else if (room.members.size === 0){
    games.delete(room);                       // a finished round just disappears
  }
  pushAll();
}

const wss = new WebSocketServer({ noServer: true });   // shared by the http and https servers
wss.on('connection', ws => {
  ws.id = nextId++; ws.isAlive = true;
  sockets.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.room = null;
  send(ws, { t:'lobby', n: lobby.members.size, size: lobby.size, started: false });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join'){
      if (ws.room) return;
      const room = lobby;                                       // always the open one
      // the HOST sets the player count in the lobby now, so a joiner doesn't pre-match — the
      // first one in seeds it from their menu pick, and only the host changes it after.
      if (room.size === null) room.size = [6, 9, 12, 15].includes(m.count) ? m.count : 9;
      if (room.members.size >= room.size)
        return send(ws, { t:'err', m:`The game is full (${room.size} players).` });
      ws.name = freeName(room, (m.name || 'Player').slice(0, 10));
      ws.room = room;
      const gotColor = freeColor(room, m.colorIdx | 0);        // may differ from the request
      room.members.set(ws.id, { ws, name: ws.name, colorIdx: gotColor });
      if (room.hostId === null) room.hostId = ws.id;          // first in hosts it
      // tell them the colour they ACTUALLY got — the request may have been taken
      send(ws, { t:'room', id: ws.id, host: ws.id === room.hostId, colorIdx: gotColor });
      log(`${ws.name} joined the lobby (${room.members.size}/${room.size})${ws.id === room.hostId ? ' — hosting' : ''}`);
      pushAll();
      return;
    }

    if (m.t === 'setsize'){                   // host changes the player count in the lobby
      const room = ws.room;
      if (!room || ws.id !== room.hostId || room.started) return;
      const n = m.n | 0;
      if (![6, 9, 12, 15].includes(n)) return;
      if (n < room.members.size)              // can't shrink below who's already here
        return send(ws, { t:'err2', m:`${room.members.size} players are already in — can't set it to ${n}.` });
      room.size = n;
      pushAll();
      return;
    }

    if (m.t === 'setcolor'){                  // claim a colour in the lobby
      const room = ws.room, me = room?.members.get(ws.id);
      if (!me || room.started) return;
      const want = m.colorIdx | 0;
      const taken = new Set([...room.members.values()].filter(x => x !== me).map(x => x.colorIdx));
      if (want >= 0 && want < PALETTE && !taken.has(want)){ me.colorIdx = want; pushAll(); }
      else send(ws, { t:'color', colorIdx: me.colorIdx });   // rejected — resync their real one
      return;
    }

    if (m.t === 'msg'){                       // relay — server never inspects m.d
      const room = ws.room;
      if (!room || !room.members.has(ws.id)) return;
      if (m.to === 'host'){
        const h = room.members.get(room.hostId);
        if (h) send(h.ws, { t:'msg', from: ws.id, d: m.d });
      } else if (m.to === 'all'){
        if (ws.id !== room.hostId) return;    // only the host may broadcast
        for (const [id, mem] of room.members) if (id !== ws.id) send(mem.ws, { t:'msg', from: ws.id, d: m.d });
      } else {
        if (ws.id !== room.hostId) return;
        const mem = room.members.get(m.to);
        if (mem) send(mem.ws, { t:'msg', from: ws.id, d: m.d });
      }
      return;
    }

    // WebRTC signalling: voice is peer-to-peer, so unlike game traffic it has to flow
    // guest<->guest. Opaque to the server, same as 'msg'.
    if (m.t === 'sig'){
      const room = ws.room;
      if (!room || !room.members.has(ws.id)) return;
      const mem = room.members.get(m.to);
      if (mem) send(mem.ws, { t:'sig', from: ws.id, d: m.d });
      return;
    }

    if (m.t === 'started'){
      // the group leaves the lobby and becomes a running game; a fresh lobby opens behind
      // them, so the next arrivals form the NEXT game instead of being turned away
      const room = ws.room;
      if (!room || ws.id !== room.hostId || room.started) return;
      room.started = true;
      games.add(room);
      lobby = newRoom();
      log(`round started with ${room.members.size} — new lobby open (${games.size} game(s) running)`);
      pushAll();
      return;
    }
    if (m.t === 'leave') leave(ws);
  });

  ws.on('close', () => { sockets.delete(ws); leave(ws); });
  ws.on('error', () => { sockets.delete(ws); leave(ws); });
});

// drop half-open sockets (laptop lid closed, wifi dropped) so rooms don't fill with ghosts
setInterval(() => {
  for (const ws of wss.clients){
    if (!ws.isAlive){ ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000).unref();

function lanIPs(){
  return Object.values(networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
}

const upgrade = (req, socket, head) =>
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
http.on('upgrade', upgrade);

try {
  if (!HTTP_ONLY) https = createTLS(await tlsOptions(), serve);
  https?.on('upgrade', upgrade);        // ?. — null in --http-only mode, which is fine
  https?.on('error', e => console.log('  (https error: ' + e.message + ')'));
} catch (e) {
  console.log('  (https unavailable: ' + e.message + ' — voice will only work on localhost)');
}

const ip = lanIPs()[0];
http.listen(PORT, () => {
  https?.listen(TLS_PORT, () => {});
  console.log(`\n  ASTROTRAITORS`);
  console.log(`  --------------------------------------------------------`);
  console.log(`  You:            http://localhost:${PORT}`);
  if (ip)   console.log(`  Phone / wifi:   http://${ip}:${PORT}`);
  console.log(`                  everything works here, nothing to accept`);
  if (https && !HTTP_ONLY){
    console.log('');
    console.log(`  Voice on a PHONE needs https (browser rule, not the game):`);
    if (ip) console.log(`                  https://${ip}:${TLS_PORT}   <- tap Advanced -> Proceed`);
    console.log(`  Voice on THIS pc already works on the http link above.`);
  }
  console.log(`  --------------------------------------------------------\n`);
});
