import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const BIN='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const p=spawn(BIN,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=9338','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(2500);
const list=await (await fetch('http://127.0.0.1:9338/json/list')).json();
const sock=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0;const pend=new Map();const net=[];const logs=[];
sock.on('message',m=>{const d=JSON.parse(m);
 if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);}
 if(d.method==='Runtime.exceptionThrown'){const e=d.params.exceptionDetails;logs.push('[EXC] '+(e.exception?.description||e.text).slice(0,300));}
 if(d.method==='Network.requestWillBeSent'){const u=d.params.request.url;if(u.includes('/api/'))net.push('REQ '+u.slice(0,110));}
 if(d.method==='Network.responseReceived'){const u=d.params.response.url;if(u.includes('/api/'))net.push('RES '+d.params.response.status+' '+u.slice(0,110));}
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
console.log('google btn:',await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^google$/i.test(x.innerText.trim()));if(!b)return 'nf';const r=b.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+' visible='+(r.width>0);})()`));
console.log('click:',await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^google$/i.test(x.innerText.trim()));if(!b)return 'nf';b.click();return 'clicked';})()`));
await sleep(9000);
console.log('URL:',await ev(`location.href`));
console.log('--- NET ---');console.log(net.slice(-8).join('\n')||'(none)');
console.log('--- LOGS ---');console.log(logs.slice(0,8).join('\n')||'(none)');
p.kill();process.exit(0);
