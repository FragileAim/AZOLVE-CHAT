import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Modal, Empty, Skeleton, Verified, Seg } from '../components/UI.jsx';
import { API, uploadFile } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';

function PostCard({ post, onChanged }) {
  const { user, notify } = useApp();
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes || 0);
  const [saved, setSaved] = useState(!!post.saved);
  const [openComments, setOpenComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comments || 0);
  const [translated, setTranslated] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    setLiked(v => !v); setLikes(v => v + (liked ? -1 : 1));
    try { await API.likePost(post.id); } catch { setLiked(liked); setLikes(likes); }
  };
  const toggleSave = async () => {
    setSaved(v => !v);
    try { await API.savePost(post.id); notify(saved ? 'Removed from saved' : 'Saved to collection', 'ok'); }
    catch { setSaved(saved); }
  };
  const translate = async () => {
    if (translated) { setTranslated(null); return; }
    setBusy(true);
    try {
      const r = await API.aiTask({ kind: 'translate', text: post.caption, targetLang: user.language || 'en' });
      setTranslated(r.result || r.text || '');
    } catch (e) { notify(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const share = async () => {
    const url = `${location.origin}/#/explore?post=${post.id}`;
    try { await navigator.clipboard.writeText(url); notify('Link copied to clipboard', 'ok'); }
    catch { notify(url, 'ok'); }
  };

  const media = post.media || [];
  return (
    <article className="post-card">
      <header className="post-head">
        <button className="post-author" onClick={() => navigate('profile', post.author.username)}>
          <Avatar user={post.author} size={40} />
          <span>
            <b>{post.author.displayName} {post.author.verified && <Verified />}</b>
            <small>@{post.author.username} · {timeAgo(post.createdAt)}{post.location ? ` · ${post.location}` : ''}</small>
          </span>
        </button>
        <span className="lang-chip">{post.originalLang?.toUpperCase()}</span>
      </header>

      {media.length > 0 && (
        <div className={`post-media ${media.length > 1 ? 'multi' : ''}`}>
          {media.map((m, i) => m.kind === 'video'
            ? <video key={i} src={m.url} controls playsInline className="post-img" />
            : <img key={i} src={m.url} alt={post.caption?.slice(0, 60) || 'post'} className="post-img" loading="lazy" />)}
        </div>
      )}

      {post.caption && (
        <div className="post-caption">
          <p>{translated || post.caption}</p>
          {translated && <small className="translated-note">Translated to {user.language?.toUpperCase()} · <button className="linkbtn" onClick={() => setTranslated(null)}>See original</button></small>}
        </div>
      )}

      <div className="post-actions">
        <button className={`pa ${liked ? 'on' : ''}`} onClick={toggleLike}><Icon name="heart" size={20} /> {likes}</button>
        <button className="pa" onClick={() => setOpenComments(true)}><Icon name="comment" size={20} /> {commentCount}</button>
        <button className="pa" onClick={share}><Icon name="share" size={20} /></button>
        <button className="pa" onClick={translate} disabled={busy} title="Translate caption"><Icon name="translate" size={20} /></button>
        <button className={`pa ml ${saved ? 'on' : ''}`} onClick={toggleSave}><Icon name="bookmark" size={20} /></button>
      </div>

      {openComments && (
        <CommentsModal post={post} onClose={() => setOpenComments(false)} onCount={setCommentCount} />
      )}
    </article>
  );
}

function CommentsModal({ post, onClose, onCount }) {
  const { notify } = useApp();
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    try { const r = await API.comments(post.id); setList(r.comments || []); }
    catch (e) { notify(e.message, 'err'); setList([]); }
  };
  useEffect(() => { load(); }, [post.id]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await API.comment(post.id, text.trim());
      setList(l => [...(l || []), r.comment]);
      onCount(c => c + 1);
      setText('');
    } catch (err) { notify(err.message, 'err'); }
    finally { setSending(false); }
  };

  return (
    <Modal open onClose={onClose} title="Comments">
      <div className="comment-list">
        {list === null && [1, 2, 3].map(i => <Skeleton key={i} h={48} style={{ marginBottom: 10 }} />)}
        {list && list.length === 0 && <Empty icon="comment" title="No comments yet" text="Start the conversation." />}
        {list && list.map(c => (
          <div key={c.id} className="comment-row">
            <Avatar user={c.author || { displayName: c.displayName || 'User' }} size={34} />
            <div>
              <b>{c.author?.displayName || c.displayName || 'User'}</b>
              <p>{c.body}</p>
              <small>{timeAgo(c.createdAt)}</small>
            </div>
          </div>
        ))}
      </div>
      <form className="comment-form" onSubmit={send}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a comment…" />
        <button className="btn primary" disabled={sending || !text.trim()}>Post</button>
      </form>
    </Modal>
  );
}

function Composer({ onClose, onCreated }) {
  const { user, notify } = useApp();
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState([]);
  const [privacy, setPrivacy] = useState('public');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState('');
  const fileRef = useRef(null);

  const pick = async (files) => {
    for (const f of Array.from(files)) {
      try {
        const r = await uploadFile(f);
        setMedia(m => [...m, { url: r.url, kind: r.kind === 'video' ? 'video' : 'image' }]);
      } catch (e) { notify(e.message, 'err'); }
    }
  };

  const ai = async (kind) => {
    setAiBusy(kind);
    try {
      const r = await API.aiTask({ kind, text: caption || 'a moment from my day', lang: user.language || 'en' });
      if (kind === 'caption') setCaption(r.result || r.text || caption);
      if (kind === 'hashtags') setCaption(c => `${c} ${r.result || r.text || ''}`.trim());
      notify(`AI ${kind} ready (${r.engine || 'local-heuristic'})`, 'ok');
    } catch (e) { notify(e.message, 'err'); }
    finally { setAiBusy(''); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!caption.trim() && media.length === 0) { notify('Add a caption or media', 'err'); return; }
    setBusy(true);
    try {
      const r = await API.createPost({ caption: caption.trim(), media, privacy, location: location || null, type: 'post' });
      onCreated(r.post);
      notify('Post published', 'ok');
      onClose();
    } catch (err) { notify(err.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Create a post" wide>
      <form className="composer" onSubmit={submit}>
        <div className="composer-author">
          <Avatar user={user} size={40} />
          <div>
            <b>{user.displayName}</b>
            <select value={privacy} onChange={e => setPrivacy(e.target.value)}>
              <option value="public">🌍 Public</option>
              <option value="followers">👥 Followers</option>
              <option value="private">🔒 Only me</option>
            </select>
          </div>
        </div>
        <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={4}
          placeholder="Share something with the world…" maxLength={2200} />
        <div className="composer-tools">
          <button type="button" className="tool" onClick={() => fileRef.current?.click()}><Icon name="image" size={18} /> Photo</button>
          <button type="button" className="tool" onClick={() => ai('caption')} disabled={!!aiBusy}><Icon name="magic" size={18} /> {aiBusy === 'caption' ? 'Thinking…' : 'AI caption'}</button>
          <button type="button" className="tool" onClick={() => ai('hashtags')} disabled={!!aiBusy}><Icon name="hashtag" size={18} /> {aiBusy === 'hashtags' ? 'Thinking…' : 'AI hashtags'}</button>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={e => pick(e.target.files)} />
          <input className="loc-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="Add location" />
        </div>
        {media.length > 0 && (
          <div className="composer-media">
            {media.map((m, i) => (
              <div key={i} className="cm-item">
                {m.kind === 'video' ? <video src={m.url} /> : <img src={m.url} alt="upload" />}
                <button type="button" onClick={() => setMedia(x => x.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-foot">
          <span className="muted">{caption.length}/2200</span>
          <button className="btn primary" disabled={busy}>{busy ? 'Publishing…' : 'Share post'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Explore() {
  const { user, notify } = useApp();
  const [tab, setTab] = useState('feed');
  /* Top tabs from the design: For you / Following / Reels. */
  const [view, setView] = useState('foryou');
  const [moments, setMoments] = useState([]);
  const [feed, setFeed] = useState(null);
  const [explore, setExplore] = useState(null);
  const [trending, setTrending] = useState([]);
  const [q, setQ] = useState('');
  const [composer, setComposer] = useState(false);
  const [searchResults, setSearchResults] = useState(null);

  const loadFeed = async () => {
    try { const r = await API.feed(); setFeed(r.posts || []); } catch (e) { notify(e.message, 'err'); setFeed([]); }
  };
  const loadExplore = async (query = '') => {
    try { const r = await API.explore(query ? `?q=${encodeURIComponent(query)}` : ''); setExplore(r.posts || []); }
    catch (e) { notify(e.message, 'err'); setExplore([]); }
  };

  useEffect(() => {
    loadFeed();
    loadExplore();
    API.trending().then(r => setTrending(r.trending || [])).catch(() => {});
    API.moments().then(r => setMoments(r.moments || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'explore') return;
    const t = setTimeout(() => loadExplore(q), 350);
    return () => clearTimeout(t);
  }, [q, tab]);

  const searchPeople = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    try { const r = await API.searchUsers(q.trim()); setSearchResults(r.users || []); }
    catch { setSearchResults([]); }
  };

  const posts = view === 'reels' ? explore : feed;

  return (
    <div className="page page-wide explore-page">
      <div className="explore-top">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h1>Updates</h1>
          <button className="icon-btn" onClick={() => setComposer(true)} aria-label="Create a post"
            style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--azolve-blue)', color: '#fff' }}>
            <Icon name="plus" size={19} />
          </button>
        </div>
        <div className="explore-search">
          <Icon name="search" size={18} />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchPeople(e)}
            placeholder="Search people, hashtags, places…" />
          {q && <button className="icon-btn" onClick={() => { setQ(''); setSearchResults(null); }}><Icon name="close" size={16} /></button>}
        </div>
      </div>

      <div className="feed-tabs">
        <button className={view === 'foryou' ? 'on' : ''} onClick={() => { setView('foryou'); setTab('feed'); }}>For you</button>
        <button className={view === 'following' ? 'on' : ''} onClick={() => { setView('following'); setTab('feed'); }}>Following</button>
        <button className={view === 'reels' ? 'on' : ''} onClick={() => { setView('reels'); setTab('explore'); }}>Reels</button>
      </div>

      <div className="stories-row">
        <button className="story-item" onClick={() => navigate('moments')}>
          <div className="story-ring"><div className="inner" style={{ display: 'grid', placeItems: 'center', color: 'var(--azolve-blue)' }}><Icon name="plus" size={22} /></div></div>
          <div className="nm">Your story</div>
        </button>
        {moments.slice(0, 8).map(m => (
          <button key={m.id} className="story-item" onClick={() => navigate('moments')}>
            <div className={`story-ring ${m.viewed ? 'seen' : ''}`}>
              <div className="inner"><Avatar user={m.author || { displayName: 'User' }} size={56} /></div>
            </div>
            <div className="nm">{m.author?.displayName?.split(' ')[0] || 'User'}</div>
          </button>
        ))}
      </div>


      {searchResults && (
        <div className="card search-results">
          <div className="row-between"><b>People</b><button className="linkbtn" onClick={() => setSearchResults(null)}>Clear</button></div>
          {searchResults.length === 0 && <p className="muted">No accounts found.</p>}
          {searchResults.map(u => (
            <button key={u.id} className="person-row" onClick={() => navigate('profile', u.username)}>
              <Avatar user={u} size={40} />
              <span><b>{u.displayName} {u.verified && <Verified />}</b><small>@{u.username} · {u.country || 'Global'}</small></span>
              <Icon name="arrow" size={16} />
            </button>
          ))}
        </div>
      )}

      <div className="explore-grid">
        <div className="feed-col">
          {posts === null && [1, 2, 3].map(i => <Skeleton key={i} h={380} style={{ marginBottom: 18, borderRadius: 20 }} />)}
          {posts && posts.length === 0 && (
            <Empty icon="explore" title="Nothing here yet" text={tab === 'feed' ? 'Follow people to fill your feed.' : 'Try a different search.'}
              action={<button className="btn primary" onClick={() => setComposer(true)}>Create the first post</button>} />
          )}
          {posts && posts.map(p => <PostCard key={p.id} post={p} onChanged={loadFeed} />)}
        </div>

        <aside className="explore-side">
          <div className="card">
            <h3><Icon name="hashtag" size={16} /> Trending globally</h3>
            <div className="trend-list">
              {trending.slice(0, 8).map(t => (
                <button key={t.tag} className="trend-row" onClick={() => { setTab('explore'); setQ(t.tag.replace('#', '')); }}>
                  <span><b>{t.tag}</b><small>{t.posts} post{t.posts === 1 ? '' : 's'} · {t.languages?.join(', ').toUpperCase()}</small></span>
                  <Icon name="arrow" size={14} />
                </button>
              ))}
              {trending.length === 0 && <p className="muted">No trends yet.</p>}
            </div>
          </div>

          <div className="card ai-note">
            <h3><Icon name="sparkles" size={16} /> Multilingual discovery</h3>
            <p className="muted">Captions in any language are shown in yours on demand. Tap the translate icon on a post to read it in {user.language?.toUpperCase()}.</p>
          </div>
        </aside>
      </div>

      {composer && <Composer onClose={() => setComposer(false)} onCreated={p => { setFeed(f => [p, ...(f || [])]); setExplore(x => [p, ...(x || [])]); }} />}
    </div>
  );
}
