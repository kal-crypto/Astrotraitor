/* Validate a map against the REAL engine (loads index.html in a headless browser and calls
   the game's own validateMap), then draw a coarse picture of it.

   Usage:  node validate-map.mjs <mapId>
   Prints "VALID" or a list of problems, then an ASCII plan view.                            */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///c:/Users/User/OneDrive/Desktop/AMONGUS3D/index.html';
const ID = process.argv[2];
const PORT = 9500 + Math.floor(Math.random() * 400);
const PROFILE = `${process.env.TEMP || "/tmp"}/amongus-validate-${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!ID){ console.log('usage: node validate-map.mjs <mapId>'); process.exit(2); }

// fail fast on a syntax error rather than waiting on a blank browser
try {
  const js = readFileSync('c:/Users/User/OneDrive/Desktop/AMONGUS3D/index.html', 'utf8')
    .match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${PROFILE}.mjs`, js);
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--check', `${PROFILE}.mjs`], { stdio: 'pipe' });
} catch (e) {
  console.log('SYNTAX ERROR in index.html — fix this first:\n');
  console.log(String(e.stderr || e.message).split('\n').slice(0, 12).join('\n'));
  process.exit(1);
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=900,600',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--mute-audio',
  `--user-data-dir=${PROFILE}`, URL], { stdio: 'ignore' });

let ws, id = 0; const pend = new Map(); const errors = [];
const send = (m, p = {}) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.value;
};

let code = 1;
try {
  let t;
  for (let i = 0; i < 80; i++){
    try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.some(x => x.type === 'page')) break; } catch {}
    await sleep(250);
  }
  ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)){ pend.get(m.id)(m.result); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value).join(' '));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(4500);

  if (!(await ev('typeof __game === "object"'))){
    console.log('The game failed to load. Page errors:');
    errors.slice(0, 8).forEach(e => console.log('  ' + String(e).split('\n')[0]));
    process.exit(1);
  }
  const known = await ev('JSON.stringify(__game.maps)');
  if (!JSON.parse(known).includes(ID)){
    console.log(`No map with id "${ID}". Registered maps: ${known}`);
    process.exit(1);
  }

  const problems = JSON.parse(await ev(`JSON.stringify(__game.validateMap(${JSON.stringify(ID)}))`));
  const info = JSON.parse(await ev(`(__game.loadMap(${JSON.stringify(ID)}), JSON.stringify({
    bounds: __game.bounds,
    rooms: __game.rooms.map(r => r.name),
    vents: __game.vents.length,
    tasks: __game.MAPS[${JSON.stringify(ID)}].tasks.length,
    steps: __game.MAPS[${JSON.stringify(ID)}].tasks.reduce((a,t) => a + (t.wire ? 3 : t.steps.length), 0),
    fuse: __game.MAPS[${JSON.stringify(ID)}].sab.fuse
  }))`));

  const b = info.bounds;
  console.log(`\n=== ${ID} ===`);
  console.log(`footprint ${b.MAXX-b.MINX} x ${b.MAXZ-b.MINZ}   rooms ${info.rooms.length}   vents ${info.vents}   tasks ${info.tasks} (${info.steps} steps)   fuse ${info.fuse}s`);

  if (problems.length){
    console.log(`\nNOT VALID — ${problems.length} problem(s):`);
    problems.forEach(p => console.log('  - ' + p));
    code = 1;
  } else {
    console.log('\nVALID');
    code = 0;
  }

  // plan view straight off the walkability grid, so it shows what the ENGINE built
  const art = await ev(`(() => {
    __game.loadMap(${JSON.stringify(ID)});
    const {MINX,MAXX,MINZ,MAXZ} = __game.bounds;
    const W = 78, H = 30, out = [];
    for (let r = 0; r < H; r++){
      let line = '';
      for (let c = 0; c < W; c++){
        const x = MINX + (c + .5) * (MAXX-MINX) / W;
        const z = MINZ + (r + .5) * (MAXZ-MINZ) / H;
        const room = __game.roomAt(x, z);
        line += !__game.freeAt(x, z, .4) ? ' ' : (room === 'Hallway' ? '.' : '#');
      }
      out.push(line);
    }
    // mark rooms, vents, spawn
    const put = (x, z, ch) => {
      const c = Math.round((x - MINX) / (MAXX-MINX) * W), r = Math.round((z - MINZ) / (MAXZ-MINZ) * H);
      if (r >= 0 && r < H && c >= 0 && c < W) out[r] = out[r].slice(0,c) + ch + out[r].slice(c+1);
    };
    __game.vents.forEach(v => put(v.p[0], v.p[1], 'V'));
    const m = __game.MAPS[${JSON.stringify(ID)}];
    put(m.spawn.x, m.spawn.z, 'S');
    __game.rooms.forEach(r => put((r.x1+r.x2)/2, (r.z1+r.z2)/2, r.name[0]));
    return out.join('\\n');
  })()`);
  console.log('\nplan view  (# room, . hall, V vent, S spawn, letter = room initial):');
  console.log(art);
  console.log('\nrooms: ' + info.rooms.join(', '));
  if (errors.length){
    console.log('\npage errors (fix these too):');
    errors.slice(0, 6).forEach(e => console.log('  ' + String(e).split('\n')[0]));
    code = 1;
  }
} catch (e) {
  console.log('VALIDATOR ERROR: ' + e.message);
  errors.slice(0, 5).forEach(x => console.log('  ' + String(x).split('\n')[0]));
  code = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(200);
  process.exit(code);
}
