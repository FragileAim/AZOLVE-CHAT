import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { unlockAudio } from '../lib/callkit.js';
import CallStage from './CallStage.jsx';

/* ---------------------------------------------------------------------------
   CallHost
   The call stage used to live inside the Calls page, so an incoming call only
   produced a ring if the recipient happened to be looking at that page. This
   host sits above every page: it owns the one active call, rings for incoming
   invites wherever the user is, and exposes placeCall() so any screen (the
   chat header, a profile, the calls list) can start a call.
--------------------------------------------------------------------------- */

const CallCtx = createContext(null);
export const useCall = () => useContext(CallCtx) || { placeCall: () => {}, active: null };

export default function CallHost({ children }) {
  const { user, notify } = useApp();
  const [active, setActive] = useState(null);
  const activeRef = useRef(null);
  activeRef.current = active;

  /* Mobile browsers refuse to start an AudioContext outside a gesture, which
     would leave an incoming call silent. Prime it on the first touch. */
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const placeCall = useCallback(async (peer, type = 'audio') => {
    if (!peer?.id) return null;
    if (activeRef.current) {
      notify?.('You are already on a call.', 'err');
      return null;
    }
    try {
      const r = await API.logCall({ calleeId: peer.id, type, status: 'ringing' });
      const call = {
        callId: r.callId,
        peer: {
          id: peer.id,
          displayName: peer.displayName || peer.name || 'Contact',
          avatar: peer.avatar || null,
          language: peer.language || 'en',
        },
        type,
        incoming: false,
        conversationId: r.conversationId || peer.conversationId,
      };
      setActive(call);
      getSocket()?.emit('call:invite', {
        to: peer.id,
        callId: r.callId,
        type,
        conversationId: call.conversationId,
      });
      return call;
    } catch (e) {
      notify?.(e.message || 'Could not start the call.', 'err');
      return null;
    }
  }, [notify]);

  /* Incoming invites are handled here, not in a page, so the phone rings from
     anywhere in the app. */
  useEffect(() => {
    const s = getSocket();
    if (!s) return;

    const onIncoming = (p) => {
      if (!p?.callId) return;
      // Already busy: tell the caller rather than showing a second stage.
      if (activeRef.current) {
        s.emit('call:decline', { to: p.from?.id, callId: p.callId });
        return;
      }
      const call = {
        callId: p.callId,
        peer: p.from || { id: 'unknown', displayName: 'Unknown caller' },
        type: p.type || 'audio',
        incoming: true,
        conversationId: p.conversationId,
      };
      setActive(call);

      // A backgrounded tab still deserves a ring the OS will show.
      try {
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(`Incoming ${call.type === 'video' ? 'video' : 'voice'} call`, {
            body: `${call.peer.displayName || 'Someone'} is calling on AZOLVE CHAT`,
            tag: p.callId,
            requireInteraction: true,
          });
          n.onclick = () => { try { window.focus(); } catch {} n.close(); };
        }
      } catch { /* notifications are optional */ }
      try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch {}
    };

    const onMissed = (p) => {
      if (activeRef.current && activeRef.current.callId === p?.callId) return;
      notify?.('Missed call', 'err');
    };

    s.on('call:incoming', onIncoming);
    s.on('call:missed', onMissed);
    return () => {
      s.off('call:incoming', onIncoming);
      s.off('call:missed', onMissed);
    };
  }, [notify, user?.id]);

  const close = useCallback(() => setActive(null), []);

  /* Preview builds have no server; this lets the Calls page demonstrate the
     incoming screen without pretending a real call arrived. */
  const previewIncoming = useCallback((peer) => {
    setActive({
      callId: 'preview-incoming',
      peer: peer || { id: 'preview-peer', displayName: 'Preview caller', language: 'en' },
      type: 'video',
      incoming: true,
    });
  }, []);

  return (
    <CallCtx.Provider value={{ placeCall, previewIncoming, active, close }}>
      {children}
      {active && (
        <CallStage
          call={active}
          onClose={close}
          onRedial={() => {
            const peer = active.peer;
            const kind = active.type;
            setActive(null);
            if (peer?.id) setTimeout(() => placeCall(peer, kind), 60);
          }}
        />
      )}
    </CallCtx.Provider>
  );
}
