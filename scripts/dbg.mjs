import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const CHROME='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT=9777; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,'--no-sandbox','--disable-gpu','--hide-scrollbars',`--user-data-dir=/tmp/cdp-d-${Date.now()}`,'about:blank'],{stdio:'ignore'});
let ver; for(let i=0;i<100&&!ver;i++){try{ver=await(await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();}catch{} if(!ver)await sleep(200);}
const ws=new WebSocket(ver.webSocketDebuggerUrl,{maxPayload:1<<26}); await new Promise(r=>ws.on('open',r));
let id=0;const w=new Map(); ws.on('message',raw=>{const m=JSON.parse(raw.toString()); if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}});
const send=(method,params={})=>new Promise((res,rej)=>{const mid=++id;w.set(mid,m=>m.error?rej(new Error(method+': '+m.error.message)):res(m.result));ws.send(JSON.stringify({id:mid,method,params}));});
const tgt=await send('Target.createTarget',{url:'about:blank'});const att=await send('Target.attachToTarget',{targetId:tgt.targetId,flatten:true});const sid=att.sessionId;
const b=(method,params={})=>new Promise((res,rej)=>{const mid=++id;w.set(mid,m=>m.error?rej(new Error(method+': '+m.error.message)):res(m.result));ws.send(JSON.stringify({id:mid,sessionId:sid,method,params}));});
await b('Page.enable');await b('Runtime.enable');
await b('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await b('Page.navigate',{url:'http://localhost:4500/?splash=0&n=1#chats'}); await sleep(3000);
const ev=async e=>(await b('Runtime.evaluate',{expression:e,returnByValue:true})).result?.value;
console.log(await ev(`location.href`));
console.log(await ev(`document.body.innerText.slice(0,300)`));
console.log(await ev(`[...new Set([...document.querySelectorAll('[class]')].flatMap(e=>String(e.className).split(' ')))].slice(0,60).join(' | ')`));
ws.close();chrome.kill('SIGKILL');process.exit(0);
