# Email OTP — current state and the one remaining step

## Status: WORKING (live)

`RESEND_API_KEY` is set on Render service `srv-dc06qdcs728c73ckquh0`, with
`EMAIL_PROVIDER=resend`. `GET https://azolve-chat.onrender.com/api/auth/otp/status`
now returns:

```json
{ "emailProvider": "resend", "emailConfigured": true, "emailDelivery": true,
  "primary": "email", "note": "Verification codes are sent by email." }
```

A real signup was run against the live deployment and Resend reported the
message `delivered`:

```
POST /api/auth/email/start {"email":"trivediabhishek267@gmail.com"}
→ {"provider":"resend","delivered":true,"message":"A 6-digit code was emailed ..."}
```

## The limitation you must fix before your team can sign up

Right now `RESEND_FROM=onboarding@resend.dev`. That is Resend's shared testing
sender, and it has a hard rule: **it will only deliver to the email address the
Resend account was created with.** Any other recipient is rejected:

```
HTTP 403  "You can only send testing emails to your own email address
(trivediabhishek267@gmail.com). To send emails to other recipients, please
verify a domain at resend.com/domains."
```

So today only `trivediabhishek267@gmail.com` can receive a code. Your team
cannot register until a domain is verified.

## Fix: verify azolve.io in Resend

The domain has already been added to your Resend account (id
`8bc1d1d4-ca3a-4d04-9ced-08260280d974`, region `us-east-1`, status
`not_started`). It now needs four DNS records at your domain registrar
(Hostinger / GoDaddy / Cloudflare / wherever azolve.io's DNS lives):

| Type | Name / Host | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCaqLH/U4zUuNKf2AFUTpFFfUIU4B+24mdIGWBQb4VLhct9Vbx4KYfuz94OBRnXWDyBFIu97+uMDPnTYplQwNpz7BfDho4gmDVGpAfFqLx73lb7ZeM+Nql0NGZvZn20rqDHrbNtIUUU5/6EnxzDk+Uiacuem1wZVOJWUH3HQp/KfwIDAQAB` | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend` | `send.forge.rmta.net` | — |

Notes on entering these:
- Some registrars want the full host (`send.azolve.io`), others want just the
  prefix (`send`). If one form is rejected, try the other.
- Cloudflare users: set the MX and CNAME records to **DNS only** (grey cloud),
  not proxied, or verification fails.
- The DKIM value is long; paste it as a single line with no line breaks.

**GoDaddy-specific click-by-click steps are in `docs/DNS-RESEND-GODADDY.md`** —
`azolve.io` is registered at GoDaddy, and I confirmed from outside that none of
the four records exist yet. The existing root SPF record
(`v=spf1 include:secureserver.net -all`) does **not** conflict and must be left
alone.

Then press **Verify** at https://resend.com/domains. Propagation is usually
minutes, occasionally up to an hour.

## The last step, which I do for you

Once Resend shows the domain as **Verified**, tell me and I will blank the
`RESEND_FROM` variable on Render so the sender falls back to `EMAIL_FROM`
(`no-reply@azolve.io`), then redeploy and confirm with a live send to a
non-owner address. That is a two-minute change.

## If you do not own azolve.io

Say so and I will delete the domain from Resend. The alternative is to verify
whatever domain you do own and change `EMAIL_FROM` to match, or switch to SMTP
with a mailbox you already have (Gmail app password, Zoho, Hostinger) — SMTP
needs no domain verification at all and would unblock the team immediately.

## Provider reference

| `EMAIL_PROVIDER` | Free tier | Needs domain? | Notes |
|---|---|---|---|
| `resend` | 3,000/mo, 100/day | Yes, for other recipients | Current choice |
| `brevo` | 300/day | Sender verification | `BREVO_API_KEY` |
| `smtp` | your mailbox | No | `SMTP_HOST/PORT/USER/PASS` |
| `sendgrid` | 100/day | Sender verification | `SENDGRID_API_KEY` |
| `mailgun` | trial | Yes | `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` |
| `console` | free | No | Code goes to server log only |
