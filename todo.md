# AZOLVE CHAT — Request AE: live translation in voice + video calls

## A. Make speech → transcript → translation real
- [x] New `server/services/speech.js`: Gemini transcription (`gemini-3.5-transcribe`), Gemini flash fallback, OpenAI Whisper fallback
- [x] `translateTranscript()` reuses the existing provider chain (deepl → google → libre → openai → mymemory → phrasebook)
- [x] `POST /api/calls/live/listen` (multipart audio) + `POST /api/calls/live/translate` + `GET /api/calls/live/status`
- [x] Fix stale Gemini model ids in `server/services/ai.js` (2.5/1.5 flash are retired)
- [x] Verify with real espeak-ng audio: en→hi 2.2s, hi→en 1.9s, en→es 1.9s, all real transcripts

## B. Socket path
- [x] Replace the decorative `call:caption` relay with a real `call:speech` handler that translates server-side per recipient
- [x] Cache repeated segments, ack the speaker, emit `call:caption` to the peer
- [x] Relay the preview `simulated` flag on `call:accept` so the preview call can reach `active`

## C. Client
- [x] `web/src/lib/livecaption.js`: on-device Web Speech engine + server engine (3.2s MediaRecorder slices → 16 kHz WAV → `/calls/live/listen`)
- [x] `CallStage.jsx`: live loop only while `active`, auto-restart, backpressure, mic pause while TTS speaks
- [x] Always-on translated caption bar with original underneath, plus a real `Live · EN → HI` status pill
- [x] Dock control: `Live` toggle (on by default) and `Captions`
- [x] `styles-v4.css`: live bar, status pill, pulse dot, responsive rules

## D. Verify
- [x] Real call between two accounts renders the bar: 390×844 → 358×134 at y568, 1440×900 → 560×103, no overflow
- [x] Translated Hindi line + English original both visible in-call
- [x] UI sweep: 80 page/width/theme combos, 0 console exceptions

## E. Ship v1.0.8
- [ ] Rebuild web bundle (classic media queries preserved)
- [ ] Bump versionCode 9 / CURRENT_PROJECT_VERSION 9 / MARKETING_VERSION 1.0.8
- [ ] Rebuild APK + iOS project zip
- [ ] Commit + push `main`, confirm Render deploy
- [ ] Verify production `/api/calls/live/status` reports `canTranscribe: true`
