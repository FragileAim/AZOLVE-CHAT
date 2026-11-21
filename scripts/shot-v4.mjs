/* Seed a realistic two-person conversation and capture the v4 design at
   phone and desktop widths in both themes. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9396;
const BASE = 'http://localhost:4500';
const OUT = '/workspace/.screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const stamp = Date.now().toString().slice(-7);
async function user(name, email, lang = 'en') {
  const s = await api('/api/auth/email/start', { method: 'POST', body: { email, displayName: name } });
  const v = await api('/api/auth/email/verify', { method: 'POST', body: { userId: s.userId, code: s.deliveryCode } });
  await api('/api/users/me', { method: 'PATCH', token: v.token, body: { username: name.toLowerCase().replace(/\W+/g, '_') + '_' + stamp, country: 'IN', bio: 'Travel storyteller · Chasing light across India. Chai > coffee.', language: lang } });
  return { id: v.user.id, token: v.token, refresh: v.refreshToken, name };
}

const A = await user('Meera Kapoor', `meera.${stamp}@azolve.io`, 'en');
const B = await user('Priya Sharma', `priya.${stamp}@azolve.io`, 'hi');
const rq = await api('/api/contacts/request', { method: 'POST', token: A.token, body: { userId: B.id } });
await api('/api/contacts/respond', { method: 'POST', token: B.token, body: { requestId: rq.requestId, action: 'accept' } });
const conv = await api('/api/chats/dm', { method: 'POST', token: A.token, body: { userId: B.id } });
const convId = conv.conversation?.id || conv.id;
await api(`/api/chats/${convId}/messages`, { method: 'POST', token: B.token, body: { body: '¿Nos vemos esta noche? El clima aquí está precioso hoy.', originalLang: 'es' } });
await api(`/api/chats/${convId}/messages`, { method: 'POST', token: A.token, body: { body: 'Yes, just landed! Sending a photo of the beach.' } });
await api(`/api/chats/${convId}/messages`, { method: 'POST', token: B.token, body: { body: '¡Qué bien! Envíame una foto de la playa.', originalLang: 'es' } });
console.log('seeded', { convId, A: A.token.slice(0, 12) });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', '--force-device-scale-factor=2', '--user-data-dir=/tmp/cdp-v4shot', 'about:blank',
], { stdio: 'ignore' });
async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not start');
}
const bws = new WebSocket(await browserWs(), { maxPayload: 128 * 1024 * 1024 });
await new Promise(r => bws.on('open', r));
let id = 0; const w = new Map();
bws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const bsend = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; w.set(i, res); bws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const t = await bsend('Target.createTarget', { url: 'about:blank' });
const at = await bsend('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sid = at.result.sessionId;
await bsend('Runtime.enable', {}, sid); await bsend('Page.enable', {}, sid);
const ev = async (expr) => (await bsend('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid)).result?.result?.value;

const shots = [
  ['welcome', null, 390, 844, 'light'],
  ['chats', null, 390, 844, 'light'],
  ['chats', convId, 390, 844, 'light'],
  ['chats', convId, 390, 844, 'dark'],
  ['explore', null, 390, 844, 'light'],
  ['people', null, 390, 844, 'light'],
  ['profile', null, 390, 844, 'light'],
  ['ai', null, 390, 844, 'dark'],
  ['settings', null, 390, 844, 'light'],
  ['settings', 'language', 390, 844, 'light'],
  ['chats', convId, 1440, 900, 'light'],
  ['chats', null, 1440, 900, 'dark'],
];

await bsend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await bsend('Page.navigate', { url: BASE + '/' }, sid);
await sleep(1500);

for (const [page, param, width, height, theme] of shots) {
  await bsend('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 900 }, sid);
  await ev(`localStorage.setItem('azolve.token', ${JSON.stringify(A.token)}); localStorage.setItem('azolve.refresh', ${JSON.stringify(A.refresh)}); localStorage.setItem('azolve.theme', '${theme}');`);
  await bsend('Page.navigate', { url: `${BASE}/?splash=0#/${page}${param ? '/' + param : ''}` }, sid);
  await sleep(1700);
  await ev(`document.documentElement.setAttribute('data-theme','${theme}'); document.documentElement.style.colorScheme='${theme}';`);
  await sleep(250);
  const shot = await bsend('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
  const suffix = page === 'chats' && param ? '-conv' : page === 'settings' && param ? '-lang' : '';
  const name = `v4-${theme}-${width}-${page}${suffix}.png`;
  fs.writeFileSync(`${OUT}/${name}`, Buffer.from(shot.result.data, 'base64'));
  const info = await ev(`(() => {
    const cs = (s,p) => { const e=document.querySelector(s); return e?getComputedStyle(e)[p]:null; };
    const rect = (s) => { const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]; };
    return { page:'${page}', theme:'${theme}', w:innerWidth, banner: !!document.querySelector('.translation-banner'),
      bubble: cs('.bubble','backgroundColor'), bubbleR: cs('.bubble','borderRadius'),
      orig: cs('.orig','backgroundColor'), tabOn: cs('.clp-tabs button.on, .feed-tabs button.on','backgroundColor'),
      hscroll: document.documentElement.scrollWidth > innerWidth + 1, themeAttr: document.documentElement.dataset.theme, stored: localStorage.getItem('azolve.theme'),
      listRect: rect('.chat-list-pane'), paneRect: rect('.chat-pane') };
  })()`);
  console.log(name, JSON.stringify(info));
}
await bsend('Browser.close');
