/* Two real browser pages, a real WebRTC call between them, and a real
   translated caption delivered through the socket path the app uses.
   Screenshots the live translation bar on the callee's phone and desktop. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9343;
const OUT = '/workspace/.screenshots';
const BASE = 'http://localhost:4500';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const post = async (p, b, tok) => (await fetch(BASE + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(b),
})).json();

async function account(name, lang) {
  const stamp = Date.now();
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${stamp}@azolve.io`;
  const s = await post('/api/auth/email/start', { email, name });
  const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
  await fetch(BASE + '/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + v.token },
    body: JSON.stringify({
      language: lang, country: lang === 'hi' ? 'IN' : 'US', bio: 'Here for the demo call.',
      username: name.toLowerCase().replace(/\W/g, '') + String(stamp).slice(-5),
    }),
  });
  return { token: v.token, id: v.user.id, name };
}

const A = await account('Rahul Mehta', 'en');
const B = await account('Meera Kapoor', 'hi');
await post('/api/contacts/request', { userId: B.id }, A.token);
const reqs = await (await fetch(BASE + '/api/contacts/requests', { headers: { Authorization: 'Bearer ' + B.token } })).json();
await post('/api/contacts/respond', { requestId: reqs.incoming?.[0]?.requestId, action: 'accept' }, B.token);
console.log('accounts ready', A.id, B.id);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=/tmp/cdp-live2', 'about:blank',
], { stdio: 'ignore' });

let ver;
for (let i = 0; i < 80 && !ver; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { }
  if (!ver) await sleep(250);
}
const bws = new WebSocket(ver.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise(r => bws.on('open', r));
let id = 0; const waiting = new Map(); const errs = [];
bws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
});
const bsend = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  bws.send(JSON.stringify({ id: mid, method, params, sessionId }));
});

async function openPage(token, w, h) {
  const t = await bsend('Target.createTarget', { url: 'about:blank' });
  const at = await bsend('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = at.sessionId;
  await bsend('Runtime.enable', {}, sid);
  await bsend('Page.enable', {}, sid);
  await bsend('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 700 }, sid);
  await bsend('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(token)});}catch(e){}`,
  }, sid);
  const ev = async (e) => {
    const r = await bsend('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, sid);
    return r.result?.value;
  };
  const shot = async (name) => {
    const r = await bsend('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(`${OUT}/${name}`, Buffer.from(r.data, 'base64'));
    console.log('shot', name);
  };
  await bsend('Page.navigate', { url: `${BASE}/?splash=0#/home` }, sid);
  return { sid, ev, shot };
}

const caller = await openPage(A.token, 390, 844);
const callee = await openPage(B.token, 390, 844);
await sleep(5000);
console.log('A hash', await caller.ev('location.hash'), '| B hash', await callee.ev('location.hash'));

const callId = 'c_live2_' + Date.now();
const invited = await caller.ev(`(async () => {
  const m = await import('/src/lib/socket.js');
  const s = m.getSocket();
  if (!s) return 'no socket';
  s.emit('call:invite', { to: ${JSON.stringify(B.id)}, callId: ${JSON.stringify(callId)}, type: 'video', conversationId: null });
  return 'invited';
})()`);
console.log('invite:', invited);
await sleep(3000);

console.log('accept:', await callee.ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /accept|answer/i.test(x.innerText || ''));
  if (b) { b.click(); return 'clicked'; }
  return 'none: ' + [...document.querySelectorAll('button')].map(x => (x.innerText || '').trim()).filter(Boolean).slice(0, 8).join('|');
})()`));

/* wait for WebRTC to reach active on both sides */
let phase = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  phase = await callee.ev(`(() => {
    const root = document.querySelector('.cv-root');
    const live = document.querySelector('.cv-chip.live');
    return { root: !!root, chip: live?.innerText.trim() || null, ctrls: [...document.querySelectorAll('.cv-ctrl')].map(c => c.innerText.trim()).filter(Boolean) };
  })()`);
  if (phase.chip) break;
}
console.log('PHASE', JSON.stringify(phase));

/* the caller's speech recognition produced a final segment -> app emits call:speech */
const ack = await caller.ev(`(async () => {
  const m = await import('/src/lib/socket.js');
  const s = m.getSocket();
  return await new Promise((res) => {
    s.emit('call:speech', { to: ${JSON.stringify(B.id)}, callId: ${JSON.stringify(callId)},
      text: 'Shall we meet this evening at seven? I have booked a table near the window.', lang: 'en' }, res);
    setTimeout(() => res('timeout'), 15000);
  });
})()`);
console.log('ACK', JSON.stringify(ack));
await sleep(2500);

const bar = await callee.ev(`(() => {
  const b = document.querySelector('.cv-livebar');
  if (!b) return { present: false };
  const r = b.getBoundingClientRect();
  return {
    present: true,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    text: b.querySelector('.cv-livebar-text')?.innerText,
    src: b.querySelector('.cv-livebar-src')?.innerText,
    head: b.querySelector('.cv-livebar-head')?.innerText,
    overflowY: document.documentElement.scrollHeight - innerHeight,
    chip: document.querySelector('.cv-chip.live')?.innerText.trim(),
    ctrls: [...document.querySelectorAll('.cv-ctrl')].map(c => c.innerText.trim()).filter(Boolean),
  };
})()`);
console.log('LIVEBAR', JSON.stringify(bar, null, 1));
await callee.shot('live-call-390.png');

await bsend('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, callee.sid);
await sleep(1800);
const wide = await callee.ev(`(() => {
  const b = document.querySelector('.cv-livebar');
  const r = b?.getBoundingClientRect();
  return { present: !!b, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, text: b?.querySelector('.cv-livebar-text')?.innerText };
})()`);
console.log('WIDE', JSON.stringify(wide));
await callee.shot('live-call-1440.png');

console.log('errors', JSON.stringify(errs));
chrome.kill('SIGKILL');
process.exit(0);
