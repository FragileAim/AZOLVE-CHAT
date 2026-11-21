import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Modal, Empty, Skeleton, Verified } from '../components/UI.jsx';
import { API, uploadFile } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import { langOf } from '../lib/i18n.js';

/* ===========================================================================
   Updates — the social feed, built to the UI/UX team's SocialFeed screen.
   ========================================================================= */

function PostCard({ post, onChanged }) {
  const { user, notify } = useApp();
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes || 0);
  const [saved, setSaved] = useState(!!post.saved);
  const [following, setFollowing] = useState(!!post.author?.followedByMe);
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
  const follow = async () => {
    setFollowing(true);
    try { await API.follow(post.author.id); notify(`Following ${post.author.displayName}`, 'ok'); }
    catch (e) { setFollowing(false); notify(e.message, 'err'); }
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
  const src = post.originalLang || post.author?.language || 'en';

  return (
    <article className="ux-post">
      <div className="ux-post-head">
        <button type="button" className="ux-post-who" onClick={() => navigate('profile', post.author.username)}>
          <Avatar user={post.author} size={40} />
          <span style={{ minWidth: 0 }}>
            <b>{post.author.displayName} {post.author.verified && <Verified size={14} />}</b>
            <small>
              {post.location ? `${post.location} · ` : ''}{timeAgo(post.createdAt)}
            </small>
          </span>
        </button>
        {post.author.id !== user.id && (
          <button type="button" className="ux-post-follow" disabled={following} onClick={follow}>
            {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {media.length > 0 && (
        <div className={`ux-post-media${media.length > 1 ? ' multi' : ''}`}>
          {media.slice(0, 4).map((m, i) => m.kind === 'video'
            ? <video key={i} src={m.url} controls playsInline />
            : <img key={i} src={m.url} alt={post.caption?.slice(0, 60) || 'post'} loading="lazy" />)}
          {media.length > 1 && <span className="ux-post-count">1/{media.length}</span>}
        </div>
      )}

      <div className="ux-post-acts">
        <button type="button" className={liked ? 'on' : ''} onClick={toggleLike} aria-label="Like"><Icon name="heart" size={22} /></button>
        <button type="button" onClick={() => setOpenComments(true)} aria-label="Comments"><Icon name="comment" size={22} /></button>
        <button type="button" onClick={share} aria-label="Share"><Icon name="share" size={22} /></button>
        <button type="button" onClick={translate} disabled={busy} aria-label="Translate"><Icon name="translate" size={22} /></button>
        <button type="button" className={`ml ${saved ? 'on' : ''}`} onClick={toggleSave} aria-label="Save"><Icon name="bookmark" size={22} /></button>
      </div>

      <div className="ux-post-body">
        <p className="ux-post-likes">{Number(likes).toLocaleString()} likes</p>
        {post.caption && (
          <p className="ux-post-cap">
            <b>{post.author.username}</b> {translated || post.caption}
          </p>
        )}
        {translated && (
          <p className="ux-post-tr">
            <Icon name="translate" size={14} />
            Translated from {langOf(src).label} · <b onClick={() => setTranslated(null)}>See original</b>
          </p>
        )}
        <button type="button" className="ux-post-more" onClick={() => setOpenComments(true)}>
          {commentCount > 0 ? `View all ${commentCount} comments` : 'Be the first to comment'}
        </button>
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
  const [view, setView] = useState('foryou');
  const [moments, setMoments] = useState([]);
  const [feed, setFeed] = useState(null);
  const [explore, setExplore] = useState(null);
  const [trending, setTrending] = useState([]);
  const [people, setPeople] = useState([]);
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
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
    API.trending().then(r => setTrending(r.trending || [])).catch(() => { });
    API.moments().then(r => setMoments(r.moments || [])).catch(() => { });
    API.directory('', 6).then(r => setPeople((r.users || []).filter(u => u.id !== user.id).slice(0, 4))).catch(() => { });
  }, []);

  const searchPeople = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    try { const r = await API.searchUsers(q.trim()); setSearchResults(r.users || []); }
    catch { setSearchResults([]); }
  };

  const posts = view === 'reels' ? explore : feed;

  return (
    <div className="ux-screen">
      <div className="ux-scroll">

        <header className="ux-feed-head">
          <h1 className="ux-feed-h1">Updates</h1>
          <div className="acts">
            <button type="button" className="ux-round" onClick={() => setSearchOpen(v => !v)} aria-label="Search">
              <Icon name="search" size={20} />
            </button>
            <button type="button" className="ux-round blue" onClick={() => setComposer(true)} aria-label="Create a post">
              <Icon name="plus" size={20} />
            </button>
          </div>
        </header>

        {searchOpen && (
          <div className="ux-pad" style={{ paddingTop: 12, paddingBottom: 0 }}>
            <div className="ux-search">
              <Icon name="search" size={16} className="sl" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchPeople(e)}
                placeholder="Search people, hashtags, places…" />
              <button type="button" className="ux-search-x" onClick={() => { setQ(''); setSearchResults(null); setSearchOpen(false); }} aria-label="Close search">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
        )}

        <div className="ux-ftabs">
          <button type="button" className={`ux-ftab${view === 'foryou' ? ' on' : ''}`} onClick={() => setView('foryou')}>For you</button>
          <button type="button" className={`ux-ftab${view === 'following' ? ' on' : ''}`} onClick={() => setView('following')}>Following</button>
          <button type="button" className={`ux-ftab${view === 'reels' ? ' on' : ''}`} onClick={() => setView('reels')}>Reels</button>
        </div>

        <div className="ux-stories">
          <button type="button" className="ux-story" onClick={() => navigate('moments')}>
            <div className="ux-story-ring">
              <div className="inner"><Icon name="plus" size={22} /></div>
              <span className="ux-story-add"><Icon name="plus" size={14} stroke={3} /></span>
            </div>
            <p>Your story</p>
          </button>
          {moments.slice(0, 8).map(m => (
            <button key={m.id} type="button" className={`ux-story${m.viewed ? ' seen' : ''}`} onClick={() => navigate('moments')}>
              <div className={`ux-story-ring${m.viewed ? ' seen' : ''}`}>
                <div className="inner"><Avatar user={m.author || { displayName: 'User' }} size={61} /></div>
              </div>
              <p>{m.author?.displayName?.split(' ')[0] || 'User'}</p>
            </button>
          ))}
        </div>

        {searchResults && (
          <div className="ux-people-list" style={{ marginTop: 16 }}>
            <div className="ux-sub" style={{ margin: 0 }}>People <span>{searchResults.length}</span></div>
            {searchResults.length === 0 && <p className="muted">No accounts found.</p>}
            {searchResults.map(u => (
              <button key={u.id} type="button" className="ux-person" onClick={() => navigate('profile', u.username)}>
                <span className="ux-person-main">
                  <Avatar user={u} size={44} />
                  <span>
                    <b>{u.displayName} {u.verified && <Verified size={12} />}</b>
                    <small>@{u.username} · {u.country || 'Global'}</small>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {posts === null && [1, 2].map(i => <Skeleton key={i} h={420} style={{ margin: '20px 12px 0', borderRadius: 28 }} />)}

        {posts && posts.length === 0 && (
          <Empty icon="explore" title="Nothing here yet"
            text={view === 'reels' ? 'Try a different search.' : 'Follow people to fill your feed.'}
            action={<button className="btn primary" onClick={() => setComposer(true)}>Create the first post</button>} />
        )}

        {posts && posts.map(p => <PostCard key={p.id} post={p} onChanged={loadFeed} />)}

        {(people.length > 0 || trending.length > 0) && (
          <div className="ux-sugg">
            <div className="hd">
              <b>Suggested for you</b>
              <button type="button" onClick={() => navigate('people')}>See all</button>
            </div>
            <div className="row">
              {people.map(u => (
                <div key={u.id} className="ux-sugg-card">
                  <button type="button" onClick={() => navigate('profile', u.username)}
                    style={{ border: 0, background: 'none', padding: 0, width: '100%', cursor: 'pointer' }}>
                    <Avatar user={u} size={64} />
                    <b>{u.displayName}</b>
                    <span>{langOf(u.language).label} · {u.country || 'Global'}</span>
                  </button>
                  <button type="button" onClick={() => navigate('people')}>Follow</button>
                </div>
              ))}
              {people.length === 0 && trending.slice(0, 3).map(t => (
                <div key={t.tag} className="ux-sugg-card">
                  <div className="ph">#</div>
                  <b>{t.tag}</b>
                  <span>{t.posts} post{t.posts === 1 ? '' : 's'}</span>
                  <button type="button" onClick={() => { setView('reels'); setQ(t.tag.replace('#', '')); loadExplore(t.tag.replace('#', '')); }}>Explore</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>

      {composer && <Composer onClose={() => setComposer(false)} onCreated={p => { setFeed(f => [p, ...(f || [])]); setExplore(x => [p, ...(x || [])]); }} />}
    </div>
  );
}
