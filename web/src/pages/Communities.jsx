import React, { useEffect, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Modal, Empty, Skeleton, Verified } from '../components/UI.jsx';
import { API } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';

const CATEGORIES = ['All', 'Technology', 'Business', 'Education', 'Gaming', 'Entertainment', 'Travel', 'Local', 'Professional', 'Interest'];

function CreateCommunity({ onClose, onCreated }) {
  const { notify } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Technology');
  const [privacy, setPrivacy] = useState('public');
  const [rules, setRules] = useState('Be kind. Stay on topic. No spam.');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { notify('Name is required', 'err'); return; }
    setBusy(true);
    try {
      const r = await API.createCommunity({ name: name.trim(), description: description.trim(), category, privacy, rules });
      notify('Community created', 'ok');
      onCreated(r.community);
      onClose();
    } catch (err) { notify(err.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Create a community">
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cross-Language Design" maxLength={60} /></label>
        <label className="field"><span>Description</span><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this community about?" /></label>
        <div className="field-row">
          <label className="field"><span>Category</span>
            <select value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.slice(1).map(c => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="field"><span>Privacy</span>
            <select value={privacy} onChange={e => setPrivacy(e.target.value)}><option value="public">Public</option><option value="private">Private</option></select>
          </label>
        </div>
        <label className="field"><span>Rules</span><textarea rows={2} value={rules} onChange={e => setRules(e.target.value)} /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create community'}</button>
      </form>
    </Modal>
  );
}

function CommunityPost({ post, communityId, onVoted }) {
  const { notify } = useApp();
  const [translated, setTranslated] = useState(null);
  const [voting, setVoting] = useState(false);

  const translate = async () => {
    if (translated) { setTranslated(null); return; }
    try {
      const r = await API.aiTask({ kind: 'translate', text: post.body, targetLang: 'en' });
      setTranslated(r.text);
    } catch (e) { notify(e.message, 'err'); }
  };

  const vote = async (i) => {
    setVoting(true);
    try { await API.vote(communityId, post.id, i); onVoted(); }
    catch (e) { notify(e.message, 'err'); }
    finally { setVoting(false); }
  };

  const total = post.poll?.total || 0;
  return (
    <article className="cp-card card">
      <header className="cp-head">
        <Avatar user={post.author} size={34} />
        <div><b>{post.author.displayName} {post.author.verified && <Verified />}</b><small>{post.author.username} · {timeAgo(post.createdAt)}</small></div>
        <span className="lang-chip">{post.originalLang?.toUpperCase()}</span>
      </header>
      <p className="cp-body">{translated || post.displayBody || post.body}</p>
      {translated && <small className="translated-note">Translated · <button className="linkbtn" onClick={() => setTranslated(null)}>See original</button></small>}
      {post.displayBody !== post.body && !translated && (
        <small className="translated-note">Translated for you · <button className="linkbtn" onClick={() => setTranslated(post.body)}>See original</button></small>
      )}
      {post.type === 'poll' && post.poll && (
        <div className="poll-box">
          <b>{post.poll.question}</b>
          {post.poll.options.map((opt, i) => {
            const count = post.poll.results?.[i] || 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <button key={i} className={`poll-opt ${post.poll.myVote === i ? 'voted' : ''}`} onClick={() => vote(i)} disabled={voting}>
                <span className="poll-fill" style={{ width: `${pct}%` }} />
                <span className="poll-label">{opt}</span>
                <span className="poll-pct">{pct}%</span>
              </button>
            );
          })}
          <small className="muted">{total} vote{total === 1 ? '' : 's'}</small>
        </div>
      )}
      {post.type === 'event' && post.event && (
        <div className="event-box"><Icon name="calendar" size={18} /><div><b>{post.event.title}</b><small>{post.event.when || post.event.date || 'Upcoming'}</small></div></div>
      )}
      {post.media?.length > 0 && (
        <div className="cp-media">{post.media.map((m, i) => m.kind === 'video' ? <video key={i} src={m.url} controls /> : <img key={i} src={m.url} alt="community" loading="lazy" />)}</div>
      )}
      <div className="cp-actions">
        <button className="pa" onClick={translate}><Icon name="translate" size={16} /> Translate</button>
      </div>
    </article>
  );
}

function CommunityDetail({ id, onBack }) {
  const { user, notify } = useApp();
  const [data, setData] = useState(null);
  const [body, setBody] = useState('');
  const [tab, setTab] = useState('discussion');
  const [posting, setPosting] = useState(false);
  const [pollMode, setPollMode] = useState(false);
  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState(['', '']);

  const load = async () => {
    try { const r = await API.community(id); setData(r); }
    catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, [id]);

  if (!data) return <div className="page"><Skeleton h={200} /><Skeleton h={300} style={{ marginTop: 16 }} /></div>;
  const { community, posts, members, locked } = data;

  const join = async () => {
    try { await API.joinCommunity(id); notify(community.joined ? 'Left community' : 'Joined community', 'ok'); load(); }
    catch (e) { notify(e.message, 'err'); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (pollMode) {
      if (!pollQ.trim() || pollOpts.filter(o => o.trim()).length < 2) { notify('Add a question and 2+ options', 'err'); return; }
      setPosting(true);
      try {
        await API.communityPost(id, { body: pollQ.trim(), type: 'poll', poll: { question: pollQ.trim(), options: pollOpts.filter(o => o.trim()) } });
        setPollQ(''); setPollOpts(['', '']); setPollMode(false); load(); notify('Poll posted', 'ok');
      } catch (err) { notify(err.message, 'err'); }
      finally { setPosting(false); }
      return;
    }
    if (!body.trim()) return;
    setPosting(true);
    try { await API.communityPost(id, { body: body.trim(), type: 'post' }); setBody(''); load(); notify('Posted', 'ok'); }
    catch (err) { notify(err.message, 'err'); }
    finally { setPosting(false); }
  };

  return (
    <div className="page page-wide">
      <button className="linkbtn back-link" onClick={onBack}><Icon name="back" size={16} /> All communities</button>
      <div className="community-hero card">
        <div className="ch-cover" />
        <div className="ch-body">
          <div className="ch-avatar"><Icon name="users" size={30} /></div>
          <div className="ch-info">
            <h1>{community.name} {community.privacy === 'private' && <Icon name="lock" size={16} />}</h1>
            <p className="muted">{community.description}</p>
            <div className="ch-meta">
              <span><Icon name="users" size={14} /> {community.members} members</span>
              <span className="cat-chip">{community.category}</span>
              <span>{community.privacy}</span>
            </div>
          </div>
          <div className="ch-actions">
            <button className={`btn ${community.joined ? 'ghost' : 'primary'}`} onClick={join}>{community.joined ? 'Leave' : 'Join'}</button>
            {community.conversationId && community.joined && (
              <button className="btn ghost" onClick={() => navigate('chats', community.conversationId)}><Icon name="chat" size={16} /> Group chat</button>
            )}
          </div>
        </div>
      </div>

      {locked ? (
        <div className="card locked-box"><Icon name="lock" size={26} /><h3>This community is private</h3><p className="muted">Join to see discussions, polls and members.</p></div>
      ) : (
        <div className="community-grid">
          <div className="community-main">
            <div className="seg-tabs">
              <button className={tab === 'discussion' ? 'active' : ''} onClick={() => setTab('discussion')}>Discussion</button>
              <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members ({members.length})</button>
              <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>About</button>
            </div>

            {tab === 'discussion' && (
              <>
                <form className="card cp-compose" onSubmit={submit}>
                  {pollMode ? (
                    <div className="stack">
                      <input value={pollQ} onChange={e => setPollQ(e.target.value)} placeholder="Poll question" />
                      {pollOpts.map((o, i) => (
                        <input key={i} value={o} onChange={e => setPollOpts(p => p.map((x, j) => j === i ? e.target.value : x))} placeholder={`Option ${i + 1}`} />
                      ))}
                      <div className="row-gap">
                        <button type="button" className="btn ghost btn-sm" onClick={() => setPollOpts(p => [...p, ''])}>+ Option</button>
                        <button type="button" className="linkbtn" onClick={() => setPollMode(false)}>Cancel poll</button>
                      </div>
                    </div>
                  ) : (
                    <textarea rows={3} value={body} onChange={e => setBody(e.target.value)} placeholder={`Share with ${community.name}…`} />
                  )}
                  <div className="cp-compose-foot">
                    <button type="button" className="tool" onClick={() => setPollMode(m => !m)}><Icon name="poll" size={16} /> Poll</button>
                    <button className="btn primary btn-sm" disabled={posting}>{posting ? 'Posting…' : 'Post'}</button>
                  </div>
                </form>
                {posts.length === 0 && <Empty icon="users" title="No posts yet" text="Be the first to start a discussion." />}
                {posts.map(p => <CommunityPost key={p.id} post={p} communityId={id} onVoted={load} />)}
              </>
            )}

            {tab === 'members' && (
              <div className="card">
                {members.map(m => (
                  <button key={m.id} className="person-row" onClick={() => navigate('profile', m.username)}>
                    <Avatar user={m} size={40} showStatus online={m.online} />
                    <span><b>{m.displayName} {m.verified && <Verified />}</b><small>@{m.username} · {m.role} · {m.language?.toUpperCase()}</small></span>
                  </button>
                ))}
              </div>
            )}

            {tab === 'about' && (
              <div className="card stack">
                <div><b>Description</b><p className="muted">{community.description}</p></div>
                <div><b>Rules</b><p className="muted">{community.rules || 'No rules set.'}</p></div>
                <div><b>Created</b><p className="muted">{timeAgo(community.createdAt)}</p></div>
                <div><b>Privacy</b><p className="muted">{community.privacy}</p></div>
              </div>
            )}
          </div>

          <aside className="community-side">
            <div className="card">
              <h3>Members</h3>
              <div className="member-stack">
                {members.slice(0, 8).map(m => <Avatar key={m.id} user={m} size={34} />)}
              </div>
              <button className="linkbtn" onClick={() => setTab('members')}>See all {members.length}</button>
            </div>
            <div className="card">
              <h3>Multilingual by default</h3>
              <p className="muted small">Every post is stored in its original language and translated on demand for each reader. Nothing is overwritten.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export default function Communities() {
  const { notify } = useApp();
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try { const r = await API.communities(q ? `?q=${encodeURIComponent(q)}` : ''); setList(r.communities || []); }
    catch (e) { notify(e.message, 'err'); setList([]); }
  };
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [q]);

  if (selected) return <CommunityDetail id={selected} onBack={() => { setSelected(null); load(); }} />;

  const filtered = (list || []).filter(c => cat === 'All' || c.category === cat);

  return (
    <div className="page page-wide communities-page">
      <div className="page-head">
        <div>
          <h1>Communities</h1>
          <p className="muted">Interest, professional and local spaces — every discussion multilingual.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={17} /> Create</button>
      </div>

      <div className="explore-top">
        <div className="explore-search">
          <Icon name="search" size={18} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search communities…" />
        </div>
      </div>

      <div className="cat-rail">
        {CATEGORIES.map(c => <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>

      {list === null && <div className="card-grid">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={190} />)}</div>}
      {list && filtered.length === 0 && <Empty icon="users" title="No communities found" text="Try another category or create one." action={<button className="btn primary" onClick={() => setCreating(true)}>Create a community</button>} />}

      <div className="card-grid">
        {filtered.map(c => (
          <button key={c.id} className="community-card card" onClick={() => setSelected(c.id)}>
            <div className="cc-top">
              <div className="cc-icon"><Icon name="users" size={22} /></div>
              {c.privacy === 'private' && <span className="lock-pill"><Icon name="lock" size={11} /> Private</span>}
            </div>
            <h3>{c.name}</h3>
            <p className="muted">{c.description}</p>
            <div className="cc-foot">
              <span className="cat-chip">{c.category}</span>
              <span className="muted small">{c.members} members</span>
              {c.joined && <span className="joined-pill">Joined</span>}
            </div>
          </button>
        ))}
      </div>

      {creating && <CreateCommunity onClose={() => setCreating(false)} onCreated={c => { setList(l => [c, ...(l || [])]); setSelected(c.id); }} />}
    </div>
  );
}
