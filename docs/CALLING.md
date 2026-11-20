# Calling — how it works and what TURN is

## The short answer: what is a TURN relay?

When two people make a call, WebRTC tries to connect them **directly**, phone to phone.
That is what STUN helps with — it just tells each phone "here is your public IP and port",
like reading your own address off an envelope.

That direct connection works fine on the same Wi-Fi. It **fails** when:

- one of you is on mobile data behind carrier-grade NAT (most Indian carriers),
- one of you is on a corporate / hotel / campus network with a strict firewall,
- the two networks use symmetric NAT, which simply refuses unsolicited inbound packets.

In those cases the two phones can each see the outside world, but the world cannot reach
*them*. There is no hole to punch.

**TURN is the fallback.** It is a relay server with a public address that both phones can
reach. Each phone opens an outbound connection to the relay, and the relay forwards the
audio/video between them. It is a post office: neither side needs a return address that
works, because both sides only ever talk to the post office.

```
Direct (works on same Wi-Fi):     Phone A  ──────────────►  Phone B
Via TURN (works anywhere):        Phone A  ──►  TURN  ◄──  Phone B
```

### Why it matters for AZOLVE specifically

Your users will be in different countries on different carriers. Direct connections will
fail for a meaningful share of them — commonly 15–30% on mobile networks. Without TURN,
those calls ring, connect, and then show a black screen or silence. With TURN, they just
work.

### The cost of not having it

Nothing breaks loudly — that is the problem. The call connects at the signalling level, so
both sides see "Connecting…" and then a dead call. That is exactly the symptom you
reported. The app now detects it and shows an honest amber banner:
*"No TURN relay configured. Calls between mobile networks may fail."*

### The three options

| Option | Cost | Effort | Good for |
|---|---|---|---|
| **Metered Open Relay** (metered.ca) | Free tier: 50 GB/month, then ~$0.40/GB | 5 minutes — sign up, copy 3 values | Getting real calls working today |
| **Cloudflare Calls / Twilio Network Traversal** | Pay per GB | 15 minutes | Production with SLA |
| **Self-hosted coturn** | Free (you pay the VPS, ~$5/mo) | 1–2 hours — install, TLS cert, firewall | Full control, no per-GB cost |

50 GB of relayed audio is roughly **1,000+ hours of voice calls** — the free Metered tier
is genuinely enough for your team's testing and early users.

### What you paste into Render

```
TURN_URL=turn:relay.metered.ca:80,turns:relay.metered.ca:443
TURN_USERNAME=your-username
TURN_CREDENTIAL=your-password
```

Multiple URLs are supported (comma-separated) and the client tries them in order — the
`turns:` on port 443 is the important one, because it survives firewalls that only allow
HTTPS out.

The server exposes them at `GET /api/rtc/config`, the client fetches that on every call,
and the amber warning disappears the moment `hasTurn` becomes true.

---

## What was rebuilt in the call system

The previous implementation only forwarded signalling messages between two sockets. There
was no server-side notion of a call, so nothing could time out, nothing could be busy, and
nothing could be cleaned up. That is why it felt broken.

### Server-side call state machine (`server/realtime.js`)

```
ringing ──accept──► connecting ──media──► active ──end──► completed
   │
   ├──decline──► declined
   ├──45s──────► missed        (both sides notified, call:missed)
   └──disconnect► missed/ended  (peer-offline, both sides notified)
```

- `calls` Map holds live call records; `userCall` Map enforces **one call per user**, which
  is what makes busy detection real rather than cosmetic.
- Ring timeout is `CALL_RING_TIMEOUT_MS` (default 45 s), per-call `setTimeout`, `.unref()`'d
  so it never holds the process open.
- Every state change is broadcast to **both** parties via `call:state`, and persisted to the
  `calls` table, so call history is real data, not a UI guess.
- If a socket disconnects mid-call, the peer is told immediately instead of waiting for a
  dead air timeout.

### Client (`web/src/components/CallStage.jsx`)

- ICE servers fetched from `/api/rtc/config` at call time (cached per session), so TURN
  credentials never ship in the bundle.
- `bundlePolicy: max-bundle`, `rtcpMuxPolicy: require`, `iceCandidatePoolSize: 4`.
- **ICE restart** on `connectionState === 'failed'` — the initiator sends a new offer with
  `iceRestart: true`, the callee requests one via `call:ice-restart`. Two attempts, then a
  clear "Reconnecting failed" state instead of an infinite spinner.
- **Real quality indicator** from `pc.getStats()`: reads `candidate-pair.currentRoundTripTime`,
  `inbound-rtp.jitter` and `packetsLost`, polled every 3 s, mapped to
  excellent / good / fair / weak / lost. No fake animation.
- Peer mute and camera-off are mirrored, so you can see "They're muted".
- Ringing countdown shows the actual seconds left before it goes to missed.
- End reasons are specific: "They are on another call", "No answer", "Call declined".

### Test coverage (`scripts/test-calls.mjs`)

Ten assertions against a live server with three real sockets:

```
PASS  callee receives call:incoming with caller identity
PASS  caller receives call:ringing (timeout advertised)
PASS  second caller gets call:busy while callee is ringing
PASS  caller receives call:accepted
PASS  call:state broadcast (connecting)
PASS  peer mute/camera state is mirrored
PASS  call:ended delivered
PASS  decline while ringing reaches the caller
PASS  ring timeout marks the call as missed for both sides
PASS  rtc config served
```

Run it with:

```bash
cd azolve
DATA_DIR=/tmp/calltest PORT=3412 CALL_RING_TIMEOUT_MS=2000 node server/index.js &
node scripts/test-calls.mjs http://127.0.0.1:3412
```

---

## Known limitation, stated honestly

There is **no end-to-end encryption** on calls or messages. Media is encrypted in transit
with DTLS-SRTP (mandatory in WebRTC) and messages are encrypted at rest, but the server can
read message bodies — it has to, because AI translation happens server-side. This is
documented in the app under **Settings → Security** rather than claimed away.

True E2EE would require translating on-device, which means shipping a translation model to
the client. That is a real architectural change, not a checkbox, and it would cost the
27-language quality DeepL gives you. If E2EE is a hard requirement for a specific
deployment, say so and it can be designed properly.
