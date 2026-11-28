import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API, clearSession, getToken, setSession, warmUp } from './lib/api.js';
import { connectSocket, disconnectSocket } from './lib/socket.js';
import { makeT } from './lib/i18n.js';
import Auth from './pages/Auth.jsx';
import Onboarding from './pages/Onboarding.jsx';
import AppShell from './components/AppShell.jsx';
import Splash from './components/Splash.jsx';
import DevicePreview from './components/DevicePreview.jsx';

const DEMO = import.meta.env.VITE_DEMO === '1';
const QS = new URLSearchParams(location.search);
const FRAME = QS.get('frame') === '1';
/* The phone-frame preview is a demo affordance for wide screens only. It used to
   render on real phones too, which put the app inside an iframe where every tap
   changed the iframe's hash instead of the page's — so nothing navigated. */
const PREVIEW = QS.get('preview') === '1';

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
  /* Bright is the default. 'system' still respects the OS preference when the
     user explicitly picks it in Settings. */
  const [themePref, setThemePref] = useState(() => localStorage.getItem('azolve.theme') || 'light');
  const [systemDark, setSystemDark] = useState(prefersDark);
  const [device, setDevice] = useState(() => (PREVIEW ? (localStorage.getItem('azolve.device') || 'mobile') : 'desktop'));
  const [toast, setToast] = useState(null);
  const [waking, setWaking] = useState(null);
  /* True while what is on screen came from the on-device cache instead of the
     server. lib/api.js raises `azolve:offline` when it serves a cached read. */
  const [offline, setOffline] = useState(false);
  /* Set when the first request of the session fails for a reason that is not
     "you are signed out" — a sleeping host, a dead network. Showing the login
     screen in that case is what made the app feel like it logged people out
     every time they came back. */
  const [bootError, setBootError] = useState(null);
  const [bootTry, setBootTry] = useState(0);

  const theme = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref;

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);  }, []);

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
    /* Start the server booting while the splash is still on screen. */
    warmUp();
    (async () => {
      if (getToken()) {
        try {
          await refreshMe();
          setBootError(null);
        } catch (e) {
          /* Only a real rejection signs you out. A 502 while the free host
             wakes up, or a dropped mobile connection, must never cost you your
             session — that was the "it logs me out every time" bug. */
          const rejected = e?.status === 401 || e?.code === 'session_revoked' || e?.code === 'session_missing';
          if (rejected) clearSession();
          else setBootError(e);
        }
      }
      // keep the splash on screen long enough to feel intentional
      const elapsed = performance.now() - started;
      const target = Number(new URLSearchParams(location.search).get('splash')) || 900;
      const wait = Math.max(0, target - elapsed);
      setTimeout(() => setBooting(false), wait);
    })();
  }, [refreshMe, bootTry]);

  /* While the reconnect card is on screen, keep trying in the background. A
     cold host that takes 40 seconds to answer should not require the person to
     tap a button six times. */
  useEffect(() => {
    if (!bootError || user || !getToken()) return;
    const t = setTimeout(() => setBootTry((n) => n + 1), 7000);
    return () => clearTimeout(t);
  }, [bootError, bootTry, user]);

  /* Offline indicator. Raised when api.js answers from disk, cleared as soon as
     the browser reports a connection again. */
  useEffect(() => {
    const off = () => { setOffline(true); setWaking(false); };
    const on = () => setOffline(false);
    window.addEventListener('azolve:offline', off);
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('azolve:offline', off);
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, []);

  useEffect(() => {
    if (user) connectSocket();
    else disconnectSocket();
    return () => {};
  }, [user?.id]);

  /* Push registration. Runs once per signed-in user. It deliberately does not
     throw or toast on failure: push is an enhancement, and a browser that
     refuses permission must not break the app. The result is logged so the
     reason is always discoverable instead of silently swallowed. */
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const run = async () => {
      try {
        const { registerPush } = await import('./lib/fcm.js');
        const r = await registerPush();
        if (!alive) return;
        if (r.ok) console.log(`[push] registered via ${r.transport}`);
        else console.log(`[push] not registered: ${r.reason}`);
      } catch (e) {
        console.warn('[push] registration error:', e?.message || e);
      }
    };
    run();

    /* Re-register every time the app comes back to the foreground.
       A device token can be rotated by Firebase while the app is closed, and a
       registration that failed on a cold start (no network yet, Firebase still
       warming up) would otherwise never be retried — which is one of the ways a
       phone ends up unreachable for calls. */
    const onVisible = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
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

  /* The API layer fires this while it waits for a sleeping server to boot, so
     people see "starting up" rather than a wrong "check your connection". */
  useEffect(() => {
    const onWaking = (e) => setWaking(e?.detail?.done ? null : (e?.detail || {}));
    window.addEventListener('azolve:server-waking', onWaking);
    return () => window.removeEventListener('azolve:server-waking', onWaking);
  }, []);

  /* The API layer fires this when a refresh token is dead (expired, signed out
     elsewhere, or wiped with the database). Drop straight to the sign-in screen
     with one clear sentence instead of a wall of 401 errors. */
  useEffect(() => {
    const onExpired = (e) => {
      setUser(null);
      setNeedsOnboarding(false);
      disconnectSocket();
      navigate('home');
      notify(
        e?.detail?.reason === 'revoked'
          ? 'This session was signed out. Please sign in again.'
          : 'Your session expired. Please sign in again.',
        'err',
      );
    };
    window.addEventListener('azolve:session-expired', onExpired);
    return () => window.removeEventListener('azolve:session-expired', onExpired);
  }, [notify]);

  const value = {
    user, setUser, refreshMe, lang, t, theme, themePref, setTheme: setThemePref,
    notify, login, logout, needsOnboarding, setNeedsOnboarding, route, navigate,
    device, setDevice, inFrame: FRAME,
  };

  if (booting) return <Splash />;

  /* The server could not be reached but we still hold a session. Offer a retry
     instead of dumping a signed-in person on the login screen.
     The copy never mentions hosting tiers or "the server waking up": that is
     infrastructure detail leaking into the product, and it made the app look
     unfinished. It also retries on its own, so nobody has to babysit a button. */
  if (bootError && !user && getToken()) {
    return (
      <div className="boot-retry">
        <div className="boot-retry-card">
          <div className="boot-retry-word">AZOLVE<span>CHAT</span></div>
          <h2>Reconnecting…</h2>
          <p>
            You are still signed in on this device. AZOLVE CHAT could not reach
            your workspace — check your connection and this screen will continue
            on its own.
          </p>
          <div className="boot-retry-actions">
            <button
              className="btn primary"
              onClick={() => { setBootError(null); setBooting(true); setBootTry((n) => n + 1); }}
            >
              Try now
            </button>
            <button className="btn ghost" onClick={() => { clearSession(); setBootError(null); }}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (PREVIEW && device === 'mobile' && !FRAME) {
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
      {waking && !offline && (
        <div className="wake-banner" role="status" aria-live="polite">
          <span className="wake-dot" />
          <span>Connecting to AZOLVE…</span>
        </div>
      )}
      {offline && (
        <div className="offline-banner" role="status" aria-live="polite">
          <span className="offline-dot" />
          <span>Offline — showing saved content</span>
        </div>
      )}
      {DEMO && !FRAME && (
        <div className="demo-flag" title="Static preview: data is a snapshot of the seeded database and changes stay in this browser.">
          <span className="demo-dot" /> Preview mode · demo data
        </div>
      )}
      {PREVIEW && !FRAME && (
        <button className="device-toggle" onClick={() => setDevice('mobile')} title="See the app in a phone frame">
          <span className="dt-ic" aria-hidden>▢</span>
          <span>Mobile view</span>
        </button>
      )}
    </AppCtx.Provider>
  );
}
