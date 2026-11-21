/* Generic screenshot: node scripts/shot-url.mjs <url> <outfile> [w] [h] */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const [, , URL_, OUT_, W_ = '390', H_ = '844'] = process.argv;
const PORT = 9400 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', `--user-data-dir=/tmp/cdp-u-${Date.now()}`, 'about:blank',
], { stdio: 'ignore' });
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
await bsend('Emulation.setDeviceMetricsOverride', { width: Number(W_), height: Number(H_), deviceScaleFactor: 2, mobile: true });
await bsend('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await bsend('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36' });
await bsend('Page.navigate', { url: URL_ });
await sleep(Number(process.env.WAIT || 2500));
const { data } = await bsend('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(OUT_, Buffer.from(data, 'base64'));
console.log('saved', OUT_);
ws.close(); chrome.kill('SIGKILL'); process.exit(0);
