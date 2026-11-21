/* Check every onboarding step at two phone sizes: can it scroll, is the primary
   button reachable, and does the sticky action bar cover any field? */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4500';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/onb2-prof', PORT = 9383;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(P, { recursive: true, force: true });

const j = async (p, o = {}) => {
  const r = await fetch(BASE + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const SIZES = [{ w: 390, h: 844, name: 'iPhone 14' }, { w: 360, h: 640, name: 'small Android' }];

(async () => {
  const email = `onb2${Date.now()}@azolve.io`;
  const start = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: 'Scroll Tester', mode: 'create' } });
  const verify = await j('/api/auth/email/verify', { method: 'POST', body: { userId: start.data.userId, code: start.data.deliveryCode } });
  if (!verify.data.token) { console.log('seed failed'); process.exit(1); }

  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0, sessionId; const pend = new Map();
  const send = (m, p = {}, sid = sessionId) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EXC ' + r.exceptionDetails.text; return r.result?.value; };
  const done = () => { try { ws.close(); } catch { } chrome.kill(); process.exit(0); };
  setTimeout(() => { console.log('hard timeout'); done(); }, 150000);

  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  const errs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').slice(0, 160));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable');

  let pass = 0, fail = 0;
  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(1000);
    await ev(`localStorage.setItem('azolve.token', ${JSON.stringify(verify.data.token)});`);
    await send('Page.navigate', { url: BASE + '/?r=' + Math.random() });
    await sleep(3500);
    await ev(`(()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      const ins=[...document.querySelectorAll('input')];
      if(ins[0]){set.call(ins[0],'Scroll Tester');ins[0].dispatchEvent(new Event('input',{bubbles:true}));}
      if(ins[1]){set.call(ins[1],'scrolltester');ins[1].dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await sleep(250);

    for (let step = 0; step < 4; step++) {
      const g = JSON.parse(await ev(`(()=>{
        const onb=document.querySelector('.onb');
        const cs=getComputedStyle(onb);
        const btn=[...document.querySelectorAll('button')].find(e=>/continue|enter azolve/i.test(e.innerText||''));
        const title=document.querySelector('.onb-title')?.innerText||'?';
        const fields=[...document.querySelectorAll('.onb input,.onb select,.onb textarea')];
        const br=btn?btn.getBoundingClientRect():null;
        // Is any field hidden behind the sticky action bar at rest?
        const covered=fields.filter(f=>{const r=f.getBoundingClientRect();
          return br && r.bottom>br.top && r.top<br.bottom && r.bottom<window.innerHeight;}).length;
        return JSON.stringify({title, overflowY:cs.overflowY,
          scrollable: onb.scrollHeight>onb.clientHeight+1,
          maxScroll: onb.scrollHeight-onb.clientHeight,
          btnVisible: br? (br.top<window.innerHeight&&br.bottom>0):false,
          btnTop: br?Math.round(br.top):null, covered})})()`));
      const ok = g.btnVisible && g.overflowY === 'auto';
      ok ? pass++ : fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${size.name} ${size.w}x${size.h} · step ${step + 1} ${g.title}: overflowY=${g.overflowY} scrollable=${g.scrollable} max=${g.maxScroll} btnTop=${g.btnTop} visible=${g.btnVisible} fieldsBehindBar=${g.covered}`);
      if (step < 3) {
        await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/continue/i.test(e.innerText||''));b&&b.click()})()`);
        await sleep(800);
      }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed · errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  done();
})();
