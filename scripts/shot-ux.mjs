/* Renders the re-skinned app at real phone size and captures every key screen,
   reporting layout metrics so problems are measured, not guessed. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:4500';
const OUT = '/workspace/.screenshots';
const PORT = 9371;
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
      language: lang, country: lang === 'hi' ? 'IN' : 'US',
      bio: 'Travel storyteller. Chasing light across India.',
      username: name.toLowerCase().replace(/\W/g, '') + String(stamp).slice(-5),
    }),
  });
  return { token: v.token, id: v.user.id, name };
}

const me = await account('Meera Kapoor', 'hi');
const peer = await account('Omar Haddad', 'en');
await post('/api/contacts/request', { userId: peer.id }, me.token);
const reqs = await (await fetch(BASE + '/api/contacts/requests', { headers: { Authorization: 'Bearer ' + peer.token } })).json();
await post('/api/contacts/respond', { requestId: reqs.incoming?.[0]?.requestId, action: 'accept' }, peer.token);
const conv = await post('/api/chats/dm', { userId: peer.id }, me.token);
const convId = conv.conversation?.id || conv.id;
await post('/api/chats/' + convId + '/messages', { text: 'Hey! Did you reach Goa safely? The weather here is lovely today.' }, peer.token);
await post('/api/chats/' + convId + '/messages', { text: 'Yes, just landed! Sending a photo of the beach.' }, me.token);
await post('/api/chats/' + convId + '/messages', { text: 'Gorgeous! Let us get chai tonight.' }, me.token);
console.log('accounts ready', me.id, peer.id, 'conv', convId);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', `--user-data-dir=/tmp/cdp-ux-${Date.now()}`, 'about:blank',
], { stdio: 'ignore' });

let ver;
for (let i = 0; i < 100 && !ver; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { }
  if (!ver) await sleep(200);
}
const ws = new WebSocket(ver.webSocketDebuggerUrl, { maxPayload: 1 << 26 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: mid, method, params }));
});

const tgt = await send('Target.createTarget', { url: 'about:blank' });
const att = await send('Target.attachToTarget', { targetId: tgt.targetId, flatten: true });
const sid = att.sessionId;
const bsend = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: mid, sessionId: sid, method, params }));
});

await bsend('Page.enable');
await bsend('Runtime.enable');
const W = Number(process.env.W || 390), H = Number(process.env.H || 844);
await bsend('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await bsend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await bsend('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
});

const ev = async (expr) => {
  const r = await bsend('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value;
};
const shot = async (name) => {
  const { data } = await bsend('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
};
let nav = 0;
const go = async (hash) => {
  /* A unique query string forces a full document load; a hash-only change
     would be same-document and the app would keep its stale auth state. */
  await bsend('Page.navigate', { url: `${BASE}/?splash=0&n=${++nav}${hash ? '#' + hash : ''}` });
  await sleep(2600);
};

const metrics = () => ev(`(() => {
  const nav = document.querySelector('.mobile-nav');
  const nb = nav ? nav.getBoundingClientRect() : null;
  return {
    vw: innerWidth, vh: innerHeight,
    docH: document.documentElement.scrollHeight,
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    nav: nb ? { y: Math.round(nb.y), h: Math.round(nb.height), w: Math.round(nb.width), bg: getComputedStyle(nav).backgroundColor } : null,
    navButtons: nav ? nav.children.length : 0,
    title: document.querySelector('.clp-title, .page-title, h1')?.innerText?.slice(0, 40) || null,
    offenders: [...document.querySelectorAll('*')].filter(el => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > innerWidth + 2 || b.left < -2);
    }).slice(0, 6).map(el => (typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName) + ' w=' + Math.round(el.getBoundingClientRect().width)),
  };
})()`);

// 1. Logged-out welcome
await go('');
await sleep(1200);
await shot('ux-welcome');
console.log('welcome', JSON.stringify(await metrics()));

// 2. Log in
await ev(`try{localStorage.setItem('azolve.token', ${JSON.stringify(me.token)});}catch(e){}`);
await go('chats');
await shot('ux-chats');
console.log('chats', JSON.stringify(await metrics()));

await go('chats/' + convId);
await shot('ux-conversation');
console.log('conversation', JSON.stringify(await metrics()));

await go('profile');
await shot('ux-profile');
console.log('profile', JSON.stringify(await metrics()));

await go('people');
await shot('ux-discover');
console.log('discover', JSON.stringify(await metrics()));

await go('explore');
await shot('ux-feed');
console.log('feed', JSON.stringify(await metrics()));

await go('settings');
await shot('ux-settings');
console.log('settings', JSON.stringify(await metrics()));

await go('ai');
await shot('ux-ai');
console.log('ai', JSON.stringify(await metrics()));

// Sheet
await go('chats');
await ev(`document.querySelector('.mn-center')?.click(); true`);
await sleep(700);
await shot('ux-sheet');

console.log('errors', JSON.stringify(await ev(`window.__errs || []`)));
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
