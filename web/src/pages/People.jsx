import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Empty, Skeleton, Verified, Modal } from '../components/UI.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { timeAgo } from '../lib/utils.js';
import { langOf } from '../lib/i18n.js';

/* ===========================================================================
   Discover — the request gate, made visible.

   Everyone on AZOLVE CHAT is discoverable here. Talking is what needs consent:
   you send a request, they accept, and only then do chats and calls open.
   ========================================================================= */

const CATEGORIES = [
  { id: 'for-you', label: '✨ For you' },
  { id: 'music', label: '🎵 Music' },
  { id: 'travel', label: '✈️ Travel' },
  { id: 'food', label: '🍜 Food' },
  { id: 'gaming', label: '🎮 Gaming' },
];

const TAGS = [
  { label: '#goldenhour', tone: 'blue' },
  { label: '#streetfood', tone: 'amber' },
  { label: '#learnhindi', tone: 'green' },
  { label: '#monsoon', tone: 'grey' },
];

function StatePill({ state }) {
  if (state === 'contact') return <span className="rel-pill ok"><Icon name="check" size={12} /> Connected</span>;
  if (state === 'pending_out') return <span className="rel-pill">Request sent</span>;
  if (state === 'pending_in') return <span className="rel-pill warm">Wants to connect</span>;
  if (state === 'blocked') return <span className="rel-pill">Blocked</span>;
  return null;
}

export default function People() {
  const { user, notify } = useApp();
  const [tab, setTab] = useState('everyone');
  const [cat, setCat] = useState('for-you');
  /* Read inside loadPeople without making it a dependency, so switching a
     category refetches once instead of rebuilding the callback every render. */
  const catRef = useRef('for-you');
  const [q, setQ] = useState('');
  const [people, setPeople] = useState(null);
  const [reqs, setReqs] = useState({ incoming: [], outgoing: [] });
  const [busyId, setBusyId] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');
  const reqRef = useRef(null);

  const loadPeople = useCallback(async (query) => {
    try {
      const d = await API.directory(query || '', 60, catRef.current);
      setPeople(d.users || []);
    } catch (e) { notify(e.message, 'err'); setPeople([]); }
  }, [notify]);

  const loadReqs = useCallback(async () => {
    try { setReqs(await API.contactRequests()); } catch { }
  }, []);

  useEffect(() => { loadPeople(''); loadReqs(); }, [loadPeople, loadReqs]);

  /* Switching category really refetches — the chips used to only move the
     highlight and leave the list untouched. */
  useEffect(() => {
    catRef.current = cat;
    loadPeople(q.trim());
  }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Search is debounced so typing does not hammer the API. */
  useEffect(() => {
    const t = setTimeout(() => loadPeople(q.trim()), q.trim() ? 280 : 0);
    return () => clearTimeout(t);
  }, [q, loadPeople]);

  /* Live: a request arriving while you are in the app shows up immediately. */
  useEffect(() => {
    const s = getSocket(); if (!s) return;
    const onReq = (p) => {
      notify(`${p?.from?.displayName || 'Someone'} wants to connect with you`, 'ok');
      loadReqs();
      loadPeople(q.trim());
    };
    const onAcc = (p) => {
      notify(`${p?.user?.displayName || 'Someone'} accepted your request — you can chat now`, 'ok');
      loadReqs();
      loadPeople(q.trim());
    };
    s.on('contact:request', onReq);
    s.on('contact:accepted', onAcc);
    return () => { s.off('contact:request', onReq); s.off('contact:accepted', onAcc); };
  }, [notify, loadReqs, loadPeople, q]);

  const incomingCount = reqs.incoming?.length || 0;

  const sendRequest = async (u, text) => {
    setBusyId(u.id);
    try {
      const d = await API.requestContact(u.id, text || '');
      notify(d.message || `Request sent to ${u.displayName}.`, 'ok');
      setPeople(ps => (ps || []).map(p => p.id === u.id ? { ...p, contactState: d.state || 'pending_out' } : p));
      setNoteFor(null); setNote('');
      loadReqs();
      window.dispatchEvent(new Event('azolve:badges'));
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusyId(null); }
  };

  const respond = async (r, action) => {
    setBusyId(r.requestId);
    try {
      await API.respondContact(r.requestId, action);
      notify(action === 'accept'
        ? `You and ${r.user.displayName} are now contacts.`
        : action === 'block' ? `${r.user.displayName} was blocked.` : 'Request declined.', 'ok');
      setReqs(x => ({ ...x, incoming: x.incoming.filter(i => i.requestId !== r.requestId) }));
      window.dispatchEvent(new Event('azolve:badges'));
      setPeople(ps => (ps || []).map(p => p.id === r.user.id
        ? { ...p, contactState: action === 'accept' ? 'contact' : action === 'block' ? 'blocked' : 'none' } : p));
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusyId(null); }
  };

  const cancel = async (r) => {
    setBusyId(r.requestId);
    try {
      await API.cancelContactRequest(r.requestId);
      notify('Request cancelled.', 'ok');
      setReqs(x => ({ ...x, outgoing: x.outgoing.filter(i => i.requestId !== r.requestId) }));
      window.dispatchEvent(new Event('azolve:badges'));
      setPeople(ps => (ps || []).map(p => p.id === r.user.id ? { ...p, contactState: 'none' } : p));
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusyId(null); }
  };

  const openChat = async (u) => {
    setBusyId(u.id);
    try { const d = await API.startDm(u.id); navigate('chats', d.conversation.id); }
    catch (e) { notify(e.message, 'err'); }
    finally { setBusyId(null); }
  };

  const contacts = useMemo(() => (people || []).filter(p => p.contactState === 'contact'), [people]);
  const others = useMemo(() => (people || []).filter(p => p.contactState !== 'contact'), [people]);

  /* Creators row: the most-followed people we can actually see. */
  const creators = useMemo(
    () => [...(people || [])].sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0)).slice(0, 6),
    [people]
  );

  return (
    <div className="ux-screen">
      <div className="ux-scroll">

        <header className="ux-pad ux-dc-head">
          <h1 className="ux-h1">Discover</h1>
          <div className="ux-search lg">
            <Icon name="search" size={16} className="sl" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search creators, tags, communities" />
            {q
              ? <button type="button" className="ux-search-x" onClick={() => setQ('')} aria-label="Clear search"><Icon name="close" size={16} /></button>
              : <Icon name="sliders" size={18} className="sl" />}
          </div>
        </header>

        <div className="ux-cats">
          {CATEGORIES.map(c => (
            <button key={c.id} type="button"
              className={`ux-cat${cat === c.id ? ' on' : ''}`}
              onClick={() => setCat(c.id)}>{c.label}</button>
          ))}
        </div>

        {tab === 'requests' ? (
          <>
            <div className="ux-sub">Requests <span>{incomingCount} waiting</span></div>

            <div className="ux-people-list">
              {(reqs.incoming || []).map(r => (
                <div key={r.requestId} className="ux-person">
                  <button type="button" className="ux-person-main" onClick={() => navigate('profile', r.user.username)}>
                    <Avatar user={r.user} size={44} showStatus online={r.user.online} />
                    <span>
                      <b>{r.user.displayName} {r.user.verified && <Verified size={12} />}</b>
                      <small>@{r.user.username} · {r.user.country || 'Global'} · {timeAgo(r.requestedAt)}</small>
                      {r.note && <em className="req-note">“{r.note}”</em>}
                    </span>
                  </button>
                  <div className="ux-person-acts">
                    <button type="button" className="ux-tiny primary" disabled={busyId === r.requestId} onClick={() => respond(r, 'accept')}>Accept</button>
                    <button type="button" className="ux-tiny ghost" disabled={busyId === r.requestId} onClick={() => respond(r, 'decline')}>Decline</button>
                  </div>
                </div>
              ))}
              {incomingCount === 0 && (
                <div className="ux-pf-empty"><b>Nothing waiting</b>No incoming requests right now.</div>
              )}
            </div>

            <div className="ux-sub">Sent by you</div>
            <div className="ux-people-list">
              {(reqs.outgoing || []).map(r => (
                <div key={r.requestId} className="ux-person">
                  <button type="button" className="ux-person-main" onClick={() => navigate('profile', r.user.username)}>
                    <Avatar user={r.user} size={44} />
                    <span>
                      <b>{r.user.displayName}</b>
                      <small>@{r.user.username} · sent {timeAgo(r.requestedAt)}</small>
                    </span>
                  </button>
                  <div className="ux-person-acts">
                    <button type="button" className="ux-tiny ghost" disabled={busyId === r.requestId} onClick={() => cancel(r)}>Cancel</button>
                  </div>
                </div>
              ))}
              {(reqs.outgoing || []).length === 0 && (
                <div className="ux-pf-empty"><b>All clear</b>You have no pending requests.</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="ux-trend">
              <b>Trending now</b>
              <div className="ux-tagrow">
                {TAGS.map(t => (
                  <button key={t.label} type="button" className={`ux-tagc ${t.tone}`}
                    onClick={() => setQ(t.label.replace('#', ''))}>{t.label}</button>
                ))}
              </div>
            </div>

            {creators.length > 0 && (
              <div className="ux-creators">
                <div className="hd">
                  <b>Popular creators</b>
                  <button type="button" onClick={() => setTab('requests')}>Requests{incomingCount ? ` · ${incomingCount}` : ''}</button>
                </div>
                <div className="row">
                  {creators.map(u => (
                    <button key={u.id} type="button" className="ux-creator" onClick={() => navigate('profile', u.username)}>
                      <Avatar user={u} size={64} />
                      <p>{u.displayName.split(' ')[0]}</p>
                      <small>{u.followersCount ? `${u.followersCount} followers` : (u.country || 'Global')}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button type="button" className="ux-comm-card" onClick={() => navigate('communities')}>
              <span className="ux-comm-ic"><Icon name="globe" size={24} /></span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <b>Communities for you</b>
                <small>Join a room and talk across languages</small>
              </span>
              <span className="ux-tiny ghost">Open</span>
            </button>

            <div className="ux-sub">
              {q.trim() ? 'Search results' : 'Discover people'}
              <span>{q.trim() ? `${others.length} found` : `${others.length} nearby`}</span>
            </div>

            {people === null && (
              <div className="ux-people-list">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={72} />)}</div>
            )}

            {people && people.length === 0 && (
              <Empty icon="users" title="Nobody matched" text="Try a different name or username." />
            )}

            <div className="ux-people-list">
              {others.map(u => (
                <div key={u.id} className="ux-person">
                  <button type="button" className="ux-person-main" onClick={() => navigate('profile', u.username)}>
                    <Avatar user={u} size={44} showStatus online={u.online} />
                    <span>
                      <b>{u.displayName} {u.verified && <Verified size={12} />}</b>
                      <small>@{u.username} · {u.country || 'Global'} · {langOf(u.language).label}</small>
                    </span>
                  </button>
                  <div className="ux-person-acts">
                    {u.contactState === 'pending_in' ? (
                      <button type="button" className="ux-tiny primary" disabled={busyId === u.id}
                        onClick={async () => {
                          const d = await API.contactRequests().catch(() => ({ incoming: [] }));
                          const r = (d.incoming || []).find(x => x.user.id === u.id);
                          if (r) respond(r, 'accept'); else sendRequest(u);
                        }}>Accept</button>
                    ) : u.contactState === 'pending_out' || u.contactState === 'blocked' ? (
                      <StatePill state={u.contactState} />
                    ) : (
                      <button type="button" className="ux-tiny ghost" disabled={busyId === u.id}
                        onClick={() => { setNoteFor(u); setNote(''); }}>Connect</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {contacts.length > 0 && (
              <>
                <div className="ux-sub">Your contacts <span>{contacts.length}</span></div>
                <div className="ux-people-list">
                  {contacts.map(u => (
                    <div key={u.id} className="ux-person">
                      <button type="button" className="ux-person-main" onClick={() => navigate('profile', u.username)}>
                        <Avatar user={u} size={44} showStatus online={u.online} />
                        <span>
                          <b>{u.displayName} {u.verified && <Verified size={12} />}</b>
                          <small>@{u.username} · {langOf(u.language).label}</small>
                        </span>
                      </button>
                      <div className="ux-person-acts">
                        <button type="button" className="ux-tiny primary" disabled={busyId === u.id} onClick={() => openChat(u)}>Message</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div style={{ height: 8 }} />
      </div>

      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title={noteFor ? `Connect with ${noteFor.displayName}` : ''}>
        <p className="muted" style={{ marginTop: 0 }}>
          They will see your request. Once they accept, you can chat and call freely.
        </p>
        <label className="field">
          <span>Add a note (optional)</span>
          <textarea className="input" rows={3} maxLength={200} value={note}
            onChange={e => setNote(e.target.value)} placeholder="Hi! We met at the founders meetup in Ahmedabad." />
        </label>
        <div className="row-end" style={{ gap: 10, marginTop: 14 }}>
          <button className="btn ghost" onClick={() => setNoteFor(null)}>Cancel</button>
          <button className="btn primary" disabled={busyId === noteFor?.id} onClick={() => noteFor && sendRequest(noteFor, note)}>
            {busyId === noteFor?.id ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
