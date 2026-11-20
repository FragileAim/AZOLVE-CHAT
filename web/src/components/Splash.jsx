import React, { useEffect, useState } from 'react';
import { Logo } from './UI.jsx';

const WORDS = ['नमस्ते', 'Hello', 'مرحبا', 'Hola', 'Bonjour', 'こんにちは', '你好', 'Olá'];

export default function Splash() {
  const [pct, setPct] = useState(6);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 1150);
      const eased = 1 - Math.pow(1 - t, 2.2);
      setPct(Math.round(6 + eased * 94));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="splash" role="status" aria-live="polite" aria-label="Loading AZOLVE CHAT">
      <div className="splash-aurora" aria-hidden />
      <div className="splash-words" aria-hidden>
        {WORDS.map((w, i) => (
          <span key={w} style={{ animationDelay: `${i * 0.22}s` }}>{w}</span>
        ))}
      </div>

      <div className="splash-core">
        <div className="splash-orbit" aria-hidden>
          <span className="sring r1" />
          <span className="sring r2" />
          <span className="sdot" />
        </div>
        <div className="splash-mark">
          <Logo size={62} />
        </div>
      </div>

      <div className="splash-brand">AZOLVE<span>CHAT</span></div>
      <div className="splash-tag">Every language. One conversation.</div>

      <div className="splash-progress">
        <div className="splash-track"><i style={{ width: `${pct}%` }} /></div>
        <div className="splash-meta">
          <span>Preparing your workspace</span>
          <b>{pct}%</b>
        </div>
      </div>

      <div className="splash-foot">AZOLVE INFOTECH · 27 languages · private by design</div>
    </div>
  );
}
