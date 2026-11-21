// Measures whether the auth form's essential controls fit above the fold.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = process.env.BASE || 'http://127.0.0.1:4500';
const OUT = '.screenshots';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdp(ws, method, params = {}) {
  return new Promise((res, rej) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = raw => {
      const m = JSON.parse(raw);
      if (m.id === id) { ws.off('message', onMsg); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function run(w, h, mode) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
  await sleep(1400);
  let list;
  for (let i = 0; i < 20; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {}
    await sleep(300);
  }
  const ws = new WebSocket(list[0].webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.on('open', r));
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp(ws, 'Page.navigate', { url: `${BASE}/#/auth` });
  await sleep(2200);
  await cdp(ws, 'Runtime.evaluate', { expression: `localStorage.clear(); location.reload();` });
  await sleep(2400);

  const evalJs = async expr => {
    const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result.value;
  };

  if (mode !== 'hero') await evalJs(`(() => { const b=[...document.querySelectorAll('.auth-actions .btn')].find(x=>/Get started/i.test(x.textContent)); b&&b.click(); return 1; })()`);
  await sleep(700);
  if (mode === "hero") { console.log("HERO", JSON.stringify(await evalJs(`(()=>{const b=[...document.querySelectorAll(".auth-actions .btn")][0];const r=b.getBoundingClientRect();return{scrollH:document.documentElement.scrollHeight,vh:innerHeight,ctaTop:Math.round(r.top),ctaBottom:Math.round(r.bottom),visible:r.bottom<=innerHeight}})()`))); ws.close(); proc.kill("SIGKILL"); return; }
  if (mode === "create") {
    await evalJs(`(() => { const b=[...document.querySelectorAll('.auth-mode-switch button')].find(x=>/Create account/i.test(x.textContent)); b&&b.click(); return 1; })()`);
    await sleep(500);
  }

  const m = await evalJs(`(() => {
    const q = s => document.querySelector(s);
    const r = e => e ? e.getBoundingClientRect() : null;
    const primary = [...document.querySelectorAll('.auth-card .btn.primary')].find(b => b.offsetParent);
    const pr = r(primary);
    return {
      scrollH: document.documentElement.scrollHeight,
      vh: innerHeight,
      tabs: r(q('.auth-mode-switch')),
      h2: r(q('.auth-card h2')),
      email: r(q('.auth-card input[type=email]')),
      primary: pr ? { top: Math.round(pr.top), bottom: Math.round(pr.bottom), label: primary.textContent.trim() } : null,
      primaryVisible: pr ? pr.bottom <= innerHeight : false,
      hero: getComputedStyle(q('.auth-mobile-hero')).display
    };
  })()`);

  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/fit-${w}x${h}-${mode}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`${w}x${h} ${mode}`, JSON.stringify(m));
  ws.close(); proc.kill('SIGKILL');
}

const sizes = [[390, 844], [375, 667], [360, 640], [414, 896]];
for (const [w, h] of sizes) for (const mode of ['hero']) await run(w, h, mode);
