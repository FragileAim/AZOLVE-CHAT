import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './styles-v2.css';
import './styles-v3.css';

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

async function boot() {
  removeHostBadge();
  if (DEMO) {
    const { installDemo } = await import('./lib/demo.js');
    installDemo();
  }
  const root = createRoot(document.getElementById('root'));
  root.render(<App />);
}

boot();
