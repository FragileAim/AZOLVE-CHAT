/* Verify the login screen actually advances, at phone AND desktop size. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4500';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/au-prof', PORT = 9355;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(P, { recursive: true, force: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, sessionId; const pend = new Map();
const send = (m, p = {}, sid = sessionId) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EXC ' + r.exceptionDetails.text; return r.result?.value; };
(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable');

  for (const [w, h, name] of [[390, 844, 'phone'], [1440, 900, 'desktop']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    for (const label of ['Get started', 'I already have an account']) {
      await send('Page.navigate', { url: `${BASE}/?r=${Math.random()}` });
      await sleep(3000);
      const vis = await ev(`JSON.stringify({welcome:!!document.querySelector('.ux-welcome')&&getComputedStyle(document.querySelector('.ux-welcome')).display!=='none', panel:!!document.querySelector('.auth-panel')&&getComputedStyle(document.querySelector('.auth-panel')).display!=='none', inputs:document.querySelectorAll('.auth-panel input').length})`);
      await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>(e.innerText||'').trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));b&&b.click()})()`);
      await sleep(1200);
      const after = await ev(`JSON.stringify({welcome:!!document.querySelector('.ux-welcome')&&getComputedStyle(document.querySelector('.ux-welcome')).display!=='none', panel:!!document.querySelector('.auth-panel')&&getComputedStyle(document.querySelector('.auth-panel')).display!=='none', inputs:document.querySelectorAll('.auth-panel input').length, inputTop:Math.round((document.querySelector('.auth-panel input')||{getBoundingClientRect:()=>({top:-1})}).getBoundingClientRect().top), vh:innerHeight})`);
      console.log(`${name} [${label}] before=${vis} after=${after}`);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/workspace/.screenshots/auth-${name}-${label.replace(/\W+/g, '-')}.png`, Buffer.from(r.data, 'base64'));
    }
  }
})().catch(e => console.error('ERR', e.message)).finally(async () => { await sleep(200); try { ws?.close(); } catch { } chrome.kill('SIGKILL'); });
