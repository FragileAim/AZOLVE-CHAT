import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const BIN='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const p=spawn(BIN,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=9335','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(2500);
const list=await (await fetch('http://127.0.0.1:9335/json/list')).json();
const sock=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0;const pend=new Map();const logs=[];const net=[];
sock.on('message',m=>{const d=JSON.parse(m);
 if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);}
 if(d.method==='Runtime.exceptionThrown'){const e=d.params.exceptionDetails;logs.push('[EXCEPTION] '+(e.exception?.description||e.text));}
 if(d.method==='Runtime.consoleAPICalled'){logs.push('['+d.params.type+'] '+d.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,300));}
 if(d.method==='Network.requestWillBeSent'){const u=d.params.request.url;if(u.includes('/api/'))net.push('REQ '+u);}
 if(d.method==='Network.responseReceived'){const u=d.params.response.url;if(u.includes('/api/'))net.push('RES '+d.params.response.status+' '+u);}
});
await new Promise(r=>sock.on('open',r));
const send=(m,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);sock.send(JSON.stringify({id:i,method:m,params}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result?.value;};
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
await send('Page.navigate',{url:'https://azolve-chat.onrender.com/#/auth'});
await sleep(7000);
await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/already have an account/i.test(x.innerText));b&&b.click();})()`);
await sleep(2500);
console.log('click:',await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^google$/i.test(x.innerText.trim()));if(!b)return 'nf';b.click();return 'clicked';})()`));
await sleep(8000);
console.log('URL:',await ev(`location.href`));
console.log('toasts:',await ev(`[...document.querySelectorAll('.toast,.form-error,[class*=toast],[class*=error]')].map(e=>e.innerText).join(' | ').slice(0,400)`));
console.log('--- NET ---');console.log(net.join('\n')||'(none)');
console.log('--- LOGS ---');console.log(logs.slice(0,15).join('\n')||'(none)');
p.kill();process.exit(0);
