import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const BIN='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const p=spawn(BIN,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=9340','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(2500);
const list=await (await fetch('http://127.0.0.1:9340/json/list')).json();
const sock=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0;const pend=new Map();const net=[];
sock.on('message',m=>{const d=JSON.parse(m);
 if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);}
 if(d.method==='Network.requestWillBeSent'){const u=d.params.request.url;if(u.includes('/api/'))net.push('REQ '+u.slice(0,100));}
});
await new Promise(r=>sock.on('open',r));
const send=(m,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);sock.send(JSON.stringify({id:i,method:m,params}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result?.value;};
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await send('Page.navigate',{url:'https://azolve-chat.onrender.com/#/auth'});
await sleep(7000);
await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/already have an account/i.test(x.innerText));b&&b.click();})()`);
await sleep(2500);
console.log('ALL google-ish buttons:');
console.log(await ev(`JSON.stringify([...document.querySelectorAll('button')].map((b,i)=>{const r=b.getBoundingClientRect();return i+': '+JSON.stringify(b.innerText.trim().slice(0,20))+' '+Math.round(r.width)+'x'+Math.round(r.height)+' top='+Math.round(r.top);}).filter(s=>/google|apple/i.test(s)),null,1)`));
console.log('click visible google:',await ev(`(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>/^google$/i.test(x.innerText.trim()));const v=bs.find(x=>x.getBoundingClientRect().width>0);if(!v)return 'no visible';v.click();return 'clicked visible #'+bs.indexOf(v)+' of '+bs.length;})()`));
await sleep(8000);
console.log('URL:',await ev(`location.href`));
console.log('NET:',net.slice(-6).join(' | ')||'(none)');
p.kill();process.exit(0);
