import React, { useEffect, useRef, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { API } from '../lib/api.js';
import { Icon, Avatar, Skeleton, Verified } from '../components/UI.jsx';
import { timeAgo } from '../lib/utils.js';
import { langOf } from '../lib/i18n.js';

/* ===========================================================================
   Reels — full-screen vertical feed, built to the UI/UX team's Reels screen.
   Every card is a real post from the feed; if nobody has posted media yet we
   say so instead of inventing a reel.
   ========================================================================= */

function Reel({ post, active }) {
  const { user, notify } = useApp();
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes || 0);
  const [saved, setSaved] = useState(!!post.saved);
  const [following, setFollowing] = useState(!!post.author?.followedByMe);
  const [translated, setTranslated] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const media = post.media || [];
  const first = media[0] || null;
  const src = post.originalLang || post.author?.language || 'en';

  const like = async () => {
    const next = !liked;
    setLiked(next); setLikes(n => n + (next ? 1 : -1));
    try { await API.likePost(post.id); } catch { setLiked(!next); setLikes(n => n + (next ? -1 : 1)); }
  };
  const save = async () => {
    const next = !saved;
    setSaved(next);
    try { await API.savePost(post.id); notify(next ? 'Saved' : 'Removed from saved', 'ok'); } catch { setSaved(!next); }
  };
  const follow = async () => {
    try { await API.follow(post.author.id); setFollowing(true); notify(`Following ${post.author.displayName}`, 'ok'); }
    catch (e) { notify(e.message, 'err'); }
  };
  const translate = async () => {
    if (translated) { setShowOriginal(v => !v); return; }
    try {
      const r = await API.aiTask({ kind: 'translate', text: post.caption, targetLang: user.language || 'en' });
      setTranslated(r.text); setShowOriginal(false);
    } catch (e) { notify(e.message, 'err'); }
  };

  const caption = showOriginal ? post.caption : (translated || post.caption);

  return (
    <div className="ux-reel">
      {first ? (
        first.type === 'video'
          ? <video src={first.url} autoPlay={active} muted loop playsInline />
          : <img src={first.url} alt={post.caption?.slice(0, 60) || 'reel'} />
      ) : (
        <div className="ux-reel-blank" />
      )}
      <div className="ux-reel-shade" />

      <div className="ux-reel-rail">
        <div className="b">
          <button className={`ic ${liked ? 'liked' : ''}`} onClick={like} aria-label="Like"><Icon name="heart" size={22} /></button>
          <span>{likes > 999 ? (likes / 1000).toFixed(1) + 'K' : likes}</span>
        </div>
        <div className="b">
          <button className="ic" onClick={() => navigate('explore')} aria-label="Comments"><Icon name="comment" size={20} /></button>
          <span>{post.comments || 0}</span>
        </div>
        <div className="b">
          <button className="ic" onClick={() => {
            const url = `${location.origin}/#/explore`;
            if (navigator.share) navigator.share({ title: 'AZOLVE', text: post.caption || '', url }).catch(() => {});
            else { navigator.clipboard?.writeText(url); notify('Link copied', 'ok'); }
          }} aria-label="Share"><Icon name="share" size={19} /></button>
          <span>Share</span>
        </div>
        <div className="b">
          <button className={`ic ${saved ? 'saved' : ''}`} onClick={save} aria-label="Save"><Icon name="bookmark" size={19} /></button>
          <span>Save</span>
        </div>
        <button className="ic more" onClick={() => navigate('profile', post.author.username)} aria-label="More"><Icon name="more" size={20} /></button>
      </div>

      <div className="ux-reel-info">
        <div className="ux-reel-who">
          <Avatar user={post.author} size={40} />
          <b>{post.author.displayName} {post.author.verified && <Verified size={14} />}</b>
          {post.author.id !== user.id && !following && (
            <button className="ux-reel-follow" onClick={follow}>Follow</button>
          )}
        </div>
        {caption && <p className="ux-reel-cap">{caption}</p>}
        {post.caption && src !== (user.language || 'en') && (
          <p className="ux-reel-tr">
            <Icon name="translate" size={14} />
            {translated ? (showOriginal ? 'Showing original' : `Translated from ${langOf(src).label}`) : 'Auto-translate'}
            <b onClick={translate} style={{ cursor: 'pointer' }}>
              {translated ? (showOriginal ? 'See translation' : 'See original') : 'Translate'}
            </b>
          </p>
        )}
        <div className="ux-reel-audio">
          <Icon name="volume" size={14} />
          <span>Original audio · {post.author.username}</span>
        </div>
      </div>

      <div className="ux-reel-disc" aria-hidden="true" />
    </div>
  );
}

export default function Home() {
  const { user, notify } = useApp();
  const [feed, setFeed] = useState(null);
  const [tab, setTab] = useState('foryou');
  const [progress, setProgress] = useState(0);
  const scroller = useRef(null);

  useEffect(() => {
    API.feed()
      .then(r => setFeed(r.posts || []))
      .catch(e => { notify(e.message, 'err'); setFeed([]); });
  }, []);

  const reels = (feed || []).filter(p => (p.media || []).length > 0);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const h = el.clientHeight || 1;
    setProgress(Math.min(100, Math.round(((el.scrollTop % h) / h) * 100)));
  };

  return (
    <div className="ux-reels">
      <div className="ux-reels-scroll" ref={scroller} onScroll={onScroll}>
        {feed === null && (
          <div className="ux-reel"><div className="ux-reel-blank" /><Skeleton h={400} /></div>
        )}

        {feed && reels.length === 0 && (
          <div className="ux-reel">
            <div className="ux-reel-blank" />
            <div className="ux-reel-empty">
              <Icon name="video" size={34} />
              <b>No reels yet</b>
              <p>When someone in your circle posts a photo or video, it plays here full-screen. Nothing is invented to fill the space.</p>
              <button className="ux-set-btn" style={{ width: 'auto', padding: '0 20px' }} onClick={() => navigate('explore')}>Open Updates</button>
            </div>
          </div>
        )}

        {reels.map((p, i) => <Reel key={p.id} post={p} active={i === 0} />)}
      </div>

      <div className="ux-reel-head">
        <div className="ux-reel-tabs">
          <span className={tab === 'following' ? 'on' : ''} onClick={() => setTab('following')}>Following</span>
          <span className={tab === 'foryou' ? 'on' : ''} onClick={() => setTab('foryou')}>For you</span>
        </div>
        <button className="ux-reel-search" onClick={() => navigate('people')} aria-label="Search">
          <Icon name="search" size={18} />
        </button>
      </div>

      <div className="ux-reel-prog"><i style={{ width: `${Math.max(6, progress)}%` }} /></div>
    </div>
  );
}
