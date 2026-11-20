/* Drives the real UI through the contact gate:
     People → Requests → Accept → Everyone shows the contact → Message opens
     the conversation → send a message → it appears in the thread.
   Proves the feature works by clicking, not by calling the API directly. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const PORT = 9341;
const OUT = '/workspace/.screenshots';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--user-data-dir=/tmp/cdp-flow', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); page = (await r.json()).find(t => t.type === 'page'); if (page) break; } catch { }
  await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
await new Promise(r => ws.on('open', r));
let id = 0; const w = new Map();
ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; w.set(mid, m => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: mid, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('azolve.token', ${JSON.stringify(process.env.TOKEN)});}catch(e){}` });

const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
};
const shot = async (n) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(data, 'base64'));
  return n;
};

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}${d ? '  ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${n}  ->  ${d}`); } };

await send('Page.navigate', { url: `${process.env.BASE || 'http://localhost:4500'}/?splash=0#/people` });
await sleep(3200);

console.log('\n== People page ==');
const peopleText = await ev(`document.body.innerText`);
check('page rendered', /People/.test(peopleText));

const badgeBefore = await ev(`document.querySelector('.mobile-nav .rail-badge')?.textContent || ''`);
check('nav shows the pending request badge', badgeBefore === '1', `badge=${badgeBefore}`);

await ev(`[...document.querySelectorAll('.seg button')].find(b=>/request/i.test(b.textContent)).click(); true`);
await sleep(1500);
await shot('flow-1-requests');
const reqText = await ev(`document.querySelector('.req-list')?.innerText || ''`);
check('incoming request is listed', /Priya Sharma/.test(reqText), reqText.split('\n')[0] || '');
check('the note is shown', /founders meetup/.test(reqText));

console.log('\n== Accept ==');
await ev(`[...document.querySelectorAll('.req-actions .btn')].find(b=>/accept/i.test(b.textContent)).click(); true`);
await sleep(2200);
await shot('flow-2-accepted');
const afterAccept = await ev(`document.body.innerText`);
check('inbox empties after accepting', /No incoming requests right now/.test(afterAccept));
check('badge clears', !(await ev(`document.querySelector('.mobile-nav .rail-badge')?.textContent || ''`)));

console.log('\n== The new contact can be messaged ==');
await ev(`[...document.querySelectorAll('.seg button')].find(b=>/everyone/i.test(b.textContent)).click(); true`);
await sleep(1500);
const everyoneText = await ev(`document.body.innerText`);
check('contact section appears', /your contacts/i.test(everyoneText));
check('Priya is now under contacts', /Priya Sharma/.test(everyoneText));
const msgBtn = await ev(`(() => {
  const card=[...document.querySelectorAll('.person-card')].find(c=>/Priya/.test(c.innerText));
  const b=card?.querySelector('.btn'); return b ? b.textContent.trim() : 'none';
})()`);
check('a Message button is offered', /message/i.test(msgBtn), msgBtn);

await ev(`(() => {
  const card=[...document.querySelectorAll('.person-card')].find(c=>/Priya/.test(c.innerText));
  card.querySelector('.btn').click(); return true;
})()`);
await sleep(2600);
await shot('flow-3-chat');
const hash = await ev(`location.hash`);
check('the conversation opened', /#\/chats\/c_/.test(hash), hash);

const composer = await ev(`!!document.querySelector('.chat-composer, .composer, textarea')`);
check('composer is present', composer);

await ev(`(() => {
  const ta=document.querySelector('.chat-composer textarea, textarea');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
  setter.call(ta,'Hello Priya, request accepted!');
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
await sleep(400);
await ev(`(() => {
  const ta=document.querySelector('.chat-composer textarea');
  if (ta) {
    const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta,'Hello Priya, request accepted!');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
  }
  return true;
})()`);
await sleep(500);
const sendState = await ev(`(() => {
  const b=document.querySelector('.send-btn');
  return b ? { found:true, disabled:b.disabled } : { found:false };
})()`);
check('send button is enabled', sendState.found && !sendState.disabled, JSON.stringify(sendState));
await ev(`document.querySelector('.send-btn').click(); true`);
await sleep(2200);
await shot('flow-4-sent');
const thread = await ev(`document.body.innerText`);
check('the message is in the thread', /request accepted/.test(thread));

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
ws.close(); chrome.kill();
process.exit(fail === 0 ? 0 : 1);
