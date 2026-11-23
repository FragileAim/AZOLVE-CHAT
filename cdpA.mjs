import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const BIN='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const p=spawn(BIN,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=9342','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(2500);
const list=await (await fetch('http://127.0.0.1:9342/json/list')).json();
const sock=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0;const pend=new Map();
sock.on('message',m=>{const d=JSON.parse(m);if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);}});
await new Promise(r=>sock.on('open',r));
const send=(m,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);sock.send(JSON.stringify({id:i,method:m,params}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result?.value;};
await send('Runtime.enable');await send('Page.enable');
for (const vp of [{w:390,h:844,n:'iPhone 14'},{w:375,h:667,n:'iPhone SE'},{w:1440,h:900,n:'desktop'}]) {
  await send('Emulation.setDeviceMetricsOverride',{width:vp.w,height:vp.h,deviceScaleFactor:1,mobile:vp.w<800});
  await send('Page.navigate',{url:'https://azolve-chat.onrender.com/#/auth'});
  await sleep(6500);
  await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/already have an account/i.test(x.innerText));b&&b.click();})()`);
  await sleep(2000);
  const info=await ev(`(()=>{const a=[...document.querySelectorAll('a')].find(x=>/^google$/i.test(x.innerText.trim()));if(!a)return 'NOT RENDERED';const r=a.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+' href='+a.getAttribute('href');})()`);
  console.log(vp.n+' -> '+info);
}
// now actually click it
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:'https://azolve-chat.onrender.com/#/auth'});
await sleep(6500);
await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/already have an account/i.test(x.innerText));b&&b.click();})()`);
await sleep(2000);
console.log('clicking Google...');
await ev(`(()=>{const a=[...document.querySelectorAll('a')].find(x=>/^google$/i.test(x.innerText.trim()));a.click();})()`);
await sleep(7000);
const u=await ev(`location.href`);
console.log('LANDED:', u.slice(0,90));
console.log('is google?', u.includes('accounts.google.com'));
p.kill();process.exit(0);
