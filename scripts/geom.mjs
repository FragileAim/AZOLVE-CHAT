/* Dumps the geometry of the key structural elements so screens can be compared
   numerically against the reference markup instead of by eye. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:4500';
const PORT = 9600 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const post = async (p, b, tok) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b),
})).json();

async function account(name, lang) {
  const stamp = Date.now() + Math.floor(Math.random() * 999);
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${stamp}@azolve.io`;
  const s = await post('/api/auth/email/start', { email, name });
  const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
  await fetch(BASE + '/api/users/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + v.token },
    body: JSON.stringify({ language: lang, country: lang === 'hi' ? 'IN' : 'US', bio: 'Travel storyteller. Chasing light across India.', username: name.toLowerCase().replace(/\W/g, '') + String(stamp).slice(-5) }),
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

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=/tmp/cdp-g-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { } if (!ver) await sleep(200); }
const ws = new WebSocket(ver.webSocketDebuggerUrl, { maxPayload: 1 << 26 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: mid, method, params })); });
const tgt = await send('Target.createTarget', { url: 'about:blank' });
const att = await send('Target.attachToTarget', { targetId: tgt.targetId, flatten: true });
const sid = att.sessionId;
const bsend = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; waiting.set(mid, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: mid, sessionId: sid, method, params })); });
await bsend('Page.enable'); await bsend('Runtime.enable');
await bsend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await bsend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await bsend('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36' });
const ev = async (e) => (await bsend('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
let n = 0;
const go = async (hash) => { await bsend('Page.navigate', { url: `${BASE}/?splash=0&n=${++n}#${hash}` }); await sleep(2600); };

const DUMP = `(() => {
  const r = (sel, all) => {
    const els = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)].filter(Boolean);
    return els.map(el => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return { sel, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
        fs: s.fontSize, fw: s.fontWeight, br: s.borderRadius, bg: s.backgroundColor, color: s.color, pad: s.padding, gap: s.gap, sh: s.boxShadow.slice(0,60) }; });
  };
  return [
    ...r('.ux-cl-head'), ...r('.ux-h1'), ...r('.ux-round', true), ...r('.ux-search'),
    ...r('.ux-filters'), ...r('.ux-filter', true), ...r('.ux-label', true),
    ...r('.ux-row', true), ...r('.ux-name', true), ...r('.ux-time', true), ...r('.ux-prev', true), ...r('.ux-badge', true), ...r('.ux-av', true),
    ...r('.ux-cv-head'), ...r('.ux-cv-back'), ...r('.ux-langchip'), ...r('.ux-msgs'), ...r('.ux-bubble', true), ...r('.ux-orig', true), ...r('.ux-composer'), ...r('.ux-composer-row'), ...r('.ux-input-pill'), ...r('.ux-composer-btn', true),
    ...r('.mobile-nav'), ...r('.mobile-nav .mn-item', true),
  ];
})()`;

await bsend('Page.navigate', { url: `${BASE}/?splash=0&n=0` }); await sleep(1500);
await ev(`try{localStorage.setItem('azolve.token', ${JSON.stringify(me.token)});}catch(e){}`);
await go('chats');
console.log('--- CHATS ---');
console.log(JSON.stringify(await ev(DUMP), null, 0).replace(/\},\{/g, '},\n{'));
await go('chats/' + convId);
console.log('--- CONVERSATION ---');
console.log(JSON.stringify(await ev(DUMP), null, 0).replace(/\},\{/g, '},\n{'));
ws.close(); chrome.kill('SIGKILL'); process.exit(0);
