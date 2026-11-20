import React, { useEffect, useState } from 'react';
import { useApp, navigate } from '../App.jsx';
import { Icon, Avatar, Logo } from './UI.jsx';
import { API } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import Home from '../pages/Home.jsx';
import Chats from '../pages/Chats.jsx';
import Moments from '../pages/Moments.jsx';
import Explore from '../pages/Explore.jsx';
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
  { id: 'explore', label: 'Explore', icon: 'explore' },
  { id: 'ai', label: 'AZOLVE AI', icon: 'sparkles' },
  { id: 'calls', label: 'Calls', icon: 'phone' },
  { id: 'communities', label: 'Communities', icon: 'users' },
];

const MOBILE = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chats', label: 'Chats', icon: 'chat' },
  { id: 'explore', label: 'Explore', icon: 'explore' },
  { id: 'ai', label: 'AI', icon: 'sparkles' },
  { id: 'profile', label: 'You', icon: 'user' },
];

export default function AppShell() {
  const { user, route, theme, setTheme } = useApp();
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState(0);

  const loadBadges = async () => {
    try {
      const [c, n] = await Promise.all([API.chats(), API.notifications()]);
      setUnread(c.conversations.reduce((s, x) => s + (x.unread || 0), 0));
      setNotifs((n.notifications || []).filter(x => !x.read).length);
    } catch {}
  };

  useEffect(() => { loadBadges(); }, [route.page, route.param]);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onMsg = () => loadBadges();
    const onNotif = () => loadBadges();
    s.on('message:new', onMsg);
    s.on('notification:new', onNotif);
    return () => { s.off('message:new', onMsg); s.off('notification:new', onNotif); };
  }, [user?.id]);

  const page = route.page;
  const isAdmin = user.role === 'admin' || user.role === 'moderator';

  let content;
  switch (page) {
    case 'chats': content = <Chats />; break;
    case 'moments': content = <Moments />; break;
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

      <main className="main"><div className="page-wrap" key={page + ":" + (route.param || "")}>{content}</div></main>

      <nav className="mobile-nav">
        {MOBILE.map(n => (
          <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => navigate(n.id)}>
            <span className="mn-ic">
              <Icon name={n.id === 'profile' ? 'user' : n.icon} size={22} />
              {n.id === 'chats' && unread > 0 && <i className="rail-badge">{unread > 9 ? '9+' : unread}</i>}
            </span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
    </CallHost>
  );
}
