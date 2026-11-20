import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API, clearSession, getToken, setSession } from './lib/api.js';
import { connectSocket, disconnectSocket } from './lib/socket.js';
import { makeT } from './lib/i18n.js';
import Auth from './pages/Auth.jsx';
import Onboarding from './pages/Onboarding.jsx';
import AppShell from './components/AppShell.jsx';
import Splash from './components/Splash.jsx';
import DevicePreview from './components/DevicePreview.jsx';

const DEMO = import.meta.env.VITE_DEMO === '1';
const FRAME = new URLSearchParams(location.search).get('frame') === '1';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

function readHash() {
  const h = (location.hash || '#/home').replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { page: parts[0] || 'home', param: parts[1] || null, query: new URLSearchParams(qs || '') };
}

export function navigate(page, param) {
  location.hash = `#/${page}${param ? `/${param}` : ''}`;
}

const prefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [route, setRoute] = useState(readHash());
  const [themePref, setThemePref] = useState(() => localStorage.getItem('azolve.theme') || 'dark');
  const [systemDark, setSystemDark] = useState(prefersDark);
  const [device, setDevice] = useState(() => localStorage.getItem('azolve.device') || 'desktop');
  const [toast, setToast] = useState(null);

  const theme = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref;

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0A0A12' : '#F6F6FA');
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('azolve.theme', themePref);
  }, [themePref]);

  useEffect(() => {
    localStorage.setItem('azolve.device', device);
  }, [device]);

  const notify = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind, at: Date.now() });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshMe = useCallback(async () => {
    const d = await API.me();
    setUser(d.user);
    setNeedsOnboarding(!!d.needsOnboarding);
    return d.user;
  }, []);

  useEffect(() => {
    const started = performance.now();
    (async () => {
      if (getToken()) {
        try { await refreshMe(); } catch { clearSession(); }
      }
      // keep the splash on screen long enough to feel intentional
      const elapsed = performance.now() - started;
      const target = Number(new URLSearchParams(location.search).get('splash')) || 1250;
      const wait = Math.max(0, target - elapsed);
      setTimeout(() => setBooting(false), wait);
    })();
  }, [refreshMe]);

  useEffect(() => {
    if (user) connectSocket();
    else disconnectSocket();
    return () => {};
  }, [user?.id]);

  const lang = user?.language || 'en';
  const t = useMemo(() => makeT(lang), [lang]);

  const login = useCallback(async (payload) => {
    setSession(payload);
    setUser(payload.user);
    setNeedsOnboarding(!!payload.needsOnboarding);
    return payload;
  }, []);

  const logout = useCallback(async () => {
    try { await API.logout(); } catch {}
    clearSession();
    disconnectSocket();
    setUser(null);
    navigate('home');
  }, []);

  const value = {
    user, setUser, refreshMe, lang, t, theme, themePref, setTheme: setThemePref,
    notify, login, logout, needsOnboarding, setNeedsOnboarding, route, navigate,
    device, setDevice, inFrame: FRAME,
  };

  if (booting) return <Splash />;

  if (device === 'mobile' && !FRAME) {
    return (
      <AppCtx.Provider value={value}>
        <DevicePreview
          hash={location.hash}
          path={location.pathname}
          onExit={() => setDevice('desktop')}
          onTheme={setThemePref}
          theme={theme}
        />
      </AppCtx.Provider>
    );
  }

  return (
    <AppCtx.Provider value={value}>
      {!user ? (
        <Auth />
      ) : needsOnboarding ? (
        <Onboarding />
      ) : (
        <AppShell />
      )}
      {toast && (
        <div className={`toast ${toast.kind === 'err' ? 'err' : 'ok'}`}>{toast.msg}</div>
      )}
      {DEMO && !FRAME && (
        <div className="demo-flag" title="Static preview: data is a snapshot of the seeded database and changes stay in this browser.">
          <span className="demo-dot" /> Preview mode · demo data
        </div>
      )}
      {!FRAME && (
        <button className="device-toggle" onClick={() => setDevice('mobile')} title="See the app in a phone frame">
          <span className="dt-ic" aria-hidden>▢</span>
          <span>Mobile view</span>
        </button>
      )}
    </AppCtx.Provider>
  );
}
