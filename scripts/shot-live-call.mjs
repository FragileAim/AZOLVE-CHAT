/* Renders a real active call between two accounts and screenshots the live
   translation bar after the caller speaks. Verifies the in-call UI for
   Request AE at phone and desktop widths. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9341;
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
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${Date.now()}@azolve.io`;
  const s = await post('/api/auth/email/start', { email, name });
  const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
  await fetch(BASE + '/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + v.token },
    body: JSON.stringify({ language: lang, country: lang === 'hi' ? 'IN' : 'US', bio: 'Here for the demo call.', username: name.toLowerCase().replace(/\W/g, '') + String(Date.now()).slice(-5) }),
  });
  return { token: v.token, id: v.user.id, name };
}

const caller = await account('Rahul Mehta', 'en');
const callee = await account('Meera Kapoor', 'hi');
console.log('accounts', caller.id, callee.id);

await post('/api/contacts/request', { userId: callee.id }, caller.token);
const reqs = await (await fetch(BASE + '/api/contacts/requests', { headers: { Authorization: 'Bearer ' + callee.token } })).json();
const incoming = (reqs.incoming || [])[0];
console.log('incoming request', JSON.stringify(incoming));
await post('/api/contacts/respond', { requestId: incoming?.requestId, action: 'accept' }, callee.token);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=/tmp/cdp-live', 'about:blank',
], { stdio: 'ignore' });

let page;
for (let i = 0; i < 60 && !page; i++) {
  try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find(t => t.type === 'page'); } catch { }
  if (!page) await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
const errs = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Page.enable'); await send('Runtime.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;

async function size(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
}

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(callee.token)});localStorage.setItem('azolve.lang','hi');}catch(e){}`,
});
await size(390, 844, true);
await send('Page.navigate', { url: `${BASE}/?splash=0#/home` });
await sleep(4000);
console.log('hash', await ev('location.hash'));

const sock = io(BASE, { auth: { token: caller.token }, transports: ['websocket'] });
await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(rej, 8000); });
const callId = 'c_live_' + Date.now();
sock.emit('call:invite', { to: callee.id, callId, type: 'video', conversationId: null });
await sleep(2600);

console.log('accept:', await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /accept|answer/i.test(x.innerText || ''));
  if (b) { b.click(); return 'clicked'; }
  return 'none: ' + [...document.querySelectorAll('button')].map(x=>(x.innerText||'').trim()).filter(Boolean).slice(0,6).join('|');
})()`));
await sleep(4000);

sock.emit('call:accept', { to: callee.id, callId, simulated: true });
await sleep(1200);

const stage = await ev(`(() => {
  const r = document.querySelector('.cv-root, .cv-stage');
  return { stage: !!r, cls: r?.className, chips: [...document.querySelectorAll('.cv-chip')].map(c=>c.innerText.trim()), ctrls: [...document.querySelectorAll('.cv-ctrl')].map(c=>c.innerText.trim()) };
})()`);
console.log('STAGE', JSON.stringify(stage));

const ack = await new Promise((res) => {
  sock.emit('call:speech', { to: callee.id, callId, text: 'Shall we meet this evening at seven? I have booked a table near the window.', lang: 'en' }, res);
  setTimeout(() => res(null), 12000);
});
console.log('ACK', JSON.stringify(ack));
console.log('STAGE TEXT', await ev(`(document.querySelector('.cv-root')?.innerText||'').replace(/\\n+/g,' | ').slice(0,400)`));
await sleep(2500);

const bar = await ev(`(() => {
  const b = document.querySelector('.cv-livebar');
  if (!b) return { present: false };
  const r = b.getBoundingClientRect();
  const t = b.querySelector('.cv-livebar-text');
  const s = b.querySelector('.cv-livebar-src');
  return {
    present: true,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    text: t?.innerText, src: s?.innerText,
    overflowY: document.documentElement.scrollHeight - innerHeight,
    chip: document.querySelector('.cv-chip.live')?.innerText.trim(),
    ctrls: [...document.querySelectorAll('.cv-ctrl')].map(c => c.innerText.trim()),
  };
})()`);
console.log('LIVEBAR', JSON.stringify(bar, null, 1));

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}`, Buffer.from(data, 'base64'));
  console.log('shot', name);
};
await shot('live-call-390.png');

await size(1440, 900, false);
await sleep(1500);
const wide = await ev(`(() => {
  const b = document.querySelector('.cv-livebar');
  const r = b?.getBoundingClientRect();
  return { present: !!b, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, text: b?.querySelector('.cv-livebar-text')?.innerText };
})()`);
console.log('WIDE', JSON.stringify(wide));
await shot('live-call-1440.png');

console.log('errors', JSON.stringify(errs));
sock.emit('call:end', { to: callee.id, callId });
sock.close(); ws.close(); chrome.kill('SIGKILL');
process.exit(0);
