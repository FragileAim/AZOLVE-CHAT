# AZOLVE CHAT — pre-team-testing audit + mobile builds

## 1. Audit the live deployment end to end
- [ ] Health, static assets, SPA fallback, security headers
- [ ] Auth: email OTP start/verify/resend, session, refresh, logout, rate limits
- [ ] Profile: read/update, avatar upload, privacy settings
- [ ] Chats: create conversation, send message, per-recipient translation, See Original
- [ ] Translation provider chain actually returns translations
- [ ] AI assistant: real provider response, no key leakage
- [ ] Moments: create, view, react
- [ ] Social feed: post, like, comment, save, follow
- [ ] Communities: create, join, post, poll
- [ ] Notifications: generate + read
- [ ] Calls: /api/rtc/config, socket signalling, call state machine
- [ ] Admin: RBAC enforcement, non-admin blocked
- [ ] Uploads: media upload + serve
- [ ] Error handling: bad input returns clean errors, no stack traces
- [ ] Fix every defect found

## 2. Mobile builds
- [ ] Verify Capacitor config points at the live URL
- [ ] Build signed-release Android APK, verify it installs
- [ ] Produce iOS Xcode project (project.pbxproj, Info.plist, assets)
- [ ] Zip the iOS project for Mac use + write build instructions
- [ ] Document what works and what is credential-gated

## 3. Deliver
- [ ] Write audit report with real test evidence
- [ ] Attach APK, iOS zip, report
