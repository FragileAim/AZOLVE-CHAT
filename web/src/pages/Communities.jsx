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
    <div className="ux-gc-row">
      <Avatar user={post.author} size={32} />
      <div className="ux-gc-bub">
        <div className="sender">
          {post.author.displayName}
          {post.author.verified && <Verified size={11} />}
          <span className="tag">{post.originalLang?.toUpperCase() || 'EN'}</span>
        </div>
        <p>{translated || post.displayBody || post.body}</p>
        {(translated || (post.displayBody && post.displayBody !== post.body)) && (
          <button className="trbtn" onClick={() => setTranslated(translated ? null : post.body)}>
            {translated ? 'See original' : 'See original'}
          </button>
        )}
        {post.type === 'poll' && post.poll && (
          <div className="ux-gc-poll">
            <span className="lbl">{post.poll.question}</span>
            {post.poll.options.map((opt, i) => {
              const count = post.poll.results?.[i] || 0;
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <button key={i} className={`ux-gc-opt ${post.poll.myVote === i ? 'on' : ''}`} onClick={() => vote(i)} disabled={voting}>
                  <i style={{ width: `${pct}%` }} />
                  <span>{opt}</span>
                  <span>{pct}%</span>
                </button>
              );
            })}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.40)' }}>{total} vote{total === 1 ? '' : 's'}</span>
          </div>
        )}
        {post.type === 'event' && post.event && (
          <div className="ux-gc-poll">
            <span className="lbl"><Icon name="calendar" size={11} /> Event</span>
            <p style={{ fontSize: 13.5 }}><b>{post.event.title}</b> · {post.event.when || post.event.date || 'Upcoming'}</p>
          </div>
        )}
        {post.media?.length > 0 && (
          <div className="ux-gc-media">
            {post.media.map((m, i) => m.kind === 'video'
              ? <video key={i} src={m.url} controls />
              : <img key={i} src={m.url} alt="community" loading="lazy" />)}
          </div>
        )}
        <div className="meta">
          {timeAgo(post.createdAt)}
          <button className="trbtn" style={{ marginLeft: 'auto', marginTop: 0 }} onClick={translate}>
            <Icon name="translate" size={11} /> Translate
          </button>
        </div>
      </div>
    </div>
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
    <div className="ux-gc">
      <header className="ux-gc-head">
        <button className="ux-gc-back" onClick={onBack} aria-label="All communities"><Icon name="back" size={18} /></button>
        <div className="ux-gc-ic"><Icon name="users" size={18} /></div>
        <div className="ux-gc-who">
          <b>{community.name} {community.privacy === 'private' && <Icon name="lock" size={11} />}</b>
          <small>{community.members} members · <em>{community.category}</em></small>
        </div>
        {community.conversationId && community.joined && (
          <button className="ux-gc-btn" onClick={() => navigate('chats', community.conversationId)} aria-label="Group chat"><Icon name="chat" size={17} /></button>
        )}
        <button className="ux-gc-btn" onClick={join} aria-label={community.joined ? 'Leave' : 'Join'}>
          <Icon name={community.joined ? 'check' : 'plus'} size={17} />
        </button>
      </header>

      {community.rules && (
        <div className="ux-gc-pinned">
          <Icon name="pin" size={14} />
          <span>{community.rules}</span>
          <Icon name="arrow" size={14} style={{ opacity: .4 }} />
        </div>
      )}

      <div className="ux-gc-tabs">
        <button className={tab === 'discussion' ? 'on' : ''} onClick={() => setTab('discussion')}>Discussion</button>
        <button className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>Members {members.length}</button>
        <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>About</button>
      </div>

      {locked ? (
        <div className="ux-gc-locked">
          <Icon name="lock" size={30} />
          <b>This community is private</b>
          <p>Join to see discussions, polls and members.</p>
          <button onClick={join}>Join community</button>
        </div>
      ) : (
        <>
          <div className="ux-gc-body">
            {tab === 'discussion' && (
              <>
                {pollMode && (
                  <div className="ux-gc-bub" style={{ maxWidth: '100%' }}>
                    <div className="sender">New poll</div>
                    {pollOpts.map((o, i) => (
                      <input
                        key={i}
                        value={o}
                        onChange={e => setPollOpts(p => p.map((x, j) => j === i ? e.target.value : x))}
                        placeholder={`Option ${i + 1}`}
                        style={{ width: '100%', marginTop: 6, height: 36, borderRadius: 10, border: 0, background: 'rgba(255,255,255,.06)', color: '#edeff7', padding: '0 12px', font: 'inherit', fontSize: 13 }}
                      />
                    ))}
                    <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                      <button type="button" className="trbtn" onClick={() => setPollOpts(p => [...p, ''])}>+ Option</button>
                      <button type="button" className="trbtn" onClick={() => setPollMode(false)}>Cancel</button>
                    </div>
                  </div>
                )}
                {posts.length === 0 && (
                  <div className="ux-gc-locked" style={{ margin: '30px 0' }}>
                    <b>No posts yet</b>
                    <p>Be the first to start a discussion.</p>
                  </div>
                )}
                {posts.map(p => <CommunityPost key={p.id} post={p} communityId={id} onVoted={load} />)}
              </>
            )}

            {tab === 'members' && members.map(m => (
              <button key={m.id} className="ux-gc-member" onClick={() => navigate('profile', m.username)}>
                <Avatar user={m} size={40} showStatus online={m.online} />
                <span style={{ flex: 1 }}>
                  <b>{m.displayName} {m.verified && <Verified size={11} />}</b>
                  <small>@{m.username} · {m.role} · {m.language?.toUpperCase()}</small>
                </span>
                <Icon name="arrow" size={15} style={{ opacity: .35 }} />
              </button>
            ))}

            {tab === 'about' && (
              <div className="ux-gc-about">
                <b>Description</b>{community.description}
                <b>Rules</b>{community.rules || 'No rules set.'}
                <b>Created</b>{timeAgo(community.createdAt)}
                <b>Privacy</b>{community.privacy}
                <b>Languages</b>Every post is stored in its original language and translated on demand for each reader. Nothing is overwritten.
              </div>
            )}
          </div>

          {tab === 'discussion' && (
            <form className="ux-gc-compose" onSubmit={submit}>
              <input
                value={pollMode ? pollQ : body}
                onChange={e => pollMode ? setPollQ(e.target.value) : setBody(e.target.value)}
                placeholder={pollMode ? 'Poll question…' : `Message ${community.name}…`}
              />
              <button type="button" onClick={() => setPollMode(m => !m)} aria-label="Poll" style={pollMode ? { color: '#ffb938' } : undefined}>
                <Icon name="poll" size={18} />
              </button>
              <button type="submit" className="send" disabled={posting} aria-label="Send">
                <Icon name="send" size={17} />
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

export default function Communities() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  /* "For you" is a real, server-ranked feed — not a label over the same list.
     It used to not exist at all, and the only thing that ever said "For you"
     was the People directory, so tapping it here surfaced a network error. */
  const [feed, setFeed] = useState('for-you');
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setErr(null);
    try {
      const query = q
        ? `?q=${encodeURIComponent(q)}`
        : (feed === 'for-you' ? '?feed=for-you' : '');
      const r = await API.communities(query);
      setList(r.communities || []);
    } catch (e) {
      /* Say what actually happened. The old code toasting the raw error text is
         where "server not found" came from — a failed request described in
         transport terms instead of human ones. */
      setErr(e?.network ? 'Could not reach AZOLVE. Check your connection and try again.' : (e?.message || 'Could not load communities.'));
      setList([]);
    }
  };
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [q, feed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selected) return <CommunityDetail id={selected} onBack={() => { setSelected(null); load(); }} />;

  const filtered = (list || []).filter(c => cat === 'All' || c.category === cat);

  return (
    <div className="ux-screen">
      <div className="ux-scroll">
        <header className="ux-set-head">
          <div>
            <h1 className="ux-set-h1 lg">Communities</h1>
            <p className="ux-set-sub">Interest, professional and local spaces.</p>
          </div>
          <button className="ux-round blue" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)} aria-label="Create community">
            <Icon name="plus" size={18} />
          </button>
        </header>

        <div className="ux-pad" style={{ paddingTop: 4 }}>
          <div className="ux-search lg">
            <Icon name="search" size={16} className="sl" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search communities…" />
          </div>
        </div>

        <div className="ux-seg" role="tablist" aria-label="Community feed">
          <button
            role="tab"
            aria-selected={feed === 'for-you'}
            className={feed === 'for-you' ? 'on' : ''}
            onClick={() => { setFeed('for-you'); setCat('All'); }}
          >
            ✨ For you
          </button>
          <button
            role="tab"
            aria-selected={feed === 'all'}
            className={feed === 'all' ? 'on' : ''}
            onClick={() => setFeed('all')}
          >
            All spaces
          </button>
        </div>

        <div className="ux-cats">
          {CATEGORIES.map(c => (
            <button key={c} className={`ux-cat ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>

        <p className="ux-sub">
          {feed === 'for-you' ? 'Picked for you' : 'Your spaces'} <span>{filtered.length}</span>
        </p>

        {list === null && (
          <div className="ux-comm-list">
            {[1, 2, 3].map(i => <div key={i} style={{ margin: '12px 16px 0' }}><Skeleton h={88} /></div>)}
          </div>
        )}

        {err && (
          <div className="ux-pf-empty">
            <b>Couldn’t load communities</b>
            <p>{err}</p>
            <button className="ux-set-btn" style={{ marginTop: 14 }} onClick={load}>Try again</button>
          </div>
        )}

        {!err && list && filtered.length === 0 && (
          <div className="ux-pf-empty">
            <b>No communities found</b>
            <p>{feed === 'for-you' ? 'Join a space or two and this feed fills up.' : 'Try another category, or start one for your people.'}</p>
            <button className="ux-set-btn" style={{ marginTop: 14 }} onClick={() => setCreating(true)}>Create a community</button>
          </div>
        )}

        <div className="ux-comm-list">
          {filtered.map(c => (
            <button key={c.id} className="ux-comm-card" onClick={() => setSelected(c.id)}>
              <span className="ux-comm-ic"><Icon name="users" size={24} /></span>
              <span className="ux-set-main">
                <b>{c.name} {c.privacy === 'private' && <Icon name="lock" size={12} />}</b>
                <small>{c.description}</small>
                <small style={{ marginTop: 4, fontWeight: 700 }}>
                  {c.category} · {c.members} members{c.joined ? ' · Joined' : ''}
                </small>
              </span>
              <span className={`ux-tiny ${c.joined ? 'ghost' : 'primary'}`}>{c.joined ? 'Open' : 'View'}</span>
            </button>
          ))}
        </div>
      </div>

      {creating && <CreateCommunity onClose={() => setCreating(false)} onCreated={c => { setList(l => [c, ...(l || [])]); setSelected(c.id); }} />}
    </div>
  );
}
