# Email OTP — live on Brevo

## Status: WORKING, verified end to end

Provider: **Brevo**, over the HTTPS API (not SMTP). Configured on Render service
`srv-dc06qdcs728c73ckquh0`.

```
GET https://azolve-chat.onrender.com/api/auth/otp/status
{ "emailProvider": "brevo", "emailConfigured": true, "emailDelivery": true,
  "primary": "email", "note": "Verification codes are sent by email." }
```

Proof of delivery, from Brevo's own event log:

```
22:47:32 | trivediabhishek267@gmail.com | Your AZOLVE CHAT verification code | delivered
22:44:34 | trivediabhishek267@gmail.com | Your AZOLVE CHAT verification code | delivered
```

Full flow exercised on a local instance with the production config:

```
POST /api/auth/email/start   -> delivered:true, code stored
POST /api/auth/email/verify  -> 200, JWT + refreshToken + sessionId returned
```

## Environment variables

| Key | Value |
|---|---|
| `EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | `xkeysib-…` (API key, **not** the `xsmtpsib-` SMTP key) |
| `BREVO_FROM` | `no-reply@azolve.io` |
| `EMAIL_FROM` | `no-reply@azolve.io` |
| `EMAIL_FROM_NAME` | `AZOLVE CHAT` |
| `EMAIL_REPLY_TO` | `support@azolve.io` |

## Why the API and not SMTP — three walls, in order

This is worth recording because each failure looked like a code bug and was not.

1. **Resend's shared sender is locked to one recipient.** `onboarding@resend.dev`
   only delivers to the address the Resend account was created with:
   `403 — You can only send testing emails to your own email address`. Verifying
   a domain is the only cure, which the owner did not want to do yet.
2. **Render Free blocks outbound ports 25, 465 and 587.** SMTP to
   `smtp-relay.brevo.com:587` timed out. Brevo's alternate port **2525** is open,
   which is how we got past this one.
3. **Brevo rejects unrecognised IPs.** On 2525 the relay answered
   `525 5.7.1 Unauthorized IP address`. Render Free has no static outbound IP, so
   there is nothing to allowlist — the IP changes on every deploy. The owner
   authorised the IP / disabled the restriction at
   https://app.brevo.com/security/authorised_ips, which unblocked it.

The **HTTPS API on port 443** sidesteps 2 and 3 entirely: 443 is never blocked,
and the API has no IP allowlist. That is why it is the right choice on Render
Free. Keep the IP restriction disabled, or switch to Render Starter for a static
IP if you ever want it back on.

## Sender identity — branded, `no-reply@azolve.io`

Mail is sent as `AZOLVE CHAT <no-reply@azolve.io>` with `Reply-To:
support@azolve.io`. Confirmed in Brevo's event log:

```
22:55:54 | no-reply@azolve.io | Your AZOLVE CHAT verification code | delivered
```

`azolve.io` was already authenticated on the Brevo account (provider GoDaddy),
so no DNS work was needed. Brevo's DNS check reports:

| Record | Host | Value | Status |
|---|---|---|---|
| DKIM 1 | `brevo1._domainkey` | CNAME `b1.azolve-io.dkim.brevo.com` | verified |
| DKIM 2 | `brevo2._domainkey` | CNAME `b2.azolve-io.dkim.brevo.com` | verified |
| Ownership | `@` | TXT `brevo-code:00a0a521…` | verified |
| DMARC | `_dmarc` | TXT `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | verified |

Note these are **CNAME** records, not the `mail._domainkey` TXT record that older
Brevo guides describe. Looking for a TXT record finds nothing and looks like a
misconfiguration when the domain is in fact fine — verify with
`GET /v3/senders/domains/azolve.io` instead of guessing.

### One optional DNS improvement

The root SPF record is still `v=spf1 include:secureserver.net -all`. It does not
include Brevo, and `-all` is a hard fail. This does **not** break delivery today
because Brevo sends with its own envelope domain (`mailin.fr`), so SPF is
evaluated against Brevo's domain, and DMARC alignment is satisfied by the DKIM
signature on `azolve.io`. But if you ever want SPF to pass for mail sent *as*
`azolve.io` from any server, add Brevo's include:

```
v=spf1 include:secureserver.net include:spf.sendinblue.com -all
```

Not urgent — DKIM is doing the work, and DMARC is at `p=none` so nothing is
being rejected. Worth doing before you send at volume.

The Resend path is no longer needed. `azolve.io` is still sitting unverified in
that account (id `8bc1d1d4-ca3a-4d04-9ced-08260280d974`); it can be deleted, or
left as a spare provider. `docs/DNS-RESEND-GODADDY.md` is kept only as a
fallback reference.

## Honest limitation: `delivered` means "provider accepted"

`POST /api/auth/email/start` returns `delivered:true` when Brevo accepts the
message (`201`), not when it lands in an inbox. Delivery is asynchronous, so a
mailbox that does not exist still reports `delivered:true` and only bounces
later. Observed during testing:

```
flowtest.azolve@gmail.com | hardBounces | 550-5.1.1 The email account you tried to reach does not exist
```

That is correct behaviour, not a bug — no provider can know synchronously. But
do not test with invented addresses: hard bounces damage the sending reputation
of the Brevo account. Use real mailboxes.

`/api/auth/otp/status` used to claim `emailDelivery:true` purely because a
provider was *configured*, even when every send was failing. It now also reports
`lastEmail` (the outcome of the most recent real attempt) and drops
`emailDelivery` to `false` if that attempt failed, with the provider's error in
`note`.

## Free tier

Brevo free: **300 emails/day**, no card. Each signup or sign-in uses one. If the
team exceeds it, sends fail with a rate-limit error visible in `lastEmail` and
the server log.

## Other providers, for reference

| `EMAIL_PROVIDER` | Free tier | Needs domain? | Notes |
|---|---|---|---|
| `brevo` | 300/day | No (sender email verification) | **Current** |
| `resend` | 3,000/mo, 100/day | Yes, for other recipients | Branded sender once DNS is done |
| `smtp` | your mailbox | No | Needs an open outbound port; blocked on Render Free |
| `sendgrid` | 100/day | Sender verification | `SENDGRID_API_KEY` |
| `mailgun` | trial | Yes | `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` |
| `console` | free | No | Code goes to the server log only |
