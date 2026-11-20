# AZOLVE CHAT — Request G

## 1. Calling rebuilt to production quality
- [x] Server-side call state machine (ringing timeout, busy, missed, decline-while-ringing, disconnect cleanup)
- [x] TURN support via env (`TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL`) + `/api/rtc/config`
- [x] Client ICE config fetch + ICE restart on failure
- [x] getStats() telemetry driving real quality indicator
- [x] Peer mute/camera state, ringing countdown, busy/missed screens
- [x] Call UI polish pass

## 2. Provider integrations
- [x] Gemini live (auto-fallback model chain) + DeepL live, both verified end-to-end
- [x] Email OTP delivery module (`services/email.js`) — Resend / Brevo / SMTP / SendGrid / Mailgun / console
- [x] `POST /api/auth/email/start|verify|resend` wired end-to-end, `email_verified` column added
- [x] Auth UI: email-first signup with channel-aware OTP screen
- [x] `/api/auth/otp/status` reports email provider, delivery truth, and primary channel
- [x] TURN credential broker (`services/turn.js`) — Metered REST, coturn REST, static; cached
- [x] `/api/rtc/config` async, reports `hasTurn` + `turnSource`
- [x] `docs/EMAIL-OTP.md` — provider setup guide
- [x] `docs/RENDER-SETUP.md` — Render API key + which options to select
- [ ] SMS gateway key (real OTP texts) — blocked on DLT approval, email is primary now
- [x] TURN credential — Metered static credential applied to Render as TURN_USERNAME/TURN_CREDENTIAL; `/api/rtc/config` returns hasTurn:true, turnSource:static; relay allocation verified with turnutils_uclient (0% loss)
- [x] Push repo to GitHub (FragileAim/AZOLVE-CHAT) and deploy live on Render
- [x] Fix Render build (`vite: not found`) — vite moved into dependencies
- [x] Replace first-user-is-admin race with ADMIN_EMAILS allowlist
- [x] Live verification: /api/health, /api/auth/otp/status, /api/rtc/config, email signup
- [x] Verify translation provider chain reads keys correctly
- [x] Verify AI provider chain reads keys correctly
- [x] Admin/Settings "Integrations" panel showing live vs missing providers
- [x] Document exactly which env keys to paste

## 3. UI / design overhaul
- [x] New design tokens (type scale, spacing, radii, shadows, color)
- [x] Refined shell: sidebar, topbar, mobile tab bar
- [x] Auth screens
- [x] Chats + composer + bubbles
- [x] Moments / Social / Explore / AI / Calls / Communities / Profile / Settings
- [x] Motion + empty states

## 4. Mobile apps
- [x] Capacitor project scaffold (Android + iOS)
- [x] Build installable Android APK
- [x] iOS project + Mac build instructions + PWA path
