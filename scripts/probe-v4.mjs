/* Verify the v4 design tokens actually reach the DOM. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9395;
const BASE = 'http://localhost:4500';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', '--user-data-dir=/tmp/cdp-v4', 'about:blank',
], { stdio: 'ignore' });

async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not start');
}
const bws = new WebSocket(await browserWs(), { maxPayload: 64 * 1024 * 1024 });
await new Promise(r => bws.on('open', r));
let id = 0; const w = new Map();
const errs = [];
bws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a=>a.value||a.description).join(' ')); });
const bsend = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; w.set(i, res); bws.send(JSON.stringify({ id: i, method, params, sessionId })); });

const t = await bsend('Target.createTarget', { url: 'about:blank' });
const at = await bsend('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sid = at.result.sessionId;
await bsend('Runtime.enable', {}, sid);
await bsend('Page.enable', {}, sid);
const ev = async (expr) => (await bsend('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid)).result?.result?.value;

await bsend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await bsend('Page.navigate', { url: BASE + '/' }, sid);
await sleep(1200);

const stamp = Date.now();
const reg = await ev(`(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const s = await post('/api/auth/email/start', { email: 'v4.${stamp}@azolve.io', displayName: 'Meera Kapoor' });
  const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
  await fetch('/api/users/me', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: JSON.stringify({ username: 'meera_${stamp}', country: 'IN', bio: 'Travel storyteller - Chasing light across India.' }) });
  localStorage.setItem('azolve.token', v.token);
  localStorage.setItem('azolve.refresh', v.refreshToken);
  return v.token ? 'ok' : 'fail';
})()`);
console.log('register:', reg);
await ev(`location.reload()`);
await sleep(2000);

for (const [page, theme] of [['chats', 'light'], ['explore', 'light'], ['profile', 'light'], ['ai', 'light'], ['settings', 'light'], ['chats', 'dark']]) {
  await ev(`localStorage.setItem('azolve.theme', '${theme}'); document.documentElement.setAttribute('data-theme','${theme}'); location.hash='#/${page}';`);
  await sleep(1800);
  const out = await ev(`(() => {
    const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    return {
      page: '${page}', theme: '${theme}',
      bodyBg: cs('body','backgroundColor'),
      h1: cs('h1','fontSize') + '/' + cs('h1','fontWeight'),
      cardBg: cs('.card','backgroundColor'),
      bubble: cs('.bubble','backgroundColor'),
      tabOn: cs('.clp-tabs button.on, .feed-tabs button.on','backgroundColor'),
      width: innerWidth, pageClass: (document.querySelector('.page')||{}).className || (document.querySelector('.chat-list-pane')?'chats':null), text: (document.body.innerText||'').slice(0,60),
    };
  })()`);
  console.log(JSON.stringify(out));
}
console.log('ERRORS:', errs.slice(0,5).join('\n---\n'));
await bsend('Browser.close');
