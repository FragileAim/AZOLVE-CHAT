import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../App.jsx';
import { Icon, Avatar } from './UI.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { fmtDur, startRing, stopRing, blip, meterStream, listDevices, stopStream } from '../lib/callkit.js';
import { langOf } from '../lib/i18n.js';
import { useSpeech } from '../lib/speech.js';
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
  const [endReason, setEndReason] = useState(null);

  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const pendingIce = useRef([]);
  const acceptedRef = useRef(false);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const initiatorRef = useRef(false);
  const restartRef = useRef(0);
  const callId = call.callId;
  const peerId = call.peer?.id;

  const peerLang = useMemo(() => langOf(call.peer?.language || 'en'), [call.peer?.language]);

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
      const [stream] = e.streams;
      if (remoteRef.current && stream) {
        remoteRef.current.srcObject = stream;
        remoteRef.current.play?.().catch(() => {});
      }
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

    const onDeclined = () => { stopRing(); blip('end'); setEndReason('declined'); setPhase('ended'); };
    const onEnded = () => { stopRing(); blip('end'); setPhase('ended'); };
    const onMissed = () => { stopRing(); blip('end'); setEndReason('missed'); setPhase('ended'); };
    const onBusy = () => { stopRing(); blip('end'); setEndReason('busy'); setPhase('ended'); };

    /* The server tells us up front when the other person has no live socket,
       so the caller is not left listening to a ring that nobody hears. */
    const onUnavailable = () => { stopRing(); blip('end'); setEndReason('offline'); setPhase('ended'); };

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

    const onCaption = ({ text, lang }) => {
      setCaptions(c => [...c.slice(-3), { text, lang }]);
      setShowCaptions(true);
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
    };
  }, [peerId, callId, simulated, ensurePC, flushIce, video]);

  /* ------------------------------- ringing ------------------------------- */
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

  const decline = () => {
    stopRing();
    getSocket()?.emit('call:decline', { to: peerId, callId });
    API.updateCall(callId, { status: 'declined', duration: 0 }).catch(() => {});
    cleanup();
    setPhase('ended');
  };

  const hangup = () => {
    stopRing();
    getSocket()?.emit('call:end', { to: peerId, callId });
    API.updateCall(callId, {
      status: phase === 'active' ? 'completed' : (phase === 'ringing' ? 'missed' : 'declined'),
      duration: seconds,
    }).catch(() => {});
    cleanup();
    blip('end');
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

  const endedText =
    endReason === 'busy' ? 'They are on another call' :
    endReason === 'offline' ? 'They are not online right now' :
    endReason === 'missed' ? 'No answer' :
    endReason === 'declined' ? 'Call declined' :
    seconds > 0 ? `Call ended · ${fmtDur(seconds)}` : 'Call ended';

  /* ------------------------------ ended card ----------------------------- */
  if (phase === 'ended') {
    return (
      <div className="cv-root">
        <div className="cv-ended">
          <div className="cv-ended-glow" aria-hidden />
          <Avatar user={call.peer} size={96} ring />
          <h2>{call.peer?.displayName || 'Call'}</h2>
          <p className="cv-ended-status">{endedText}</p>
          <div className="cv-ended-actions">
            <button className="cv-ended-btn ghost" onClick={onClose}>Close</button>
            <button className="cv-ended-btn primary" onClick={onRedial || onClose}>
              <Icon name={video ? 'video' : 'phone'} size={17} /> Call again
            </button>
          </div>
          <p className="cv-ended-note">
            <Icon name="translate" size={13} /> Live translated captions were available during this call
          </p>
        </div>
      </div>
    );
  }

  /* ------------------------------- incoming ------------------------------ */
  if (phase === 'incoming') {
    return (
      <div className="cv-root">
        <div className="cv-incoming">
          <div className="cv-incoming-bg" aria-hidden>
            <div className="cv-aurora a1" /><div className="cv-aurora a2" /><div className="cv-aurora a3" />
          </div>

          <div className="cv-incoming-top">
            <span className="cv-chip"><Icon name="lock" size={12} /> Encrypted in transit</span>
            <span className="cv-chip soft">{video ? 'Video call' : 'Audio call'}</span>
          </div>

          <div className="cv-incoming-core">
            <div className="cv-rings" aria-hidden>
              <span /><span /><span />
            </div>
            <Avatar user={call.peer} size={132} ring />
            <h1>{call.peer?.displayName || 'Unknown'}</h1>
            <p className="cv-incoming-sub">
              <span className="cv-dotpulse" /> Incoming {video ? 'video' : 'audio'} call
            </p>
            <span className="cv-lang-pill">
              <Icon name="translate" size={12} /> Speaks {peerLang.native} · you hear {langOf(user.language).native}
            </span>
          </div>

          <div className="cv-incoming-actions">
            <button className="cv-big decline" onClick={decline}>
              <span className="cv-big-ic"><Icon name="phone" size={26} /></span>
              <span>Decline</span>
            </button>
            <button className="cv-big accept" onClick={accept}>
              <span className="cv-big-ic"><Icon name={video ? 'video' : 'phone'} size={26} /></span>
              <span>Accept</span>
            </button>
          </div>
          <p className="cv-slide-hint">Tap to answer — your camera and mic stay off until you do</p>
        </div>
      </div>
    );
  }

  /* --------------------------- ringing / active -------------------------- */
  const showRemoteVideo = video && (phase === 'active' || phase === 'connecting');
  const peerAvatar = call.peer?.avatar;

  return (
    <div className={`cv-root ${minimized ? 'is-min' : ''}`}>
      <div className={`cv-stage ${video ? 'is-video' : 'is-audio'} ${sharing ? 'is-sharing' : ''}`} ref={stageRef}>
        {/* backdrop */}
        {!video && (
          <div className="cv-audio-bg" aria-hidden>
            <div className="cv-aurora a1" /><div className="cv-aurora a2" /><div className="cv-aurora a3" />
          </div>
        )}

        {/* remote */}
        {showRemoteVideo && (
          <>
            <video ref={remoteRef} autoPlay playsInline className="cv-remote" />
            {simulated && (
              <div className="cv-sim-remote">
                {peerAvatar && <div className="cv-sim-photo" style={{ backgroundImage: `url(${peerAvatar})` }} />}
                <div className="cv-sim-veil" />
                <div className="cv-sim-tag">Preview · simulated peer</div>
              </div>
            )}
          </>
        )}

        {/* audio art / ringing art */}
        {(!showRemoteVideo || phase !== 'active') && (
          <div className="cv-art">
            <div className="cv-rings big" aria-hidden><span /><span /><span /></div>
            {peerAvatar && video ? (
              <div className="cv-art-photo" style={{ backgroundImage: `url(${peerAvatar})` }} />
            ) : null}
            <Avatar user={call.peer} size={video ? 108 : 138} ring />
            <h1>{call.peer?.displayName || 'Unknown'}</h1>
            <p className="cv-art-status">
              {statusText}
              {phase === 'ringing' && <span className="cv-dots"><i /><i /><i /></span>}
            </p>
            {phase === 'ringing' && (
              <span className="cv-lang-pill">
                <Icon name="translate" size={12} /> Captions will translate to {peerLang.native}
              </span>
            )}
            {phase === 'active' && !video && <Waveform level={level} bars={32} active={!muted} />}
          </div>
        )}

        {/* top bar */}
        <div className="cv-top">
          <div className="cv-top-left">
            <button
              className={`cv-icon min-ic ${minimized ? 'is-min' : ''}`}
              onClick={() => setMinimized(m => !m)}
              title={minimized ? 'Back to full screen' : 'Minimise call'}
              aria-label={minimized ? 'Expand call' : 'Minimise call'}
            >
              <Icon name={minimized ? 'screen' : 'arrow'} size={17} />
            </button>
            <div className="cv-peer">
              <span className="cv-peer-name">{call.peer?.displayName || 'Unknown'}</span>
              <span className="cv-peer-meta">
                {phase === 'active' ? (
                  <>
                    <i className={`cv-q ${quality}`} /> {qualityLabel} · {fmtDur(seconds)}
                  </>
                ) : statusText}
              </span>
            </div>
          </div>
          <div className="cv-top-right">
            {phase === 'active' && (
              <span className="cv-chip mini"><Icon name="translate" size={11} /> Live translation</span>
            )}
            {peerMuted && <span className="cv-chip mini mute"><Icon name="mute" size={11} /> They're muted</span>}
            {simulated && <span className="cv-chip mini warn">Simulated</span>}
          </div>
        </div>

        {/* local preview */}
        {(video || phase === 'ringing') && (
          <div
            className={`cv-pip ${camOn ? '' : 'off'} ${pipPos.x || pipPos.y ? 'moved' : ''}`}
            style={pipPos.x || pipPos.y ? { left: pipPos.x, top: pipPos.y, right: 'auto', bottom: 'auto' } : undefined}
            onPointerDown={onPipDown}
            onPointerMove={onPipMove}
            onPointerUp={onPipUp}
            onPointerCancel={onPipUp}
          >
            <video ref={localRef} autoPlay playsInline muted className="cv-pip-video" />
            {!camOn && (
              <div className="cv-pip-off">
                <Icon name="camera" size={18} />
                <span>Camera off</span>
              </div>
            )}
            <span className="cv-pip-tag">You</span>
          </div>
        )}

        {/* captions */}
        {showCaptions && (
          <div className="cv-captions">
            <div className="cv-captions-head">
              <span><Icon name="translate" size={13} /> Live captions</span>
              <button className="cv-icon sm" onClick={() => setShowCaptions(false)}><Icon name="close" size={13} /></button>
            </div>
            <div className="cv-captions-body">
              {captions.length === 0 && <p className="cv-cap-empty">Speak or type — captions appear here, translated for the other person.</p>}
              {captions.map((c, i) => {
                const cid = `cap-${i}-${c.lang}`;
                const live = sp.isPlaying(cid);
                return (
                  <button
                    key={i}
                    type="button"
                    className={`cv-cap ${c.mine ? 'mine' : ''} ${live ? 'speaking' : ''}`}
                    onClick={() => sp.toggle({ text: c.text, lang: c.lang || 'en', id: cid })}
                    title={`Tap to hear this in ${langOf(c.lang || 'en').native}`}
                  >
                    <span className="cv-cap-lang">{langOf(c.lang || 'en').code?.toUpperCase()}</span>
                    <span className="cv-cap-text">{c.text}</span>
                    <span className="cv-cap-hear" aria-hidden>
                      {live ? <SpeakingBars small /> : <Icon name="volume" size={13} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <form className="cv-cap-form" onSubmit={e => { e.preventDefault(); sendCaption(); }}>
              <input
                value={captionDraft}
                onChange={e => setCaptionDraft(e.target.value)}
                placeholder="Type a caption — auto-translated…"
              />
              <button type="submit" className="cv-cap-send"><Icon name="send" size={15} /></button>
            </form>
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

        {/* no TURN configured — be honest about why mobile calls can fail */}
        {!turnReady && phase !== 'active' && (
          <div className="cv-warn">
            <Icon name="warning" size={14} />
            <span>
              No TURN relay configured. Calls between mobile networks may fail —
              add <code>TURN_URL</code> on the server.
            </span>
          </div>
        )}

        {/* error */}
        {error && (
          <div className="cv-error">
            <Icon name="warning" size={15} /> {error}
          </div>
        )}

        {/* dock */}
        <div className="cv-dock-wrap">
          <div className="cv-dock">
            <Ctrl icon={muted ? 'mute' : 'mic'} label={muted ? 'Unmute' : 'Mute'} on={muted} onClick={toggleMute} />
            {video && <Ctrl icon="video" label={camOn ? 'Camera' : 'Cam off'} on={!camOn} onClick={toggleCam} />}
            {video && <Ctrl icon="refresh" label="Flip" onClick={flipCamera} />}
            <Ctrl icon="volume" label={speaker ? 'Speaker' : 'Earpiece'} on={!speaker} onClick={() => setSpeaker(s => !s)} />
            <Ctrl icon="translate" label="Captions" on={showCaptions} onClick={() => setShowCaptions(s => !s)} />
            <Ctrl icon="screen" label="Share" on={sharing} onClick={shareScreen} />
            <button className="cv-end" onClick={hangup} aria-label="End call">
              <Icon name="phone" size={24} />
              <span>End</span>
            </button>
          </div>
          <p className="cv-dock-hint">
            {phase === 'ringing'
              ? (ringLeft ? `Ringing… ${ringLeft}s left` : 'Waiting for the other person to answer…')
              : `${fmtDur(seconds)} · ${turnReady ? 'peer-to-peer media' : 'direct connection'}`}
          </p>
        </div>
      </div>
    </div>
  );
}

/* Mount the call surface at the document root so no ancestor transform,
   filter or overflow can trap the full-screen overlay. */
export default function CallStage(props) {
  if (typeof document === 'undefined') return null;
  return createPortal(<CallStageInner {...props} />, document.body);
}
