/* Places a real incoming call from a second account and screenshots what the
   recipient sees, on a page that is not the Calls page. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const PORT = 9336;
const OUT = '/workspace/.screenshots';
const BASE = 'http://localhost:4500';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---- caller account ---- */
const email = `caller.${Date.now()}@azolve.io`;
const start = await (await fetch(`${BASE}/api/auth/email/start`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, name: 'Rahul Mehta' }),
})).json();
const verify = await (await fetch(`${BASE}/api/auth/email/verify`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: start.userId, code: start.deliveryCode }),
})).json();
const callerToken = verify.token;
const callerId = verify.user.id;
console.log('caller', callerId, 'delivered', start.delivered);

/* ---- browser as the recipient ---- */
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
  '--disable-gpu', '--hide-scrollbars', '--user-data-dir=/tmp/cdp4', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 40 && !page; i++) {
  try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = j.find(t => t.type === 'page'); } catch {}
  if (!page) await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; waiting.set(mid, m => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: mid, method, params })); });

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(process.env.TOKEN)});}catch(e){}`,
});
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.navigate', { url: `${BASE}/?splash=0#/home` });
await sleep(4000);
console.log('page', await ev(`location.hash + ' | ' + document.querySelector('.mobile-nav') ? 'shell' : 'no shell'`));

/* ---- caller connects and invites ---- */
const caller = io(BASE, { auth: { token: callerToken }, transports: ['websocket'] });
await new Promise((res, rej) => { caller.on('connect', res); caller.on('connect_error', rej); setTimeout(rej, 8000); });
console.log('caller socket connected', caller.id);

const callId = 'c_test_' + Date.now();
caller.emit('call:invite', {
  to: process.env.TARGET, callId, type: process.env.KIND || 'video',
  conversationId: null,
});

/* give the recipient time to ring and render */
await sleep(2600);

const state = await ev(`(() => {
  const stage = document.querySelector('.cv-stage, .cv-incoming, [class*="cv-"]');
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
  return {
    stagePresent: !!stage,
    stageCls: stage ? stage.className : null,
    bodyHasIncoming: document.body.innerText.includes('Incoming'),
    buttons: btns.slice(-8),
    text: document.body.innerText.split('\\n').filter(l => /incoming|call|answer|decline/i.test(l)).slice(0, 8),
  };
})()`);
console.log('STATE', JSON.stringify(state, null, 1));

const { data } = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`${OUT}/incoming-call.png`, Buffer.from(data, 'base64'));
console.log('shot saved');

/* ---- answer it ---- */
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /accept/i.test(x.innerText || ''));
  if (b) { b.click(); return 'clicked accept'; }
  return 'no accept button';
})()`).then(r => console.log('accept:', r));
await sleep(3500);
const after = await ev(`(() => {
  const stage = document.querySelector('.cv-root');
  return {
    stillOpen: !!stage,
    phaseText: document.body.innerText.split('\n').filter(l => /connecting|connected|00:0|mute|camera|end|speaker/i.test(l)).slice(0, 8),
    buttons: [...document.querySelectorAll('.cv-ctrl')].map(b => (b.innerText || '').trim()).filter(Boolean),
  };
})()`);
console.log('AFTER ACCEPT', JSON.stringify(after, null, 1));
const s2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`${OUT}/call-active.png`, Buffer.from(s2.data, 'base64'));

caller.emit('call:end', { to: process.env.TARGET, callId });
caller.close();
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
