import React, { useEffect, useMemo, useState } from 'react';

const PRESETS = [
  { id: 'iphone14', label: 'iPhone 14 Pro', w: 393, h: 852, radius: 54 },
  { id: 'iphonese', label: 'iPhone SE', w: 375, h: 667, radius: 30 },
  { id: 'pixel', label: 'Pixel 7', w: 412, h: 915, radius: 40 },
];

export default function DevicePreview({ path, hash, onExit, theme, onTheme }) {
  const [preset, setPreset] = useState(() => localStorage.getItem('azolve.device.preset') || 'iphone14');
  const [scale, setScale] = useState(1);
  const [frameKey, setFrameKey] = useState(0);

  const dev = PRESETS.find(p => p.id === preset) || PRESETS[0];

  useEffect(() => {
    localStorage.setItem('azolve.device.preset', preset);
  }, [preset]);

  useEffect(() => {
    const fit = () => {
      const availH = window.innerHeight - 240;
      const availW = window.innerWidth - 70;
      setScale(Math.min(1, availH / dev.h, availW / dev.w));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [dev.h, dev.w]);

  const src = useMemo(() => {
    const base = `${path}?frame=1`;
    return base + (hash || '');
  }, [path, hash]);

  return (
    <div className="device-stage">
      <div className="device-glow" aria-hidden />

      <header className="device-bar">
        <div className="device-bar-left">
          <span className="device-live"><i /> Live device preview</span>
          <span className="device-note">This is the real app rendered at phone size — tap and scroll inside it.</span>
        </div>

        <div className="device-seg" role="group" aria-label="Device size">
          {PRESETS.map(p => (
            <button
              key={p.id}
              className={preset === p.id ? 'on' : ''}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
              <em>{p.w}×{p.h}</em>
            </button>
          ))}
        </div>

        <div className="device-bar-right">
          <div className="device-theme" role="group" aria-label="Theme">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => onTheme('light')} title="Light mode">☀</button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => onTheme('dark')} title="Dark mode">☾</button>
            <button className={theme === 'system' ? 'on' : ''} onClick={() => onTheme('system')} title="Follow system">Auto</button>
          </div>
          <button className="device-btn" onClick={() => setFrameKey(k => k + 1)} title="Reload the preview">↻</button>
          <a className="device-btn" href={src} target="_blank" rel="noreferrer" title="Open full screen">⤢</a>
          <button className="device-btn primary" onClick={onExit}>Desktop view</button>
        </div>
      </header>

      <div className="device-fit" style={{ height: dev.h * scale + 34, width: dev.w * scale + 34 }}>
        <div
          className="device-frame"
          style={{
            width: dev.w + 22,
            height: dev.h + 22,
            borderRadius: dev.radius + 11,
            transform: `scale(${scale})`,
          }}
        >
          <div className="device-screen" style={{ borderRadius: dev.radius }}>
            <iframe
              key={frameKey}
              src={src}
              title="AZOLVE CHAT mobile preview"
              className="device-iframe"
            />
          </div>
          <span className="device-island" aria-hidden />
          <span className="device-home" aria-hidden />
        </div>
      </div>

      <div className="device-hint">Safe-area aware · bottom tab bar · one-hand reachable controls</div>
    </div>
  );
}
