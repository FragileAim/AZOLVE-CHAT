import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const PORT = 9335;
const OUT = '/workspace/.screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
  '--disable-gpu', '--hide-scrollbars', '--user-data-dir=/tmp/cdp3', 'about:blank'], { stdio: 'ignore' });

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
if (process.env.TOKEN) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(process.env.TOKEN)});}catch(e){}`,
  });
}

const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const BASE = process.env.BASE || 'http://localhost:4500';

await send('Page.navigate', { url: `${BASE}/?splash=0` });
await sleep(3500);

const PAGES = ['home', 'chats', 'moments', 'explore', 'ai', 'calls', 'communities', 'profile', 'settings'];
const out = {};

for (const p of PAGES) {
  await ev(`location.hash = '#/${p}'; true`);
  await sleep(1800);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/p-${p}.png`, Buffer.from(data, 'base64'));
  out[p] = await ev(`(() => {
    const de = document.documentElement;
    const nav = document.querySelector('.mobile-nav');
    const main = document.querySelector('.main');
    const pw = document.querySelector('.page-wrap');
    const b = (el) => el ? [Math.round(el.getBoundingClientRect().x), Math.round(el.getBoundingClientRect().y), Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)] : null;
    const small = [...document.querySelectorAll('button, a, [role=button]')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 34 || r.height < 34); })
      .length;
    const clipped = [...document.querySelectorAll('*')].filter(el => {
      const cs = getComputedStyle(el);
      return el.scrollWidth > el.clientWidth + 4 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && el.clientWidth > 0;
    }).slice(0, 6).map(el => (typeof el.className === 'string' ? el.className : el.tagName).slice(0, 40));
    return {
      docH: de.scrollHeight, vh: innerHeight,
      hOverflow: de.scrollWidth > innerWidth + 1,
      main: b(main), pageWrap: b(pw), nav: b(nav),
      navOverlapsContent: nav && pw ? (pw.getBoundingClientRect().bottom > nav.getBoundingClientRect().top + 4) : null,
      tinyTargets: small,
      clippedText: clipped,
    };
  })()`);
}

console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill('SIGKILL'); process.exit(0);
