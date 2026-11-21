/* End-to-end test of in-call live captions with a REAL microphone signal.

   The browser is the callee and is launched with /tmp/en.wav as its fake
   microphone, so the genuine capture path runs:
     MediaRecorder -> 16 kHz WAV -> POST /api/calls/live/listen -> socket
   Nothing is emitted by hand. The caller is a plain socket.io client that only
   listens, so whatever it receives is what the real feature produced.

   Pass = the callee's own live bar shows the recognised line AND the caller
   receives a translated call:caption. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:4500';
const OUT = '/workspace/.screenshots';
const AUDIO = process.env.AUDIO || '/tmp/en.wav';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const post = async (p, b, tok) => (await fetch(BASE + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(b),
})).json();

async function account(name, lang) {
  const stamp = Date.now() + Math.floor(Math.random() * 999);
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${stamp}@azolve.io`;
  const s = await post('/api/auth/email/start', { email, name });
  const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
  await fetch(BASE + '/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + v.token },
    body: JSON.stringify({
      language: lang, country: lang === 'hi' ? 'IN' : 'US', bio: 'Live caption test.',
      username: name.toLowerCase().replace(/\W/g, '') + String(stamp).slice(-5),
    }),
  });
  return { token: v.token, id: v.user.id, name };
}

const caller = await account('Rahul Mehta', 'en');   // node client, listens only
const callee = await account('Meera Kapoor', 'hi');  // browser, speaks into fake mic
await post('/api/contacts/request', { userId: callee.id }, caller.token);
const reqs = await (await fetch(BASE + '/api/contacts/requests', { headers: { Authorization: 'Bearer ' + callee.token } })).json();
await post('/api/contacts/respond', { requestId: reqs.incoming?.[0]?.requestId, action: 'accept' }, callee.token);
console.log('caller', caller.id, 'callee', callee.id, 'audio', AUDIO);

const port = 9357;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${AUDIO}`,
  '--autoplay-policy=no-user-gesture-required', `--user-data-dir=/tmp/cdp-e2e-${Date.now()}`, 'about:blank',
], { stdio: 'ignore' });

let ver;
for (let i = 0; i < 100 && !ver; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { }
  if (!ver) await sleep(200);
}
const bws = new WebSocket(ver.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise(r => bws.on('open', r));
let id = 0; const waiting = new Map(); const logs = [];
bws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (/live-caption|caption|speech|listen/i.test(txt)) logs.push(`${m.params.type}: ${txt}`.slice(0, 260));
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
});
const bsend = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  bws.send(JSON.stringify({ id: mid, method, params, sessionId }));
});
const t = await bsend('Target.createTarget', { url: 'about:blank' });
const at = await bsend('Target.attachToTarget', { targetId: t.targetId, flatten: true });
const sid = at.sessionId;
await bsend('Runtime.enable', {}, sid);
await bsend('Page.enable', {}, sid);
await bsend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await bsend('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(callee.token)});}catch(e){}`,
}, sid);
const ev = async (e) => {
  const r = await bsend('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, sid);
  return r.result?.value;
};
const shot = async (name) => {
  const r = await bsend('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${OUT}/${name}`, Buffer.from(r.data, 'base64'));
};
await bsend('Page.navigate', { url: `${BASE}/?splash=0#/home` }, sid);
await sleep(5000);

console.log('CAPS', JSON.stringify(await ev(`({
  speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  recorder: !!window.MediaRecorder,
  webm: window.MediaRecorder ? MediaRecorder.isTypeSupported('audio/webm;codecs=opus') : null,
})`)));

const sock = io(BASE, { auth: { token: caller.token }, transports: ['websocket'] });
await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(rej, 8000); });
const received = [];
sock.on('call:caption', (p) => { received.push(p); console.log('CALLER RECEIVED', JSON.stringify(p).slice(0, 260)); });

const callId = 'c_e2e_' + Date.now();
sock.emit('call:invite', { to: callee.id, callId, type: 'video', conversationId: null });
await sleep(3000);
console.log('accept:', await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /accept|answer/i.test(x.innerText || ''));
  if (b) { b.click(); return 'clicked'; }
  return 'none';
})()`));
await sleep(2500);
sock.emit('call:accept', { to: callee.id, callId, simulated: process.env.SIM !== '0' });

for (let i = 0; i < 10; i++) {
  await sleep(3000);
  const st = await ev(`(() => {
    const bar = document.querySelector('.cv-livebar');
    return {
      root: !!document.querySelector('.cv-root'),
      chip: document.querySelector('.cv-chip.live')?.innerText.trim() || null,
      state: document.querySelector('.cv-chip.live')?.dataset.state || null,
      engine: document.querySelector('.cv-chip.live')?.dataset.engine || null,
      title: document.querySelector('.cv-chip.live')?.title || null,
      bar: bar ? (bar.querySelector('.cv-livebar-text')?.innerText || '').slice(0, 140) : null,
      src: bar ? (bar.querySelector('.cv-livebar-src')?.innerText || '').slice(0, 140) : null,
    };
  })()`);
  console.log(`t+${(i + 1) * 3}s`, JSON.stringify(st));
  if (st.bar && received.length) break;
}

console.log('caller received captions:', received.length);
console.log('--- callee console ---');
logs.slice(-14).forEach(l => console.log(' ', l));
await shot('e2e-callee.png');

sock.emit('call:end', { to: callee.id, callId });
sock.close(); bws.close(); chrome.kill('SIGKILL');
process.exit(0);
