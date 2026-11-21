import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const CHROME='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT=9412, BASE='http://localhost:4500';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--no-sandbox','--disable-gpu','about:blank']);
await sleep(1200);
const list=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws=new WebSocket(list[0].webSocketDebuggerUrl);
let id=0;const pend=new Map();
ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
await new Promise(r=>ws.on('open',r));
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
await send('Page.enable');await send('Runtime.enable');
for (const [theme,w,h] of [['light',390,844],['dark',390,844]]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
  await send('Page.navigate',{url:BASE+'/'});
  await sleep(600);
  await send('Runtime.evaluate',{expression:`localStorage.clear();localStorage.setItem('azolve.theme','${theme}');`});
  await send('Page.navigate',{url:BASE+'/'});
  await sleep(2000);
  await send('Runtime.evaluate',{expression:`document.documentElement.setAttribute('data-theme','${theme}')`});
  await sleep(400);
  const r=await send("Page.captureScreenshot",{format:"png"});
  const fs=await import('node:fs');
  fs.writeFileSync(`/workspace/.screenshots/auth-${theme}-390.png`,Buffer.from(r.result.data,'base64'));
  console.log('shot',theme);
}
ws.close();chrome.kill();
