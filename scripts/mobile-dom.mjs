import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const PORT = 9334;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
  '--disable-gpu', '--hide-scrollbars', '--user-data-dir=/tmp/cdp2', 'about:blank'], { stdio: 'ignore' });

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
if (process.env.TOKEN) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(process.env.TOKEN)});}catch(e){}`,
  });
}
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const BASE = process.env.BASE || 'http://localhost:4500';
const TOKEN = process.env.TOKEN || '';
const HASH = process.env.HASH || '#/chats';

await send('Page.navigate', { url: `${BASE}/?splash=0${HASH}` }); await sleep(3500);
await ev(`location.hash = ${JSON.stringify(HASH)}; true`); await sleep(2000);

const outline = await ev(`(() => {
  const walk = (el, depth) => {
    if (depth > 6) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || b.width === 0) return null;
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
      box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      pos: cs.position, disp: cs.display,
      kids: depth < 6 ? [...el.children].map(c => walk(c, depth + 1)).filter(Boolean) : undefined,
    };
  };
  return walk(document.getElementById('root'), 0);
})()`);

const overflow = await ev(`(() => {
  const out = [];
  document.querySelectorAll('*').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && (b.right > innerWidth + 1 || b.left < -1 || b.bottom > innerHeight + 1)) {
      out.push({ cls: (typeof el.className === 'string' ? el.className : el.tagName).slice(0, 50), box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] });
    }
  });
  return out.slice(0, 25);
})()`);

console.log('OUTLINE\n' + JSON.stringify(outline, null, 1));
console.log('\nOVERFLOW\n' + JSON.stringify(overflow, null, 1));
ws.close(); chrome.kill('SIGKILL'); process.exit(0);
