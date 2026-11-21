import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9401;
const BASE = 'http://127.0.0.1:4500';

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// register
await send('Page.navigate', { url: BASE });
await sleep(1200);
const reg = await ev(`(async()=>{
  const e='probe'+Date.now()+'@azolve.test';
  const s=await fetch('/api/auth/email/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e})}).then(r=>r.json());
  const v=await fetch('/api/auth/email/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:s.userId,code:s.deliveryCode})}).then(r=>r.json());
  localStorage.setItem('azolve.token',v.token); localStorage.setItem('azolve.refresh',v.refreshToken);
  await fetch('/api/users/me',{method:'PATCH',headers:{'content-type':'application/json','authorization':'Bearer '+v.token},body:JSON.stringify({country:'IN',bio:'probe',displayName:'Probe User'})});
  return 'ok';
})()`);
console.log('register', reg);

await send('Page.navigate', { url: BASE + '/#/chats' });
await sleep(2500);

const report = await ev(`(()=>{
  const out=[];
  const sel=['.rail','.mobile-nav','.clp-head','.clp-title h1','.clp-tabs','.conv-item','.chat-list','.list-pane','.app-shell','.shell','.main','.chat-pane'];
  for(const s of sel){ const el=document.querySelector(s); if(!el){out.push([s,'MISSING']);continue;}
    const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
    out.push([s, Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.width)+'x'+Math.round(r.height), cs.padding, cs.fontSize+'/'+cs.fontWeight, cs.borderRadius]);
  }
  out.push(['docScrollW', document.documentElement.scrollWidth, 'win', innerWidth]);
  out.push(['convItems', document.querySelectorAll('.conv-item').length]);
  out.push(['bodyText', document.body.innerText.slice(0,200).replace(/\\n/g,' | ')]);
  return out;
})()`);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
