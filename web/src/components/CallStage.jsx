import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../App.jsx';
import { Icon, Avatar } from './UI.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { fmtDur, startRing, stopRing, blip, meterStream, listDevices, stopStream } from '../lib/callkit.js';
import { langOf } from '../lib/i18n.js';
import { useSpeech, speak } from '../lib/speech.js';
import { startLiveCaption } from '../lib/livecaption.js';
import { SpeakingBars } from './Hear.jsx';
import { getIceConfig, toRtcConfig, readQuality } from '../lib/rtc.js';

/* Fallback only — the authoritative list comes from /api/rtc/config so TURN
   credentials can be rotated server-side without a rebuild. */
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/* ------------------------------- waveform -------------------------------- */
function Waveform({ level, bars = 28, active = true }) {
  return (
    <div className={`cv-wave ${active ? '' : 'idle'}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const live = typeof level === 'number' && level > 0.02 ? level : 0;
        // with no microphone signal the bars still breathe in a soft wave,
        // so the stage never looks dead
        const idle = 0.15 + 0.13 * Math.abs(Math.sin(i * 0.62));
        const wobble = 0.45 + 0.55 * Math.abs(Math.sin((i / bars) * Math.PI * 2.2 + performance.now() / 900));
        const h = live
          ? Math.max(12, Math.min(100, live * 120 * wobble + 10))
          : Math.max(12, Math.min(100, idle * 100));
        return <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 40}ms` }} />;
      })}
    </div>
  );
}

/* ------------------------------ control btn ------------------------------ */
function Ctrl({ icon, label, on, danger, onClick, disabled, badge }) {
  return (
    <button
      type="button"
      className={`cv-ctrl ${on ? 'on' : ''} ${danger ? 'danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={!!on}
    >
      <span className="cv-ctrl-ic">
        <Icon name={icon} size={21} />
        {badge ? <i className="cv-ctrl-badge">{badge}</i> : null}
      </span>
      <span className="cv-ctrl-lbl">{label}</span>
    </button>
  );
}

/* ================================ stage ================================== */
function CallStageInner({ call, onClose, onRedial }) {
  const { user, notify } = useApp();
  const sp = useSpeech();
  const video = call.type === 'video';

  const [phase, setPhase] = useState(call.incoming ? 'incoming' : 'ringing');
  const [simulated, setSimulated] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(video);
  const [speaker, setSpeaker] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [panel, setPanel] = useState(null);
  const [captions, setCaptions] = useState([]);
  const [captionDraft, setCaptionDraft] = useState('');
  const [level, setLevel] = useState(0);
  const [quality, setQuality] = useState('good');
  const [devices, setDevices] = useState({ cams: [], mics: [] });
  const [facing, setFacing] = useState('user');
  const [pipPos, setPipPos] = useState({ x: 0, y: 0 });
  const [error, setError] = useState(null);
  const [turnReady, setTurnReady] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [peerMuted, setPeerMuted] = useState(false);
  const [ringLeft, setRingLeft] = useState(0);
  /* Who ended the call, why, and how long it ran. Kept together so the ended
     screen can answer the only question people have at that moment. */
  const [endInfo, setEndInfo] = useState(null);

  /* ---- live translation ---- */
  const [liveOn, setLiveOn] = useState(true);
  const [liveStatus, setLiveStatus] = useState({ state: 'idle', engine: null });
  const [liveLine, setLiveLine] = useState(null);
  const [autoSpeak, setAutoSpeak] = useState(true);

  const localRef = useRef(null);
  const remoteRef = useRef(null);
  /* Audio-only calls had nowhere to play the other person. The remote <video>
     element is only rendered for video calls, so on a voice call `ontrack`
     attached the stream to a null ref and the call was silent in both
     directions even though the peer connection was healthy. This element is
     always mounted, so there is always a sink for remote audio. */
  const remoteAudioRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pcRef = useRef(null);
  const pcPromiseRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const pendingIce = useRef([]);
  const acceptedRef = useRef(false);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const initiatorRef = useRef(false);
  const restartRef = useRef(0);
  const liveRef = useRef(null);
  const autoSpeakRef = useRef(true);
  const speakingRef = useRef(false);
  const callId = call.callId;
  const peerId = call.peer?.id;

  const peerLang = useMemo(() => langOf(call.peer?.language || 'en'), [call.peer?.language]);

  /* --------------------------- live captions ----------------------------- */
  /* Every caption lands here: our own speech, the other person's, and typed
     notes. Speaking the incoming line is what makes this feel like live
     translation rather than subtitles — but the mic is paused while the voice
     plays, otherwise the phone hears its own translation and loops. */
  const speakLine = useCallback(async (text, lang) => {
    if (!sp.supported || !text) return;
    speakingRef.current = true;
    liveRef.current?.pause?.();
    try { await speak({ text, lang: lang || 'en', id: 'live-caption' }); } catch { /* engine refused */ }
    speakingRef.current = false;
    if (liveRef.current && !speakingRef.current) liveRef.current.resume?.();
  }, [sp.supported]);

  const addCaption = useCallback((c) => {
    if (!c?.text) return;
    setCaptions(prev => [...prev.slice(-5), c]);
    setLiveLine(c);
    setShowCaptions(true);
    if (!c.mine && autoSpeakRef.current) speakLine(c.text, c.lang);
  }, [speakLine]);

  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);

  /* ------------------------------ media ---------------------------------- */
  const acquire = useCallback(async (withVideo) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      streamRef.current = stream;
      if (localRef.current) localRef.current.srcObject = stream;
      listDevices().then(setDevices);
      return stream;
    } catch (e) {
      setError(e.name === 'NotAllowedError'
        ? 'Camera and microphone access was blocked. Allow it in your browser, then retry.'
        : 'No camera or microphone available on this device.');
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = audioOnly;
        return audioOnly;
      } catch {
        return null;
      }
    }
  }, [facing]);

  /* --------------------------- peer connection --------------------------- */
  const ensurePC = useCallback(async (initiator) => {
    if (pcRef.current) return pcRef.current;
    /* accept() and the first inbound offer can both land within a few
       milliseconds. Without this lock each would build its own
       RTCPeerConnection, the offer would be applied to the one that is not
       sending media, and the call would connect with no audio. */
    if (pcPromiseRef.current) return pcPromiseRef.current;

    pcPromiseRef.current = (async () => {
    // Ask the server which STUN/TURN servers to use, then build the peer.
    const cfg = await getIceConfig();
    setTurnReady(!!cfg.hasTurn);
    const pc = new RTCPeerConnection(toRtcConfig(cfg));
    pcRef.current = pc;
    initiatorRef.current = initiator;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        getSocket()?.emit('call:signal', { to: peerId, callId, signal: { candidate: e.candidate } });
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      remoteStreamRef.current = stream;
      /* Play into whichever sinks exist. The audio element is always present;
         the video element only exists on a video call. */
      const sinks = [remoteAudioRef.current, remoteRef.current].filter(Boolean);
      sinks.forEach((el) => {
        if (el.srcObject !== stream) el.srcObject = stream;
        const p = el.play?.();
        if (p && p.catch) p.catch(() => { /* retried on the next gesture below */ });
      });
      setPhase('active');
      getSocket()?.emit('call:connected', { to: peerId, callId });
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') { setPhase('active'); setQuality(q => (q === 'lost' ? 'good' : q)); }
      if (st === 'disconnected') setQuality('weak');
      if (st === 'failed') restartIce();
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'checking') setQuality('connecting');
      if (s === 'connected' || s === 'completed') setQuality(q => (q === 'connecting' ? 'good' : q));
      if (s === 'failed') restartIce();
    };

    const stream = streamRef.current || await acquire(video);
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

    if (initiator) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
      await pc.setLocalDescription(offer);
      getSocket()?.emit('call:signal', { to: peerId, callId, signal: offer });
    }
    return pc;
    })().finally(() => { pcPromiseRef.current = null; });
    return pcPromiseRef.current;
  }, [peerId, callId, video, acquire]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Recover from a network switch instead of dropping the call. The caller
     side re-offers with iceRestart so a fresh candidate pair is gathered. */
  const restartIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || restartRef.current > 2) { setQuality('lost'); setPhase('ended'); return; }
    restartRef.current += 1;
    setQuality('connecting');
    setReconnecting(true);
    try {
      if (initiatorRef.current) {
        const offer = await pc.createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: video });
        await pc.setLocalDescription(offer);
        getSocket()?.emit('call:signal', { to: peerId, callId, signal: offer });
      } else {
        getSocket()?.emit('call:ice-restart', { to: peerId, callId });
      }
      setTimeout(() => setReconnecting(false), 4000);
    } catch {
      setQuality('lost');
      setPhase('ended');
    }
  }, [peerId, callId, video]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const queue = pendingIce.current;
    pendingIce.current = [];
    for (const c of queue) { try { await pc.addIceCandidate(c); } catch {} }
  }, []);

  /* ---------------------------- quality poll ----------------------------- */
  useEffect(() => {
    if (phase !== 'active') return;
    let alive = true;
    const tick = async () => {
      const q = await readQuality(pcRef.current);
      if (alive) setQuality(q);
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [phase]);

  /* ------------------------------ signalling ----------------------------- */
  useEffect(() => {
    const s = getSocket();
    if (!s) return;

    const onAccepted = async ({ simulated: sim }) => {
      if (acceptedRef.current) return;
      acceptedRef.current = true;
      stopRing();
      blip('connect');
      setPhase('connecting');
      if (sim) { setSimulated(true); setTimeout(() => setPhase('active'), 1100); return; }
      await ensurePC(true);
    };

    const onDeclined = (p) => {
      stopRing(); blip('end');
      setEndInfo({ reason: 'declined', by: p?.by || null, byName: p?.byName || null, duration: 0 });
      setPhase('ended');
    };
    const onEnded = (p) => {
      stopRing(); blip('end');
      setEndInfo({ reason: p?.reason || 'hangup', by: p?.by || null, byName: p?.byName || null, duration: p?.duration ?? null });
      setPhase('ended');
    };
    const onMissed = (p) => {
      stopRing(); blip('end');
      setEndInfo({ reason: p?.reason || 'no-answer', by: null, byName: null, duration: 0 });
      setPhase('ended');
    };
    const onBusy = () => { stopRing(); blip('end'); setEndInfo({ reason: 'busy' }); setPhase('ended'); };

    /* The server tells us up front when the other person has no live socket,
       so the caller is not left listening to a ring that nobody hears. */
    const onUnavailable = () => { stopRing(); blip('end'); setEndInfo({ reason: 'offline' }); setPhase('ended'); };

    const onRinging = ({ ringTimeout }) => {
      const secs = Math.round((ringTimeout || 45000) / 1000);
      setRingLeft(secs);
    };

    const onToggle = ({ muted: m }) => setPeerMuted(!!m);

    const onIceRestart = async () => {
      if (!initiatorRef.current) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const offer = await pc.createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: video });
        await pc.setLocalDescription(offer);
        s.emit('call:signal', { to: peerId, callId, signal: offer });
      } catch {}
    };

    const onSignal = async ({ signal }) => {
      if (simulated) return;
      const pc = pcRef.current || await ensurePC(false);
      if (!pc) return;
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(signal);
        await flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        s.emit('call:signal', { to: peerId, callId, signal: answer });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(signal);
        await flushIce();
      } else if (signal.candidate) {
        if (pc.remoteDescription) { try { await pc.addIceCandidate(signal.candidate); } catch {} }
        else pendingIce.current.push(signal.candidate);
      }
    };

    const onCaption = ({ text, lang, source, srcLang }) => {
      const line = String(source || text || '').trim();
      if (line) {
        const norm = line.toLowerCase().replace(/\s+/g, ' ');
        peerLinesRef.current.set(norm, Date.now());
        /* keep the guard window small and bounded */
        if (peerLinesRef.current.size > 40) {
          const cutoff = Date.now() - 25000;
          for (const [k, at] of peerLinesRef.current) if (at < cutoff) peerLinesRef.current.delete(k);
        }
      }
      addCaption({ text, lang, source, srcLang, mine: false });
    };
    /* our own speech comes back translated so both sides show the same line */
    const onCaptionAck = ({ text, lang, source, srcLang }) => {
      addCaption({ text, lang, source, srcLang, mine: true });
    };

    s.on('call:accepted', onAccepted);
    s.on('call:declined', onDeclined);
    s.on('call:ended', onEnded);
    s.on('call:missed', onMissed);
    s.on('call:busy', onBusy);
    s.on('call:unavailable', onUnavailable);
    s.on('call:ringing', onRinging);
    s.on('call:toggle', onToggle);
    s.on('call:ice-restart', onIceRestart);
    s.on('call:signal', onSignal);
    s.on('call:caption', onCaption);
    s.on('call:caption:ack', onCaptionAck);
    return () => {
      s.off('call:accepted', onAccepted);
      s.off('call:declined', onDeclined);
      s.off('call:ended', onEnded);
      s.off('call:missed', onMissed);
      s.off('call:busy', onBusy);
      s.off('call:unavailable', onUnavailable);
      s.off('call:ringing', onRinging);
      s.off('call:toggle', onToggle);
      s.off('call:ice-restart', onIceRestart);
      s.off('call:signal', onSignal);
      s.off('call:caption', onCaption);
      s.off('call:caption:ack', onCaptionAck);
    };
  }, [peerId, callId, simulated, ensurePC, flushIce, video, addCaption]);

  /* ------------------------- live translation loop ------------------------ */
  /* Runs for the whole connected call. The engine picks itself: on-device
     recognition where the browser has it, otherwise short mic slices are
     transcribed and translated on the server. */
  useEffect(() => {
    if (phase !== 'active' || !liveOn || muted) {
      liveRef.current?.stop?.();
      liveRef.current = null;
      setLiveStatus({ state: liveOn ? 'idle' : 'off', engine: null });
      return undefined;
    }
    const myLang = user.language || 'en';
    const theirLang = call.peer?.language || 'en';
    let cancelled = false;

    const engine = startLiveCaption({
      stream: streamRef.current,
      lang: myLang,
      targetLang: theirLang,
      onStatus: st => { if (!cancelled) setLiveStatus(st); },
      onSegment: seg => {
        if (cancelled || !seg?.final) return;
        const source = String(seg.source || '').trim();
        if (!source) return;

        /* Did we just hear this from the peer? Then it is our microphone
           picking up their speaker, not us speaking. Dropping it is what stops
           the "captions appear on their own" behaviour. */
        const norm = source.toLowerCase().replace(/\s+/g, ' ');
        const seen = peerLinesRef.current.get(norm);
        if (seen && Date.now() - seen < 20000) {
          console.debug('[live-caption] dropped echo of peer line');
          return;
        }

        const socket = getSocket();
        if (seg.engine === 'device') {
          /* Show what we heard immediately, so the speaker can see the engine is
             alive, then let the translated line replace it a moment later. */
          addCaption({ source, text: source, srcLang: myLang, lang: myLang, mine: true, provisional: true });
          /* the server translates and fans the line out to both sides */
          socket?.emit('call:speech', { to: peerId, callId, text: source, lang: myLang });
        } else {
          const translated = seg.translated || source;
          /* Only claim "translated" when it genuinely differs from what was
             said. A provider that handed the sentence back is not a
             translation, and the badge must not say otherwise. */
          const reallyTranslated = seg.translatedByProvider !== false
            && translated.trim() !== source.trim();
          const payload = {
            source, text: translated,
            srcLang: seg.srcLang || myLang, lang: theirLang,
            translated: reallyTranslated,
            unavailable: !reallyTranslated && (seg.srcLang || myLang) !== theirLang,
          };
          socket?.emit('call:caption', { to: peerId, callId, ...payload });
          addCaption({ ...payload, mine: true });
        }
      },
    });
    liveRef.current = engine;
    return () => { cancelled = true; engine.stop?.(); liveRef.current = null; };
  }, [phase, liveOn, muted, peerId, callId, user.language, call.peer?.language, addCaption]);

  /* ------------------------------- ringing ------------------------------- */
  /* Mobile browsers can refuse the first programmatic play(). A tap anywhere
     on the call screen retries it, so the audio never stays stuck silent. */
  useEffect(() => {
    const retry = () => {
      const el = remoteAudioRef.current;
      if (!el || !remoteStreamRef.current || !el.paused) return;
      el.play?.().catch(() => {});
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('touchstart', retry, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('touchstart', retry);
    };
  }, []);

  useEffect(() => {
    if (phase === 'ringing') startRing('out');
    else if (phase === 'incoming') startRing('in');
    else stopRing();
  }, [phase]);

  /* Countdown so a caller can see the call is about to time out. */
  useEffect(() => {
    if (phase !== 'ringing' || !ringLeft) return;
    const id = setInterval(() => setRingLeft(n => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [phase, ringLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --------------------------- outgoing preview -------------------------- */
  useEffect(() => {
    if (call.incoming) return;
    let disposed = false;
    (async () => {
      const st = await acquire(video);
      if (disposed) return;
      if (st) {
        const stop = meterStream(st, setLevel);
        return () => stop();
      }
    })();
    return () => { disposed = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------- timer --------------------------------- */
  useEffect(() => {
    if (phase !== 'active') return;
    timerRef.current = setInterval(() => setSeconds(x => x + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  /* ------------------------------ teardown ------------------------------- */
  const cleanup = useCallback(() => {
    stopRing();
    clearInterval(timerRef.current);
    stopStream(streamRef.current);
    streamRef.current = null;
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    pcPromiseRef.current = null;
    remoteStreamRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  /* ------------------------------ actions -------------------------------- */
  const accept = async () => {
    stopRing();
    setPhase('connecting');
    getSocket()?.emit('call:accept', { to: peerId, callId });
    const st = await acquire(video);
    if (st) meterStream(st, setLevel);
    await ensurePC(false);
  };

  /* Arriving from an Accept tap on a notification: the person already said yes,
     so join the call instead of showing them a second Accept button. */
  const autoRef = useRef(false);
  useEffect(() => {
    if (!call.autoAccept || !call.incoming || autoRef.current) return;
    autoRef.current = true;
    accept();
  }, [call.autoAccept, call.incoming, accept]);

  const decline = () => {
    stopRing();
    const s = getSocket();
    s?.emit('call:decline', { to: peerId, callId });
    /* The server records the decline. Only write it ourselves if there is no
       socket, otherwise two writers race and the log can end up naming the
       wrong person as the one who ended it. */
    if (!s?.connected) API.updateCall(callId, { status: 'declined', duration: 0, reason: 'declined' }).catch(() => {});
    setEndInfo({ reason: 'declined', by: user?.id, byName: 'You', duration: 0 });
    cleanup();
    setPhase('ended');
  };

  const hangup = () => {
    stopRing();
    const s = getSocket();
    s?.emit('call:end', { to: peerId, callId });
    if (!s?.connected) {
      API.updateCall(callId, {
        status: phase === 'active' ? 'completed' : (phase === 'ringing' ? 'missed' : 'declined'),
        duration: seconds,
        reason: 'hangup',
      }).catch(() => {});
    }
    cleanup();
    blip('end');
    setEndInfo({ reason: 'hangup', by: user?.id, byName: 'You', duration: seconds });
    setPhase('ended');
  };

  const toggleMute = () => {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
    getSocket()?.emit('call:toggle', { to: peerId, callId, muted: next, camOn });
  };

  const toggleCam = () => {
    const next = !camOn;
    streamRef.current?.getVideoTracks().forEach(t => { t.enabled = next; });
    setCamOn(next);
    getSocket()?.emit('call:toggle', { to: peerId, callId, muted, camOn: next });
  };

  const flipCamera = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
      const track = ns.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      await sender?.replaceTrack(track);
      const old = streamRef.current?.getVideoTracks()[0];
      if (old) { streamRef.current.removeTrack(old); old.stop(); }
      streamRef.current?.addTrack(track);
      if (localRef.current) localRef.current.srcObject = streamRef.current;
    } catch {
      notify('This device has a single camera', 'err');
    }
  };

  const shareScreen = async () => {
    if (sharing) {
      setSharing(false);
      notify('Screen sharing stopped');
      return;
    }
    try {
      const ss = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 } });
      const track = ss.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      await sender?.replaceTrack(track);
      track.onended = () => setSharing(false);
      setSharing(true);
    } catch {
      notify('Screen share cancelled', 'err');
    }
  };

  /* Output routing. setSinkId is the only web API that can move a live stream
     between speaker and earpiece, and it is not on every browser — so when it
     is missing we say so instead of showing a button that does nothing. */
  const toggleSpeaker = async () => {
    const el = remoteAudioRef.current;
    const next = !speaker;
    if (!el || typeof el.setSinkId !== 'function') {
      notify('Use your phone’s volume buttons to switch output on this device', 'err');
      return;
    }
    try {
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
      const target = next ? (outs.find(d => d.deviceId !== 'default') || outs[0]) : outs.find(d => d.deviceId === 'default');
      await el.setSinkId(target?.deviceId || 'default');
      setSpeaker(next);
    } catch {
      notify('This device does not allow switching the audio output', 'err');
    }
  };

  const sendCaption = async () => {
    const text = captionDraft.trim();
    if (!text) return;
    getSocket()?.emit('call:caption', { to: peerId, callId, text, lang: user.language });
    setCaptions(c => [...c.slice(-3), { text, lang: user.language, mine: true }]);
    setShowCaptions(true);
    setCaptionDraft('');
    try {
      const r = await API.aiTask({ kind: 'translate', text, targetLang: call.peer?.language || 'en' });
      if (r?.text) setCaptions(c => [...c.slice(-3), { text: r.text, lang: call.peer?.language, translated: true }]);
    } catch {}
  };

  /* ----------------------------- drag the PiP ---------------------------- */
  const onPipDown = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    el.setPointerCapture?.(e.pointerId);
  };
  const onPipMove = (e) => {
    if (!dragRef.current) return;
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const { dx, dy, w, h } = dragRef.current;
    const x = Math.min(Math.max(8, e.clientX - stage.left - dx), stage.width - w - 8);
    const y = Math.min(Math.max(8, e.clientY - stage.top - dy), stage.height - h - 8);
    setPipPos({ x, y });
  };
  const onPipUp = (e) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const statusText =
    phase === 'incoming' ? 'Incoming call' :
    phase === 'ringing' ? 'Ringing' :
    phase === 'connecting' ? 'Connecting' :
    phase === 'active' ? fmtDur(seconds) : 'Call ended';

  const qualityLabel = {
    excellent: 'Excellent',
    good: 'Good',
    weak: 'Weak network',
    lost: 'Connection lost',
    connecting: 'Negotiating',
  }[quality] || 'Good';

  /* Plain sentences, written from the point of view of the person reading
     them. This is the whole point of recording ended_by. */
  const peerFirst = (call.peer?.displayName || 'They').split(' ')[0];
  const endReason = endInfo?.reason || null;
  const iEnded = !!(endInfo?.by && user?.id && endInfo.by === user.id);
  const endDuration = endInfo?.duration != null ? endInfo.duration : seconds;
  const endedText = (() => {
    if (endReason === 'busy') return `${peerFirst} is on another call`;
    if (endReason === 'offline') return `${peerFirst} is not online right now`;
    if (endReason === 'no-answer') return 'No answer';
    if (endReason === 'declined') return iEnded ? 'You declined this call' : `${peerFirst} declined the call`;
    if (endReason === 'peer-offline') return iEnded ? 'Your connection dropped' : `${peerFirst} lost connection`;
    if (endDuration > 0) {
      const who = iEnded ? 'You ended the call' : `${peerFirst} ended the call`;
      return `${who} \u00b7 ${fmtDur(endDuration)}`;
    }
    return iEnded ? 'You ended the call' : `${peerFirst} ended the call`;
  })();

  /* ------------------------------ ended card ----------------------------- */
  if (phase === 'ended') {
    return (
      <div className="ux-call-ended">
        <Avatar user={call.peer} size={110} ring />
        <b>{call.peer?.displayName || 'Call'}</b>
        <p>{endedText}</p>
        <p className="meta">
          {video ? 'Video' : 'Audio'} call
          {endDuration > 0 ? ` · ${fmtDur(endDuration)}` : ''}
          {endInfo?.byName && !iEnded ? ` · ended by ${endInfo.byName}` : ''}
        </p>
        <div className="acts">
          <button className="g" onClick={onClose}>Close</button>
          <button className="p" onClick={onRedial || onClose}>
            <Icon name={video ? 'video' : 'phone'} size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} /> Call again
          </button>
        </div>
        <p className="note">Live translated captions were available during this call.</p>
      </div>
    );
  }

  /* ------------------------------- incoming ------------------------------ */
  if (phase === 'incoming') {
    return (
      <div className="ux-call-incoming">
        <div className="top">
          <span className="chip"><Icon name="lock" size={12} /> Encrypted in transit</span>
          <span className="chip">{video ? 'Video call' : 'Audio call'}</span>
        </div>

        <div className="core">
          <Avatar user={call.peer} size={132} ring />
          <b>{call.peer?.displayName || 'Unknown'}</b>
          <small>Incoming {video ? 'video' : 'audio'} call</small>
          <span className="chip" style={{ marginTop: 6 }}>
            <Icon name="translate" size={12} /> Speaks {peerLang.native} · you hear {langOf(user.language).native}
          </span>
        </div>

        <div className="acts">
          <button className="ux-call-big decline" onClick={decline} aria-label="Decline">
            <Icon name="phone" size={26} style={{ transform: 'rotate(135deg)' }} />
          </button>
          <button className="ux-call-big accept" onClick={accept} aria-label="Accept">
            <Icon name={video ? 'video' : 'phone'} size={26} />
          </button>
        </div>
        <p style={{ marginTop: 18, fontSize: 11.5, color: 'rgba(255,255,255,.45)' }}>
          Tap to answer — your camera and mic stay off until you do
        </p>
      </div>
    );
  }

  /* --------------------------- ringing / active -------------------------- */
  const showRemoteVideo = video && (phase === 'active' || phase === 'connecting');
  const peerAvatar = call.peer?.avatar;
  const lastCap = captions[captions.length - 1];
  const capLine = liveLine || (showCaptions ? lastCap : null);
  const capWho = capLine
    ? (capLine.mine ? 'You' : (call.peer?.displayName || 'They').split(' ')[0])
    : '';
  const capLang = capLine ? langOf(capLine.lang || 'en').code?.toUpperCase() : '';

  return (
    <div className={`ux-call ${minimized ? 'is-min' : ''}`}>
      <audio ref={remoteAudioRef} autoPlay playsInline className="cv-remote-audio" />

      <div className="ux-call-media">
        {showRemoteVideo ? (
          <video ref={remoteRef} autoPlay playsInline />
        ) : (
          <div className="ux-call-audio">
            <div className="orb" aria-hidden />
            <div className="who">
              <Avatar user={call.peer} size={128} ring />
              <b>{call.peer?.displayName || 'Unknown'}</b>
              <small>
                {statusText}
                {phase === 'ringing' && <span className="cv-dots" style={{ marginLeft: 6 }}><i /><i /><i /></span>}
              </small>
              {phase === 'active' && !video && <Waveform level={level} bars={30} active={!muted} />}
            </div>
          </div>
        )}
        {simulated && showRemoteVideo && (
          <div className="cv-sim-remote">
            {peerAvatar && <div className="cv-sim-photo" style={{ backgroundImage: `url(${peerAvatar})` }} />}
            <div className="cv-sim-veil" />
            <div className="cv-sim-tag">Preview · simulated peer</div>
          </div>
        )}
      </div>
      <div className="ux-call-shade" aria-hidden />

      {/* header */}
      <div className="ux-call-head">
        <button className="ux-call-rnd" onClick={() => setMinimized(true)} aria-label="Minimise call">
          <Icon name="back" size={18} style={{ transform: 'rotate(-90deg)' }} />
        </button>
        <div className="ux-call-id">
          <b>{call.peer?.displayName || 'Unknown'}</b>
          <span>
            {phase === 'active' ? (<><i />{fmtDur(seconds)}</>) : statusText}
          </span>
        </div>
        <button className="ux-call-rnd" onClick={() => setPanel(p => p === 'options' ? null : 'options')} aria-label="Call options">
          <Icon name="users" size={18} />
        </button>
      </div>

      {/* live translation badge */}
      <button
        type="button"
        className={`ux-call-live ${liveOn && liveStatus.state === 'listening' ? '' : 'off'}`}
        onClick={() => setLiveOn(v => !v)}
        title={liveStatus.state === 'error' ? `Live captions could not start: ${liveStatus.error || 'unknown error'}` : 'Toggle live translation'}
      >
        <Icon name="translate" size={14} />
        {liveStatus.state === 'listening'
          ? `Live · ${langOf(user.language).code?.toUpperCase()} → ${peerLang.code?.toUpperCase()}`
          : liveStatus.state === 'error' ? 'Live unavailable'
            : liveStatus.state === 'unsupported' ? 'Live unsupported'
              : liveOn ? 'Live starting…' : 'Live translation off'}
      </button>

      {/* self view */}
      {(video || phase === 'ringing') && (
        <div
          className="ux-call-self"
          style={pipPos.x || pipPos.y ? { left: pipPos.x, top: pipPos.y, right: 'auto' } : undefined}
          onPointerDown={onPipDown}
          onPointerMove={onPipMove}
          onPointerUp={onPipUp}
          onPointerCancel={onPipUp}
        >
          <video ref={localRef} autoPlay playsInline muted />
          {!camOn && (
            <div className="off">
              <Icon name="camera" size={18} />
              <span>Camera off</span>
            </div>
          )}
        </div>
      )}

      {/* caption card */}
      {phase === 'active' && capLine && (
        <div className="ux-call-caps" onClick={() => setPanel(p => p === 'captions' ? null : 'captions')} role="status" aria-live="polite">
          <div className="lbl">
            {capWho} · {capLang}
            {capLine.provisional
              ? ' · listening…'
              : capLine.translated === false
                ? (capLine.unavailable ? ' · translation unavailable' : '')
                : ' · translated'}
          </div>
          <p>{capLine.text}</p>
          {capLine.source && capLine.source !== capLine.text && <div className="src">{capLine.source}</div>}
        </div>
      )}

      {/* reconnecting */}
      {reconnecting && (
        <div className="cv-reconnect" role="status">
          <span className="cv-reconnect-spin" aria-hidden />
          <div>
            <strong>Reconnecting…</strong>
            <span>Switching network route to keep the call alive</span>
          </div>
        </div>
      )}

      {!turnReady && phase !== 'active' && (
        <div className="ux-call-warn">
          <Icon name="warning" size={14} />
          <span>No TURN relay configured. Calls between mobile networks may fail — add <code>TURN_URL</code> on the server.</span>
        </div>
      )}

      {error && <div className="ux-call-err"><Icon name="warning" size={15} /> {error}</div>}

      {/* options / captions sheet */}
      {panel && (
        <div className="ux-call-sheet">
          <div className="hd">
            <Icon name={panel === 'captions' ? 'comment' : 'settings'} size={16} />
            <span style={{ flex: 1 }}>{panel === 'captions' ? 'Live captions' : 'Call options'}</span>
            <button className="ux-call-rnd" style={{ width: 32, height: 32 }} onClick={() => setPanel(null)} aria-label="Close"><Icon name="close" size={15} /></button>
          </div>
          {panel === 'options' ? (
            <div className="bd">
              <div className="ux-call-cap" style={{ cursor: 'default' }}>
                <span className="tx"><b style={{ fontSize: 14 }}>Live translation</b><em>Captions appear in the other person's language.</em></span>
                <button className={`ux-tgl ${liveOn ? 'on' : ''}`} onClick={() => setLiveOn(v => !v)} aria-label="Live translation"><i /></button>
              </div>
              <div className="ux-call-cap" style={{ cursor: 'default' }}>
                <span className="tx"><b style={{ fontSize: 14 }}>Speak translations aloud</b><em>Reads the translated line out loud.</em></span>
                <button className={`ux-tgl ${autoSpeak ? 'on' : ''}`} onClick={() => setAutoSpeak(v => !v)} aria-label="Speak translations"><i /></button>
              </div>
              <button className="ux-call-cap" onClick={() => setPanel('captions')}>
                <span className="tx"><b style={{ fontSize: 14 }}>Caption history</b><em>{captions.length} lines this call</em></span>
                <Icon name="arrow" size={16} />
              </button>
              {video && (
                <button className="ux-call-cap" onClick={flipCamera}>
                  <span className="tx"><b style={{ fontSize: 14 }}>Flip camera</b><em>Switch between front and back</em></span>
                  <Icon name="refresh" size={16} />
                </button>
              )}
              <button
                className="ux-call-cap"
                onClick={async () => {
                  const link = `${location.origin}/#/calls`;
                  try {
                    if (navigator.share) await navigator.share({ title: 'AZOLVE CHAT call', text: `Call ${call.peer?.displayName || ''} on AZOLVE CHAT`, url: link });
                    else { await navigator.clipboard.writeText(link); }
                  } catch { /* user dismissed */ }
                }}
              >
                <span className="tx"><b style={{ fontSize: 14 }}>Share call link</b><em>Invite someone else to AZOLVE CHAT</em></span>
                <Icon name="share" size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="bd">
                {captions.length === 0 && <p className="cv-cap-empty" style={{ padding: 8 }}>Speak normally — every sentence appears here in the other person's language, and theirs in yours.</p>}
                {captions.map((c, i) => {
                  const cid = `cap-${i}-${c.lang}`;
                  const live = sp.isPlaying(cid);
                  return (
                    <button key={i} className="ux-call-cap" onClick={() => sp.toggle({ text: c.text, lang: c.lang || 'en', id: cid })}>
                      <span className="lc">{langOf(c.lang || 'en').code?.toUpperCase()}</span>
                      <span className="tx">
                        {c.text}
                        {c.source && c.source !== c.text && <em>{c.source}</em>}
                      </span>
                      <span style={{ flex: 'none', color: live ? 'var(--ux-amber)' : 'rgba(255,255,255,.45)' }}>
                        {live ? <SpeakingBars small /> : <Icon name="volume" size={13} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <form className="ux-call-capform" onSubmit={e => { e.preventDefault(); sendCaption(); }}>
                <input value={captionDraft} onChange={e => setCaptionDraft(e.target.value)} placeholder="Type a caption — auto-translated…" />
                <button type="submit" aria-label="Send caption"><Icon name="send" size={15} /></button>
              </form>
            </>
          )}
        </div>
      )}

      {/* dock */}
      <div className="ux-call-dock">
        <button className={`ux-call-btn ${muted ? 'on' : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
          <Icon name={muted ? 'mute' : 'mic'} size={22} />
        </button>
        <button className={`ux-call-btn ${!camOn ? 'on' : ''}`} onClick={video ? toggleCam : flipCamera} aria-label={video ? (camOn ? 'Turn camera off' : 'Turn camera on') : 'Flip camera'}>
          <Icon name={video ? 'video' : 'refresh'} size={22} />
        </button>
        <button className={`ux-call-btn ${sharing ? 'on' : ''}`} onClick={shareScreen} aria-label="Share screen">
          <Icon name="screen" size={22} />
        </button>
        <button className={`ux-call-btn ${speaker ? 'on' : ''}`} onClick={toggleSpeaker} aria-label={speaker ? 'Speaker on' : 'Earpiece'}>
          <Icon name="volume" size={22} />
        </button>
        <button className="ux-call-btn end" onClick={hangup} aria-label="End call">
          <Icon name="phone" size={22} style={{ transform: 'rotate(135deg)' }} />
        </button>
      </div>

      <p className="ux-call-note">
        {phase === 'ringing'
          ? (ringLeft ? `Ringing… ${ringLeft}s left` : 'Waiting for the other person to answer…')
          : `${fmtDur(seconds)} · ${turnReady ? 'peer-to-peer media' : 'direct connection'}${peerMuted ? ' · they are muted' : ''}`}
      </p>
    </div>
  );
}

/* Mount the call surface at the document root so no ancestor transform,
   filter or overflow can trap the full-screen overlay. */
export default function CallStage(props) {
  if (typeof document === 'undefined') return null;
  return createPortal(<CallStageInner {...props} />, document.body);
}
