import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { Icon, Avatar, Modal, Empty, Skeleton } from '../components/UI.jsx';
import CallStage from '../components/CallStage.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { timeAgo } from '../lib/utils.js';
import { fmtDur } from '../lib/callkit.js';
import { langOf } from '../lib/i18n.js';

const DEMO = import.meta.env.VITE_DEMO === '1';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'missed', label: 'Missed' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
];

function statusMeta(c) {
  if (c.status === 'missed') return { label: 'Missed', cls: 'missed', icon: 'phone' };
  if (c.status === 'declined') return { label: 'Declined', cls: 'declined', icon: 'close' };
  if (c.status === 'completed') return { label: c.duration ? fmtDur(c.duration) : 'Completed', cls: 'ok', icon: 'check' };
  if (c.status === 'ringing') return { label: 'Ringing', cls: 'live', icon: 'phone' };
  return { label: c.status || 'Call', cls: '', icon: 'phone' };
}

export default function Calls() {
  const { user, notify } = useApp();
  const [calls, setCalls] = useState(null);
  const [picking, setPicking] = useState(false);
  const [contacts, setContacts] = useState(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('audio');
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState('all');
  const [starting, setStarting] = useState(null);

  const load = async () => {
    try {
      const r = await API.calls();
      setCalls(r.calls || []);
    } catch (e) {
      notify(e.message, 'err');
      setCalls([]);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onIncoming = (p) => {
      setActive({
        callId: p.callId,
        peer: p.from,
        type: p.type,
        incoming: true,
        conversationId: p.conversationId,
      });
    };
    s.on('call:incoming', onIncoming);
    return () => s.off('call:incoming', onIncoming);
  }, []);

  const openPicker = async (kind) => {
    setType(kind || type);
    setPicking(true);
    setQuery('');
    if (contacts) return;
    try {
      const r = await API.chats();
      const people = [];
      (r.conversations || []).forEach(c => {
        (c.participants || []).forEach(p => {
          if (p.id !== user.id && !people.find(x => x.id === p.id)) people.push(p);
        });
      });
      setContacts(people);
    } catch {
      setContacts([]);
    }
  };

  const startCall = async (peer, callType) => {
    setPicking(false);
    setStarting(peer.id);
    try {
      const r = await API.logCall({ calleeId: peer.id, type: callType, status: 'ringing' });
      setActive({ callId: r.callId, peer, type: callType, incoming: false });
      getSocket()?.emit('call:invite', {
        to: peer.id,
        callId: r.callId,
        type: callType,
        from: { id: user.id, displayName: user.displayName, avatar: user.avatar, language: user.language },
      });
      load();
    } catch (e) {
      notify(e.message, 'err');
    } finally {
      setStarting(null);
    }
  };

  const visible = useMemo(() => {
    if (!calls) return null;
    if (filter === 'all') return calls;
    if (filter === 'missed') return calls.filter(c => c.status === 'missed' || c.status === 'declined');
    return calls.filter(c => c.type === filter);
  }, [calls, filter]);

  const filteredContacts = useMemo(() => {
    if (!contacts) return null;
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(p =>
      (p.displayName || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
  }, [contacts, query]);

  const stats = useMemo(() => {
    const list = calls || [];
    return {
      total: list.length,
      missed: list.filter(c => c.status === 'missed').length,
      minutes: Math.round(list.reduce((s, c) => s + (c.duration || 0), 0) / 60),
    };
  }, [calls]);

  return (
    <div className="page page-wide calls-page">
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p className="muted">Crystal-clear audio and video over WebRTC, encrypted in transit, with TURN relay when a direct path is blocked.</p>
        </div>
        <div className="row-gap">
          {DEMO && (
            <button
              className="btn ghost"
              title="Preview the incoming-call screen (preview build only)"
              onClick={() => {
                const p = (contacts && contacts[0]) || { id: 'preview-peer', displayName: 'Priya Sharma', language: 'hi', avatar: null };
                setActive({ callId: 'preview-incoming', peer: p, type: 'video', incoming: true });
              }}
            >
              <Icon name="phone" size={16} /> Preview incoming
            </button>
          )}
          <button className="btn primary" onClick={() => openPicker('video')}>
            <Icon name="video" size={17} /> New call
          </button>
        </div>
      </div>

      {/* hero */}
      <div className="cv-hero">
        <div className="cv-hero-glow" aria-hidden />
        <div className="cv-hero-body">
          <span className="cv-hero-eyebrow"><i /> WebRTC · DTLS-SRTP encrypted media</span>
          <h2>Talk to anyone, in any language.</h2>
          <p>
            Audio and video are negotiated peer-to-peer and fall back to a TURN relay when a
            direct path is blocked, so a call across four time zones still connects. Live
            translated captions inside calls are not built yet — text translation in chats is.
          </p>
          <div className="cv-hero-actions">
            <button className="cv-hero-btn primary" onClick={() => openPicker('video')}>
              <span className="cv-hero-ic"><Icon name="video" size={19} /></span>
              <span><b>Video call</b><small>Face to face</small></span>
            </button>
            <button className="cv-hero-btn" onClick={() => openPicker('audio')}>
              <span className="cv-hero-ic"><Icon name="phone" size={19} /></span>
              <span><b>Audio call</b><small>Voice only</small></span>
            </button>
          </div>
        </div>
        <div className="cv-hero-stats">
          <div><b>{stats.total}</b><small>calls</small></div>
          <div><b>{stats.minutes}</b><small>minutes</small></div>
          <div><b>{stats.missed}</b><small>missed</small></div>
        </div>
      </div>

      {/* recent */}
      <div className="card cv-recent">
        <div className="cv-recent-head">
          <h3>Recent calls</h3>
          <div className="cv-filters">
            {FILTERS.map(f => (
              <button key={f.id} className={`cv-filter ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {visible === null && [1, 2, 3].map(i => <Skeleton key={i} h={62} style={{ marginBottom: 8 }} />)}
        {visible && visible.length === 0 && (
          <Empty icon="phone" title="No calls here yet" text="Start a call from a chat, or use the buttons above." />
        )}

        <div className="cv-list">
          {visible && visible.map(c => {
            const meta = statusMeta(c);
            const peer = {
              id: c.callee_id || c.caller_id,
              displayName: c.display_name,
              avatar: c.avatar,
              username: c.username,
              language: c.language,
            };
            const outgoing = c.direction === 'outgoing';
            return (
              <div key={c.id} className="cv-row">
                <Avatar user={{ displayName: c.display_name, avatar: c.avatar }} size={46} />
                <div className="cv-row-main">
                  <div className="cv-row-top">
                    <b>{c.display_name || 'Unknown'}</b>
                    <span className={`cv-badge ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <small className="cv-row-sub">
                    <Icon name={outgoing ? 'arrow' : 'back'} size={12} />
                    {outgoing ? 'Outgoing' : 'Incoming'} · {c.type === 'video' ? 'Video' : 'Audio'} · {timeAgo(c.started_at)}
                  </small>
                </div>
                <div className="cv-row-actions">
                  <button
                    className="cv-round"
                    title="Audio call"
                    disabled={starting === peer.id}
                    onClick={() => startCall(peer, 'audio')}
                  >
                    <Icon name="phone" size={17} />
                  </button>
                  <button
                    className="cv-round accent"
                    title="Video call"
                    disabled={starting === peer.id}
                    onClick={() => startCall(peer, 'video')}
                  >
                    <Icon name="video" size={17} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* picker */}
      {picking && (
        <Modal open onClose={() => setPicking(false)} title="Start a call">
          <div className="cv-pick-type">
            <button className={`cv-pick-opt ${type === 'audio' ? 'on' : ''}`} onClick={() => setType('audio')}>
              <Icon name="phone" size={17} /> Audio
            </button>
            <button className={`cv-pick-opt ${type === 'video' ? 'on' : ''}`} onClick={() => setType('video')}>
              <Icon name="video" size={17} /> Video
            </button>
          </div>

          <label className="cv-search">
            <Icon name="search" size={16} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people…" autoFocus />
          </label>

          <div className="cv-contacts">
            {filteredContacts === null && [1, 2, 3].map(i => <Skeleton key={i} h={52} style={{ marginBottom: 6 }} />)}
            {filteredContacts && filteredContacts.length === 0 && (
              <p className="muted small" style={{ padding: '14px 4px' }}>No contacts found. Start a chat first.</p>
            )}
            {filteredContacts && filteredContacts.map(p => (
              <button key={p.id} className="cv-contact" onClick={() => startCall(p, type)} disabled={starting === p.id}>
                <Avatar user={p} size={42} showStatus online={p.online} />
                <span className="cv-contact-main">
                  <b>{p.displayName}</b>
                  <small>@{p.username} · speaks {langOf(p.language || 'en').native}</small>
                </span>
                <span className="cv-contact-go">
                  <Icon name={type === 'video' ? 'video' : 'phone'} size={16} />
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {active && (
        <CallStage
          call={active}
          onClose={() => { setActive(null); load(); }}
          onRedial={() => {
            const peer = active.peer;
            const kind = active.type;
            setActive(null);
            if (peer?.id) startCall(peer, kind);
          }}
        />
      )}
    </div>
  );
}
