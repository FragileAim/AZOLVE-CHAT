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

  return (
    <div className="page page-wide profile-page">
      <div className="profile-hero card">
        <div className="ph-cover" style={user.cover ? { backgroundImage: `url(${user.cover})` } : {}} />
        <div className="ph-main">
          <Avatar user={user} size={104} ring showStatus online={user.online} />
          <div className="ph-info">
            <h1>{user.displayName} {user.verified && <Verified size={20} />}</h1>
            <p className="ph-handle">@{user.username} {followsYou && !isMe && <span className="pill">Follows you</span>}</p>
            {user.bio && <p className="ph-bio">{user.bio}</p>}
            <div className="ph-meta">
              {user.country && <span><Icon name="globe" size={14} /> {user.country}</span>}
              <span><Icon name="translate" size={14} /> {langOf(user.language)?.label || user.language}</span>
              {user.mood && <span>{user.mood}</span>}
              <span><Icon name="clock" size={14} /> {user.online ? 'Online' : `Last seen ${timeAgo(user.lastSeen)}`}</span>
            </div>
          </div>
          <div className="ph-actions">
            {isMe ? (
              <>
                <button className="btn primary" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> Edit profile</button>
                <button className="btn ghost" onClick={() => navigate('settings')}><Icon name="settings" size={16} /> Settings</button>
                <button className="btn ghost danger-ghost" onClick={doLogout}><Icon name="logout" size={16} /> Log out</button>
              </>
            ) : relation === 'contact' ? (
              <>
                <button className="btn primary" onClick={message}><Icon name="chat" size={16} /> Message</button>
                <button className="btn ghost" onClick={() => navigate('calls')}><Icon name="phone" size={16} /> Call</button>
                <button className={`btn ghost ${isFollowing ? '' : 'subtle'}`} onClick={follow} disabled={busy}>{isFollowing ? 'Following' : 'Follow'}</button>
                <button className="icon-btn" onClick={block} title="Block"><Icon name="lock" size={17} /></button>
                <button className="icon-btn" onClick={() => setReporting(true)} title="Report"><Icon name="warning" size={17} /></button>
              </>
            ) : relation === 'pending_out' ? (
              <>
                <button className="btn ghost" disabled><Icon name="clock" size={16} /> Request sent</button>
                <span className="rel-note">Waiting for {user.displayName.split(' ')[0]} to accept.</span>
              </>
            ) : relation === 'pending_in' ? (
              <>
                <button className="btn primary" onClick={acceptContact} disabled={busy}><Icon name="check" size={16} /> Accept request</button>
                <span className="rel-note">{user.displayName.split(' ')[0]} wants to connect with you.</span>
              </>
            ) : relation === 'blocked' ? (
              <span className="rel-note">You cannot interact with this account.</span>
            ) : (
              <>
                <button className="btn primary" onClick={askContact} disabled={busy}>
                  <Icon name="plus" size={16} /> {busy ? 'Sending…' : 'Add contact'}
                </button>
                <button className={`btn ghost ${isFollowing ? '' : 'subtle'}`} onClick={follow} disabled={busy}>{isFollowing ? 'Following' : 'Follow'}</button>
                <button className="icon-btn" onClick={block} title="Block"><Icon name="lock" size={17} /></button>
                <button className="icon-btn" onClick={() => setReporting(true)} title="Report"><Icon name="warning" size={17} /></button>
              </>
            )}
          </div>
        </div>
        <div className="ph-stats">
          <div><b>{counts.posts}</b><span>Posts</span></div>
          <div><b>{counts.followers}</b><span>Followers</span></div>
          <div><b>{counts.following}</b><span>Following</span></div>
        </div>
      </div>

      {!canView ? (
        <div className="card locked-box"><Icon name="lock" size={26} /><h3>This account is private</h3><p className="muted">Follow {user.displayName} to see their posts and moments.</p></div>
      ) : (
        <>
          <div className="seg-tabs">
            <button className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}><Icon name="grid" size={15} /> Posts</button>
            <button className={tab === 'moments' ? 'active' : ''} onClick={() => setTab('moments')}><Icon name="eye" size={15} /> Moments</button>
            <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}><Icon name="info" size={15} /> About</button>
          </div>

          {tab === 'posts' && (
            posts.length === 0
              ? <Empty icon="grid" title="No posts yet" text={isMe ? 'Share your first post on Explore.' : 'Nothing here yet.'} action={isMe ? <button className="btn primary" onClick={() => navigate('explore')}>Create a post</button> : null} />
              : <div className="post-grid">
                {posts.map(p => (
                  <div key={p.id} className="pg-item" onClick={() => navigate('explore')}>
                    {p.media?.[0]
                      ? (p.media[0].kind === 'video' ? <video src={p.media[0].url} muted /> : <img src={p.media[0].url} alt="post" loading="lazy" />)
                      : <div className="pg-text">{p.caption?.slice(0, 120)}</div>}
                    <div className="pg-overlay"><span><Icon name="heart" size={14} /> {p.likes || 0}</span><span><Icon name="comment" size={14} /> {p.comments || 0}</span></div>
                  </div>
                ))}
              </div>
          )}

          {tab === 'moments' && (
            moments.length === 0
              ? <Empty icon="eye" title="No active moments" text="Moments disappear after 24 hours." />
              : <div className="moment-grid">
                {moments.map(m => (
                  <div key={m.id} className="mg-item" style={{ background: m.bg || '#222' }}>
                    {m.media_url && <img src={m.media_url} alt="moment" />}
                    {m.text && <p>{m.text}</p>}
                    <small>{timeAgo(m.created_at)} · {m.audience}</small>
                  </div>
                ))}
              </div>
          )}

          {tab === 'about' && (
            <div className="card stack">
              <div><b>Bio</b><p className="muted">{user.bio || 'No bio yet.'}</p></div>
              <div><b>Language</b><p className="muted">{langOf(user.language)?.label} — messages are auto-translated for you.</p></div>
              {mutual?.length > 0 && (
                <div><b>Mutual connections</b>
                  <div className="mutual-row">{mutual.map(m => <button key={m.id} onClick={() => navigate('profile', m.username)}><Avatar user={m} size={38} /><small>{m.displayName.split(' ')[0]}</small></button>)}</div>
                </div>
              )}
              <div><b>Joined</b><p className="muted">{timeAgo(user.createdAt)}</p></div>
            </div>
          )}
        </>
      )}

      {editing && <EditProfile user={user} onClose={() => setEditing(false)} onSaved={() => { load(); refreshMe(); }} />}
      {reporting && <ReportModal user={user} onClose={() => setReporting(false)} />}
    </div>
  );
}
