import { spawn } from 'node:child_process';
import fs from 'node:fs';
const BASE = 'http://localhost:4500';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/boot-prof', PORT = 9347;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(P, { recursive: true, force: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0, sessionId; const pend = new Map();
const send = (m, p = {}, sid = sessionId) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const api = async (path, body, token, method = 'POST') => (await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const s = Date.now().toString(36);
  const st = await api('/api/auth/email/start', { email: `bp${s}@azolve.test` });
  const v = await api('/api/auth/email/verify', { userId: st.userId, code: st.deliveryCode });
  await api('/api/users/me', { language: 'en', country: 'IN', bio: 'probe', displayName: 'Boot Probe', username: `bp${s}` }, v.token, 'PATCH');
  await send('Page.navigate', { url: `${BASE}/?splash=0` }); await sleep(1200);
  await ev(`localStorage.setItem('azolve.token', ${JSON.stringify(v.token)});localStorage.setItem('azolve.refresh', ${JSON.stringify(v.refreshToken || '')});localStorage.setItem('azolve.device','desktop');`);
  await send('Page.navigate', { url: `${BASE}/?splash=0#/home` });
  for (let i = 0; i < 12; i++) {
    await sleep(700);
    console.log(i, await ev(`JSON.stringify({t:(localStorage.getItem('azolve.token')||'').length, h:location.hash, nav:document.querySelectorAll('.mobile-nav button').length, b:document.body.innerText.replace(/\\s+/g,' ').slice(0,60)})`));
  }
  console.log('me direct:', JSON.stringify(await api('/api/users/me', null, v.token, 'GET')).slice(0, 160));
})().catch(e => console.error('ERR', e.message)).finally(async () => { await sleep(200); try { ws?.close(); } catch { } chrome.kill('SIGKILL'); });
