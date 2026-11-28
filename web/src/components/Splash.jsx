import React from 'react';

/* ---------------------------------------------------------------------------
   Splash
   One design, used four times.

   The app used to show four different loading screens in sequence: the Android
   window background, a native LinearLayout built in MainActivity, this React
   component (aurora + orbit + eight greeting words + a percentage), and the
   `#preboot` block in index.html. Each had its own layout, so a cold start
   looked like the app restarting three times.

   This component now mirrors the native splash and `#preboot` pixel for pixel:
   the wordmark, the teal CHAT, the tagline and one thin indeterminate line.
   Nothing else. The handover is invisible, which is the whole point.
--------------------------------------------------------------------------- */
export default function Splash() {
  return (
    <div className="splash2" role="status" aria-live="polite" aria-label="Loading AZOLVE CHAT">
      <div className="splash2-word">AZOLVE</div>
      <div className="splash2-sub">CHAT</div>
      <div className="splash2-tag">Every language. One conversation.</div>
      <div className="splash2-bar" aria-hidden><i /></div>
    </div>
  );
}
