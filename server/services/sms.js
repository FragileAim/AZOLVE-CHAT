/* ============================================================================
   OTP DELIVERY — pluggable SMS providers
   ----------------------------------------------------------------------------
   The app never talks to a specific vendor. It asks this module to deliver a
   code, and the module picks the provider named by SMS_PROVIDER.

   Providers, cheapest first:

     console   FREE, no account. Prints the code to the server log. This is the
               right choice for a team test on Render: everyone reads the code
               from the Render logs (or from OTP_DEV_ECHO when explicitly on).
     textbelt  Free tier: 1 SMS/day with key "textbelt". Good for a smoke test.
     fast2sms  India. Free trial credits. Production needs DLT registration.
     msg91     India. Free trial credits. Production needs DLT registration.
     2factor   India. Free trial credits, simplest OTP API.
     vonage    Free trial credit (~2 EUR). Trial only reaches verified numbers.
     twilio    Free trial credit (~15 USD). Trial only reaches verified numbers.

   Every provider call is wrapped: a delivery failure never throws into the
   request handler, it returns { ok:false, error } so the caller can tell the
   user "we could not send the code" instead of pretending it was sent.
   ========================================================================== */

const PROVIDER = (process.env.SMS_PROVIDER || 'console').toLowerCase();

const digits = (s) => String(s || '').replace(/[^\d+]/g, '').replace(/^\+/, '');

function timeout(ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function postJson(url, body, headers = {}) {
  const t = timeout();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    return { status: res.status, ok: res.ok, data };
  } finally { t.done(); }
}

async function postForm(url, params, headers = {}) {
  const t = timeout();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(params).toString(),
      signal: t.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    return { status: res.status, ok: res.ok, data };
  } finally { t.done(); }
}

/* ------------------------------- providers -------------------------------- */

const providers = {
  /* Free. No account, no network. The code goes to the server log. */
  async console({ phone, code }) {
    console.log(`\n  ┌─────────────────────────────────────────────┐`);
    console.log(`  │  AZOLVE OTP                                  │`);
    console.log(`  │  to: ${String(phone).padEnd(39)}│`);
    console.log(`  │  code: ${code}                               │`);
    console.log(`  └─────────────────────────────────────────────┘\n`);
    return { ok: true, provider: 'console', id: `log_${Date.now()}` };
  },

  /* Free tier: 1 message/day on key "textbelt". */
  async textbelt({ phone, code }) {
    const key = process.env.TEXTBELT_KEY || 'textbelt';
    const r = await postForm('https://textbelt.com/text', {
      phone: digits(phone),
      message: `Your AZOLVE verification code is ${code}. It expires in 10 minutes.`,
      key,
    });
    if (!r.ok || r.data?.success === false) {
      return { ok: false, provider: 'textbelt', error: r.data?.error || `HTTP ${r.status}` };
    }
    return { ok: true, provider: 'textbelt', id: r.data?.textId };
  },

  async fast2sms({ phone, code }) {
    const key = process.env.FAST2SMS_API_KEY;
    if (!key) return { ok: false, provider: 'fast2sms', error: 'FAST2SMS_API_KEY is not set' };
    const r = await postJson('https://www.fast2sms.com/dev/bulkV2', {
      route: 'q',
      message: `Your AZOLVE verification code is ${code}. Valid for 10 minutes.`,
      language: 'english',
      flash: 0,
      numbers: digits(phone),
    }, { authorization: key });
    if (!r.ok || r.data?.return === false) {
      return { ok: false, provider: 'fast2sms', error: r.data?.message || `HTTP ${r.status}` };
    }
    return { ok: true, provider: 'fast2sms', id: r.data?.request_id };
  },

  async msg91({ phone, code }) {
    const key = process.env.MSG91_AUTH_KEY;
    const template = process.env.MSG91_TEMPLATE_ID;
    if (!key || !template) return { ok: false, provider: 'msg91', error: 'MSG91_AUTH_KEY / MSG91_TEMPLATE_ID are not set' };
    const r = await postJson('https://control.msg91.com/api/v5/flow/', {
      template_id: template,
      short_url: '0',
      recipients: [{ mobiles: digits(phone), otp: code }],
    }, { authkey: key });
    if (!r.ok) return { ok: false, provider: 'msg91', error: r.data?.message || `HTTP ${r.status}` };
    return { ok: true, provider: 'msg91', id: r.data?.request_id };
  },

  async '2factor'({ phone, code }) {
    const key = process.env.TWOFACTOR_API_KEY;
    if (!key) return { ok: false, provider: '2factor', error: 'TWOFACTOR_API_KEY is not set' };
    const t = timeout();
    try {
      const res = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(key)}/SMS/${digits(phone)}/${code}`, { signal: t.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.Status === 'Error') {
        return { ok: false, provider: '2factor', error: data?.Details || `HTTP ${res.status}` };
      }
      return { ok: true, provider: '2factor', id: data?.Details };
    } finally { t.done(); }
  },

  async vonage({ phone, code }) {
    const key = process.env.VONAGE_API_KEY;
    const secret = process.env.VONAGE_API_SECRET;
    const from = process.env.VONAGE_FROM || 'AZOLVE';
    if (!key || !secret) return { ok: false, provider: 'vonage', error: 'VONAGE_API_KEY / VONAGE_API_SECRET are not set' };
    const r = await postForm('https://rest.nexmo.com/sms/json', {
      api_key: key, api_secret: secret, to: digits(phone), from,
      text: `Your AZOLVE verification code is ${code}. Valid for 10 minutes.`,
    });
    const msg = r.data?.messages?.[0];
    if (msg?.status && msg.status !== '0') {
      return { ok: false, provider: 'vonage', error: msg['error-text'] || `status ${msg.status}` };
    }
    return { ok: true, provider: 'vonage', id: msg?.['message-id'] };
  },

  async twilio({ phone, code }) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) return { ok: false, provider: 'twilio', error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are not set' };
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const r = await postForm(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      To: `+${digits(phone)}`,
      From: from,
      Body: `Your AZOLVE verification code is ${code}. Valid for 10 minutes.`,
    }, { authorization: `Basic ${auth}` });
    if (!r.ok) return { ok: false, provider: 'twilio', error: r.data?.message || `HTTP ${r.status}` };
    return { ok: true, provider: 'twilio', id: r.data?.sid };
  },
};

/* --------------------------------- public --------------------------------- */

export function smsProviderName() { return PROVIDER; }

export function smsConfigured() {
  if (PROVIDER === 'console') return true;
  const need = {
    textbelt: () => true, // works without a key on the free tier
    fast2sms: () => !!process.env.FAST2SMS_API_KEY,
    msg91: () => !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID),
    '2factor': () => !!process.env.TWOFACTOR_API_KEY,
    vonage: () => !!(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET),
    twilio: () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
  };
  return !!(need[PROVIDER] && need[PROVIDER]());
}

/**
 * Deliver an OTP. Never throws.
 * @returns {Promise<{ok:boolean, provider:string, id?:string, error?:string}>}
 */
export async function deliverOtp({ phone, code }) {
  const fn = providers[PROVIDER];
  if (!fn) {
    return { ok: false, provider: PROVIDER, error: `Unknown SMS_PROVIDER "${PROVIDER}". Use console, textbelt, fast2sms, msg91, 2factor, vonage or twilio.` };
  }
  if (!smsConfigured()) {
    return { ok: false, provider: PROVIDER, error: `SMS_PROVIDER=${PROVIDER} is selected but its credentials are missing.` };
  }
  try {
    return await fn({ phone, code });
  } catch (e) {
    return { ok: false, provider: PROVIDER, error: e?.name === 'AbortError' ? 'Provider timed out' : String(e?.message || e) };
  }
}

/**
 * Should the API return the code to the browser?
 * Only when the operator explicitly opts in. This is for team testing on a
 * throwaway deployment — never leave it on for real users.
 */
export function echoOtp() {
  return process.env.OTP_DEV_ECHO === '1';
}
