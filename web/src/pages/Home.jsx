import React, { useEffect, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { API } from '../lib/api.js';
import { Icon, Avatar, Skeleton, Empty, Verified } from '../components/UI.jsx';
import { timeAgo } from '../lib/utils.js';
import { langOf } from '../lib/i18n.js';

export default function Home() {
  const { user, lang, notify } = useApp();
  const [data, setData] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [chats, moments, trending, sugg, status] = await Promise.all([
          API.chats(), API.moments(), API.trending(), API.suggestions(), API.aiStatus(),
        ]);
        setData({ chats: chats.conversations, moments: moments.groups, trending: trending.trending, sugg: sugg.users });
        setAiStatus(status);
      } catch (e) { notify(e.message, 'err'); }
    })();
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = (user.displayName || 'there').split(' ')[0];
  const unread = data?.chats.reduce((s, c) => s + (c.unread || 0), 0) || 0;

  return (
    <div className="page home-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{greeting}</div>
          <h1>{first}<span className="soft">, everything is in your language.</span></h1>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => navigate('explore')}><Icon name="search" size={16} /> Discover</button>
          <button className="btn primary" onClick={() => navigate('chats')}><Icon name="chat" size={16} /> Open chats {unread > 0 && <span className="pill-count">{unread}</span>}</button>
        </div>
      </div>

      <section className="hero-card">
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="eyebrow"><span className="pulse-dot" /> UNIVERSAL LANGUAGE MODE · ACTIVE</div>
          <h2>You write in {langOf(lang).label}.<br /><em>Everyone reads in theirs.</em></h2>
          <p>
            {data ? `${data.chats.length} conversations · ${data.chats.reduce((s, c) => s + c.participants.length, 0)} people` : 'Loading your world'} —
            each message is translated per recipient, with the original always preserved.
          </p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => navigate('chats')}>Start a conversation <Icon name="arrow" size={16} /></button>
            <button className="btn ghost" onClick={() => navigate('ai')}><Icon name="sparkles" size={16} /> Ask AZOLVE AI</button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring r1" /><div className="orbit-ring r2" /><div className="orbit-ring r3" />
          <div className="orbit-core"><Icon name="globe" size={30} /></div>
          {['नमस्ते', 'Hello', 'مرحبا', 'Hola', 'こんにちは', 'Bonjour'].map((w, i) => (
            <span key={w} className={`orbit-word w${i + 1}`}>{w}</span>
          ))}
        </div>
      </section>

      <div className="dash-grid">
        <section className="card span-2">
          <div className="card-head">
            <h3>Recent conversations</h3>
            <button className="link-btn" onClick={() => navigate('chats')}>View all <Icon name="arrow" size={13} /></button>
          </div>
          {!data ? <Skeleton h={180} /> : data.chats.length === 0 ? (
            <Empty icon="chat" title="No conversations yet" text="Start a direct message or create a group."
              action={<button className="btn primary sm" onClick={() => navigate('chats')}>Start chatting</button>} />
          ) : (
            <div className="conv-mini-list">
              {data.chats.slice(0, 5).map(c => (
                <button key={c.id} className="conv-mini" onClick={() => navigate('chats', c.id)}>
                  <Avatar user={{ displayName: c.title, avatar: c.avatar }} size={42} showStatus online={c.other?.online} />
                  <div className="cm-main">
                    <div className="cm-top"><b>{c.title}</b><span>{timeAgo(c.lastMessageAt)}</span></div>
                    <div className="cm-sub">
                      {c.lastMessage?.translated && <Icon name="translate" size={12} />}
                      <span className="ellipsis">{c.lastMessage?.displayBody || c.lastMessage?.body || 'No messages yet'}</span>
                      {c.unread > 0 && <i className="unread-dot">{c.unread}</i>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h3>Moments</h3><button className="link-btn" onClick={() => navigate('moments')}>Open</button></div>
          {!data ? <Skeleton h={160} /> : data.moments.length === 0 ? (
            <Empty icon="eye" title="No moments yet" text="Share a moment with your circle." />
          ) : (
            <div className="moment-mini-rail">
              {data.moments.slice(0, 6).map(g => (
                <button key={g.user.id} className="moment-mini" onClick={() => navigate('moments')}>
                  <div className={`mm-ring ${g.allViewed ? 'seen' : ''}`}>
                    <Avatar user={g.user} size={52} />
                  </div>
                  <span>{g.user.displayName.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mini-stat-row">
            <div><b>{data?.moments.length || 0}</b><span>active circles</span></div>
            <div><b>{data?.chats.filter(c => c.type === 'group').length || 0}</b><span>groups</span></div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>AI assistant</h3><span className={`chip tiny ${aiStatus?.engine === 'local-heuristic' ? '' : 'on'}`}>{aiStatus?.engine || '…'}</span></div>
          <div className="ai-teaser">
            <div className="ai-orb sm"><Icon name="sparkles" size={20} /></div>
            <p>Summarise a thread, rewrite a message, or draft a caption in any language.</p>
          </div>
          <div className="quick-grid">
            <button onClick={() => navigate('ai')}><Icon name="brain" size={17} /> Summarise</button>
            <button onClick={() => navigate('ai')}><Icon name="edit" size={17} /> Rewrite</button>
            <button onClick={() => navigate('ai')}><Icon name="translate" size={17} /> Translate</button>
            <button onClick={() => navigate('ai')}><Icon name="magic" size={17} /> Caption</button>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            Engine: <b>{aiStatus?.engine || 'checking'}</b>. Add an API key in <code>.env</code> to use a hosted model.
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Trending globally</h3><button className="link-btn" onClick={() => navigate('explore')}>Explore</button></div>
          <div className="trend-list">
            {(data?.trending || []).slice(0, 6).map((t, i) => (
              <button key={t.tag} className="trend-row" onClick={() => navigate('explore')}>
                <span className="trend-rank">{String(i + 1).padStart(2, '0')}</span>
                <div><b>{t.tag}</b><span>{t.posts} post{t.posts > 1 ? 's' : ''} · {t.languages.join(', ')}</span></div>
                <Icon name="arrow" size={14} />
              </button>
            ))}
            {data && data.trending.length === 0 && <div className="hint">No trends yet.</div>}
          </div>
        </section>

        <section className="card span-2">
          <div className="card-head"><h3>People you may know</h3><button className="link-btn" onClick={() => navigate('explore')}>See more</button></div>
          {!data ? <Skeleton h={90} /> : data.sugg.length === 0 ? (
            <div className="hint">You're following everyone in the demo network.</div>
          ) : (
            <div className="people-row">
              {data.sugg.slice(0, 6).map(u => (
                <button key={u.id} className="person-card" onClick={() => navigate('profile', u.username)}>
                  <Avatar user={u} size={52} showStatus online={u.online} />
                  <b>{u.displayName} {u.verified && <Verified size={12} />}</b>
                  <span>@{u.username}</span>
                  <span className="lang-pill">{langOf(u.language).native}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
