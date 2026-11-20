# AZOLVE CHAT — Third-Party Services

Every integration is optional, configured through environment variables, and degrades gracefully. No keys are hardcoded. The app runs fully with **zero credentials** (MyMemory translation + local AI engine).

---

## 1. Translation providers

| Service | Env vars | Free tier | Used for |
|---|---|---|---|
| **MyMemory** | `MYMEMORY_EMAIL` (optional) | Yes, keyless | Default translation. Verified working. Public rate limits apply. |
| **DeepL** | `DEEPL_API_KEY` | 500k chars/month | Highest quality EU languages |
| **Google Cloud Translation** | `GOOGLE_TRANSLATE_API_KEY` | $300 credit | Broadest language coverage |
| **LibreTranslate** | `LIBRE_TRANSLATE_URL`, `LIBRE_TRANSLATE_KEY` | Self-hosted / free public | Fully offline-capable |
| **OpenAI** | `OPENAI_API_KEY` | Paid | LLM-based translation |
| **Offline phrasebook** | — | Built in | Deterministic demo fallback |

Chain order is controlled by `TRANSLATION_PROVIDER` (comma-separated). Failures fall through to the next provider. `GET /api/ai/status` reports availability.

## 2. AI / LLM providers

First configured provider wins: OpenAI → Anthropic → Gemini → Groq → Ollama → `local-heuristic`.

| Service | Env vars |
|---|---|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Ollama (local) | `OLLAMA_URL` |

Used for: chat assistant, summaries, rewrites, captions, hashtags, ideas, reply suggestions, image descriptions, and (OpenAI only) Whisper voice transcription.

## 3. Authentication providers

| Service | Env vars | Status |
|---|---|---|
| Google Sign-In | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Endpoint implemented; returns 501 + setup instructions until configured |
| Apple Sign-In | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID` | Same |

## 4. Messaging / delivery

| Service | Purpose | Status |
|---|---|---|
| Twilio / AWS SES / Postmark | OTP SMS + email | Not wired; demo mode returns codes and labels them as demo |
| Web Push (VAPID) / FCM | Mobile push | Not wired; in-app notification centre is live |

## 5. Realtime / media infrastructure

| Service | Purpose | Status |
|---|---|---|
| Google STUN (`stun.l.google.com:19302`) | WebRTC NAT discovery | In use, free |
| TURN (coturn / Twilio NTS / Cloudflare Calls) | WebRTC relay behind strict NAT | Recommended for production |
| LiveKit / mediasoup | SFU for group calls | Recommended beyond ~4 peers |
| S3 / GCS / Cloudflare R2 | Object storage for media | Recommended; local disk today |
| CDN (Cloudflare / CloudFront) | Media + static delivery | Recommended at scale |

## 6. Data infrastructure

| Service | Purpose | Status |
|---|---|---|
| SQLite (built in) | Primary datastore | In use |
| PostgreSQL | Production datastore | Port `server/db.js` |
| Redis | Presence, rate limits, socket adapter | Recommended for multi-node |

## 7. Media content

Seeded demo images use **Unsplash** URLs (`images.unsplash.com`). No binary assets are bundled. Replace with your own CDN for production.

## 8. What runs with no credentials

- All authentication (email/phone + OTP demo mode)
- All messaging, groups, receipts, presence, typing
- Per-recipient translation via MyMemory + offline phrasebook
- Moments, Social, Communities, Profile, Settings, Admin
- AZOLVE AI via the deterministic `local-heuristic` engine
- WebRTC calls via public STUN (same-network and many NAT configurations)

## 9. Adding a provider

1. Add the env vars to `.env.example` and `.env`.
2. Implement the adapter in `server/services/translate.js` (translation) or `server/services/ai.js` (LLM).
3. Register it in the provider map / chain.
4. Expose availability through `providerStatus()` / `engineName()` so the UI stays honest.

No other code changes are required — the UI reads availability from `/api/ai/status`.
