/* Reproduce what the Android WebView does: load the bundled demo build from a
   file:// URL and report whether the JS module actually executes. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const TARGET = process.argv[2] || 'file:///workspace/azolve/mobile/android/app/src/main/assets/www/index.html';
const P = '/tmp/file-prof', PORT = 9361;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(P, { recursive: true, force: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files=false', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, sessionId; const pend = new Map();
const send = (m, p = {}, sid = sessionId) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EXC ' + r.exceptionDetails.text; return r.result?.value; };
(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  const errs = [], fails = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
    if (m.method === 'Log.entryAdded') errs.push('[log] ' + m.params.entry.text.slice(0, 300));
    if (m.method === 'Network.loadingFailed') fails.push(m.params.errorText + ' ' + (m.params.blockedReason || ''));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: TARGET });
  await sleep(5000);
  console.log('target:', TARGET);
  console.log('root children:', await ev(`document.getElementById('root')?document.getElementById('root').childElementCount:'no #root'`));
  console.log('body text:', JSON.stringify(await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,160)`)));
  console.log('scripts:', await ev(`JSON.stringify([...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src')))`));
  console.log('exceptions/log:', errs.length ? errs.join('\n  ') : 'none');
  console.log('network failures:', fails.length ? fails.join(' | ') : 'none');
  ws.close(); chrome.kill(); process.exit(0);
})();
