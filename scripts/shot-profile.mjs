/* Renders the Profile page at four widths in both themes and measures the
   layout, so "profile UI is broken" can be seen and quantified instead of
   guessed at. Writes PNGs to /workspace/.screenshots/profile-*.png */

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = process.env.CHROME || '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9371;
const BASE = 'http://localhost:4500';
const OUT = '/workspace/.screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', '--user-data-dir=/tmp/cdp-prof', 'about:blank',
], { stdio: 'ignore' });

async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

const bws = new WebSocket(await browserWs(), { maxPayload: 128 * 1024 * 1024 });
await new Promise(r => bws.on('open', r));
let bid = 0; const bwait = new Map();
bws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && bwait.has(m.id)) { bwait.get(m.id)(m); bwait.delete(m.id); }
});
const bsend = (method, params = {}, sessionId) => new Promise((res) => {
  const i = ++bid; bwait.set(i, res); bws.send(JSON.stringify({ id: i, method, params, sessionId }));
});

const t = await bsend('Target.createTarget', { url: 'about:blank' });
const at = await bsend('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sessionId = at.result.sessionId;
const send = (method, params = {}) => bsend(method, params, sessionId);

await send('Page.enable');
await send('Runtime.enable');

const evalJs = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await send('Page.navigate', { url: BASE });
await sleep(1500);

const stamp = Date.now().toString().slice(-7);
const me = await evalJs(`(async () => {
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const s = await post('/api/auth/email/start', { email: 'prof.${stamp}@azolve.io', displayName: 'Aarav Mehta' });
  const v = await post('/api/auth/email/verify', { userId: s.userId, code: s.deliveryCode });
  const h = { 'content-type': 'application/json', authorization: 'Bearer ' + v.token };
  await fetch('/api/users/me', { method: 'PATCH', headers: h, body: JSON.stringify({
    username: 'aarav_${stamp}', country: 'IN', bio: 'Building AZOLVE. Coffee, code and long calls across four time zones.',
    mood: 'Focused', cover: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=70',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&q=70',
  }) });
  localStorage.setItem('azolve.token', v.token);
  localStorage.setItem('azolve.refresh', v.refreshToken);
  return { id: v.user.id, username: 'aarav_${stamp}' };
})()`);
console.log('user', JSON.stringify(me));

const SIZES = [
  { w: 360, h: 780, mobile: true, tag: '360' },
  { w: 390, h: 844, mobile: true, tag: '390' },
  { w: 834, h: 1112, mobile: false, tag: '834' },
  { w: 1440, h: 900, mobile: false, tag: '1440' },
];

const report = [];
for (const theme of ['light', 'dark']) {
  await evalJs(`localStorage.setItem('azolve.theme', ${JSON.stringify(theme)}); document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});`);
  for (const s of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: s.w, height: s.h, deviceScaleFactor: 2, mobile: s.mobile,
    });
    await evalJs(`location.hash = '#/profile'`);
    await sleep(1400);
    const m = await evalJs(`(() => {
      const de = document.documentElement;
      const hero = document.querySelector('.profile-hero');
      const av = document.querySelector('.ph-main > .avatar');
      const info = document.querySelector('.ph-info');
      const act = document.querySelector('.ph-actions');
      const stats = document.querySelector('.ph-stats');
      const r = (el) => el ? (({x,y,width,height}) => ({x:Math.round(x),y:Math.round(y),w:Math.round(width),h:Math.round(height)}))(el.getBoundingClientRect()) : null;
      const overlap = (a,b) => a && b && !(a.x+a.w <= b.x || b.x+b.w <= a.x || a.y+a.h <= b.y || b.y+b.h <= a.y);
      const ra = r(av), ri = r(info), rc = r(act);
      return {
        theme: de.getAttribute('data-theme'),
        hScroll: de.scrollWidth > de.clientWidth + 1,
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        hero: r(hero), avatar: ra, info: ri, actions: rc, stats: r(stats),
        avatarOverlapsInfo: overlap(ra, ri),
        infoOverlapsActions: overlap(ri, rc),
        actionsClipped: rc ? (rc.x < -1 || rc.x + rc.w > de.clientWidth + 1) : null,
        heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : null,
      };
    })()`);
    report.push({ theme, size: s.tag, ...m });
    const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(`${OUT}/profile-${theme}-${s.tag}.png`, Buffer.from(png.result.data, 'base64'));
  }
}

console.log(JSON.stringify(report, null, 2));
chrome.kill();
