import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/shotp', PORT = 9377, sleep = ms => new Promise(r => setTimeout(r, ms));
fs.rmSync(P, { recursive: true, force: true });
const c = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, sid; const pend = new Map();
const send = (m, p = {}, s = sid) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.value; };
const done = () => { try { ws.close(); } catch { } c.kill(); process.exit(0); };
setTimeout(() => { console.log('hard timeout'); done(); }, 60000);
(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 AzolveChatApp/1.1.4' });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'https://azolve-chat.onrender.com/?r=' + Math.random() });
  await sleep(6000);
  await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>/get started/i.test(e.innerText||''));b&&b.click()})()`);
  await sleep(1800);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/workspace/azolve/.screenshots/apk-login-live.png', Buffer.from(r.data, 'base64'));
  console.log('saved');
  done();
})();
