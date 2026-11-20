# AZOLVE CHAT — Feature Status

Legend: **✅ Done** = implemented, wired to the API and exercised in the browser. **🟡 Gated** = implemented but needs an external credential or infrastructure to activate. **⏳ Planned** = designed, not built.

---

## 1. Foundation

| Feature | Status | Notes |
|---|---|---|
| Custom brand identity | ✅ | Logo (`web/public/logo.svg`), gradient wordmark, bespoke design system |
| Light + dark mode | ✅ | Persisted per device, instant switch, full token coverage |
| Responsive layout | ✅ | Desktop rail sidebar, tablet collapse, mobile bottom navigation |
| Database + schema | ✅ | 28 tables, WAL, idempotent DDL |
| Design tokens / typography | ✅ | CSS custom properties, no framework dependency |
| Loading skeletons, empty states, error toasts | ✅ | `Skeleton`, `Empty`, app-level toast |

## 2. Authentication & onboarding

| Feature | Status | Notes |
|---|---|---|
| Signup with email or phone | ✅ | |
| OTP verification | ✅ | Demo delivery labelled; pluggable SMS/email provider |
| Login / logout / logout-all | ✅ | |
| Refresh tokens (rotating) | ✅ | Old refresh token revoked on use |
| Session/device list + revoke | ✅ | Settings → Security |
| Forgot / reset password | ✅ | |
| Two-factor auth (TOTP) | ✅ | Enable/disable, login challenge |
| Google / Apple sign-in | 🟡 | `POST /auth/oauth/:provider` returns 501 + setup instructions until `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` are set |
| Username creation | ✅ | Uniqueness enforced |
| Profile setup (avatar, bio, DOB, country) | ✅ | |
| **Language selection at onboarding** | ✅ | Becomes the account's default translation target |
| Privacy preferences at onboarding | ✅ | |
| Contact discovery | ✅ | People suggestions + search |

## 3. Core — AI auto-translation

| Feature | Status | Notes |
|---|---|---|
| **Per-recipient translation** | ✅ | One message, N languages, cached per `(message, lang)` |
| Original never overwritten | ✅ | `messages.body` immutable; translation lives in `translations` |
| "See original" toggle | ✅ | Shows stored original inline |
| Automatic language detection | ✅ | Unicode script ranges + stopword scoring + diacritics |
| 27 languages | ✅ | hi, en, ar, gu, es, fr, de, zh, ja, ko, pt, ru, it, tr, id, bn, mr, ta, te, ur, fa, he, th, vi, nl, pl, sw |
| RTL support | ✅ | `ar`, `he`, `ur`, `fa` render right-to-left |
| Group translation per participant | ✅ | Each member receives their own rendering |
| Per-chat language override | ✅ | `participants.language_override` |
| Pluggable providers | ✅ | DeepL, Google, LibreTranslate, OpenAI, MyMemory, offline |
| Provider fallback chain | ✅ | Automatic on failure |
| Provider visibility in UI | ✅ | `/api/ai/status` chips |
| Translation of posts, comments, community posts, moments | ✅ | On-demand with the same provider chain |

## 4. Messaging

| Feature | Status | Notes |
|---|---|---|
| Direct messages | ✅ | |
| Group chats | ✅ | Create, add/remove members, roles |
| Realtime delivery | ✅ | Socket.IO |
| Read receipts | ✅ | Respects privacy preference |
| Online / last seen | ✅ | Presence map + `last_seen` |
| Typing indicators | ✅ | |
| Reply | ✅ | Quoted context |
| Forward | ✅ | |
| Edit | ✅ | Re-detects language, invalidates cache |
| Delete | ✅ | Soft delete |
| Pin / star | ✅ | Per-chat starred list |
| Reactions | ✅ | Multi-emoji |
| Emoji picker | ✅ | |
| GIF / stickers | 🟡 | Upload + emoji supported; GIF search needs a Tenor/Giphy key |
| Voice notes | ✅ | Record via MediaRecorder, upload, inline player |
| Images / video / documents | ✅ | Multer upload, inline previews, file cards |
| Location sharing | ✅ | Location card |
| Contact sharing | ✅ | Contact card |
| Search (chats + messages) | ✅ | |
| Archive / mute / lock | ✅ | |
| Disappearing messages | ✅ | `disappear_seconds` per conversation |
| Wallpapers | ✅ | Per conversation |
| Block / report | ✅ | Enforced across the app |
| Scheduled messages | ✅ | `scheduled_for`, background processor |
| Silent messages | ✅ | |
| Private notes | ✅ | Self-chat / note-to-self |
| AI conversation summary | ✅ | `/chats/:id/summary` |
| AI suggested replies | ✅ | `/ai/task` kind `replies` |
| AI writing improvement / tone | ✅ | `improve`, `rewrite` with tone |
| Voice transcription | 🟡 | Implemented via OpenAI Whisper; needs `OPENAI_API_KEY` |
| Spam detection | ✅ | Heuristic flagging → admin report queue |

## 5. AZOLVE MOMENTS

| Feature | Status |
|---|---|
| Photo / video / text moments | ✅ |
| Captions, links, location | ✅ |
| Backgrounds / filters (colour + gradient presets) | ✅ |
| Reactions and replies | ✅ |
| Replies create a DM | ✅ |
| Private audience + hide-from | ✅ |
| Viewer list | ✅ |
| Analytics (views/reactions) | ✅ |
| 24h expiry | ✅ |
| Highlights / collections | ✅ |
| AI Moment Creator | ✅ (caption + hashtag generation) |

## 6. AZOLVE SOCIAL

| Feature | Status |
|---|---|
| Public / private profiles | ✅ |
| Follow / unfollow, followers / following | ✅ |
| Feed (following) | ✅ |
| Explore + search | ✅ |
| Photo / video / carousel posts | ✅ |
| Short vertical video | ✅ (`type: reel`) |
| Likes, comments, share (copy link), save, repost | ✅ |
| Hashtags, mentions, location tags | ✅ |
| Trending | ✅ |
| Suggested accounts | ✅ |
| Creator profile layout | ✅ |
| Reporting + privacy controls | ✅ |
| AI captions / hashtags / translation / image descriptions | ✅ (image description via LLM when configured) |
| Feed recommendations | ✅ (recency + engagement + follow weighting) |
| Comment translation | ✅ |
| Multilingual discovery | ✅ |

## 7. AZOLVE AI assistant

| Feature | Status |
|---|---|
| Ask anything | ✅ |
| Generate / rewrite / translate messages | ✅ |
| Summarise conversations | ✅ |
| Explain messages | ✅ |
| Captions, creative content, ideas | ✅ |
| Professional communication | ✅ |
| Voice interaction (input + spoken replies) | ✅ (Web Speech API) |
| Smart search across chats | ✅ |
| Persistent threads | ✅ |
| Pluggable model providers | ✅ OpenAI / Anthropic / Gemini / Groq / Ollama |
| Honest engine label | ✅ Every reply states `engine` |

## 8. Voice & video calling

| Feature | Status |
|---|---|
| 1:1 audio / video | ✅ Real WebRTC peer connection |
| Group calls | 🟡 Signalling and UI support multiple participants; production SFU (LiveKit/mediasoup) recommended beyond ~4 peers |
| Incoming / outgoing UI | ✅ |
| Missed calls + duration | ✅ Persisted to `calls` |
| Mute / camera toggle / switch camera | ✅ |
| Speaker toggle | ✅ |
| Screen share | ✅ `getDisplayMedia` + `replaceTrack` |
| Picture-in-picture | ✅ |
| Notifications | ✅ |
| Live translated captions | ✅ `call:caption` + translation layer; typed captions are translated for the peer's language |
| Minimise to floating call | ✅ The call keeps running in a 330px floating window while you use the rest of the app |
| Connection quality indicator | ✅ Driven by real `connectionState` / `iceConnectionState` |
| Ringtone + connect/end tones | ✅ WebAudio synthesis, no audio assets |
| Mic level / speaking waveform | ✅ `AnalyserNode` on the local stream |
| Device enumeration | ✅ `enumerateDevices` for cameras and microphones |

> **NAT traversal:** signalling uses Socket.IO and media is peer-to-peer over WebRTC with
> public STUN servers only. Calls between peers behind symmetric NATs or restrictive
> corporate firewalls need a TURN server — see `docs/DEPLOYMENT.md` §5. Without TURN the
> call will fail to connect in those networks, and the UI reports "Connection lost" rather
> than pretending the call is up.

## 9. Communities

| Feature | Status |
|---|---|
| Categories (interest/professional/business/education/gaming/tech/entertainment/travel/local) | ✅ |
| Public / private | ✅ |
| Linked group chat | ✅ |
| Announcements | ✅ (admin posts) |
| Admin / moderator roles | ✅ |
| Member management | ✅ |
| Polls | ✅ Live results, one vote per member |
| Events | ✅ |
| Discussions | ✅ |
| File sharing | ✅ |
| Discovery + search | ✅ |
| Multilingual posts | ✅ |

## 10. The ten signature features

| # | Feature | Status |
|---|---|---|
| 1 | Universal Language Mode | ✅ Per-recipient translation across the whole product |
| 2 | AI Conversation Memory | ✅ Persistent AI threads + conversation summaries |
| 3 | Smart Message Delivery | ✅ `scheduled_for` + receiver-timezone display |
| 4 | Mood-Based Status | ✅ `mood` / `mood_text` on profile and chat header |
| 5 | Personal Social Dashboard | ✅ Home dashboard: conversations, moments, AI, trending |
| 6 | AI Voice Translator | ✅ Voice input → AI → spoken output |
| 7 | Global Discovery | ✅ Explore, trending, language-aware discovery |
| 8 | Temporary Identity Mode | ✅ `temporary_identity` flag + anonymous community membership |
| 9 | Smart Privacy | ✅ Granular privacy object + per-feature enforcement |
| 10 | Cross-Language Group Calls | ✅ Live captions translated per participant |

## 11. Profile, notifications, privacy, admin

| Feature | Status |
|---|---|
| Profile system (cover, avatar, bio, stats, tabs) | ✅ |
| Notification centre + unread badges | ✅ |
| Notification preferences | ✅ |
| Privacy dashboard | ✅ |
| Data export (JSON) | ✅ |
| Account deletion | ✅ |
| Admin dashboard with RBAC | ✅ |
| Analytics charts | ✅ |
| Report queue | ✅ |
| Audit log | ✅ |
| System health panel | ✅ |

---

## 12. Credential-gated / not yet production-ready

These are the only items that are not fully live. Each is implemented behind a clean integration point and documented:

| Item | What is needed |
|---|---|
| Google / Apple sign-in | OAuth client credentials + redirect URI registration |
| SMS / email OTP delivery | Twilio / SES / Postmark credentials |
| GIF search | Tenor or Giphy API key |
| Voice transcription | `OPENAI_API_KEY` (Whisper) |
| Hosted LLM quality | Any of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, or a local `OLLAMA_URL` |
| Higher-quality translation | `DEEPL_API_KEY` or `GOOGLE_TRANSLATE_API_KEY` |
| Group calls beyond small rooms | SFU (LiveKit, mediasoup) + TURN server |
| End-to-end encryption | Requires on-device translation; deliberately not claimed |
| Push notifications (mobile/web push) | VAPID keys / FCM project |
| Object storage | S3/GCS credentials (currently local disk) |
| PostgreSQL / Redis at scale | Connection strings + port of `server/db.js` helpers |

Everything else in this document is functional today.

## 12. Tap to hear — spoken translations and call captions

Every translated message and every live call caption is a real button: tap it and the
device speaks it aloud, in the language of that specific text.

**How it works.** `web/src/lib/speech.js` wraps the Web Speech API
(`speechSynthesis` + `SpeechSynthesisUtterance`). There is no API key, no server round
trip and no audio upload — the voice comes from the operating system. Long text is split
on sentence boundaries into ~180-character chunks, because several engines silently
truncate a single utterance after roughly fifteen seconds. Only one utterance plays at a
time app-wide; starting a new one cancels the previous one, and tapping the item that is
already speaking stops it.

**Where you can tap.**

| Surface | Element | What is spoken |
| --- | --- | --- |
| Chat bubble | the translated body text | the translation, in your language |
| Chat bubble | `Hear in <language>` inline control | the translation, explicitly |
| Chat bubble | `See original` → `Hear original` | the sender's untouched original, in their language |
| Call captions | any caption row | that caption, in the language it was captured in |
| Settings → Voice & speech | per-language sample button | a short sample sentence |

**Honesty about voice coverage.** `resolveVoice(lang)` reports one of three states:
`native` (a voice exists for that language), `approximate` (no voice for that language,
so the closest installed voice reads it — the UI labels this in amber) and `none` (no
speech engine or no voices at all). The Voice & speech settings section lists all 27
languages with their actual state on the current device, so a user can see exactly what
their phone or browser can speak. When only an English voice is installed, the engine is
still asked for the target language tag rather than being forced onto an English voice,
so it never mispronounces text while claiming to be correct.

**Accessibility.** Bubbles carry `role="button"`, `tabIndex=0` and Enter/Space handlers.
A click is ignored when the user has an active text selection, so selecting text to copy
does not start playback. Speaking items get a visible inset bar plus a four-bar
equaliser, so the state is not conveyed by sound alone.
