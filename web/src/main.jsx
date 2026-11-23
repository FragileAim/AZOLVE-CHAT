import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './styles-v2.css';
import './styles-v3.css';
import './styles-mobile.css';
import './styles-v4.css';
import './styles-ux.css';

const DEMO = import.meta.env.VITE_DEMO === '1';

/* The hosting platform injects a "Made by …" badge. It is not part of the
   product, so we strip it (and any later re-injection) from the DOM. */
function removeHostBadge() {
  const kill = () => {
    document.querySelectorAll('#ninja-badge, .ninja-badge').forEach(el => el.remove());
  };
  kill();
  new MutationObserver(kill).observe(document.documentElement, { childList: true, subtree: true });
}

/* ---------------------------------------------------------------------------
   OAuth return trip.
   The Google redirect flow hands the session back in the URL fragment, because
   a fragment is never sent to the server and so never lands in an access log.
   We read it once, store it, and scrub it from the address bar before React
   mounts so the token is not left sitting in history or a screenshot.
   ------------------------------------------------------------------------- */
function absorbOAuthFragment() {
  const raw = window.location.hash || '';
  if (!raw.includes('token=')) return;
  const qIndex = raw.indexOf('?');
  if (qIndex === -1) return;
  const params = new URLSearchParams(raw.slice(qIndex + 1));
  const token = params.get('token');
  const refreshToken = params.get('refreshToken');
  if (token) {
    localStorage.setItem('azolve.token', token);
    if (refreshToken) localStorage.setItem('azolve.refresh', refreshToken);
  }
  const err = params.get('error');
  if (err) sessionStorage.setItem('azolve.oauth.error', err);
  /* Keep the route, drop the credentials. */
  window.history.replaceState(null, '', `${window.location.pathname}#/auth`);
}

async function boot() {
  removeHostBadge();
  absorbOAuthFragment();
  if (DEMO) {
    const { installDemo } = await import('./lib/demo.js');
    installDemo();
  }
  const root = createRoot(document.getElementById('root'));
  root.render(<App />);

  /* Registering the worker early means a call can ring this device even if the
     person never opens Settings. It does nothing until they grant permission. */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }
}

boot();
