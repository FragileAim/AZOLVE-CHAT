/* On the smallest phone, at the Privacy step, scrolled fully to the bottom:
   report exactly which field overlaps the sticky action bar and by how much. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4500';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/onb3-prof', PORT = 9389, sleep = ms => new Promise(r => setTimeout(r, ms));
fs.rmSync(P, { recursive: true, force: true });
const j = async (p, o = {}) => {
  const r = await fetch(BASE + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
(async () => {
  const email = `onb3${Date.now()}@azolve.io`;
  const a = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: 'T', mode: 'create' } });
  const v = await j('/api/auth/email/verify', { method: 'POST', body: { userId: a.data.userId, code: a.data.deliveryCode } });
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0, sid; const pend = new Map();
  const send = (m, p = {}, s = sid) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value; };
  const done = () => { try { ws.close(); } catch { } chrome.kill(); process.exit(0); };
  setTimeout(() => { console.log('timeout'); done(); }, 90000);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: BASE + '/' }); await sleep(1000);
  await ev(`localStorage.setItem('azolve.token', ${JSON.stringify(v.data.token)});`);
  await send('Page.navigate', { url: BASE + '/?r=' + Math.random() }); await sleep(3500);
  await ev(`(()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const ins=[...document.querySelectorAll('input')];
    if(ins[0]){set.call(ins[0],'T Tester');ins[0].dispatchEvent(new Event('input',{bubbles:true}));}
    if(ins[1]){set.call(ins[1],'ttester');ins[1].dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await sleep(250);
  for (let i = 0; i < 3; i++) { await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/continue/i.test(e.innerText||''));b&&b.click()})()`); await sleep(800); }
  await ev(`(()=>{const o=document.querySelector('.onb');o.scrollTop=o.scrollHeight;return 1})()`);
  await sleep(600);
  console.log(await ev(`(()=>{const o=document.querySelector('.onb');const bar=document.querySelector('.onb-actions');
    const br=bar.getBoundingClientRect();
    const rows=[...document.querySelectorAll('.onb .field,.onb .setting-row,.onb .onb-note')].map(f=>{const r=f.getBoundingClientRect();
      return {label:(f.innerText||'').replace(/\\s+/g,' ').slice(0,26),top:Math.round(r.top),bottom:Math.round(r.bottom),hiddenBy:Math.round(Math.max(0,r.bottom-br.top))};});
    return JSON.stringify({barTop:Math.round(br.top),barHeight:Math.round(br.height),scrollTop:o.scrollTop,max:o.scrollHeight-o.clientHeight,rows},null,1)})()`));
  done();
})();
