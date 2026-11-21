# AZOLVE CHAT — Request AA: call audio, call details, profile UI, stay signed in, ring when app is closed

## 1. Voice calls: nobody can hear anybody
- [x] Find the real cause (audio-only calls had no media sink at all)
- [x] Always mount a remote audio element; attach the remote stream to it
- [x] Fix the peer-connection double-create race (accept + signal both called ensurePC)
- [x] Make the speaker/earpiece control actually do something (setSinkId) or say it can't
- [x] Prove it with a real two-browser WebRTC test that measures received audio level
- [x] Fix the credential-less TURN entry that made RTCPeerConnection throw (server + client)
- [x] Wire the real Metered TURN username/credential so relay works off-LAN

## 2. Call details: who ended it and how long it lasted
- [x] Migrate calls table: ended_by, ended_reason
- [x] Server records who ended / declined / missed, and the duration
- [x] Calls list shows "You ended · 2:31", "Priya ended · 2:31", "Missed", "You declined"
- [x] Ended screen says who hung up and how long the call ran
- [x] test-aa.mjs: 20/20 socket-level checks pass

## 3. Profile UI
- [x] Rebuild the hero as a responsive grid (cover, avatar, actions, stats)
- [x] Fix the phone layout: 170px cover, 54px padding hacks, wrapped action row
- [x] Verify at 360 / 390 / 834 / 1440 in both themes
- [x] Real bug found and fixed: the flex container was shrinking the card to 292px for 525px of content, so overflow:hidden cut the stats row off. 0 problems across all 8 combinations now

## 4. Stay signed in on the same device
- [x] Fix the snapshot signature: it ignored the -wal file, so saves were skipped and accounts vanished on restart
- [x] Save immediately after signup / login / refresh instead of waiting for the 60s tick
- [x] Boot must not sign you out on a network error — only on a real 401/revoked session
- [x] Prove it: register, restart the server, confirm the same token still works (6/6)

## 5. Ring when the app is closed
- [x] VAPID keys + push_subscriptions table + subscribe/unsubscribe endpoints
- [x] Service worker: show the incoming call with Accept / Decline actions
- [x] Server sends a push on call:invite when the callee has no live socket
- [x] Declining from the notification really declines the call server-side
- [x] Browser proof: 7/7 (real PushSubscription skipped — headless has no push service)

## 6. Ship
- [ ] Build, run the full API audit + UI audit, deploy, verify production
- [ ] Rebuild APK + iOS zip
