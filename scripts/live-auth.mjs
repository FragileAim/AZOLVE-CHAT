/* Drive the LIVE login screen: list its controls, click "Get started" and
   "I already have an account", and report what actually changes. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const BASE = 'https://azolve-chat.onrender.com';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/auth-prof', PORT = 9353;
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
  const errs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').slice(0, 250));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(4000);

  console.log('controls:', await ev(`JSON.stringify([...document.querySelectorAll('button,a[href],input')].filter(e=>{const r=e.getBoundingClientRect();return r.width>4&&r.height>4}).map(e=>({tag:e.tagName,txt:(e.innerText||e.placeholder||e.getAttribute('aria-label')||'').trim().slice(0,40),cls:(e.className||'').toString().slice(0,40)})))`));

  for (const label of ['Get started', 'I already have an account']) {
    await send('Page.navigate', { url: BASE + '/?r=' + Math.random() });
    await sleep(3500);
    const before = await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,80)`);
    const clicked = await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>(e.innerText||'').trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));if(!b)return 'not-found';b.click();return 'clicked'})()`);
    await sleep(1800);
    const after = await ev(`JSON.stringify({txt:document.body.innerText.replace(/\\s+/g,' ').slice(0,140),inputs:document.querySelectorAll('input').length,hash:location.hash})`);
    console.log(`\n[${label}] ${clicked}\n  before: ${before}\n  after : ${after}`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`/workspace/.screenshots/live-auth-${label.replace(/\W+/g, '-')}.png`, Buffer.from(r.data, 'base64'));
  }
  console.log('\nexceptions:', errs.length ? errs : 'none');
})().catch(e => console.error('ERR', e.message)).finally(async () => { await sleep(200); try { ws?.close(); } catch { } chrome.kill('SIGKILL'); });
