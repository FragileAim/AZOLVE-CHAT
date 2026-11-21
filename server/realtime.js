import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { get, run, all } from './db.js';
import { now, parseJSON } from './util.js';
import { translateMessage } from './services/translate.js';
import { sendToUser, callPayload } from './services/push.js';

/* Local copy of the contact check so realtime does not import the route module
   (which imports this one back). One indexed lookup. */
const areContacts = (a, b) => !!get('SELECT 1 FROM contacts WHERE owner_id = ? AND peer_id = ?', a, b);

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
let io = null;
const online = new Map(); // userId -> Set(socketId)

/* ---------------------------------------------------------------------------
   Call registry
   A call is tracked on the server so that ringing cannot hang forever, a busy
   user is reported as busy instead of silently ignoring the invite, and a
   dropped socket tears the call down for the other side.
--------------------------------------------------------------------------- */
const RING_TIMEOUT = Number(process.env.CALL_RING_TIMEOUT_MS || 45000);
const calls = new Map(); // callId -> call record
const userCall = new Map(); // userId -> callId

function callOf(userId) {
  const id = userCall.get(userId);
  return id ? calls.get(id) : null;
}

function setCallState(call, state, extra = {}) {
  call.state = state;
  const payload = {
    callId: call.callId,
    state,
    type: call.type,
    conversationId: call.conversationId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    ...extra,
  };
  emitToUser(call.callerId, 'call:state', payload);
  emitToUser(call.calleeId, 'call:state', payload);
  return payload;
}

export function finishCall(callId, state, extra = {}) {
  const call = calls.get(callId);
  if (!call) return null;
  clearTimeout(call.timer);
  calls.delete(callId);
  userCall.delete(call.callerId);
  userCall.delete(call.calleeId);

  /* Duration is measured from the moment the call was answered, not from the
     moment it started ringing. A 40 second ring that nobody picks up is not a
     40 second conversation. */
  const duration = extra.duration != null
    ? extra.duration
    : (call.answeredAt ? Math.max(0, Math.round((Date.now() - call.answeredAt) / 1000)) : 0);
  const endedBy = extra.endedBy || null;
  const reason = extra.reason || null;
  const byName = endedBy
    ? (get('SELECT display_name FROM users WHERE id = ?', endedBy)?.display_name || null)
    : null;

  const payload = setCallState(call, state, { ...extra, duration, endedBy, endedReason: reason, endedByName: byName });
  try {
    run('UPDATE calls SET status = ?, ended_at = ?, duration = ?, ended_by = ?, ended_reason = ?, answered_at = ? WHERE id = ?',
      state, now(), duration, endedBy, reason, call.answeredAt || null, callId);
  } catch { /* call row may not exist yet — signalling still works */ }
  return payload;
}

function registerCall({ callId, callerId, calleeId, type, conversationId }) {
  const call = { callId, callerId, calleeId, type, conversationId, state: 'ringing', startedAt: Date.now(), answeredAt: null };
  calls.set(callId, call);
  userCall.set(callerId, callId);
  userCall.set(calleeId, callId);
  call.timer = setTimeout(() => {
    const c = calls.get(callId);
    if (!c || c.state !== 'ringing') return;
    finishCall(callId, 'missed', { reason: 'no-answer' });
    emitToUser(c.callerId, 'call:missed', { callId, reason: 'no-answer' });
    emitToUser(c.calleeId, 'call:missed', { callId, reason: 'no-answer' });
  }, RING_TIMEOUT);
  if (call.timer.unref) call.timer.unref();
  return call;
}

export function getIO() { return io; }
export const isOnline = (uid) => (online.get(uid)?.size || 0) > 0;

export function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}
export function emitToConv(convId, event, payload) {
  if (io) io.to(`conv:${convId}`).emit(event, payload);
}

/** Per-recipient delivery: every participant receives the message in their own language. */
export async function deliverMessage(message, conversationId) {
  const parts = all('SELECT * FROM participants WHERE conversation_id = ?', conversationId);
  const sender = get('SELECT * FROM users WHERE id = ?', message.sender_id);
  await Promise.all(parts.map(async (p) => {
    const u = get('SELECT * FROM users WHERE id = ?', p.user_id);
    if (!u) return;
    const lang = p.language_override || u.language || 'en';
    /* The socket payload must look exactly like the REST payload. It used to be
       the raw database row, which meant the client received `created_at` and
       `client_id` where it expected `createdAt` and `clientId`. The visible
       symptoms were a message stamped "Invalid Date", the sender's own bubble
       drawn on the receiving side, and every message appearing twice because
       the optimistic copy could not be matched to its echo. */
    let payload = {
      id: message.id,
      conversationId,
      senderId: message.sender_id,
      body: message.deleted ? '' : (message.body || ''),
      displayBody: message.deleted ? '' : message.body,
      originalBody: message.original_body ?? message.body,
      originalLang: message.original_lang,
      translated: false,
      type: message.type,
      mediaUrl: message.media_url,
      mediaMeta: message.media_meta ? parseJSON(message.media_meta, null) : null,
      replyTo: null,
      createdAt: message.created_at,
      editedAt: message.edited_at,
      deleted: !!message.deleted,
      pinned: !!message.pinned,
      starred: false,
      scheduledFor: message.scheduled_for,
      silent: !!message.silent,
      location: message.location ? parseJSON(message.location, null) : null,
      contact: message.contact ? parseJSON(message.contact, null) : null,
      reactions: {},
      reads: [],
      clientId: message.client_id,
    };
    if (message.type === 'text' && !message.deleted) {
      const t = await translateMessage(message, lang);
      payload = { ...payload, displayBody: t.text, translated: t.translated, displayLang: t.lang, translationProvider: t.provider };
    }
    payload.sender = sender ? { id: sender.id, displayName: sender.display_name, username: sender.username, avatar: sender.avatar } : null;
    emitToUser(p.user_id, 'message:new', payload);
  }));
  if (parts.length) {
    for (const p of parts) {
      if (p.user_id !== message.sender_id && !p.muted) {
        emitToUser(p.user_id, 'conversation:updated', { conversationId });
      }
    }
  }
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 5e6 });
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const p = jwt.verify(token, SECRET);
      const s = get('SELECT * FROM sessions WHERE id = ? AND revoked = 0', p.sid);
      if (!s) return next(new Error('unauthorized'));
      socket.userId = p.sub;
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const uid = socket.userId;
    socket.join(`user:${uid}`);
    if (!online.has(uid)) online.set(uid, new Set());
    online.get(uid).add(socket.id);
    run('UPDATE users SET last_seen = ? WHERE id = ?', now(), uid);
    io.emit('presence', { userId: uid, online: true, lastSeen: now() });

    for (const c of all('SELECT conversation_id FROM participants WHERE user_id = ?', uid)) socket.join(`conv:${c.conversation_id}`);

    socket.on('typing', ({ conversationId, typing }) => {
      if (!conversationId) return;
      socket.to(`conv:${conversationId}`).emit('typing', { conversationId, userId: uid, typing: !!typing });
    });

    socket.on('read', ({ conversationId }) => {
      run('UPDATE participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?', now(), conversationId, uid);
      socket.to(`conv:${conversationId}`).emit('read', { conversationId, userId: uid, at: now() });
    });

    socket.on('join', ({ conversationId }) => { if (conversationId) socket.join(`conv:${conversationId}`); });

    /* ----------------------------- WebRTC calls ---------------------------- */
    socket.on('call:invite', ({ to, callId, type, conversationId }) => {
      if (!to || !callId) return;
      const caller = get('SELECT * FROM users WHERE id = ?', uid);

      /* Calling is a contact-only action, same as messaging. */
      if (!areContacts(uid, to)) {
        emitToUser(uid, 'call:not-contact', {
          callId, to,
          peer: { id: to, displayName: get('SELECT display_name FROM users WHERE id = ?', to)?.display_name },
        });
        return;
      }

      // Already in a call? Tell the caller instead of ringing into the void.
      let busyWith = callOf(to);
      /* A call record can outlive the client that created it (tab killed,
         phone asleep, network dropped before the end event). Left alone it
         would block every future call to that person, which looks exactly
         like "calling does nothing". Anything that never reached 'active'
         and is older than the ring window is treated as dead. */
      if (busyWith && busyWith.state !== 'ended' && busyWith.state !== 'active'
          && Date.now() - busyWith.startedAt > RING_TIMEOUT + 15000) {
        finishCall(busyWith.callId, 'missed', { reason: 'stale' });
        busyWith = null;
      }
      if (busyWith && busyWith.state !== 'ended') {
        emitToUser(uid, 'call:busy', {
          callId, to,
          peer: { id: to, displayName: get('SELECT display_name FROM users WHERE id = ?', to)?.display_name },
        });
        return;
      }
      const mine = callOf(uid);
      if (mine) finishCall(mine.callId, 'ended', { reason: 'replaced' });

      /* Register first, in both cases. The call has to exist on the server even
         when the other person only ever sees a notification, otherwise tapping
         Decline on the notification has nothing to decline and the caller keeps
         ringing until the timeout. */
      registerCall({ callId, callerId: uid, calleeId: to, type, conversationId });

      const from = { id: uid, displayName: caller?.display_name, avatar: caller?.avatar, language: caller?.language };
      emitToUser(uid, 'call:ringing', { callId, ringTimeout: RING_TIMEOUT });

      if (isOnline(to)) {
        emitToUser(to, 'call:incoming', { callId, type, conversationId, from, ringTimeout: RING_TIMEOUT });
        return;
      }

      /* No socket means the app is closed or asleep, so an in-app ring would be
         silence. Push is the only way to reach them, and it carries Accept and
         Decline actions so the call can be answered without opening the app. */
      sendToUser(to, callPayload({ callId, from, type, conversationId, toUserId: to }))
        .then((sent) => {
          if (sent > 0) return;
          /* Nothing was delivered: no registered device, or every endpoint is
             dead. Say so instead of letting the caller listen to a ring that
             nobody can hear. */
          finishCall(callId, 'missed', { reason: 'peer-offline' });
          emitToUser(uid, 'call:unavailable', {
            callId, to,
            peer: { id: to, displayName: get('SELECT display_name FROM users WHERE id = ?', to)?.display_name },
          });
        })
        .catch(() => {
          finishCall(callId, 'missed', { reason: 'peer-offline' });
          emitToUser(uid, 'call:unavailable', { callId, to, peer: { id: to, displayName: get('SELECT display_name FROM users WHERE id = ?', to)?.display_name } });
        });
    });

    socket.on('call:accept', ({ to, callId }) => {
      const call = calls.get(callId);
      if (call) {
        clearTimeout(call.timer);
        call.state = 'connecting';
        call.answeredAt = Date.now();
        setCallState(call, 'connecting');
      }
      emitToUser(to, 'call:accepted', { callId, by: uid });
    });

    socket.on('call:decline', ({ to, callId }) => {
      const call = calls.get(callId);
      const byName = get('SELECT display_name FROM users WHERE id = ?', uid)?.display_name || null;
      finishCall(callId, 'declined', { endedBy: uid, reason: 'declined' });
      emitToUser(to, 'call:declined', { callId, by: uid, byName, reason: 'declined' });
      /* The caller may have closed the tab already; nothing else records this. */
      if (!call) {
        try {
          run('UPDATE calls SET status = ?, ended_at = ?, duration = 0, ended_by = ?, ended_reason = ? WHERE id = ?',
            'declined', now(), uid, 'declined', callId);
        } catch { /* no row */ }
      }
    });

    socket.on('call:end', ({ to, callId }) => {
      const call = calls.get(callId);
      const byName = get('SELECT display_name FROM users WHERE id = ?', uid)?.display_name || null;
      const payload = finishCall(callId, 'completed', { endedBy: uid, reason: 'hangup' });
      const duration = payload?.duration || 0;
      emitToUser(to, 'call:ended', { callId, by: uid, byName, duration, reason: 'hangup' });
      /* The call may already have been torn down by a disconnect; make sure the
         log still records who hung up. */
      if (!call) {
        try {
          run('UPDATE calls SET status = ?, ended_at = ?, duration = ?, ended_by = ?, ended_reason = ? WHERE id = ?',
            'completed', now(), duration, uid, 'hangup', callId);
        } catch { /* no row */ }
      }
    });

    // Media is live — mark the call active so a late invite reports busy.
    socket.on('call:connected', ({ to, callId }) => {
      const call = calls.get(callId);
      if (call) { call.state = 'active'; setCallState(call, 'active'); }
      emitToUser(to, 'call:connected', { callId, by: uid });
    });

    socket.on('call:signal', ({ to, callId, signal }) => {
      emitToUser(to, 'call:signal', { callId, from: uid, signal });
    });

    socket.on('call:caption', ({ to, callId, text, lang }) => {
      emitToUser(to, 'call:caption', { callId, from: uid, text, lang });
    });

    // Mirror mute / camera state so the other side can show "Muted".
    socket.on('call:toggle', ({ to, callId, muted, camOn }) => {
      emitToUser(to, 'call:toggle', { callId, from: uid, muted, camOn });
    });

    // Request the peer to renegotiate (ICE restart after a network change).
    socket.on('call:renegotiate', ({ to, callId, reason }) => {
      emitToUser(to, 'call:renegotiate', { callId, from: uid, reason });
    });

    // Explicit "I need a fresh offer" after an ICE failure.
    socket.on('call:ice-restart', ({ to, callId }) => {
      emitToUser(to, 'call:ice-restart', { callId, from: uid });
    });

    socket.on('disconnect', () => {
      const set = online.get(uid);
      if (set) {
        set.delete(socket.id);
        if (!set.size) {
          online.delete(uid);
          run('UPDATE users SET last_seen = ? WHERE id = ?', now(), uid);
          io.emit('presence', { userId: uid, online: false, lastSeen: now() });
          // A closed tab / lost network must not leave the other side ringing.
          const call = callOf(uid);
          if (call) {
            const peer = call.callerId === uid ? call.calleeId : call.callerId;
            const state = call.state === 'ringing' ? 'missed' : 'completed';
            const payload = finishCall(call.callId, state, { reason: 'peer-offline', endedBy: uid });
            emitToUser(peer, state === 'missed' ? 'call:missed' : 'call:ended', {
              callId: call.callId,
              reason: 'peer-offline',
              by: uid,
              byName: get('SELECT display_name FROM users WHERE id = ?', uid)?.display_name || null,
              duration: payload?.duration || 0,
            });
          }
        }
      }
    });
  });
  return io;
}
