/* Drive the LIVE sign-in form all the way to the 6-digit code screen.
   This is the exact path a first-time visitor takes, so it proves the app is
   not "just loading" — it advances, submits, and reaches a real server call. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const BASE = 'https://azolve-chat.onrender.com';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const P = '/tmp/form-prof', PORT = 9355;
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
  const errs = [], net = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').slice(0, 250));
    if (m.method === 'Network.requestWillBeSent' && /\/api\//.test(m.params.request.url)) net.push(`> ${m.params.request.method} ${m.params.request.url}`);
    if (m.method === 'Network.responseReceived' && /\/api\//.test(m.params.response.url)) {
      net.push(`${m.params.response.status} ${m.params.response.url}`);
      if (m.params.response.status >= 400) {
        send('Network.getResponseBody', { requestId: m.params.requestId })
          .then(r => net.push('   body: ' + String(r.body).slice(0, 300)))
          .catch(() => { });
      }
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await send('Page.navigate', { url: BASE + '/?r=' + Math.random() });
  await sleep(4500);
  console.log('1. landing:', await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,70)`));

  await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>(e.innerText||'').trim().toLowerCase().includes('get started'));b&&b.click()})()`);
  await sleep(1500);
  console.log('2. after Get started:', await ev(`JSON.stringify({inputs:document.querySelectorAll('input').length, txt:document.body.innerText.replace(/\\s+/g,' ').slice(0,90)})`));

  /* The default tab is Sign in; a brand-new address belongs on Create account. */
  await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>(e.innerText||'').trim().toLowerCase()==='create account');b&&b.click();return !!b})()`);
  await sleep(1200);
  console.log('2b. create tab:', await ev(`document.body.innerText.replace(/\\s+/g,' ').slice(0,80)`));
  const email = `liveform${Date.now()}@example.com`;
  /* React tracks the input's value on the DOM node, so a plain `i.value = x`
     is ignored by its onChange. Use the prototype setter, then fire input. */
  console.log('2c. fill:', await ev(`(()=>{
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    const all=[...document.querySelectorAll('input')];
    const mail=all.find(i=>i.type==='email')||all[all.length-1];
    const name=all.find(i=>i!==mail && i.type!=='email');
    if(name){ name.focus(); set.call(name,'Live Tester'); name.dispatchEvent(new Event('input',{bubbles:true})); }
    mail.focus(); set.call(mail, ${JSON.stringify(email)}); mail.dispatchEvent(new Event('input',{bubbles:true}));
    return JSON.stringify(all.map(i=>({t:i.type,v:i.value})))})()`));
  await sleep(400);
  const btn = await ev(`(()=>{const all=[...document.querySelectorAll('button')];
    const b=all.find(e=>/create account & email|email me a code|send code/i.test(e.innerText||''))||all.find(e=>/^continue$/i.test((e.innerText||'').trim()));
    if(!b)return 'no-button';b.click();return b.innerText.trim()})()`);
  console.log('3. submitted via:', btn);
  await sleep(4000);
  console.log('4. screen now:', await ev(`JSON.stringify({codeInputs:document.querySelectorAll('input[inputmode=numeric],input[maxlength="1"],input[maxlength="6"]').length,inputs:document.querySelectorAll('input').length,txt:document.body.innerText.replace(/\\s+/g,' ').slice(0,200)})`));
  console.log('5. api calls:\n' + (net.length ? net.join('\n') : 'none'));
  console.log('6. exceptions:', errs.length ? errs.join(' | ') : 'none');
  await send('Page.captureScreenshot', { format: 'png' }).then(async r => {
    fs.mkdirSync('/workspace/azolve/.screenshots', { recursive: true });
    fs.writeFileSync('/workspace/azolve/.screenshots/live-form.png', Buffer.from(r.data, 'base64'));
  });
  ws.close(); chrome.kill();
  process.exit(0);
})();
