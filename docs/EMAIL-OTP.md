# Email verification (primary OTP channel)

SMS to Indian handsets cannot go live until your DLT registration is approved.
Until then AZOLVE CHAT verifies accounts by **email**. This document is the
setup guide: pick a provider, paste two or three values, done.

The code path is already built and tested end to end:

| Step | Endpoint | What it does |
| --- | --- | --- |
| 1 | `POST /api/auth/email/start` | Creates a pending account if the address is new, generates a 6-digit code, mails it |
| 2 | `POST /api/auth/email/verify` | Checks the code, marks `email_verified = 1`, returns a session |
| 3 | `POST /api/auth/email/resend` | New code, same 30-second / 6-per-hour throttle |
| — | `GET /api/auth/otp/status` | Tells the client, honestly, whether mail will actually arrive |

Phone signup still works in parallel at `/api/auth/phone/start`. When DLT
clears, set `SMS_PROVIDER` to your gateway and the phone flow starts sending
real texts — no code change needed.

---

## What the email looks like

A branded HTML message, table-based and inline-styled so it renders the same in
Gmail, Outlook and Apple Mail:

- gradient header with the AZOLVE CHAT wordmark
- "PRIVATE · TRANSLATED · GLOBAL" strapline
- the 6-digit code in a large monospaced block
- a plain-text alternative for clients that block HTML
- `Reply-To: support@azolve.io`

The subject line changes with purpose: verification, sign-in, password reset,
security code.

---

## Choosing a provider

| Provider | Free tier | Card needed | Domain needed | Best for |
| --- | --- | --- | --- | --- |
| **Resend** | 3,000 / month, 100 / day | No | No (can use `onboarding@resend.dev` to test) | **Recommended default** |
| **Brevo** | 300 / day | No | No | High daily volume on a budget |
| **SMTP** | your mailbox's limit | No | No | You already own a mailbox (Gmail, Zoho, SES) |
| **SendGrid** | 100 / day | No | Sender must be verified | Existing SendGrid account |
| **Mailgun** | trial only | Yes | Yes | You already own a domain |
| `console` | unlimited | No | No | Local dev / team test — code goes to the server log |

Leave `EMAIL_PROVIDER` blank and the server auto-detects: Resend → Brevo → SMTP
→ SendGrid → Mailgun → console.

---

## Option 1 — Resend (fastest, free, no card)

1. Go to <https://resend.com> and sign up with your work email.
2. In the dashboard open **API Keys → Create API Key**. Permission: *Sending
   access*. Copy the key — it starts with `re_`.
3. Add these to `.env` (or to Render's environment tab):

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=onboarding@resend.dev
EMAIL_FROM_NAME=AZOLVE CHAT
EMAIL_REPLY_TO=support@azolve.io
```

`onboarding@resend.dev` works immediately and can send to any address, but the
from-line looks generic. To send as `no-reply@azolve.io`:

1. Resend → **Domains → Add Domain** → `azolve.io`.
2. Copy the SPF, DKIM and DMARC records it shows into your DNS provider.
3. Wait for verification (usually minutes), then set
   `EMAIL_FROM=no-reply@azolve.io`.

Free-tier limits: 100 emails per day, 3,000 per month. Enough for a team test
and roughly 100 new signups a day.

---

## Option 2 — Brevo (300/day free)

1. Sign up at <https://brevo.com>.
2. **SMTP & API → API Keys → Generate a new API key** (v3).
3. Paste:

```env
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxx
EMAIL_FROM=your-verified-sender@yourdomain.com
```

Brevo requires you to verify a sender address or domain under **Senders &
IP → Senders** before it will deliver.

---

## Option 3 — SMTP (use a mailbox you already own)

This is the least "signup-y" option: no third party, no new account.

### Gmail

1. Turn on 2-Step Verification on the Google account.
2. Go to <https://myaccount.google.com/apppasswords> and create an app password
   for "Mail". You get a 16-character string — this is **not** your login
   password.
3. Paste:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=you@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
SMTP_FROM=you@gmail.com
```

Gmail caps free accounts at roughly 500 recipients per day and will silently
throttle bursts. Fine for testing, not for launch.

### Zoho Mail

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.zoho.in
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=no-reply@azolve.io
SMTP_PASS=<app-specific password>
SMTP_FROM=no-reply@azolve.io
```

### Amazon SES

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=<SES SMTP username>
SMTP_PASS=<SES SMTP password>
SMTP_FROM=no-reply@azolve.io
```

SES starts in the sandbox: you can only send to verified addresses until you
request production access.

---

## Verifying it works

```bash
# 1. Does the server think mail is configured?
curl -s localhost:3000/api/auth/otp/status | jq '{emailProvider, emailDelivery, primary}'

# 2. Send yourself a code
curl -s -X POST localhost:3000/api/auth/email/start \
  -H 'content-type: application/json' \
  -d '{"email":"you@yourdomain.com","displayName":"Your Name"}' | jq .
```

A healthy response looks like:

```json
{
  "userId": "u_...",
  "email": "you@yourdomain.com",
  "isNew": true,
  "channel": "email",
  "provider": "resend",
  "delivered": true,
  "message": "A 6-digit code was emailed to you@yourdomain.com."
}
```

If `delivered` is `false`, read `deliveryError` — it is the provider's own
message, not a generic failure. Common ones:

| Message | Meaning |
| --- | --- |
| `RESEND_API_KEY is not set` | You set `EMAIL_PROVIDER=resend` but never pasted the key |
| `HTTP 403` / `domain is not verified` | Add and verify the domain, or use `onboarding@resend.dev` |
| `Invalid login: 535` | Gmail/Outlook rejected the password — you need an **app password** |
| `Connection timeout` | Some hosts block outbound 25/465; use port 587 or an HTTP API (Resend/Brevo) instead |

---

## Test mode vs production

`OTP_DEV_ECHO=1` returns the code in the API response and shows it in the UI
under "Test mode". This is how your team logs in before a mail provider is
wired up.

**Turn it off before real users arrive.** With `OTP_DEV_ECHO=0` the code is
never in the response and never in the browser — only in the mail.

```env
OTP_DEV_ECHO=0
```

---

## Honest limitations

- **No inbound mail handling.** `support@azolve.io` is a `Reply-To`, not a
  monitored inbox — point it at a real mailbox you read.
- **No bounce processing.** A hard bounce is not fed back into the user record,
  so an address that bounces stays marked verified. Add a webhook from your
  provider if you need that.
- **No unsubscribe flow.** Verification mail is transactional, so this is not
  legally required, but it is also not built.
- **Rate limits are per address, not per IP.** A determined attacker rotating
  addresses can still cost you provider quota. Add a per-IP limit at the proxy
  if that becomes a problem.
