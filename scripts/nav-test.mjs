/* Navigation truth test.
   Runs the real app at a phone viewport and clicks every navigation control
   (bottom nav, "all screens" sheet, rail) checking that location.hash really
   changes. Prints a table so a broken route is obvious. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4500';
const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PROFILE = '/tmp/nav-prof';
const PORT = 9345;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

fs.rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0, sessionId;
const pending = new Map();
const send = (method, params = {}, sid = sessionId) => new Promise((res, rej) => {
  const m = ++id; pending.set(m, { res, rej });
  ws.send(JSON.stringify({ id: m, method, params, ...(sid ? { sessionId: sid } : {}) }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
};

async function main() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch { }
    await sleep(250);
  }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  /* Seed a session directly through the API so we skip the OTP dance. */
  const api = async (path, body, token, method = 'POST') => {
    const r = await fetch(BASE + path, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };
  const stamp = Date.now().toString(36);
  const start = await api('/api/auth/email/start', { email: `nav${stamp}@azolve.test` });
  const ver = await api('/api/auth/email/verify', { userId: start.userId, code: start.deliveryCode });
  const token = ver.token;
  await api('/api/users/me', {
    language: 'en', country: 'IN', bio: 'nav tester', displayName: 'Nav Tester', username: `nav${stamp}`,
  }, token, 'PATCH');

  await send('Page.navigate', { url: `${BASE}/?splash=0` });
  await sleep(1500);
  await ev(`localStorage.setItem('azolve.token', ${JSON.stringify(token)});
            localStorage.setItem('azolve.refresh', ${JSON.stringify(ver.refreshToken)});
            localStorage.setItem('azolve.device', 'desktop');
            localStorage.removeItem('azolve.device.preset');`);
  await send('Page.navigate', { url: `${BASE}/?splash=0&b=${Math.random()}#/home` });
  await sleep(6000);

  const tok = await ev(`JSON.stringify({t:(localStorage.getItem('azolve.token')||'').length, r:(localStorage.getItem('azolve.refresh')||'').length})`);
  console.log('token at boot', tok);
  const where = await ev(`JSON.stringify({hash:location.hash, frames:document.querySelectorAll('iframe').length, nav:[...document.querySelectorAll('.mobile-nav button')].map(b=>b.innerText.trim()||b.getAttribute('aria-label')), body:document.body.innerText.slice(0,300)})`);
  console.log('boot', where);

  const rows = [];
  /* Bottom nav: click each button, read hash, then go home again. */
  const navCount = await ev(`document.querySelectorAll('.mobile-nav button').length`);
  for (let i = 0; i < navCount; i++) {
    await ev(`location.hash = '#/home'`); await sleep(700);
    const label = await ev(`(document.querySelectorAll('.mobile-nav button')[${i}]?.innerText || document.querySelectorAll('.mobile-nav button')[${i}]?.getAttribute('aria-label') || '').trim()`);
    await ev(`document.querySelectorAll('.mobile-nav button')[${i}].click()`);
    await sleep(900);
    const hash = await ev(`location.hash`);
    rows.push({ ctl: `nav:${label}`, hash, ok: hash && hash !== '#/home' });
  }

  /* The centre button opens the all-screens sheet; every entry must navigate. */
  await ev(`location.hash='#/home'`); await sleep(600);
  await ev(`document.querySelector('.mn-center')?.click()`); await sleep(600);
  const sheet = await ev(`document.querySelectorAll('.more-item').length`);
  for (let i = 0; i < sheet; i++) {
    await ev(`location.hash='#/home'`); await sleep(500);
    await ev(`document.querySelector('.mn-center')?.click()`); await sleep(400);
    const label = await ev(`document.querySelectorAll('.more-item')[${i}]?.innerText.trim()`);
    await ev(`document.querySelectorAll('.more-item')[${i}].click()`); await sleep(900);
    const hash = await ev(`location.hash`);
    rows.push({ ctl: `sheet:${label}`, hash, ok: hash && hash !== '#/home' });
  }

  /* Direct deep links must render the right screen, not fall back to home. */
  for (const h of ['#/chats', '#/moments', '#/people', '#/explore', '#/ai', '#/calls', '#/communities', '#/profile', '#/settings', '#/settings/language']) {
    await send('Page.navigate', { url: `${BASE}/?splash=0&d=${Math.random()}${h}` });
    await sleep(2000);
    const got = await ev(`JSON.stringify({hash:location.hash, h1:(document.querySelector('h1,h2,.ux-h1,.ux-set-h1,.ux-feed-h1')?.innerText||'').trim().slice(0,40)})`);
    rows.push({ ctl: `link:${h}`, hash: JSON.parse(got).hash, ok: JSON.parse(got).hash === h, h1: JSON.parse(got).h1 });
  }

  console.log('\n=== NAVIGATION ===');
  for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.ctl.padEnd(26)} -> ${r.hash}${r.h1 ? '  [' + r.h1 + ']' : ''}`);
  console.log(`\nfailures: ${rows.filter(r => !r.ok).length}/${rows.length}`);
}

main().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(async () => { await sleep(300); try { ws?.close(); } catch { } chrome.kill('SIGKILL'); });
