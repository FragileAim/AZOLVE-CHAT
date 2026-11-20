/* Screenshots of the Request Y surfaces: auth switch, People directory,
   request inbox, new-chat gate, and the profile log-out button. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const PORT = 9335;
const OUT = '/workspace/.screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--user-data-dir=/tmp/cdp-people', 'about:blank'], { stdio: 'ignore' });

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page) return page;
    } catch { }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}
const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  waiting.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Page.enable'); await send('Runtime.enable');

const BASE = process.env.BASE || 'http://localhost:4500';
const TOKEN = process.env.TOKEN || '';
const W = Number(process.env.W || 390), H = Number(process.env.H || 844);
const TAG = process.env.TAG || 'p';

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 700 });
if (TOKEN) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(TOKEN)});}catch(e){}`,
  });
}
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text };
  return r.result?.value;
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  return `${OUT}/${name}.png`;
};
const go = async (hash, wait = 2400) => {
  await send('Page.navigate', { url: `${BASE}/?splash=0#/${hash}` });
  await sleep(wait);
};

const out = {};

/* Auth screen without a token. */
if (!TOKEN) {
  await go('', 2200);
  out.auth = await shot(`${TAG}-auth-signin`);
  out.authMetrics = await evaluate(`(() => {
    const sw = document.querySelector('.auth-mode-switch');
    const b = sw ? sw.getBoundingClientRect() : null;
    return {
      hasSwitch: !!sw,
      labels: [...document.querySelectorAll('.auth-mode-switch button')].map(x => x.textContent.trim()),
      active: document.querySelector('.auth-mode-switch button.on')?.textContent.trim(),
      switchRect: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null,
      hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      docH: document.documentElement.scrollHeight,
    };
  })()`);
  await evaluate(`[...document.querySelectorAll('.auth-mode-switch button')].find(b=>/create/i.test(b.textContent))?.click(); true`);
  await sleep(700);
  out.authCreate = await shot(`${TAG}-auth-create`);
  out.authCreateMetrics = await evaluate(`(() => ({
    active: document.querySelector('.auth-mode-switch button.on')?.textContent.trim(),
    heading: document.querySelector('.auth-card h1, .auth-card h2, h1, h2')?.textContent.trim(),
    nameField: !!document.querySelector('input[placeholder*="ame" i]'),
  }))()`);
} else {
  await go('people', 2600);
  out.people = await shot(`${TAG}-people`);
  out.peopleMetrics = await evaluate(`(() => {
    const cards = document.querySelectorAll('.person-card');
    const r = cards[0] ? cards[0].getBoundingClientRect() : null;
    return {
      cards: cards.length,
      firstCard: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      pills: [...document.querySelectorAll('.rel-pill')].map(x => x.textContent.trim()).slice(0, 8),
      buttons: [...document.querySelectorAll('.person-card .btn')].map(x => x.textContent.trim()).slice(0, 8),
      hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      navBadge: document.querySelector('.mobile-nav .rail-badge')?.textContent || null,
    };
  })()`);

  await evaluate(`[...document.querySelectorAll('.seg button')].find(b=>/request/i.test(b.textContent))?.click(); true`);
  await sleep(1400);
  out.requests = await shot(`${TAG}-requests`);
  out.requestsMetrics = await evaluate(`(() => ({
    incomingRows: document.querySelectorAll('.req-row').length,
    acceptBtns: [...document.querySelectorAll('.req-actions .btn')].map(x => x.textContent.trim()),
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
  }))()`);

  await go('chats', 2400);
  await evaluate(`document.querySelector('.clp-new')?.click(); true`);
  await sleep(1800);
  out.newChat = await shot(`${TAG}-newchat`);
  out.newChatMetrics = await evaluate(`(() => {
    const rows = document.querySelectorAll('.user-pick-row');
    return {
      rows: rows.length,
      actions: [...document.querySelectorAll('.user-pick-row .btn, .user-pick-row .rel-pill')].map(x => x.textContent.trim()).slice(0, 10),
      hasSendRequest: [...document.querySelectorAll('.user-pick-row .btn')].some(b => /send request/i.test(b.textContent)),
      hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  })()`);

  await go('profile', 2400);
  out.profile = await shot(`${TAG}-profile`);
  out.profileMetrics = await evaluate(`(() => ({
    actions: [...document.querySelectorAll('.ph-actions .btn, .ph-actions button')].map(x => x.textContent.trim()),
    hasLogout: [...document.querySelectorAll('button')].some(b => /log out/i.test(b.textContent)),
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
  }))()`);
}

console.log(JSON.stringify(out, null, 2));
ws.close(); chrome.kill();
process.exit(0);
