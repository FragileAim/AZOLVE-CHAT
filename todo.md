# AZOLVE CHAT — Request Y: real login, logout, contact requests, persistence

## 1. Accounts survive and people can sign back in
- [x] Persistence: encrypted SQLite snapshot (AES-256-GCM) to a managed Postgres blob, restore on boot, save on change + SIGTERM
- [x] Auth screen: Sign in / Create account toggle, OTP sign-in for everyone, no forced re-registration
- [x] Server: /auth/email/start reports isNew honestly; signup mode on existing account tells them to sign in
- [x] Cooldown no longer blocks signing straight back in (only unused codes hold it)

## 2. Logout everywhere
- [x] Log out button on Profile page (with confirm)
- [x] Keep Settings logout

## 3. Contact requests gate
- [x] DB: contact_requests + contacts tables
- [x] API: request / respond / list / remove / directory
- [x] Enforce on DM create, message send, call invite
- [x] UI: Requests inbox, People directory, add-to-contacts on profile, contact-only new chat
- [x] Socket: live request notification + badge

## 4. Verify + ship
- [x] Automated tests for the gate (54 assertions green: API 26, UI 13, calls 7, persistence 8)
- [ ] Build, deploy, verify production
- [ ] Rebuild APK + iOS
