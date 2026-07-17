/* ============================================================
   host.mjs — put your game on the internet for free, one command.

   Starts the game server, then opens a Cloudflare "quick tunnel": a
   throwaway public https URL that points at your machine. No account,
   no signup, no port forwarding — and because the URL is real https,
   voice chat works on phones with no certificate warning.

   Run:  npm run host       (or: node host.mjs)
   Stop: Ctrl+C — the tunnel and the link vanish with it.
   ============================================================ */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { bin, install, Tunnel } from 'cloudflared';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

// the tunnel already gives real https, so the server only needs plain http
const server = spawn(process.execPath, [join(ROOT, 'server.mjs'), String(PORT), '--http-only'],
  { stdio: 'inherit' });

// cloudflared downloads a small binary the first time
if (!existsSync(bin)){
  console.log('\n  first run: downloading the tunnel helper (~30MB, once)…');
  await install(bin);
}

console.log('  opening a public tunnel…\n');
const tunnel = Tunnel.quick(`http://localhost:${PORT}`);

let printed = false;
tunnel.on('url', link => {
  if (printed) return; printed = true;
  console.log('\n  ========================================================');
  console.log('  SHARE THIS LINK — anyone, anywhere, no install:');
  console.log(`\n     ${link}\n`);
  console.log('  Real https, so phone voice works with no warning.');
  console.log('  Keep this window open. Ctrl+C ends the game and the link.');
  console.log('  ========================================================\n');
});
tunnel.on('error', e => console.log('  tunnel error: ' + e.message));

const shutdown = () => { try { tunnel.stop(); } catch {} try { server.kill(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', shutdown);
tunnel.on('exit', () => { try { server.kill(); } catch {} process.exit(1); });
