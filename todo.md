# AZOLVE CHAT — pre-team-testing audit + mobile builds

## 1. Audit the live deployment end to end
- [x] Health, static assets, SPA fallback, security headers
- [x] Auth: email OTP start/verify/resend, session, refresh, logout, rate limits
- [x] Profile: read/update, avatar upload, privacy settings
- [x] Chats: create conversation, send message, per-recipient translation, See Original
- [x] Translation provider chain actually returns translations (27/27 languages)
- [x] AI assistant: real provider response, no key leakage
- [x] Moments: create, view, react
- [x] Social feed: post, like, comment, save, follow
- [x] Communities: create, join, post, poll
- [x] Notifications: generate + read
- [x] Calls: /api/rtc/config, socket signalling, call state machine
- [x] Admin: RBAC enforcement, non-admin blocked
- [x] Uploads: media upload + serve
- [x] Error handling: bad input returns clean errors, no stack traces
- [x] Fix every defect found (socket payload shape, JSON 500, message cap, /users/me, false caption claim)
- [x] Re-run harness after fixes → 80 passed, 0 failed
- [x] Verify the fixes are live in production (not just locally)
- [x] Verify production OTP email actually delivers (Brevo event log = delivered)
- [x] Verify Gemini + DeepL keys work

## 2. Mobile builds
- [x] Verify Capacitor config points at the live URL
- [x] Build signed-release Android APK, verify it installs
- [x] Add Android splash + "Try again" screen for Render cold starts
- [x] Produce iOS Xcode project (project.pbxproj, Info.plist, assets)
- [x] Strip CocoaPods/Capacitor so the project opens with no dependency setup
- [x] Remove dangling CAPBridgeViewController storyboard reference
- [x] Validate pbxproj (balanced, no orphan UUIDs, AppDelegate in Sources)
- [x] Verify app icon is 1024x1024 with no alpha
- [x] Zip the iOS project for Mac use + write build instructions
- [x] Document what works and what is credential-gated

## 3. Deliver
- [x] Write audit report with real test evidence
- [x] Attach APK, iOS zip, report
