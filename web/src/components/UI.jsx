import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { initials, gradientFor } from '../lib/utils';

/* ------------------------------- icons ------------------------------------ */
const P = {
  home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-5.5h5V20"/></>,
  chat: <><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z"/></>,
  sparkles: <><path d="M12 3l1.7 4.6L18.5 9l-4.8 1.4L12 15l-1.7-4.6L5.5 9l4.8-1.4L12 3Z"/><path d="M18.5 15.5l.9 2.4 2.6.8-2.6.8-.9 2.4-.9-2.4-2.6-.8 2.6-.8.9-2.4Z"/></>,
  explore: <><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5 13.8 13.8 8.5 15.5l1.7-5.3 5.3-1.7Z"/></>,
  phone: <><path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"/></>,
  users: <><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6"/><path d="M17.5 14.4c2 .8 3.5 2.8 3.5 5.1"/></>,
  user: <><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-3.9 3.4-7 7.5-7s7.5 3.1 7.5 7"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></>,
  send: <><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5 21 3Z"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></>,
  heart: <><path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 3C19.5 15.4 12 20 12 20Z"/></>,
  comment: <><path d="M20.5 11.5a7.5 7.5 0 0 1-11 6.7L4.5 20l1.8-4.6A7.5 7.5 0 1 1 20.5 11.5Z"/></>,
  share: <><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 13v6.5h14V13"/></>,
  bookmark: <><path d="M6.5 3.5h11V21L12 17l-5.5 4V3.5Z"/></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/></>,
  image: <><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 3-3 4 4"/></>,
  video: <><rect x="3" y="6" width="12.5" height="12" rx="3"/><path d="m15.5 11 5.5-3v8l-5.5-3"/></>,
  file: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z"/><path d="M14 3.5v5h5"/></>,
  pin: <><path d="M9 3.5h6l-1 5 4 4v2H6v-2l4-4-1-5Z"/><path d="M12 14.5V21"/></>,
  star: <><path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9L12 3.5Z"/></>,
  reply: <><path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7v1"/></>,
  trash: <><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/></>,
  edit: <><path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/></>,
  check: <><path d="m4.5 12.5 5 5 10-11"/></>,
  checkcheck: <><path d="m1.5 12.5 4.5 4.5L15 7"/><path d="m9 15.5 1.5 1.5L22 5.5"/></>,
  bell: <><path d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4 18.5h16L18 15.5Z"/><path d="M10 21h4"/></>,
  lock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/></>,
  logout: <><path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14"/><path d="M17 8.5 20.5 12 17 15.5"/><path d="M10 12h10.5"/></>,
  back: <><path d="M20 12H4"/><path d="m10 6-6 6 6 6"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  camera: <><path d="M4 8.5h3l1.5-2.5h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z"/><circle cx="12" cy="13.5" r="3.5"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></>,
  moon: <><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></>,
  shield: <><path d="M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
  download: <><path d="M12 3.5v11"/><path d="m8 11 4 4 4-4"/><path d="M4.5 17.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/></>,
  chart: <><path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="5" width="3" height="12"/></>,
  play: <><path d="M8 5.5 18 12 8 18.5v-13Z"/></>,
  pause: <><path d="M9 5v14M15 5v14"/></>,
  smile: <><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><circle cx="9" cy="9.5" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r=".9" fill="currentColor" stroke="none"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></>,
  map: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></>,
  link: <><path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0L5.5 13.3a4 4 0 0 0 5.7 5.7l1.3-1.3"/></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeoff: <><path d="M4 4l16 16"/><path d="M9.9 5.9A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.4 4.2"/><path d="M6.4 7.9A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1"/></>,
  volume: <><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.5 7a7 7 0 0 1 0 10"/></>,
  screen: <><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/></>,
  verified: <><path d="m12 2.5 2.4 1.9 3-.3 1 2.9 2.6 1.6-1 2.9 1 2.9-2.6 1.6-1 2.9-3-.3L12 21.5l-2.4-1.9-3 .3-1-2.9L3 15.4l1-2.9-1-2.9 2.6-1.6 1-2.9 3 .3L12 2.5Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/></>,
  translate: <><path d="M3 5.5h9M7.5 3v2.5"/><path d="M9.5 5.5c0 4-3 7.5-6.5 8.5"/><path d="M5 10c1 2 3 3.7 5 4.5"/><path d="M13 20.5l3.5-9 3.5 9"/><path d="M14.3 17.5h4.4"/></>,
  magic: <><path d="M5 19 19 5"/><path d="M14 3.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z"/><path d="M6 13.5l.7 1.8 1.8.7-1.8.7L6 18.5l-.7-1.8-1.8-.7 1.8-.7L6 13.5Z"/></>,
  poll: <><path d="M5 20V10M12 20V4M19 20v-6"/></>,
  at: <><circle cx="12" cy="12" r="3.5"/><path d="M15.5 8.5v4.2a3 3 0 0 0 5.5 1.6A9 9 0 1 0 18 19.5"/></>,
  hashtag: <><path d="M9 3.5 7 20.5M17 3.5l-2 17M3.5 9h17M3 15h17"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/></>,
  warning: <><path d="M12 3.5 22 20.5H2L12 3.5Z"/><path d="M12 9.5v5"/><circle cx="12" cy="17.4" r=".9" fill="currentColor" stroke="none"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  gif: <><rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.5 10.5H8.8a1.8 1.8 0 0 0 0 3.6h1.7v-1.5"/><path d="M13 10v4.5M15.5 10h2.5M15.5 10v4.5M15.5 12.3h2"/></>,
  forward: <><path d="m14 6 6 6-6 6"/><path d="M20 12H9a5 5 0 0 0-5 5v1"/></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></>,
  archive: <><rect x="3" y="4.5" width="18" height="4.5" rx="1.5"/><path d="M4.5 9v9.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9"/><path d="M9.5 13h5"/></>,
  mute: <><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></>,
  zap: <><path d="M13 2.5 5 13.5h5.5L11 21.5l8-11h-5.5L13 2.5Z"/></>,
  brain: <><path d="M9.5 4.5A3 3 0 0 0 6.5 7.5 3 3 0 0 0 4.5 12a3 3 0 0 0 1.5 4.5 3 3 0 0 0 3.5 3V4.5Z"/><path d="M14.5 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 4.5 3 3 0 0 1-1.5 4.5 3 3 0 0 1-3.5 3V4.5Z"/></>,
  key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9 2 2-2 2 1.5 1.5-2 2L18 9l-3 3"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></>,
  smartphone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/></>,
  filter: <><path d="M3.5 5.5h17l-6.5 8v6l-4 2v-8l-6.5-8Z"/></>,
  arrow: <><path d="M4 12h16"/><path d="m14 6 6 6-6 6"/></>,
  gridview: <><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></>,
};

export function Icon({ name, size = 20, stroke = 1.75, className = '', style }) {
  const path = P[name];
  if (!path) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      {path}
    </svg>
  );
}

/* ------------------------------- logo ------------------------------------- */
export function Logo({ size = 40, withWord = false, tagline = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-label="AZOLVE CHAT">
        <defs>
          <linearGradient id="azg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6D5EF8" /><stop offset="0.55" stopColor="#4F8CFF" /><stop offset="1" stopColor="#18E0C8" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="18" fill="url(#azg)" />
        <path d="M32 14 L46 46 H38.5 L36 40 H28 L25.5 46 H18 Z M30.2 34 H33.8 L32 29.2 Z" fill="#fff" />
        <circle cx="47" cy="18" r="5" fill="#0A0A12" opacity=".18" />
        <circle cx="47" cy="18" r="2.6" fill="#fff" />
      </svg>
      {withWord && (
        <div>
          <div style={{ fontWeight: 800, letterSpacing: '-.03em', fontSize: 17, lineHeight: 1.1 }}>AZOLVE</div>
          <div style={{ fontSize: 9.5, letterSpacing: '.22em', color: 'var(--text-3)', fontWeight: 700 }}>CHAT</div>
          {tagline && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>by AZOLVE INFOTECH</div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ avatar ------------------------------------ */
export function Avatar({ user, size = 44, showStatus = false, online = false, ring = false, onClick }) {
  const name = user?.displayName || user?.name || '?';
  const url = user?.avatar;
  return (
    <div className="avatar" onClick={onClick} style={{
      width: size, height: size, fontSize: Math.max(10, size * 0.36), cursor: onClick ? 'pointer' : undefined,
      boxShadow: ring ? '0 0 0 2px var(--surface), 0 0 0 4px var(--indigo)' : undefined,
    }}>
      {url ? <img src={url} alt={name} loading="lazy" /> : (
        <div className="fallback" style={{ background: gradientFor(name) }}>{initials(name)}</div>
      )}
      {showStatus && online && <span className="status-dot" />}
    </div>
  );
}

/* ------------------------------ switch ------------------------------------ */
export function Switch({ on, onChange, label }) {
  return <button aria-label={label} aria-pressed={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

/* ------------------------------ modal ------------------------------------- */
export function Modal({ open, onClose, title, children, wide, footer }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal pop-in ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ toast ------------------------------------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter(i => i.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map(i => (
          <div key={i.id} className={`toast ${i.kind}`}>
            <Icon name={i.kind === 'err' ? 'warning' : 'check'} size={15} />{i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------ misc -------------------------------------- */
export function Empty({ icon = 'sparkles', title, text, action }) {
  return (
    <div className="empty">
      <div className="ic"><Icon name={icon} size={24} /></div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, r = 8, style }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map(o => {
        /* Callers have always passed { id, label }; older ones passed { value }.
           Accept both so a toggle can never silently do nothing. */
        const key = o.value !== undefined ? o.value : o.id;
        return (
          <button key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>{o.label}</button>
        );
      })}
    </div>
  );
}

export function Verified({ size = 14 }) {
  return <span className="badge-verified" title="Verified account"><Icon name="verified" size={size} stroke={1.6} /></span>;
}

export function LangTag({ code, label }) {
  return <span className="lang-tag"><Icon name="globe" size={11} stroke={2} />{label || code}</span>;
}
