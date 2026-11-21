/* Walk the onboarding to the Privacy step and report whether that screen can
   actually scroll. It is the tallest step, so if the shell's overflow:hidden
   has no scroll container behind it, the "Enter AZOLVE CHAT" button is
   unreachable. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4500';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/onb-prof', PORT = 9391;
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

(async () => {
  /* A brand-new account has no country/bio, so the app gates it into onboarding. */
  const email = `onb${Date.now()}@azolve.io`;
  const start = await j('/api/auth/email/start', { method: 'POST', body: { email, displayName: 'Scroll Tester', mode: 'create' } });
  const verify = await j('/api/auth/email/verify', { method: 'POST', body: { userId: start.data.userId, code: start.data.deliveryCode } });
  if (!verify.data.token) { console.log('seed failed:', JSON.stringify(start.data), JSON.stringify(verify.data)); process.exit(1); }

  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${P}`, '--headless=new', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0, sessionId; const pend = new Map();
  const send = (m, p = {}, sid = sessionId) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p, ...(sid ? { sessionId: sid } : {}) })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EXC ' + r.exceptionDetails.text; return r.result?.value; };
  const done = () => { try { ws.close(); } catch { } chrome.kill(); process.exit(0); };
  setTimeout(() => { console.log('hard timeout'); done(); }, 90000);

  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { } await sleep(250); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  const errs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').slice(0, 200));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });

  /* Seed the session before the app boots. */
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1200);
  await ev(`localStorage.setItem('azolve.token', ${JSON.stringify(verify.data.token)}); localStorage.setItem('azolve.refresh', ${JSON.stringify(verify.data.refreshToken || '')});`);
  await send('Page.navigate', { url: BASE + '/?r=' + Math.random() });
  await sleep(4000);

  console.log('landed on:', JSON.stringify(await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,90)`)));

  /* Step 0 needs a name + username before Continue will advance. */
  await ev(`(()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    const ins=[...document.querySelectorAll('input')];
    const name=ins[0], user=ins[1];
    if(name){set.call(name,'Scroll Tester');name.dispatchEvent(new Event('input',{bubbles:true}));}
    if(user){set.call(user,'scrolltester');user.dispatchEvent(new Event('input',{bubbles:true}));}
    return ins.length})()`);
  await sleep(300);

  for (let i = 0; i < 3; i++) {
    await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/continue/i.test(e.innerText||''));b&&b.click();return !!b})()`);
    await sleep(900);
    console.log(`after continue ${i + 1}:`, JSON.stringify(await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,60)`)));
  }

  const geo = await ev(`(()=>{
    const onb=document.querySelector('.onb');
    const card=document.querySelector('.onb-card');
    const act=[...document.querySelectorAll('button')].find(e=>/enter azolve/i.test(e.innerText||''));
    const cs=onb?getComputedStyle(onb):null;
    return JSON.stringify({
      step: document.body.innerText.includes('Privacy, your way') ? 'privacy' : 'other',
      onbOverflowY: cs&&cs.overflowY, onbHeight: onb&&onb.clientHeight, onbScrollHeight: onb&&onb.scrollHeight,
      cardBottom: card&&Math.round(card.getBoundingClientRect().bottom),
      actionTop: act&&Math.round(act.getBoundingClientRect().top),
      actionVisible: act ? (act.getBoundingClientRect().top < window.innerHeight && act.getBoundingClientRect().bottom > 0) : null,
      viewportH: window.innerHeight,
      bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
    })})()`);
  console.log('privacy geometry:', geo);

  /* Try scrolling the way a thumb would, then see if the button came into view. */
  const scrolled = await ev(`(()=>{const onb=document.querySelector('.onb');
    if(!onb) return 'no .onb';
    onb.scrollTop = onb.scrollHeight;
    return JSON.stringify({scrollTop: onb.scrollTop, max: onb.scrollHeight - onb.clientHeight})})()`);
  console.log('programmatic scroll:', scrolled);
  await sleep(500);
  console.log('button in view after scroll:', await ev(`(()=>{const a=[...document.querySelectorAll('button')].find(e=>/enter azolve/i.test(e.innerText||''));
    if(!a) return 'no button';
    const r=a.getBoundingClientRect();
    return JSON.stringify({top:Math.round(r.top),bottom:Math.round(r.bottom),visible:r.top<window.innerHeight&&r.bottom>0})})()`));
  console.log('rows:', await ev(`(()=>{const o=document.querySelector('.onb');const bar=document.querySelector('.onb-actions');
    const br=bar.getBoundingClientRect();
    return JSON.stringify({barTop:Math.round(br.top),barH:Math.round(br.height),scrollTop:o.scrollTop,max:o.scrollHeight-o.clientHeight,
      rows:[...document.querySelectorAll('.onb .field,.onb .setting-row,.onb .onb-note')].map(f=>{const r=f.getBoundingClientRect();
        return {label:(f.innerText||'').replace(/\\s+/g,' ').slice(0,24),top:Math.round(r.top),bottom:Math.round(r.bottom),underBar:Math.round(Math.max(0,r.bottom-br.top))};})})})()`));
  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  done();
})();
