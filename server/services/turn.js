/* ============================================================================
   TURN credentials
   ----------------------------------------------------------------------------
   Browsers cannot be trusted with a permanent TURN password, so the server
   mints short-lived ones and hands them to the client through /api/rtc/config.

   Three ways to get credentials, tried in this order:

   1. METERED (recommended)
      Metered gives you an API key + secret per "app". Set:

        TURN_APP=yourapp            # the sub-domain: yourapp.metered.live
        TURN_API_KEY=sk_id_...      # Key ID
        TURN_API_SECRET=sk_secret_...   # Signing secret

      We POST to https://<TURN_APP>.metered.live/api/v1/turn/credential and
      cache the result. Note: sk_id_/sk_secret_ are NOT a TURN username and
      password — they are API keys, and the relay will reject them if used
      directly. That is why TURN_APP is required.

   2. SELF-HOSTED coturn with the REST API (use-auth-secret)
      Set TURN_STATIC_AUTH_SECRET to the same value as coturn's
      `static-auth-secret`. We compute username = "<expiry>:azolve" and
      password = base64(HMAC-SHA1(secret, username)) per
      draft-uberti-behave-turn-rest. No API call, no network.

   3. STATIC username/password
      Set TURN_USERNAME and TURN_CREDENTIAL. Simplest, but the password is
      long-lived — fine for a team test, not for production.

   If none are set we return STUN only and say so honestly, because a call that
   silently fails on a mobile network is worse than one that warns you first.
   ========================================================================== */

import crypto from 'node:crypto';

const TTL_SECONDS = 60 * 60;          // credentials valid for 1 hour
const CACHE_MS = 30 * 60 * 1000;      // refresh Metered creds every 30 minutes

let meteredCache = null;              // { expiresAt, username, credential }
let meteredWarned = false;

const split = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

export function turnUrls() {
  return split(process.env.TURN_URL);
}

/** True when we have a way to mint real TURN credentials. */
export function turnReady() {
  if (!turnUrls().length) return false;
  if (process.env.TURN_STATIC_AUTH_SECRET) return true;
  if (process.env.TURN_APP && process.env.TURN_API_KEY && process.env.TURN_API_SECRET) return true;
  return !!(process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL);
}

/* ------------------------- coturn REST (RFC draft) ------------------------ */

function coturnRest(secret) {
  const username = `${Math.floor(Date.now() / 1000) + TTL_SECONDS}:azolve`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/* ------------------------------- Metered ---------------------------------- */

async function meteredCredentials() {
  const app = process.env.TURN_APP;
  const key = process.env.TURN_API_KEY;
  const secret = process.env.TURN_API_SECRET;
  if (!app || !key || !secret) return null;

  if (meteredCache && meteredCache.expiresAt > Date.now()) return meteredCache;

  const url = `https://${app}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(secret)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expiryInSeconds: TTL_SECONDS }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!meteredWarned) {
        console.warn(`[turn] Metered rejected the request (${res.status}): ${data?.reason || data?.message || 'unknown'}`);
        console.warn('[turn] Check TURN_APP — it must be the sub-domain of your Metered app, e.g. "azolve" for azolve.metered.live');
        meteredWarned = true;
      }
      return null;
    }
    const username = data.username || data.iceServers?.[0]?.username;
    const credential = data.password || data.credential || data.iceServers?.[0]?.credential;
    if (!username || !credential) {
      console.warn('[turn] Metered responded but without a username/password pair');
      return null;
    }
    meteredCache = { expiresAt: Date.now() + CACHE_MS, username, credential };
    console.log(`[turn] Metered credentials refreshed for ${app}.metered.live (valid ${TTL_SECONDS / 60} min)`);
    return meteredCache;
  } catch (e) {
    if (!meteredWarned) {
      console.warn(`[turn] Metered request failed: ${e?.name === 'AbortError' ? 'timed out' : e.message}`);
      meteredWarned = true;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------- public --------------------------------- */

/**
 * Build the ICE server list handed to the browser.
 * Never throws — on any failure it degrades to STUN plus an honest flag.
 */
export async function iceServers() {
  if (process.env.ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.length) {
        return { servers: parsed, turn: parsed.some(s => /turns?:/.test(String(s.urls))), source: 'ICE_SERVERS' };
      }
    } catch {
      console.warn('[rtc] ICE_SERVERS is not valid JSON — falling back to env parts');
    }
  }

  const stun = split(process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302');
  const servers = stun.map(urls => ({ urls }));
  const urls = turnUrls();
  if (!urls.length) return { servers, turn: false, source: 'stun-only' };

  let creds = null;
  let source = 'none';

  if (process.env.TURN_STATIC_AUTH_SECRET) {
    creds = coturnRest(process.env.TURN_STATIC_AUTH_SECRET);
    source = 'coturn-rest';
  } else if (process.env.TURN_APP) {
    creds = await meteredCredentials();
    source = creds ? 'metered' : 'metered-failed';
  }

  if (!creds && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    creds = { username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL };
    source = 'static';
  }

  /* A TURN entry without a username/credential is worse than no TURN entry at
     all: the browser throws InvalidAccessError inside the RTCPeerConnection
     constructor, so the call never even starts. Only advertise TURN when we
     actually minted credentials; otherwise stay on STUN and say so. */
  if (creds) {
    servers.push({ urls, username: creds.username, credential: creds.credential });
  } else {
    console.warn('[turn] TURN URLs are configured but no credentials could be minted — serving STUN only so calls still connect');
  }

  return { servers, turn: !!creds, source };
}
