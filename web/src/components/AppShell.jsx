import React, { useEffect, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Logo } from './UI.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { pushBackHandler } from '../lib/back.js';
import Home from '../pages/Home.jsx';
import Chats from '../pages/Chats.jsx';
import Moments from '../pages/Moments.jsx';
import Explore from '../pages/Explore.jsx';
import People from '../pages/People.jsx';
import AI from '../pages/AI.jsx';
import Calls from '../pages/Calls.jsx';
import Communities from '../pages/Communities.jsx';
import Profile from '../pages/Profile.jsx';
import Settings from '../pages/Settings.jsx';
import Admin from '../pages/Admin.jsx';
import CallHost from './CallHost.jsx';

const NAV = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chats', label: 'Chats', icon: 'chat' },
  { id: 'moments', label: 'Moments', icon: 'eye' },
  { id: 'people', label: 'People', icon: 'users' },
  { id: 'explore', label: 'Explore', icon: 'explore' },
  { id: 'ai', label: 'AZOLVE AI', icon: 'sparkles' },
  { id: 'calls', label: 'Calls', icon: 'phone' },
  { id: 'communities', label: 'Communities', icon: 'users' },
];

/* Screen names shown after the brand in the thin top bar, matching the design set. */
const SCREEN_LABEL = {
  home: 'Home',
  chats: 'Chat List',
  moments: 'Moments',
  people: 'Discover',
  explore: 'Social Feed',
  ai: 'AI Assistant',
  calls: 'Calls',
  communities: 'Communities',
  profile: 'Profile',
  settings: 'Translation Settings',
  admin: 'Admin',
};

/* The floating pill nav from the design set: Chats · Discover · + · Updates · Profile.
   Everything else (Moments, AI, Calls, Communities, Settings, Admin) lives in
   the "All screens" sheet so no feature loses its way in. */
const MOBILE_LEFT = [
  { id: 'chats', label: 'Chats', icon: 'chat' },
  { id: 'people', label: 'Discover', icon: 'explore' },
];
const MOBILE_RIGHT = [
  { id: 'explore', label: 'Updates', icon: 'eye' },
  { id: 'profile', label: 'Profile', icon: 'user' },
];
const MORE = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'moments', label: 'Moments', icon: 'eye' },
  { id: 'ai', label: 'AZOLVE AI', icon: 'sparkles' },
  { id: 'calls', label: 'Calls', icon: 'phone' },
  { id: 'communities', label: 'Communities', icon: 'users' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export default function AppShell() {
  const { user, route, theme, setTheme } = useApp();
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState(0);
  const [reqCount, setReqCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  const loadBadges = async () => {
    try {
      const [c, n, rq] = await Promise.all([
        API.chats(), API.notifications(), API.contactRequests().catch(() => ({ incoming: [] })),
      ]);
      setUnread(c.conversations.reduce((s, x) => s + (x.unread || 0), 0));
      setNotifs((n.notifications || []).filter(x => !x.read).length);
      setReqCount((rq.incoming || []).length);
    } catch {}
  };

  useEffect(() => { loadBadges(); }, [route.page, route.param]);

  /* The sheet is a modal, so it must be dismissible the way a phone user
     expects: Escape on a desktop keyboard, and the hardware/gesture back on
     Android. Without this the only way out was tapping the dimmed area, and on
     a short screen the sheet covered nearly all of it. */
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('keydown', onKey);
    /* Android hardware back closes the sheet instead of navigating away. */
    const off = pushBackHandler(() => { setMoreOpen(false); return true; });
    /* Stop the page behind the sheet from scrolling while it is open. */
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  /* Any navigation dismisses it, so it can never be left covering a new page. */
  useEffect(() => { setMoreOpen(false); }, [route.page, route.param]);

  /* Pages that change request state (accept, cancel, send) ask for a badge
     refresh instead of waiting for a navigation. */
  useEffect(() => {
    const h = () => loadBadges();
    window.addEventListener('azolve:badges', h);
    return () => window.removeEventListener('azolve:badges', h);
  }, []);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onMsg = () => loadBadges();
    const onNotif = () => loadBadges();
    s.on('message:new', onMsg);
    s.on('notification:new', onNotif);
    s.on('contact:request', onNotif);
    s.on('contact:accepted', onNotif);
    return () => {
      s.off('message:new', onMsg); s.off('notification:new', onNotif);
      s.off('contact:request', onNotif); s.off('contact:accepted', onNotif);
    };
  }, [user?.id]);

  const page = route.page;
  const isAdmin = user.role === 'admin' || user.role === 'moderator';

  let content;
  switch (page) {
    case 'chats': content = <Chats />; break;
    case 'moments': content = <Moments />; break;
    case 'people': content = <People />; break;
    case 'explore': content = <Explore />; break;
    case 'ai': content = <AI />; break;
    case 'calls': content = <Calls />; break;
    case 'communities': content = <Communities />; break;
    case 'profile': content = <Profile />; break;
    case 'settings': content = <Settings />; break;
    case 'admin': content = isAdmin ? <Admin /> : <Home />; break;
    default: content = <Home />;
  }

  return (
    <CallHost>
    <div className="app">
      <aside className="rail">
        <button className="rail-logo" onClick={() => navigate('home')} aria-label="AZOLVE CHAT home">
          <Logo size={38} />
        </button>

        <nav className="rail-nav">
          {NAV.map(n => (
            <button key={n.id} className={`rail-item ${page === n.id ? 'active' : ''}`}
              onClick={() => navigate(n.id)} title={n.label}>
              <span className="rail-ic">
                <Icon name={n.icon} size={21} />
                {n.id === 'chats' && unread > 0 && <i className="rail-badge">{unread > 9 ? '9+' : unread}</i>}
              {n.id === 'people' && reqCount > 0 && <i className="rail-badge">{reqCount > 9 ? '9+' : reqCount}</i>}
                {n.id === 'people' && reqCount > 0 && <i className="rail-badge">{reqCount > 9 ? '9+' : reqCount}</i>}
              </span>
              <span className="rail-label">{n.label}</span>
            </button>
          ))}
          {isAdmin && (
            <button className={`rail-item ${page === 'admin' ? 'active' : ''}`} onClick={() => navigate('admin')} title="Admin">
              <span className="rail-ic"><Icon name="shield" size={21} /></span>
              <span className="rail-label">Admin</span>
            </button>
          )}
        </nav>

        <div className="rail-bottom">
          <button className="rail-item" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
            <span className="rail-ic"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} /></span>
            <span className="rail-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button className="rail-item" onClick={() => navigate('settings')} title="Settings">
            <span className="rail-ic"><Icon name="settings" size={20} /></span>
            <span className="rail-label">Settings</span>
          </button>
          <button className="rail-avatar" onClick={() => navigate('profile')} title="Your profile">
            <Avatar user={user} size={36} showStatus online />
            {notifs > 0 && <i className="rail-dot" />}
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <span className="tb-brand">Azolve <b>Chat</b></span>
          <span className="tb-sep">—</span>
          <span className="tb-screen">{SCREEN_LABEL[page] || 'Home'}</span>
        </div>
        <div className="page-wrap" key={page + ":" + (route.param || "")}>{content}</div>
      </main>

      <nav className="mobile-nav">
        {MOBILE_LEFT.map(n => (
          <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => navigate(n.id)}>
            <span className="mn-ic">
              <Icon name={n.icon} size={20} />
              {n.id === 'chats' && unread > 0 && <i className="rail-badge">{unread > 9 ? '9+' : unread}</i>}
              {n.id === 'people' && reqCount > 0 && <i className="rail-badge">{reqCount > 9 ? '9+' : reqCount}</i>}
            </span>
            <span>{n.label}</span>
          </button>
        ))}

        <button
          className={`mn-center${moreOpen ? ' open' : ''}`}
          onClick={() => setMoreOpen(v => !v)}
          aria-label={moreOpen ? 'Close menu' : 'New chat and all screens'}
          aria-expanded={moreOpen}>
          <Icon name={moreOpen ? 'close' : 'plus'} size={20} />
        </button>

        {MOBILE_RIGHT.map(n => (
          <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => navigate(n.id)}>
            <span className="mn-ic"><Icon name={n.icon} size={20} /></span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      {moreOpen && (
        <div className="more-sheet below-nav" onClick={() => setMoreOpen(false)}>
          <div className="more-sheet-inner" onClick={e => e.stopPropagation()}>
            <div className="more-grab" onClick={() => setMoreOpen(false)} />
            <div className="more-head">
              <b className="more-title">All screens</b>
              <button className="more-close" onClick={() => setMoreOpen(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <button className="more-new" onClick={() => { setMoreOpen(false); navigate('chats'); }}>
              <Icon name="plus" size={18} /> New chat
            </button>
            <div className="more-grid">
              {MORE.map(n => (
                <button key={n.id} className={`more-item ${page === n.id ? 'active' : ''}`}
                  onClick={() => { setMoreOpen(false); navigate(n.id); }}>
                  <span className="more-ic"><Icon name={n.icon} size={20} /></span>
                  <span>{n.label}</span>
                </button>
              ))}
              {isAdmin && (
                <button className={`more-item ${page === 'admin' ? 'active' : ''}`}
                  onClick={() => { setMoreOpen(false); navigate('admin'); }}>
                  <span className="more-ic"><Icon name="shield" size={20} /></span>
                  <span>Admin</span>
                </button>
              )}
            </div>
            <button className="more-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
              {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            </button>
          </div>
        </div>
      )}
    </div>
    </CallHost>
  );
}
