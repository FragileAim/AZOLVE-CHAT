import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Modal, Empty, Skeleton, Verified } from '../components/UI.jsx';
import { API, uploadFile } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { LANGS, langOf } from '../lib/i18n.js';

function EditProfile({ user, onClose, onSaved }) {
  const { notify } = useApp();
  const [form, setForm] = useState({
    displayName: user.displayName || '', username: user.username || '', bio: user.bio || '',
    country: user.country || '', language: user.language || 'en', mood: user.mood || '',
    dob: user.dob || '', isPrivate: !!user.isPrivate, avatar: user.avatar || '', cover: user.cover || '',
  });
  const [busy, setBusy] = useState(false);
  const avRef = useRef(null); const covRef = useRef(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const upload = async (file, key) => {
    try { const r = await uploadFile(file); set(key, r.url); } catch (e) { notify(e.message, 'err'); }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await API.updateMe(form);
      notify('Profile updated', 'ok');
      onSaved();
      onClose();
    } catch (err) { notify(err.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Edit profile" wide>
      <form className="stack" onSubmit={save}>
        <div className="edit-media">
          <div className="em-cover" style={form.cover ? { backgroundImage: `url(${form.cover})` } : {}}>
            <button type="button" className="btn ghost btn-sm" onClick={() => covRef.current?.click()}>Change cover</button>
            <input ref={covRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && upload(e.target.files[0], 'cover')} />
          </div>
          <div className="em-avatar">
            <Avatar user={{ ...user, avatar: form.avatar }} size={76} />
            <button type="button" className="btn ghost btn-sm" onClick={() => avRef.current?.click()}>Change photo</button>
            <input ref={avRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && upload(e.target.files[0], 'avatar')} />
          </div>
        </div>
        <div className="field-row">
          <label className="field"><span>Display name</span><input value={form.displayName} onChange={e => set('displayName', e.target.value)} /></label>
          <label className="field"><span>Username</span><input value={form.username} onChange={e => set('username', e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())} /></label>
        </div>
        <label className="field"><span>Bio</span><textarea rows={3} value={form.bio} onChange={e => set('bio', e.target.value)} maxLength={160} /></label>
        <div className="field-row">
          <label className="field"><span>Country</span><input value={form.country} onChange={e => set('country', e.target.value.toUpperCase().slice(0, 2))} placeholder="US" /></label>
          <label className="field"><span>Date of birth</span><input type="date" value={form.dob} onChange={e => set('dob', e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Display language</span>
            <select value={form.language} onChange={e => set('language', e.target.value)}>
              {LANGS.map(l => <option key={l.code} value={l.code}>{l.label} — {l.native}</option>)}
            </select>
          </label>
          <label className="field"><span>Mood</span><input value={form.mood} onChange={e => set('mood', e.target.value)} placeholder="🎧 Focused" /></label>
        </div>
        <label className="switch-row"><span>Private profile<small>Only followers can see your posts</small></span>
          <input type="checkbox" checked={form.isPrivate} onChange={e => set('isPrivate', e.target.checked)} />
        </label>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>
    </Modal>
  );
}

function ReportModal({ user, onClose }) {
  const { notify } = useApp();
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await API.report(user.id, { reason, details }); notify('Report submitted — our team will review', 'ok'); onClose(); }
    catch (err) { notify(err.message, 'err'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Report @${user.username}`}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Reason</span>
          <select value={reason} onChange={e => setReason(e.target.value)}>
            <option value="spam">Spam</option><option value="harassment">Harassment</option>
            <option value="hate">Hate speech</option><option value="impersonation">Impersonation</option>
            <option value="scam">Scam / fraud</option><option value="other">Other</option>
          </select>
        </label>
        <label className="field"><span>Details</span><textarea rows={3} value={details} onChange={e => setDetails(e.target.value)} placeholder="What happened?" /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</button>
      </form>
    </Modal>
  );
}

export default function Profile() {
  const { user: me, route, notify, refreshMe, logout } = useApp();
  const username = route.param || me.username;
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('posts');
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);

  const load = async () => {
    try { const r = await API.profile(username); setData(r); }
    catch (e) { notify(e.message, 'err'); setData({ error: e.message }); }
  };
  useEffect(() => { setData(null); load(); }, [username]);

  if (!data) return <div className="page page-wide"><Skeleton h={220} /><Skeleton h={300} style={{ marginTop: 16 }} /></div>;
  if (data.error) return <div className="page"><Empty icon="warning" title="Profile unavailable" text={data.error} /></div>;

  const { user, counts, isFollowing, followsYou, blocked, canView, posts, moments, mutual } = data;
  const relation = data.contactState || 'none';
  const isMe = user.id === me.id;

  const follow = async () => {
    setBusy(true);
    try {
      const r = await API.follow(user.id);
      notify(r.following ? `Following ${user.displayName}` : 'Unfollowed', 'ok');
      load();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const block = async () => {
    if (!confirm(`Block @${user.username}?`)) return;
    try { await API.block(user.id); notify('User blocked', 'ok'); load(); } catch (e) { notify(e.message, 'err'); }
  };
  const message = async () => {
    try { const r = await API.startDm(user.id); navigate('chats', r.conversation.id); }
    catch (e) { notify(e.message, 'err'); }
  };

  /* Connection flow. Nothing opens until both sides agree. */
  const askContact = async () => {
    setBusy(true);
    try {
      const r = await API.requestContact(user.id);
      notify(r.message || 'Request sent', 'ok');
      load();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const acceptContact = async () => {
    setBusy(true);
    try {
      const r = await API.contactRequests();
      const mine = r.incoming.find(x => x.user.id === user.id);
      if (!mine) { notify('That request is no longer available.', 'err'); load(); return; }
      await API.respondContact(mine.requestId, 'accept');
      notify(`You and ${user.displayName} are now contacts.`, 'ok');
      load();
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const doLogout = async () => {
    if (!confirm('Log out of AZOLVE CHAT on this device?')) return;
    await logout();
  };

  const shareProfile = async () => {
    const url = `${location.origin}/#/profile/${user.username}`;
    try {
      if (navigator.share) { await navigator.share({ title: user.displayName, url }); return; }
    } catch { return; /* person dismissed the share sheet */ }
    try {
      await navigator.clipboard.writeText(url);
      notify('Profile link copied', 'ok');
    } catch {
      /* Clipboard needs a secure context and permission. Never fail silently —
         show the link so it can still be copied by hand. */
      notify(`Copy this link: ${url}`, 'ok');
    }
  };

  return (
    <div className="ux-screen pf">
      <div className="ux-scroll">
        <div className="ux-pf-cover">
          {user.cover
            ? <img src={user.cover} alt="" />
            : <div className="ux-pf-cover-fallback" />}
          <div className="ux-pf-coverbar">
            <button
              className="ux-glass-btn"
              aria-label="Back"
              onClick={() => (window.history.length > 1 ? window.history.back() : navigate('chats'))}
            >
              <Icon name="back" size={18} />
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ux-glass-btn" aria-label="Share profile" onClick={shareProfile}>
                <Icon name="link" size={17} />
              </button>
              {isMe
                ? <button className="ux-glass-btn" aria-label="Settings" onClick={() => navigate('settings')}><Icon name="settings" size={17} /></button>
                : <button className="ux-glass-btn" aria-label="More" onClick={() => setSheet(true)}><Icon name="more" size={17} /></button>}
            </div>
          </div>
        </div>

        <div className="ux-pf-body">
          <div className="ux-pf-avatar">
            <Avatar user={user} size={84} />
          </div>

          <h1 className="ux-pf-name">
            {user.displayName}
            {user.verified && <Verified size={18} />}
          </h1>
          <p className="ux-pf-handle">
            @{user.username}
            {followsYou && !isMe ? ' · Follows you' : ''}
            {user.online && !isMe ? ' · online' : ''}
          </p>
          {user.bio && <p className="ux-pf-bio">{user.bio}</p>}

          <div className="ux-pf-tags">
            <span className="ux-tag lang">
              <Icon name="translate" size={13} />
              {langOf(user.language)?.native || user.language}
              {langOf(user.language)?.code && langOf(user.language).code !== 'en' ? ' · English' : ''}
            </span>
            <span className="ux-tag ok">
              <Icon name={user.private ? 'lock' : 'globe'} size={12} />
              {user.private ? 'Private' : 'Public'}
            </span>
          </div>

          <div className="ux-pf-stats">
            <div><b>{counts.posts}</b><span>Posts</span></div>
            <div className="mid"><b>{counts.followers}</b><span>Followers</span></div>
            <div><b>{counts.following}</b><span>Following</span></div>
          </div>

          <div className="ux-pf-actions">
            {isMe ? (
              <>
                <button className="ux-pf-btn primary" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> Edit profile</button>
                <button className="ux-pf-btn ghost" onClick={() => navigate('settings')}><Icon name="settings" size={16} /> Settings</button>
                <button className="ux-pf-btn ghost sq" onClick={doLogout} title="Log out" aria-label="Log out"><Icon name="logout" size={17} /></button>
              </>
            ) : relation === 'contact' ? (
              <>
                <button className="ux-pf-btn primary" onClick={message}><Icon name="chat" size={16} /> Message</button>
                <button className="ux-pf-btn ghost" onClick={() => navigate('calls')}><Icon name="phone" size={16} /> Call</button>
                <button className="ux-pf-btn ghost sq" onClick={() => setSheet(true)} aria-label="More"><Icon name="more" size={17} /></button>
              </>
            ) : relation === 'pending_out' ? (
              <>
                <button className="ux-pf-btn ghost" disabled><Icon name="clock" size={16} /> Request sent</button>
                <button className="ux-pf-btn ghost" onClick={follow} disabled={busy}>{isFollowing ? 'Following' : 'Follow'}</button>
                <button className="ux-pf-btn ghost sq" onClick={() => setSheet(true)} aria-label="More"><Icon name="more" size={17} /></button>
              </>
            ) : relation === 'pending_in' ? (
              <>
                <button className="ux-pf-btn primary" onClick={acceptContact} disabled={busy}><Icon name="check" size={16} /> Accept request</button>
                <button className="ux-pf-btn ghost" onClick={follow} disabled={busy}>{isFollowing ? 'Following' : 'Follow'}</button>
                <button className="ux-pf-btn ghost sq" onClick={() => setSheet(true)} aria-label="More"><Icon name="more" size={17} /></button>
              </>
            ) : relation === 'blocked' ? (
              <p className="ux-pf-note">You cannot interact with this account.</p>
            ) : (
              <>
                <button className="ux-pf-btn primary" onClick={askContact} disabled={busy}>
                  <Icon name="plus" size={16} /> {busy ? 'Sending…' : 'Add contact'}
                </button>
                <button className="ux-pf-btn ghost" onClick={follow} disabled={busy}>{isFollowing ? 'Following' : 'Follow'}</button>
                <button className="ux-pf-btn ghost sq" onClick={() => setSheet(true)} aria-label="More"><Icon name="more" size={17} /></button>
              </>
            )}
          </div>
          {relation === 'pending_out' && <p className="ux-pf-note">Waiting for {user.displayName.split(' ')[0]} to accept.</p>}
          {relation === 'pending_in' && <p className="ux-pf-note">{user.displayName.split(' ')[0]} wants to connect with you.</p>}
        </div>

        <div className="ux-pf-highlights">
          {(moments || []).slice(0, 8).map(m => (
            <button key={m.id} className="ux-pf-hl" onClick={() => navigate('moments')}>
              <span className="ux-pf-hl-circle">
                {m.media_url ? <img src={m.media_url} alt="" /> : <i>{(m.text || '✨').slice(0, 2)}</i>}
              </span>
              <small>{timeAgo(m.created_at)}</small>
            </button>
          ))}
          {isMe && (
            <button className="ux-pf-hl" onClick={() => navigate('moments')}>
              <span className="ux-pf-hl-circle add"><Icon name="plus" size={20} /></span>
              <small>New</small>
            </button>
          )}
        </div>

        <div className="ux-pf-tabs">
          <button className={tab === 'posts' ? 'on' : ''} onClick={() => setTab('posts')} aria-label="Posts"><Icon name="grid" size={20} /></button>
          <button className={tab === 'moments' ? 'on' : ''} onClick={() => setTab('moments')} aria-label="Moments"><Icon name="play" size={20} /></button>
          <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')} aria-label="About"><Icon name="info" size={20} /></button>
        </div>

        {!canView ? (
          <div className="ux-pf-empty">
            <Icon name="lock" size={26} />
            <b style={{ marginTop: 10 }}>This account is private</b>
            Follow {user.displayName} to see their posts and moments.
          </div>
        ) : tab === 'posts' ? (
          posts.length === 0 ? (
            <div className="ux-pf-empty">
              <b>No posts yet</b>
              {isMe ? 'Share your first post on Updates.' : 'Nothing here yet.'}
            </div>
          ) : (
            <div className="ux-pf-grid">
              {posts.map(p => (
                <button key={p.id} className="ux-pf-cell" onClick={() => navigate('explore')}>
                  {p.media?.[0]
                    ? (p.media[0].kind === 'video'
                      ? <video src={p.media[0].url} muted playsInline />
                      : <img src={p.media[0].url} alt="" loading="lazy" />)
                    : <div className="txt">{p.caption?.slice(0, 90)}</div>}
                  <div className="ov">
                    <span><Icon name="heart" size={12} /> {p.likes || 0}</span>
                    <span><Icon name="comment" size={12} /> {p.comments || 0}</span>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : tab === 'moments' ? (
          moments.length === 0 ? (
            <div className="ux-pf-empty"><b>No active moments</b>Moments disappear after 24 hours.</div>
          ) : (
            <div className="ux-pf-grid">
              {moments.map(m => (
                <button key={m.id} className="ux-pf-cell" onClick={() => navigate('moments')} style={{ background: m.bg || 'var(--surface)' }}>
                  {m.media_url && <img src={m.media_url} alt="" />}
                  {!m.media_url && <div className="txt">{m.text}</div>}
                  <div className="ov"><span>{timeAgo(m.created_at)}</span></div>
                </button>
              ))}
            </div>
          )
        ) : (
          <div style={{ padding: '20px 20px 8px', display: 'grid', gap: 16 }}>
            <div><b style={{ fontSize: 14 }}>Bio</b><p className="ux-pf-note">{user.bio || 'No bio yet.'}</p></div>
            <div><b style={{ fontSize: 14 }}>Language</b><p className="ux-pf-note">{langOf(user.language)?.label} — messages are auto-translated for you.</p></div>
            {user.country && <div><b style={{ fontSize: 14 }}>Country</b><p className="ux-pf-note">{user.country}</p></div>}
            {mutual?.length > 0 && (
              <div>
                <b style={{ fontSize: 14 }}>Mutual connections</b>
                <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
                  {mutual.map(m => (
                    <button key={m.id} onClick={() => navigate('profile', m.username)}
                      style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'center' }}>
                      <Avatar user={m} size={44} />
                      <small style={{ display: 'block', marginTop: 4, fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{m.displayName.split(' ')[0]}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div><b style={{ fontSize: 14 }}>Joined</b><p className="ux-pf-note">{timeAgo(user.createdAt)}</p></div>
          </div>
        )}
      </div>

      {sheet && (
        <div className="more-sheet" onClick={() => setSheet(false)}>
          <div className="more-sheet-inner" onClick={e => e.stopPropagation()}>
            <div className="more-grab" />
            <div className="more-title">@{user.username}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="ux-pf-btn ghost" onClick={() => { setSheet(false); setReporting(true); }}>
                <Icon name="warning" size={16} /> Report account
              </button>
              <button className="ux-pf-btn ghost" onClick={() => { setSheet(false); block(); }}>
                <Icon name="lock" size={16} /> Block account
              </button>
              <button className="ux-pf-btn ghost" onClick={() => { setSheet(false); shareProfile(); }}>
                <Icon name="link" size={16} /> Copy profile link
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && <EditProfile user={user} onClose={() => setEditing(false)} onSaved={() => { load(); refreshMe(); }} />}
      {reporting && <ReportModal user={user} onClose={() => setReporting(false)} />}
    </div>
  );
}
