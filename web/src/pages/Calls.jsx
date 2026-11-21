import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { Icon, Avatar, Modal, Empty, Skeleton } from '../components/UI.jsx';
import { useCall } from '../components/CallHost.jsx';
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
  if (c.status === 'completed' || c.status === 'ended') {
    return { label: c.duration ? fmtDur(c.duration) : 'Completed', cls: 'ok', icon: 'check' };
  }
  if (c.status === 'ringing') return { label: 'Ringing', cls: 'live', icon: 'phone' };
  return { label: c.status || 'Call', cls: '', icon: 'phone' };
}

/* Who ended it, said plainly. The call log is where people go to settle "did
   they hang up on me?", so it has to answer that. */
function endLabel(c, meId) {
  const first = (c.display_name || 'They').split(' ')[0];
  const byMe = c.ended_by && c.ended_by === meId;
  if (c.status === 'missed') {
    return c.ended_reason === 'peer-offline' ? 'Caller lost connection' : 'No answer';
  }
  if (c.status === 'declined') return byMe ? 'You declined' : `${first} declined`;
  if (c.status === 'completed' || c.status === 'ended') {
    if (c.ended_reason === 'peer-offline') return byMe ? 'Your connection dropped' : `${first} lost connection`;
    if (!c.ended_by) return 'Ended';
    return byMe ? 'You ended the call' : `${first} ended the call`;
  }
  return '';
}

export default function Calls() {
  const { user, notify } = useApp();
  const [calls, setCalls] = useState(null);
  const [picking, setPicking] = useState(false);
  const [contacts, setContacts] = useState(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('audio');
  const { placeCall, previewIncoming } = useCall();
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

  /* Incoming calls are handled globally by CallHost so they ring on any page.
     Here we only need to refresh the history when a call's state changes. */
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => load();
    s.on('call:state', refresh);
    s.on('call:ended', refresh);
    s.on('call:missed', refresh);
    return () => {
      s.off('call:state', refresh);
      s.off('call:ended', refresh);
      s.off('call:missed', refresh);
    };
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
      await placeCall(peer, callType);
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
    <div className="ux-screen">
      <div className="ux-scroll">
        <header className="ux-feed-head">
          <div>
            <h1 className="ux-feed-h1">Calls</h1>
            <p className="ux-set-sub">WebRTC · encrypted in transit</p>
          </div>
          <div className="acts">
            {DEMO && (
              <button
                className="ux-round"
                title="Preview the incoming-call screen (preview build only)"
                onClick={() => {
                  const p = (contacts && contacts[0]) || { id: 'preview-peer', displayName: 'Priya Sharma', language: 'hi', avatar: null };
                  previewIncoming(p);
                }}
              >
                <Icon name="bell" size={18} />
              </button>
            )}
            <button className="ux-round blue" onClick={() => openPicker('video')} aria-label="New call">
              <Icon name="video" size={18} />
            </button>
          </div>
        </header>

        <div className="ux-calls-hero">
          <div className="glow" />
          <div className="eyebrow">AZOLVE CALLS</div>
          <h2>Talk to anyone,<br />in any language.</h2>
          <p>Audio and video negotiate peer-to-peer and fall back to a TURN relay when a direct path is blocked. Live translated captions inside calls are still in preview.</p>
          <div className="acts">
            <button className="p" onClick={() => openPicker('video')}><Icon name="video" size={16} /> Video</button>
            <button className="g" onClick={() => openPicker('audio')}><Icon name="phone" size={16} /> Audio</button>
          </div>
        </div>

        <div className="ux-calls-stats">
          <div><b>{stats.total}</b><span>calls</span></div>
          <div><b>{stats.minutes}</b><span>minutes</span></div>
          <div><b>{stats.missed}</b><span>missed</span></div>
        </div>

        <div className="ux-filters" style={{ paddingTop: 16 }}>
          {FILTERS.map(f => (
            <button key={f.id} className={`ux-filter ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>

        <p className="ux-sub">Recent calls <span>{visible?.length || 0}</span></p>

        {visible === null && (
          <div style={{ padding: '0 16px' }}>
            {[1, 2, 3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skeleton h={70} /></div>)}
          </div>
        )}
        {visible && visible.length === 0 && (
          <div className="ux-pf-empty">
            <b>No calls here yet</b>
            <p>Start a call from a chat, or use the buttons above.</p>
            <button className="ux-set-btn" style={{ marginTop: 14 }} onClick={() => openPicker('audio')}>Start a call</button>
          </div>
        )}

        <div style={{ padding: '0 4px' }}>
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
              <div key={c.id} className="ux-callrow">
                <Avatar user={{ displayName: c.display_name, avatar: c.avatar }} size={52} />
                <div className="main">
                  <b>{c.display_name || 'Unknown'}</b>
                  <small className={meta.cls === 'missed' || meta.cls === 'declined' ? 'miss' : ''}>
                    <Icon name={outgoing ? 'arrow' : 'back'} size={12} />
                    {outgoing ? 'Outgoing' : 'Incoming'} · {c.type === 'video' ? 'Video' : 'Audio'} · {timeAgo(c.started_at)}
                  </small>
                  <small>{endLabel(c, user.id) || meta.label}</small>
                </div>
                <div className="acts">
                  <button className="act a" title="Audio call" disabled={starting === peer.id} onClick={() => startCall(peer, 'audio')}>
                    <Icon name="phone" size={17} />
                  </button>
                  <button className="act v" title="Video call" disabled={starting === peer.id} onClick={() => startCall(peer, 'video')}>
                    <Icon name="video" size={17} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {picking && (
        <Modal open onClose={() => setPicking(false)} title="Start a call">
          <div className="ux-filters" style={{ padding: '0 0 12px' }}>
            <button className={`ux-filter ${type === 'audio' ? 'on' : ''}`} onClick={() => setType('audio')}>
              <Icon name="phone" size={14} /> Audio
            </button>
            <button className={`ux-filter ${type === 'video' ? 'on' : ''}`} onClick={() => setType('video')}>
              <Icon name="video" size={14} /> Video
            </button>
          </div>

          <div className="ux-search" style={{ marginBottom: 10 }}>
            <Icon name="search" size={16} className="sl" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people…" autoFocus />
          </div>

          <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {filteredContacts === null && [1, 2, 3].map(i => <div key={i} style={{ marginBottom: 6 }}><Skeleton h={58} /></div>)}
            {filteredContacts && filteredContacts.length === 0 && (
              <p className="ux-pf-note">No contacts found. Start a chat first.</p>
            )}
            {filteredContacts && filteredContacts.map(p => (
              <button key={p.id} className="ux-person" onClick={() => startCall(p, type)} disabled={starting === p.id}>
                <Avatar user={p} size={44} showStatus online={p.online} />
                <span className="ux-person-main">
                  <b>{p.displayName}</b>
                  <small>@{p.username} · speaks {langOf(p.language || 'en').native}</small>
                </span>
                <span className="ux-tiny primary">
                  <Icon name={type === 'video' ? 'video' : 'phone'} size={14} />
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
