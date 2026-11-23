import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const BIN='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const p=spawn(BIN,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=9334','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(2500);
const list=await (await fetch('http://127.0.0.1:9334/json/list')).json();
const sock=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0; const pend=new Map(); const logs=[];
sock.on('message',m=>{const d=JSON.parse(m);
  if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);}
  if(d.method==='Runtime.exceptionThrown'){const e=d.params.exceptionDetails;logs.push('[EXCEPTION] '+(e.exception?.description||e.text));}
  if(d.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(d.params.type)){logs.push('['+d.params.type+'] '+d.params.args.map(a=>a.value??a.description??'').join(' '));}
});
await new Promise(r=>sock.on('open',r));
const send=(m,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);sock.send(JSON.stringify({id:i,method:m,params}));});
const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result?.value;};
await send('Runtime.enable');await send('Page.enable');
await send('Page.navigate',{url:'https://azolve-chat.onrender.com/#/auth'});
await sleep(7000);
// click "I already have an account"
console.log('click existing:', await ev(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/already have an account/i.test(x.innerText));if(!b)return 'not found';b.click();return 'clicked';})()`));
await sleep(3000);
console.log('body after:', (await ev(`document.body.innerText`)||'').slice(0,700));
console.log('google btn:', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/google/i.test(x.innerText));return b?('found: '+b.innerText.trim()):'NOT FOUND';})()`));
// click google and watch navigation
console.log('click google:', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/google/i.test(x.innerText));if(!b)return 'nf';b.click();return 'clicked';})()`));
await sleep(6000);
console.log('URL now:', await ev(`location.href`));
console.log('--- LOGS ---'); console.log(logs.slice(0,15).join('\n')||'(none)');
p.kill();process.exit(0);
