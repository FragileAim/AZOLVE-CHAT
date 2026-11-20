# Adding the Resend DNS records at GoDaddy

`azolve.io` is registered at **GoDaddy** (nameservers `ns61/ns62.domaincontrol.com`).
These are the exact clicks.

## Before you start

I checked DNS from outside. Current state of `azolve.io`:

| Record | Current value | Conflict with Resend? |
|---|---|---|
| `A @` | `68.178.231.21` (GoDaddy parking page) | No |
| `TXT @` | `v=spf1 include:secureserver.net -all` | **No** — Resend's SPF goes on the `send` subdomain, not the root |
| `TXT @` | google-site-verification | No |
| `TXT @` | brevo-code:00a0a521… | No |
| `resend._domainkey` | *missing* | needs adding |
| `send` MX / TXT | *missing* | needs adding |
| `rsend` CNAME | *missing* | needs adding |

**Do not touch the existing root SPF record.** Leave it exactly as it is.

## Step by step in GoDaddy

1. Sign in at https://godaddy.com and open **My Products**.
2. Find `azolve.io` → click **DNS** (or *Manage DNS*).
3. You will see a table of records. Add the four below with the **Add New Record**
   button. GoDaddy's form has: Type, Name, Value, TTL. Set TTL to **1/2 hour**
   (the default) or 600 seconds — short TTL means verification lands faster.
4. GoDaddy wants only the **prefix** in the Name field, not the full hostname.

### Record 1 — DKIM (TXT)

- Type: **TXT**
- Name: `resend._domainkey`
- Value: paste this whole line, unbroken:

```
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCaqLH/U4zUuNKf2AFUTpFFfUIU4B+24mdIGWBQb4VLhct9Vbx4KYfuz94OBRnXWDyBFIu97+uMDPnTYplQwNpz7BfDho4gmDVGpAfFqLx73lb7ZeM+Nql0NGZvZn20rqDHrbNtIUUU5/6EnxzDk+Uiacuem1wZVOJWUH3HQp/KfwIDAQAB
```

- TTL: 1/2 hour

GoDaddy sometimes splits long TXT values or adds quotes of its own. Paste it
raw, without surrounding quotes. If GoDaddy complains the value is too long,
that is a sign it auto-wrapped it — delete and re-paste as one line.

### Record 2 — MX for bounces (MX)

- Type: **MX**
- Name: `send`
- Value: `feedback-smtp.us-east-1.amazonses.com`
- Priority: `10`
- TTL: 1/2 hour

### Record 3 — SPF for the send subdomain (TXT)

- Type: **TXT**
- Name: `send`
- Value: `v=spf1 include:amazonses.com ~all`
- TTL: 1/2 hour

### Record 4 — Click/open tracking (CNAME)

- Type: **CNAME**
- Name: `rsend`
- Value: `send.forge.rmta.net`
- TTL: 1/2 hour

## Then verify

Go to https://resend.com/domains, open `azolve.io`, and press **Verify DNS
Records**. Each of the four rows should turn green. If one stays red after ten
minutes, it is almost always one of:

- **Name field got the full hostname.** GoDaddy wants `send`, not
  `send.azolve.io`. If you typed the full name, the record resolves as
  `send.azolve.io.azolve.io` and will never verify.
- **TXT value was quoted twice** (`""v=spf1…""`).
- **CNAME proxied.** Not applicable at GoDaddy, but if you ever move DNS to
  Cloudflare, the CNAME must be grey-cloud / DNS-only.
- **DKIM pasted with a line break.**

## What I do once it is green

Tell me and I will:

1. Blank `RESEND_FROM` on the Render service so the sender falls back to
   `EMAIL_FROM` = `no-reply@azolve.io`.
2. Redeploy.
3. Send a live test code to an address that is **not** the Resend account
   owner, which is the only test that proves the restriction is gone.

Until that moment, only `trivediabhishek267@gmail.com` can receive a code —
that is a Resend anti-spam rule on the shared `onboarding@resend.dev` sender,
not a bug in the app.
