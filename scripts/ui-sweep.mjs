/* Sweeps every main page at phone and desktop widths in both themes and reports
   horizontal overflow, elements escaping the viewport, and console errors.
   Run: node scripts/ui-sweep.mjs */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = process.env.CHROME || '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9391;
const BASE = process.env.BASE || 'http://localhost:4500';
const OUT = '/workspace/.screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', '--user-data-dir=/tmp/cdp-sweep', 'about:blank',
], { stdio: 'ignore' });

async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch { }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

const bws = new WebSocket(await browserWs(), { maxPayload: 128 * 1024 * 1024 });
await new Promise(r => bws.on('open', r));
let id = 0; const w = new Map();
const errs = [];
bws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
});
const bsend = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; w.set(i, res); bws.send(JSON.stringify({ id: i, method, params, sessionId })); });

const t = await bsend('Target.createTarget', { url: 'about:blank' });
const at = await bsend('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sid = at.result.sessionId;
const send = (m, p = {}) => bsend(m, p, sid);
await send('Page.enable'); await send('Runtime.enable');
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

await send('Page.navigate', { url: BASE });
await sleep(1600);

const stamp = Date.now().toString().slice(-7);
await ev(`(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const s = await post('/api/auth/email/start', { email: 'sweep.${stamp}@azolve.io', displayName: 'Sweep User' });
  const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
  await fetch('/api/users/me', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: JSON.stringify({ username: 'sweep_${stamp}', country: 'IN', bio: 'UI sweep account with a reasonably long bio so the profile hero has real content to lay out.' }) });
  localStorage.setItem('azolve.token', v.token);
  localStorage.setItem('azolve.refresh', v.refreshToken);
})()`);

const PAGES = ['home', 'chats', 'calls', 'explore', 'moments', 'communities', 'ai', 'people', 'settings', 'profile'];
const SIZES = [
  { w: 360, h: 780, mobile: true, tag: '360' },
  { w: 390, h: 844, mobile: true, tag: '390' },
  { w: 834, h: 1112, mobile: false, tag: '834' },
  { w: 1440, h: 900, mobile: false, tag: '1440' },
];

const rows = [];
for (const theme of ['light', 'dark']) {
  await ev(`localStorage.setItem('azolve.theme', ${JSON.stringify(theme)}); document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
  for (const s of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.mobile });
    for (const page of PAGES) {
      await ev(`location.hash = '#/${page}'`);
      await sleep(900);
      const m = await ev(`(() => {
        const de = document.documentElement;
        const vw = de.clientWidth;
        const over = [...document.querySelectorAll('body *')].filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed') return false;
          return r.right > vw + 2 || r.left < -2;
        }).slice(0, 4).map(el => (el.className && typeof el.className === 'string' ? el.className : el.tagName) + ':' + Math.round(el.getBoundingClientRect().right));
        return { hScroll: de.scrollWidth > vw + 1, scrollW: de.scrollWidth, vw, over };
      })()`);
      rows.push({ theme, size: s.tag, page, ...m });
      if (theme === 'light' && (s.tag === '390' || s.tag === '1440')) {
        const png = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${OUT}/sweep-${theme}-${s.tag}-${page}.png`, Buffer.from(png.result.data, 'base64'));
      }
    }
  }
}

const bad = rows.filter(r => r.hScroll || r.over.length);
console.log(`checked ${rows.length} page/width/theme combinations`);
if (!bad.length) console.log('NO horizontal overflow anywhere');
else bad.forEach(b => console.log(`  ${b.theme} ${b.size} ${b.page}: scrollW=${b.scrollW} vw=${b.vw} over=${JSON.stringify(b.over)}`));
console.log(`console exceptions: ${errs.length}`);
errs.slice(0, 6).forEach(e => console.log('  ' + String(e).slice(0, 160)));
chrome.kill();
process.exit(bad.length ? 1 : 0);
