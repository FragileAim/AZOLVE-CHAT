# AZOLVE CHAT — provider integrations

Everything below is configured through environment variables. No key is ever committed,
logged, or returned by an API — `GET /api/admin/integrations` reports only whether a
credential is **present**, never its value.

---

## Current status (verified live)

| Provider | Purpose | Status | Verified |
|---|---|---|---|
| **Google Gemini** | AZOLVE AI (chat, summarise, rewrite, caption, translate) | ✅ **LIVE** | `gemini-3.6-flash` answered through `POST /api/ai/chat` and `POST /api/ai/task` |
| **DeepL** | Message / caption / comment translation | ✅ **LIVE** | EN→HI, EN→AR, EN→JA, EN→DE all returned correct output via `POST /api/chats/:id/translate` |
| MyMemory | Keyless translation fallback | ✅ active | used only if DeepL/Google/Libre are unavailable |
| **Email OTP** | Account verification (primary) | ✅ **built** | `POST /api/auth/email/start` → code → `POST /api/auth/email/verify` → session, `email_verified = 1` |
| SMS · console | OTP delivery (secondary) | ⚠️ dev only | codes print to the server log — **not** real SMS |
| TURN relay | WebRTC calls across mobile networks | ⚠️ **keys stored, app name missing** | Metered `sk_id_`/`sk_secret_` are API keys, not a TURN username/password — set `TURN_APP` to exchange them |

### Verified test output

```
POST /api/ai/chat
→ "AZOLVE CHAT is an AI-powered messaging platform designed to help you communicate,
   translate, and connect effortlessly across languages."
   engine: gemini:gemini-3.6-flash

POST /api/ai/task  {kind:"rewrite", text:"hey send me the report tomorrow ok"}
→ "Could you please send me the report by tomorrow? Thank you."
   engine: gemini:gemini-3.6-flash

POST /api/chats/:id/translate  {lang:"hi"}
→ "सुबह की शुभकामनाएँ, आप कैसे हैं? मैं कल रिपोर्ट भेजूँगा।"   provider: deepl
POST /api/chats/:id/translate  {lang:"ar"}
→ "صباح الخير، كيف حالك؟ سأرسل التقرير غدًا."                  provider: deepl
POST /api/chats/:id/translate  {lang:"ja"}
→ "おはようございます。お元気ですか？レポートは明日お送りします。"  provider: deepl
POST /api/chats/:id/translate  {lang:"de"}
→ "Guten Morgen, wie geht es dir? Ich werde den Bericht morgen schicken."
```

The original message body is never overwritten — translations live in a separate
`translations` table keyed by `(message_id, lang)`, which is what makes "See Original" and
per-recipient translation possible.

---

## Gemini model auto-fallback

Google retires model ids without warning (`gemini-2.0-flash` and `gemini-2.5-flash` already
return `404 no longer available`). The server therefore tries a chain and caches whichever
one answers:

```
GEMINI_MODEL (if set) → gemini-3.6-flash → gemini-flash-latest
                      → gemini-2.5-flash → gemini-1.5-flash
```

`404` (retired), `429` (rate limit) and `503` (busy) all fall through to the next name.
Pin a specific model with `GEMINI_MODEL` if you ever need to.

---

## Translation chain

```
deepl → google → libre → openai → mymemory (keyless) → offline phrasebook
```

The first provider that answers wins, and the response tells you which one it was
(`provider: "deepl"`). If every network provider fails the app still returns a real
translation from the bundled offline phrasebook rather than an error.

Force one provider with `TRANSLATION_PROVIDER=deepl`.

---

## What still needs a key

### 1. Email OTP — now the primary channel (SMS waits on DLT approval)

Full guide: **`docs/EMAIL-OTP.md`**. Short version — pick one:

```bash
# Resend — free 3,000/month, 100/day, no card  (recommended)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...

# Brevo — free 300/day
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-...

# Any SMTP mailbox (Gmail needs an app password)
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char app password>
```

With no provider set, codes go to the server log and the UI says so plainly.

### 1b. SMS / OTP — needed once DLT approval lands

Pick one. **Fast2SMS** is cheapest for India (~₹0.20/SMS); **Twilio** is the most reliable
globally; **MSG91** has good India deliverability with DLT templates.

```bash
# Fast2SMS (India)
SMS_PROVIDER=fast2sms
FAST2SMS_API_KEY=...

# Twilio (global)
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...

# MSG91 (India, needs DLT-approved template)
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=...
MSG91_TEMPLATE_ID=...
```

Until one is set, `OTP_DEV_ECHO=1` makes the server return the code in the API response so
your team can still test the flow.

### 2. TURN relay — needed for calls between different networks

See `docs/CALLING.md`. Short version: without TURN, calls work on the same Wi-Fi and fail
when one person is on mobile data behind carrier NAT.

Your Metered **Key ID** and **Signing secret** are stored, but they are API keys, not a
TURN username/password — the relay rejects them directly (verified: HTTP 400). The server
now exchanges them for short-lived credentials, which needs one more value: the Metered
app sub-domain.

```bash
TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443
TURN_APP=yourapp          # the "yourapp" in yourapp.metered.live
TURN_API_KEY=sk_id_...
TURN_API_SECRET=sk_secret_...
```

Where to find `TURN_APP`: <https://dashboard.metered.live> → your TURN app. The app name
is in the URL and in the "Credentials" panel next to `global.relay.metered.ca`.

Alternatives if you do not want to use Metered:

```bash
# Self-hosted coturn with use-auth-secret (no third party at all)
TURN_URL=turn:your-server:3478
TURN_STATIC_AUTH_SECRET=<same value as coturn's static-auth-secret>

# Static username/password (fine for a team test, long-lived)
TURN_URL=turn:host:3478
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

`GET /api/rtc/config` reports `hasTurn` and `turnSource` (`metered`, `coturn-rest`,
`static`, `metered-failed`, `none`) so you can confirm it took effect without guessing.

---

## Optional upgrades

| Key | Unlocks |
|---|---|
| `OPENAI_API_KEY` | GPT as an alternative AI engine; also translation via OpenAI |
| `ANTHROPIC_API_KEY` | Claude as an alternative AI engine |
| `GROQ_API_KEY` | Very fast, very cheap Llama inference |
| `GOOGLE_TRANSLATE_API_KEY` | Second translation provider, better for some Asian pairs |
| `LIBRE_TRANSLATE_URL` | Self-hosted LibreTranslate — free, private, no per-word cost |

AI provider priority: `OPENAI → ANTHROPIC → GEMINI → GROQ → OLLAMA → local-heuristic`.
With no key at all the platform still works — it falls back to a deterministic local engine
that does real extractive summarisation, and the API honestly reports
`engine: "local-heuristic"` so the UI never pretends a heuristic is a frontier model.

---

## Checking status yourself

```bash
curl -H "Authorization: Bearer <admin-token>" \
     https://your-service.onrender.com/api/admin/integrations
```

Or in the app: **Admin → Integrations**. Every provider shows a green dot and its model /
detail, or a grey dot and the exact env key it is waiting for.
