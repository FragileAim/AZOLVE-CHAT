import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
const CHROME='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT=9421, BASE='http://localhost:4500';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--no-sandbox','--disable-gpu','about:blank']);
await sleep(1300);
const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws=new WebSocket(list[0].webSocketDebuggerUrl);
let id=0;const pend=new Map();
ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
await new Promise(r=>ws.on('open',r));
const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true})).result?.result?.value;
await send('Page.enable');await send('Runtime.enable');
for (const [w,h] of [[390,844],[360,640]]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
  await send('Page.navigate',{url:BASE+'/'});await sleep(600);
  await ev(`localStorage.clear();localStorage.setItem('azolve.theme','light')`);
  await send('Page.navigate',{url:BASE+'/'});await sleep(1800);
  const before=await ev(`JSON.stringify({scrollH:document.body.scrollHeight,vh:innerHeight})`);
  // click Get started
  await ev(`[...document.querySelectorAll('button')].find(b=>/Get started/i.test(b.textContent))?.click()`);
  await sleep(700);
  const after=await ev(`(()=>{const q=s=>document.querySelector(s);const r=q('.auth-mode-switch')?.getBoundingClientRect();
    return JSON.stringify({scrollH:document.documentElement.scrollHeight,vh:innerHeight,scrollY,
      tabsTop:r?Math.round(r.top):null,tabsBottom:r?Math.round(r.bottom):null,
      visible:!!r && r.top>=0 && r.bottom<=innerHeight,
      hero:getComputedStyle(q('.auth-mobile-hero')).display,
      emailTop:Math.round(q('input[type=email]')?.getBoundingClientRect().top||-1),
      btnBottom:Math.round([...document.querySelectorAll('button')].filter(b=>/Continue|Send|code/i.test(b.textContent)).map(b=>b.getBoundingClientRect().bottom).sort((a,b)=>b-a)[0]||-1)})})()`);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(`/workspace/.screenshots/auth-started-${w}.png`,Buffer.from(shot.result.data,'base64'));
  console.log(w+'x'+h, 'before',before,'after',after);
}
ws.close();chrome.kill();
