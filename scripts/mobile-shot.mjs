/* Renders the app in a real phone viewport via the Chrome DevTools Protocol so
   layout problems can be seen and measured rather than guessed at. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const PORT = 9333;
const OUT = '/workspace/.screenshots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--user-data-dir=/tmp/cdp-profile', 'about:blank',
], { stdio: 'ignore' });

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const page = j.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise(r => ws.on('open', r));

let id = 0;
const waiting = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  waiting.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id: mid, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
if (process.env.TOKEN) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(process.env.TOKEN)});}catch(e){}`,
  });
}
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

const BASE = process.env.BASE || 'http://localhost:4500';
const TOKEN = process.env.TOKEN || '';

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value;
};

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  return `${OUT}/${name}.png`;
};

const go = async (url) => {
  await send('Page.navigate', { url });
  await sleep(2600);
};

await go(`${BASE}/?splash=0`);

const report = {};

report.home = await shot('m-home');
report.homeMetrics = await evaluate(`(() => {
  const de = document.documentElement;
  return {
    vw: innerWidth, vh: innerHeight,
    docW: de.scrollWidth, docH: de.scrollHeight,
    hOverflow: de.scrollWidth > innerWidth + 1,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    navVisible: !!document.querySelector('.mobile-nav'),
    railDisplay: getComputedStyle(document.querySelector('.rail') || document.body).display,
  };
})()`);

await evaluate(`location.hash = '#/chats'; true`);
await sleep(2200);
report.chats = await shot('m-chats');
report.chatsMetrics = await evaluate(`(() => {
  const list = document.querySelector('.chats-list, .conv-list, .chat-list');
  const r = list ? list.getBoundingClientRect() : null;
  return {
    vw: innerWidth, vh: innerHeight,
    listRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    convCount: document.querySelectorAll('[class*="conv-item"], [class*="chat-row"]').length,
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    offenders: [...document.querySelectorAll('*')].filter(el => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > innerWidth + 2 || b.left < -2);
    }).slice(0, 8).map(el => el.className && typeof el.className === 'string'
      ? el.className.split(' ')[0] + ' w=' + Math.round(el.getBoundingClientRect().width)
      : el.tagName),
  };
})()`);

report.openResult = await evaluate(`(() => {
  const row = document.querySelector('[class*="conv-item"], [class*="chat-row"], .conv');
  if (!row) return 'no conversation row';
  row.click();
  return 'clicked: ' + (row.innerText || '').slice(0, 40).replace(/\\n/g, ' ');
})()`);
await sleep(2500);
report.chat = await shot('m-chat');
report.chatMetrics = await evaluate(`(() => {
  const shell = document.querySelector('.chat-shell, .chat-pane, .chat-view');
  const head = document.querySelector('.chat-head, .chat-header');
  const body = document.querySelector('.chat-body, .msg-list, .messages');
  const comp = document.querySelector('.composer, .chat-composer, .msg-composer');
  const box = (el) => el ? (() => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })() : null;
  return {
    vw: innerWidth, vh: innerHeight,
    docH: document.documentElement.scrollHeight,
    shell: box(shell), head: box(head), body: box(body), composer: box(comp),
    composerOffscreen: comp ? comp.getBoundingClientRect().bottom > innerHeight + 2 : null,
    bodyScrollable: body ? body.scrollHeight > body.clientHeight : null,
    pageScrolls: document.documentElement.scrollHeight > innerHeight + 2,
  };
})()`);

console.log(JSON.stringify(report, null, 2));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);
