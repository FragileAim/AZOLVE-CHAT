# Metered TURN — what to click, step by step

> **STATUS: CONFIGURED AND VERIFIED (live).**
> `TURN_USERNAME` / `TURN_CREDENTIAL` are set on the Render service
> `srv-dc06qdcs728c73ckquh0`. `GET https://azolve-chat.onrender.com/api/rtc/config`
> returns `"hasTurn": true, "turnSource": "static"`, and the TURN entry carries the
> username and credential. A real relay allocation against
> `global.relay.metered.ca:3478` was tested with `turnutils_uclient` and passed
> with 8/8 packets and 0% loss. Nothing left to do here unless the credential is
> rotated.

You said you are clueless about the TURN app. That is fine — there are only two
things to do, and **one of them is much easier than the other**. Read §1, do the
easy one, and you are finished.

---

## 0. Why you need this at all

Two phones on the same Wi-Fi can call each other directly. Two phones on
**different networks** (one on Jio 4G, one on office Wi-Fi) usually cannot —
mobile carriers use symmetric NAT and block direct connections. A **TURN relay**
is a server in the middle that forwards the audio/video for both sides. Without
it, calls connect on Wi-Fi and fail on cellular.

Metered runs that relay. You pay per GB relayed; the free tier is 50 GB/month.

---

## 1. The easy way — create a static credential (do this)

This gives you a fixed username and password. No app name, no API keys, no
secret exchange. It is the fastest path to working calls.

1. Go to **<https://dashboard.metered.ca>** and sign in.
2. In the left sidebar click **TURN Server**.
   - On the *new* dashboard the item is called **TURN Server → Credentials**.
   - On the *classic* dashboard it is just **TURN Server**.
3. Click **Create Credential** (classic dashboard: **Add Credential**, or the big
   "Click Here to Generate Your First Credential" button).
4. Everything in the dialog is optional. Type a **label** like `azolve-prod` so
   you can tell it apart later, and leave **Region** on the default (Global
   automatic). Click **Create credential**.
5. The new row appears at the top of the table. Click the **eye icon** to reveal
   the password, or click **Get credential** on that row.
6. You now have two values. Copy them:

   | Metered shows | Paste into Render as |
   |---|---|
   | **Username** (looks like `a5c3184b4a4836923cf6bd96`) | `TURN_USERNAME` |
   | **Password** (looks like `mcOUQqUdXie7PTd1`) | `TURN_CREDENTIAL` |

7. In Render → your service → **Environment**, add:

   ```env
   TURN_URL=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443
   TURN_USERNAME=<the username from step 6>
   TURN_CREDENTIAL=<the password from step 6>
   ```

   Leave `TURN_APP`, `TURN_API_KEY`, `TURN_API_SECRET` and
   `TURN_STATIC_AUTH_SECRET` **empty**. The server checks them in order and
   stops at the first complete set it finds.

8. Save. Render redeploys automatically. Done.

> **Wait two minutes before testing.** Metered propagates a brand-new credential
> across its global relay network, and a call placed in the first ~2 minutes can
> fail even though the credential is valid. This is documented by Metered, not a
> bug in our code.

### How to confirm it worked

Open this in a browser:

```
https://azolve-chat.onrender.com/api/rtc/config
```

You want to see:

```json
{
  "hasTurn": true,
  "turnSource": "static",
  "iceServers": [ "..." , { "urls": "turn:global.relay.metered.ca:80", "username": "...", "credential": "..." } ]
}
```

If `hasTurn` is `false`, the source tells you why — see §4.

---

## 2. The other way — API keys (what you already gave me)

Your `sk_id_f7258334...` and `sk_secret_c1344...` are **API keys**, not a TURN
username and password. You cannot put them into an `RTCPeerConnection` — the
relay rejects them. They have to be **exchanged** for a short-lived credential
first, which is what the server does for you.

That exchange needs one extra piece of information: **your Metered domain**, the
`<appname>` in `<appname>.metered.live`.

**Where to find it:**

1. Sign in at <https://dashboard.metered.ca>.
2. Left sidebar → **Developers**.
3. There is a field labelled **Metered domain**. It looks like
   `azolve-chat.metered.live` or `demo.metered.live`.
4. Copy only the part **before** `.metered.live` — e.g. `azolve-chat`.
5. Put that in Render as `TURN_APP`, and keep `TURN_API_KEY` /
   `TURN_API_SECRET` as they are.

The server will then call:

```
POST https://<TURN_APP>.metered.live/api/v1/turn/credential?secretKey=<TURN_API_SECRET>
```

…cache the result for 30 minutes, and hand short-lived credentials to the
browser. `/api/rtc/config` will report `"turnSource": "metered"`.

**If the Developers page has no "Metered domain" field**, your workspace is on
the classic dashboard and has no app sub-domain. In that case use §1 — the static
credential — and ignore the API keys entirely.

---

## 3. Which should you pick?

| | Static credential (§1) | API keys (§2) |
|---|---|---|
| Setup effort | 3 clicks | find the app name, then 3 env vars |
| Credential lifetime | permanent until you delete it | 1 hour, auto-refreshed |
| Leaks in a screenshot? | yes, permanently | no, expires |
| Good for | getting it working today | production |

Both work with the current code. Start with §1, move to §2 later when you have
real users. Nothing in the app needs to change — only environment variables.

---

## 4. Reading `/api/rtc/config`

| `turnSource` | Meaning | Fix |
|---|---|---|
| `static` | Working, using `TURN_USERNAME` / `TURN_CREDENTIAL` | none |
| `metered` | Working, using the Metered API exchange | none |
| `coturn-rest` | Working, using your own coturn server | none |
| `stun-only` | `TURN_URL` is empty — calls work on Wi-Fi only | set `TURN_URL` |
| `metered-failed` | `TURN_APP` / keys present but Metered rejected the exchange | check `TURN_APP` spelling; the log says `invalid secretKey` if the app name is wrong |
| `none` | `TURN_URL` is set but **no credential** is configured — the relay URL is advertised without a username | do §1 |
| `error` | The broker threw | read the Render log line starting `[rtc]` |

---

## 5. Testing that the relay actually works

Metered provides a browser test page: <https://www.metered.ca/tools/openrelay/>.
Paste your username and password there and click **Test TURN Server**. A green
result means the relay accepts your credential — independent of our app.

Then do the real test: two phones, **one on mobile data and one on Wi-Fi**,
place a call. If that connects, TURN is doing its job. Two devices on the same
Wi-Fi will connect even without TURN, so that is not a valid test.

---

## 6. Cost

Metered free tier: **50 GB/month** of relayed traffic, no card required. A
one-minute audio call uses roughly 1 MB; video roughly 5–8 MB. 50 GB is
thousands of test calls. If you exceed it, relay stops until the month rolls over
or you add billing — calls then fall back to direct-only, which fails on
cellular.
