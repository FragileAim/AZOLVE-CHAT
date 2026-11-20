/* End-to-end check of the call state machine over real Socket.IO connections. */
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:3222';

const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};

async function makeUser(phone, name) {
  const s = await post('/api/auth/phone/start', { phone, displayName: name });
  const code = s.body.deliveryCode;
  if (!code) throw new Error('no deliveryCode: ' + JSON.stringify(s.body));
  const v = await post('/api/auth/phone/verify', { userId: s.body.userId, code });
  if (!v.body.token) throw new Error('no token: ' + JSON.stringify(v.body));
  return { id: v.body.user.id, name, token: v.body.token };
}

const connect = (u) => new Promise((res, rej) => {
  const s = io(BASE, { auth: { token: u.token }, transports: ['websocket'] });
  s.on('connect', () => res(s));
  s.on('connect_error', rej);
});

const once = (sock, ev, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
  sock.once(ev, (p) => { clearTimeout(t); res(p); });
});

const log = (ok, msg) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);

const A = await makeUser('+919000000101', 'Asha');
const B = await makeUser('+919000000102', 'Bilal');
const C = await makeUser('+919000000103', 'Chen');
const sa = await connect(A);
const sb = await connect(B);
const sc = await connect(C);

/* 1. invite → ringing + incoming */
const inv = once(sb, 'call:incoming');
const ring = once(sa, 'call:ringing');
sa.emit('call:invite', { to: B.id, callId: 'c1', type: 'video', conversationId: null });
const incoming = await inv;
const ringing = await ring;
log(incoming.callId === 'c1' && incoming.from.id === A.id, 'callee receives call:incoming with caller identity');
log(typeof ringing.ringTimeout === 'number', `caller receives call:ringing (timeout ${ringing.ringTimeout}ms)`);

/* 2. busy — C invites B who is ringing */
const busy = once(sc, 'call:busy');
sc.emit('call:invite', { to: B.id, callId: 'c2', type: 'audio' });
const busyP = await busy;
log(busyP.callId === 'c2', 'second caller gets call:busy while callee is ringing');

/* 3. accept → caller notified + state broadcast */
const acc = once(sa, 'call:accepted');
const st = once(sa, 'call:state');
sb.emit('call:accept', { to: A.id, callId: 'c1' });
const accP = await acc;
const stP = await st;
log(accP.callId === 'c1', 'caller receives call:accepted');
log(stP.state === 'connecting', `call:state broadcast (${stP.state})`);

/* 4. toggle mirror */
const tog = once(sb, 'call:toggle');
sa.emit('call:toggle', { to: B.id, callId: 'c1', muted: true, camOn: false });
const togP = await tog;
log(togP.muted === true && togP.camOn === false, 'peer mute/camera state is mirrored');

/* 5. end */
const ended = once(sb, 'call:ended');
sa.emit('call:end', { to: B.id, callId: 'c1' });
const endP = await ended;
log(endP.callId === 'c1', 'call:ended delivered');

/* 6. decline */
const inv2 = once(sb, 'call:incoming');
sa.emit('call:invite', { to: B.id, callId: 'c3', type: 'audio' });
await inv2;
const dec = once(sa, 'call:declined');
sb.emit('call:decline', { to: A.id, callId: 'c3' });
const decP = await dec;
log(decP.callId === 'c3', 'decline while ringing reaches the caller');

/* 7. ring timeout → missed on both sides */
const inv3 = once(sb, 'call:incoming');
const missedA = once(sa, 'call:missed', 6000);
const missedB = once(sb, 'call:missed', 6000);
sa.emit('call:invite', { to: B.id, callId: 'c4', type: 'audio' });
await inv3;
const [mA, mB] = await Promise.all([missedA, missedB]);
log(mA.callId === 'c4' && mB.callId === 'c4', 'ring timeout marks the call missed for both sides');

/* 8. rtc config */
const rtc = await (await fetch(BASE + '/api/rtc/config')).json();
log(Array.isArray(rtc.iceServers) && rtc.iceServers.length > 0, `rtc config served (hasTurn=${rtc.hasTurn})`);

sa.close(); sb.close(); sc.close();
console.log('\nDONE');
process.exit(0);
