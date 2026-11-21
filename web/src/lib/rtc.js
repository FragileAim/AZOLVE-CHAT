/* ---------------------------------------------------------------------------
   ICE configuration loader
   The server decides which STUN/TURN servers to use (see /api/rtc/config).
   We cache the answer for the session so a call never waits on a round trip
   after the first one.
--------------------------------------------------------------------------- */

const FALLBACK = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  hasTurn: false,
  ringTimeout: 45000,
  iceTransportPolicy: 'all',
};

let cached = null;
let inflight = null;

export async function getIceConfig() {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch('/api/rtc/config', { credentials: 'include' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      cached = { ...FALLBACK, ...d };
    } catch {
      cached = FALLBACK;
    }
    inflight = null;
    return cached;
  })();
  return inflight;
}

/* Never hand the browser a TURN server without credentials: the constructor
   throws and the whole call dies before a single packet is sent. Filtering here
   means a bad server response can only ever downgrade us to STUN, not break
   calling outright. */
function sanitiseIceServers(list) {
  return (Array.isArray(list) ? list : []).filter((s) => {
    if (!s || !s.urls) return false;
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    const needsCreds = urls.some((u) => /^turns?:/i.test(String(u)));
    return !needsCreds || Boolean(s.username && s.credential);
  });
}

export function toRtcConfig(cfg) {
  const iceServers = sanitiseIceServers(cfg?.iceServers);
  return {
    iceServers: iceServers.length ? iceServers : FALLBACK.iceServers,
    iceTransportPolicy: cfg.iceTransportPolicy || 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 4,
  };
}

/* ---------------------------------------------------------------------------
   Quality from real getStats() numbers rather than connection state alone.
   Returns 'excellent' | 'good' | 'weak' | 'lost' | 'connecting'.
--------------------------------------------------------------------------- */
export async function readQuality(pc) {
  if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') return 'lost';
  if (pc.connectionState !== 'connected') return 'connecting';
  try {
    const stats = await pc.getStats();
    let rtt = null;
    let lossPct = null;
    let jitter = null;

    stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null) {
        rtt = s.currentRoundTripTime * 1000;
      }
      if (s.type === 'inbound-rtp' && s.kind === 'audio') {
        if (s.jitter != null) jitter = s.jitter * 1000;
        if (s.packetsReceived && s.packetsLost != null) {
          const total = s.packetsReceived + s.packetsLost;
          if (total > 20) lossPct = (s.packetsLost / total) * 100;
        }
      }
    });

    if (rtt == null && lossPct == null) return 'good';
    if ((rtt != null && rtt > 400) || (lossPct != null && lossPct > 8)) return 'weak';
    if ((rtt != null && rtt > 180) || (lossPct != null && lossPct > 2)) return 'good';
    return 'excellent';
  } catch {
    return 'good';
  }
}
