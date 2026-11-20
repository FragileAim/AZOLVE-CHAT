import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Empty, Skeleton, Verified, Seg, Modal } from '../components/UI.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { timeAgo } from '../lib/utils.js';
import { langOf } from '../lib/i18n.js';

/* ===========================================================================
   People — the request gate, made visible.

   Everyone on AZOLVE CHAT is discoverable here. Talking is what needs consent:
   you send a request, they accept, and only then do chats and calls open.
   ========================================================================= */

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
  const [q, setQ] = useState('');
  const [people, setPeople] = useState(null);
  const [reqs, setReqs] = useState({ incoming: [], outgoing: [] });
  const [busyId, setBusyId] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');
  const reqRef = useRef(null);

  const loadPeople = useCallback(async (query) => {
    try {
      const d = await API.directory(query || '', 60);
      setPeople(d.users || []);
    } catch (e) { notify(e.message, 'err'); setPeople([]); }
  }, [notify]);

  const loadReqs = useCallback(async () => {
    try { setReqs(await API.contactRequests()); } catch { }
  }, []);

  useEffect(() => { loadPeople(''); loadReqs(); }, [loadPeople, loadReqs]);

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

  return (
    <div className="page page-wide people-page">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">Everyone is visible. Conversations open once a request is accepted.</p>
        </div>
        <Seg
          options={[
            { id: 'everyone', label: `Everyone${people ? ` · ${people.length}` : ''}` },
            { id: 'requests', label: incomingCount ? `Requests · ${incomingCount}` : 'Requests' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'requests' ? (
        <div className="people-grid">
          <section className="card">
            <h3><Icon name="bell" size={16} /> Waiting for you {incomingCount > 0 && <span className="count-dot">{incomingCount}</span>}</h3>
            {incomingCount === 0 && (
              <p className="muted" style={{ padding: '10px 0' }}>No incoming requests right now.</p>
            )}
            <div className="req-list">
              {(reqs.incoming || []).map(r => (
                <div key={r.requestId} className="req-row">
                  <button className="req-who" onClick={() => navigate('profile', r.user.username)}>
                    <Avatar user={r.user} size={44} showStatus online={r.user.online} />
                    <span>
                      <b>{r.user.displayName} {r.user.verified && <Verified size={12} />}</b>
                      <small>@{r.user.username} · {r.user.country || 'Global'} · {timeAgo(r.requestedAt)}</small>
                      {r.note && <em className="req-note">“{r.note}”</em>}
                    </span>
                  </button>
                  <div className="req-actions">
                    <button className="btn tiny primary" disabled={busyId === r.requestId} onClick={() => respond(r, 'accept')}>Accept</button>
                    <button className="btn tiny ghost" disabled={busyId === r.requestId} onClick={() => respond(r, 'decline')}>Decline</button>
                    <button className="icon-btn" title="Block" disabled={busyId === r.requestId} onClick={() => respond(r, 'block')}><Icon name="shield" size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3><Icon name="send" size={16} /> Sent by you</h3>
            {(reqs.outgoing || []).length === 0 && (
              <p className="muted" style={{ padding: '10px 0' }}>You have no pending requests.</p>
            )}
            <div className="req-list">
              {(reqs.outgoing || []).map(r => (
                <div key={r.requestId} className="req-row">
                  <button className="req-who" onClick={() => navigate('profile', r.user.username)}>
                    <Avatar user={r.user} size={44} />
                    <span>
                      <b>{r.user.displayName}</b>
                      <small>@{r.user.username} · sent {timeAgo(r.requestedAt)}</small>
                    </span>
                  </button>
                  <div className="req-actions">
                    <span className="rel-pill">Pending</span>
                    <button className="btn tiny ghost" disabled={busyId === r.requestId} onClick={() => cancel(r)}>Cancel</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="explore-search" style={{ marginBottom: 16 }}>
            <Icon name="search" size={18} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search everyone by name, @username, country…" />
            {q && <button className="icon-btn" onClick={() => setQ('')}><Icon name="close" size={16} /></button>}
          </div>

          {people === null && <div className="people-grid">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={92} />)}</div>}

          {people && people.length === 0 && (
            <Empty icon="users" title="Nobody matched" text="Try a different name or username." />
          )}

          {contacts.length > 0 && (
            <section className="people-section">
              <h3 className="ps-title">Your contacts <span className="muted">· {contacts.length}</span></h3>
              <div className="people-grid">
                {contacts.map(u => (
                  <div key={u.id} className="person-card">
                    <button className="pc-main" onClick={() => navigate('profile', u.username)}>
                      <Avatar user={u} size={46} showStatus online={u.online} />
                      <span>
                        <b>{u.displayName} {u.verified && <Verified size={12} />}</b>
                        <small>@{u.username} · {langOf(u.language).label}</small>
                      </span>
                    </button>
                    <div className="pc-actions">
                      <button className="btn tiny primary" disabled={busyId === u.id} onClick={() => openChat(u)}><Icon name="chat" size={13} /> Message</button>
                      <button className="icon-btn" title="View profile" onClick={() => navigate('profile', u.username)}><Icon name="arrow" size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {people && people.length > 0 && (
            <section className="people-section">
              <h3 className="ps-title">{q.trim() ? 'Search results' : 'Discover people'} <span className="muted">· {others.length}</span></h3>
              {others.length === 0 && <p className="muted">You are connected with everyone here.</p>}
              <div className="people-grid">
                {others.map(u => (
                  <div key={u.id} className="person-card">
                    <button className="pc-main" onClick={() => navigate('profile', u.username)}>
                      <Avatar user={u} size={46} showStatus online={u.online} />
                      <span>
                        <b>{u.displayName} {u.verified && <Verified size={12} />}</b>
                        <small>@{u.username} · {u.country || 'Global'}</small>
                      </span>
                    </button>
                    <div className="pc-actions">
                      {u.contactState === 'pending_in' ? (
                        <button className="btn tiny primary" disabled={busyId === u.id}
                          onClick={async () => {
                            const d = await API.contactRequests().catch(() => ({ incoming: [] }));
                            const r = (d.incoming || []).find(x => x.user.id === u.id);
                            if (r) respond(r, 'accept'); else sendRequest(u);
                          }}>Accept</button>
                      ) : u.contactState === 'pending_out' ? (
                        <StatePill state="pending_out" />
                      ) : u.contactState === 'blocked' ? (
                        <StatePill state="blocked" />
                      ) : (
                        <>
                          <button className="btn tiny ghost" disabled={busyId === u.id} onClick={() => { setNoteFor(u); setNote(''); }}>Send request</button>
                          <button className="icon-btn" title="View profile" onClick={() => navigate('profile', u.username)}><Icon name="arrow" size={15} /></button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

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
