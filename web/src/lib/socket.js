import { io } from 'socket.io-client';
import { getToken } from './api.js';

const DEMO = import.meta.env.VITE_DEMO === '1';

let socket = null;

/* ---------------------------------------------------------------------------
   Preview bus
   In the static preview there is no server, so we provide a signalling bus that
   is genuinely functional: events are relayed between browser tabs/windows over
   a BroadcastChannel. Two tabs of the preview can therefore place a real
   WebRTC call to each other. When nobody answers, the bus simulates a peer so a
   single visitor can still walk through the entire call experience.
--------------------------------------------------------------------------- */
function makeDemoBus() {
  const listeners = new Map();
  const tabId = Math.random().toString(36).slice(2, 9);
  let channel = null;
  try { channel = new BroadcastChannel('azolve-preview-bus'); } catch {}

  const fire = (event, payload) => {
    const set = listeners.get(event);
    if (set) set.forEach(fn => { try { fn(payload); } catch (e) { console.error('[bus]', event, e); } });
  };

  // presence: if another preview tab answers, we are not alone and must not
  // fake the far end of a call
  let peers = false;
  let lastPeerAt = 0;

  if (channel) {
    channel.onmessage = (e) => {
      const { event, payload, from } = e.data || {};
      if (!event || from === tabId) return;
      if (event === '__hello') {
        peers = true; lastPeerAt = Date.now();
        try { channel.postMessage({ event: '__here', payload: {}, from: tabId }); } catch {}
        return;
      }
      if (event === '__here') { peers = true; lastPeerAt = Date.now(); return; }

      peers = true; lastPeerAt = Date.now();

      /* The real server rewrites these events for the recipient
         (invite -> incoming, accept -> accepted, ...). Mirror that here so a
         second preview tab behaves exactly like a second real client. */
      if (event === 'call:invite') {
        fire('call:incoming', {
          callId: payload.callId,
          type: payload.type,
          from: payload.from || { id: payload.to, displayName: 'Preview caller' },
          conversationId: payload.conversationId,
        });
        return;
      }
      if (event === 'call:accept') { fire('call:accepted', { callId: payload.callId, by: from }); return; }
      if (event === 'call:decline') { fire('call:declined', { callId: payload.callId }); return; }
      if (event === 'call:end') { fire('call:ended', { callId: payload.callId }); return; }

      fire(event, payload);
    };
    try { channel.postMessage({ event: '__hello', payload: {}, from: tabId }); } catch {}
  }

  const pending = new Map();

  const bus = {
    id: tabId,
    connected: true,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return bus;
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
      return bus;
    },
    emit(event, payload = {}) {
      try { channel?.postMessage({ event, payload, from: tabId }); } catch {}

      // single-visitor fallback: simulate the far end of a call
      const alone = !peers || Date.now() - lastPeerAt > 4000;
      if (event === 'call:invite' && alone) {
        const key = payload.callId;
        const t1 = setTimeout(() => {
          if (pending.get(key) === 'cancelled') return;
          fire('call:accepted', { callId: key, by: 'preview-peer', simulated: true });
        }, 2600);
        const t2 = setTimeout(() => {
          if (pending.get(key) === 'cancelled') return;
          fire('call:caption', {
            callId: key,
            text: 'Simulated captions are running — in the live app this is your voice, translated.',
            lang: 'en',
          });
        }, 9000);
        pending.set(key, [t1, t2]);
      }
      if (event === 'call:end' || event === 'call:decline') {
        const timers = pending.get(payload.callId);
        if (Array.isArray(timers)) timers.forEach(clearTimeout);
        pending.set(payload.callId, 'cancelled');
      }
      return bus;
    },
    disconnect() { listeners.clear(); try { channel?.close(); } catch {} },
  };
  return bus;
}

export function connectSocket() {
  if (DEMO) {
    if (!socket) socket = makeDemoBus();
    return socket;
  }
  if (socket) return socket;
  const token = getToken();
  if (!token) return null;
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
