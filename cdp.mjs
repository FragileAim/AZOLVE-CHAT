import { spawn } from 'node:child_process';
const BIN='/root/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const p=spawn(BIN,['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=9333','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(2500);
const list=await (await fetch('http://127.0.0.1:9333/json/list')).json();
const ws=list.find(t=>t.type==='page').webSocketDebuggerUrl;
const {default:WebSocket}=await import('ws');
const sock=new WebSocket(ws);
let id=0; const pend=new Map(); const logs=[];
sock.on('message',m=>{
  const d=JSON.parse(m);
  if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);}
  if(d.method==='Runtime.consoleAPICalled'){logs.push('[console.'+d.params.type+'] '+d.params.args.map(a=>a.value??a.description??'').join(' '));}
  if(d.method==='Runtime.exceptionThrown'){const e=d.params.exceptionDetails;logs.push('[EXCEPTION] '+(e.exception?.description||e.text));}
  if(d.method==='Log.entryAdded'){const e=d.params.entry;if(e.level==='error')logs.push('[log.error] '+e.text);}
});
await new Promise(r=>sock.on('open',r));
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);sock.send(JSON.stringify({id:i,method,params}));});
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate',{url:'https://azolve-chat.onrender.com/#/auth'});
await sleep(9000);
const r=await send('Runtime.evaluate',{expression:`JSON.stringify({title:document.title,body:(document.body.innerText||'').slice(0,1200)})`,returnByValue:true});
console.log('PAGE:',r.result.value?.slice(0,1500));
console.log('--- LOGS ---');
console.log(logs.slice(0,25).join('\n')||'(none)');
p.kill(); process.exit(0);
