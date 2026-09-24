# CivicView — Email Deliverability (SPF / DKIM / DMARC)

How to harden `civicview.app` so transactional + notification email actually
reaches user inboxes instead of spam folders. Companion runbook to
[`SECURITY.md`](./SECURITY.md) (overall hardening) and
[`DEPLOY.md`](../DEPLOY.md) (Vercel + Render + Cloudflare setup).

**Status:** documented but not yet applied. The records below need to be added
in Cloudflare DNS once Postmark + Resend accounts are provisioned. Once they
are, mail receivers (Gmail / Outlook / iCloud / Yahoo) authenticate every
message that claims to come from `civicview.app` and reject forgeries.

**Who sends mail on behalf of `civicview.app`:**

| Service | Purpose | From address | Code reference |
| --- | --- | --- | --- |
| **Postmark** | Transactional — password reset, password-changed confirmation, future account email | `civicview@civicview.app` | [`backend/app/services/email_service.py`](../backend/app/services/email_service.py) |
| **Resend** | Admin notifications — fires when a report lands in the moderation queue | `noreply@civicview.app` | [`backend/app/services/notifications.py`](../backend/app/services/notifications.py) |

Both providers need DKIM verified on the domain, and the domain needs a single
SPF record that authorizes *both* providers to send on its behalf. SPF lookup
limit (10 DNS lookups) is not a concern here — Postmark + Resend together use
two `include:` directives.

---

## 1. What each record does (and why deliverability needs all three)

The mail-authentication stack has three layers. Receivers like Gmail want all
three aligned before they'll deliver to the inbox at scale.

- **SPF (Sender Policy Framework)** — DNS `TXT` record on `civicview.app`
  listing which mail servers are *allowed* to send mail claiming to be from
  `@civicview.app`. Receivers check the SMTP envelope sender (Return-Path)
  against this list. One SPF record per domain, period — multiple SPF records
  break SPF entirely.
- **DKIM (DomainKeys Identified Mail)** — DNS `TXT` record (per-provider,
  under a selector subdomain like `pm._domainkey.civicview.app`) containing a
  public key. The mail server signs each outbound message with the matching
  private key; receivers fetch the public key from DNS and verify the
  signature. Proves the message wasn't tampered with in flight + actually
  came from the claimed domain. Postmark and Resend each publish their own
  DKIM selector, so they coexist without conflict.
- **DMARC (Domain-based Message Authentication, Reporting & Conformance)** —
  DNS `TXT` record on `_dmarc.civicview.app` that tells receivers what to do
  with mail that *fails* SPF + DKIM (`p=none` / `p=quarantine` / `p=reject`)
  and where to send aggregate reports about the volume of mail claiming to be
  from this domain. Without DMARC, mailbox providers default to lenient
  handling; with DMARC, they enforce alignment.

The big-three mailbox providers (Gmail, Yahoo, Apple Mail) have all moved
toward requiring DMARC for bulk senders. Even at CivicView's launch volume
(< 5K messages / month), missing DMARC drops Gmail inbox placement
noticeably.

---

## 2. Postmark setup (transactional email)

Postmark hosts the password-reset + password-changed-confirmation emails
today, and is the path of least resistance for future account email
(verification confirmations, sub-renewal receipts, etc.). Free tier:
100 emails / month, forever. Paid tier starts at $15/mo for 10K messages.

### 2.1 Create the Postmark account + server

1. Sign up at [postmarkapp.com](https://postmarkapp.com/sign_up) with
   the CivicView admin email address.
2. **Servers** → **Create Server**. Name it `civicview-prod`. Color and
   icon don't matter functionally; pick anything.
3. Inside the server, **API Tokens** → copy the **Server API Token**. This
   is what gets pasted into Render as `POSTMARK_API_TOKEN`. Treat it like
   a password.

### 2.2 Verify the `civicview.app` sending domain

Sender Signatures (per-address verification) and Domain DKIM are two paths
to the same end. Domain DKIM is the only one worth doing — it covers
every sender address on the domain (`civicview@`, `noreply@`,
`hello@`, etc.) with one set of DNS records, and SPF/DMARC alignment only
works with DKIM-signed mail.

1. **Postmark** → **Sender Signatures** → **Add Domain**.
2. Enter `civicview.app`. Postmark generates a DKIM record + a
   Return-Path (bounce) CNAME and shows you both. The DKIM record looks
   like:

   ```
   Type:  TXT
   Name:  20XXXXX-pm._domainkey.civicview.app
   Value: k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBi… [long string]
   ```

   The selector (`20XXXXX-pm`) is generated per-domain. Copy Postmark's
   exact value — don't generate your own.

3. Postmark also shows a **Return-Path** CNAME:

   ```
   Type:  CNAME
   Name:  pm-bounces.civicview.app
   Target: pm.mtasv.net
   ```

   This routes bounce notifications through Postmark so Postmark sees
   them and can suppress bad addresses. Without it bounces go to
   `civicview@civicview.app` (the From address) and you have to handle
   suppression manually.

### 2.3 Add the records in Cloudflare

1. Cloudflare → `civicview.app` → DNS → **Records** → **Add record**.
2. For the DKIM record:
   - Type: `TXT`
   - Name: `20XXXXX-pm._domainkey` (Cloudflare auto-appends `.civicview.app`)
   - Content: paste the full `k=rsa; p=…` value from Postmark
   - Proxy status: **DNS only** (gray cloud — Cloudflare cannot proxy
     a DNS-level record; this is just the UI default)
   - TTL: Auto
3. For the Return-Path CNAME:
   - Type: `CNAME`
   - Name: `pm-bounces`
   - Target: `pm.mtasv.net`
   - Proxy status: **DNS only**
   - TTL: Auto
4. Save both.

### 2.4 Confirm in Postmark

Back in **Sender Signatures** → click **Verify**. Postmark queries DNS
and flips the status to **Verified ✓**. Propagation is usually instant
on Cloudflare but can take up to 10 minutes. If verification fails,
re-check the record name + value character-for-character.

### 2.5 Set the env vars on Render

After verification:

```
POSTMARK_API_TOKEN=<server token from §2.1>
POSTMARK_FROM_EMAIL=civicview@civicview.app
POSTMARK_MESSAGE_STREAM=outbound
```

Restart the backend (Render does this automatically on env-var change).
Watch the startup log for:

```
Email service: Postmark backend active (from=civicview@civicview.app, stream=outbound)
```

If you see `Email service: Dev backend active`, double-check both env
vars are set + non-empty.

---

## 3. Resend setup (admin notifications)

Resend handles "new report in the moderation queue" emails to addresses
listed in `ADMIN_EMAILS`. Free tier: 3K emails / month, 100 / day. The
volume is much lower than Postmark's transactional load, but the same
authentication discipline applies.

### 3.1 Create the Resend account + verify the domain

1. Sign up at [resend.com](https://resend.com) with
   the CivicView admin email address.
2. **Domains** → **Add Domain** → `civicview.app`. Resend gives you a
   single DKIM record:

   ```
   Type:  TXT
   Name:  resend._domainkey.civicview.app
   Value: p=MIGfMA0GCSqGSIb3DQ… [long string]
   ```

   Selector is fixed (`resend`), so it can't collide with Postmark's
   per-domain selector.

3. Resend may also show a Return-Path / MX-related entry for bounce
   tracking; this is optional for transactional use. Skip unless their
   dashboard insists it's required.

### 3.2 Add the DKIM record in Cloudflare

- Type: `TXT`
- Name: `resend._domainkey`
- Content: paste Resend's `p=…` value verbatim
- Proxy status: **DNS only**
- TTL: Auto

### 3.3 Confirm + set env vars

In Resend → **Domains** → click **Verify DNS**. Once it flips to green,
set on Render:

```
RESEND_API_KEY=re_<token>
NOTIFICATION_FROM_EMAIL=CivicView <noreply@civicview.app>
REPORT_NOTIFICATIONS_ENABLED=true
```

Restart the backend. Trigger a test report (file a report from the
demo citizen account) and verify the admin email lands.

---

## 4. SPF — one combined record for both providers

**Critical:** a domain may only have ONE SPF record (`v=spf1 …`). If
Postmark and Resend each tell you to add a separate `v=spf1 include:…`
record, you must merge them into a single record. Two SPF records on
one domain = SPF fails for both.

### 4.1 The record

- Type: `TXT`
- Name: `@` (root of `civicview.app`)
- Content:

  ```
  v=spf1 include:spf.mtasv.net include:amazonses.com ~all
  ```

  Breakdown:
  - `v=spf1` — version identifier (required first).
  - `include:spf.mtasv.net` — authorizes Postmark's outbound MTAs.
  - `include:amazonses.com` — authorizes Resend's outbound MTAs (Resend
    sends through Amazon SES infrastructure).
  - `~all` — **soft fail** for any other source. Receivers may
    quarantine but not necessarily reject. Use this during the rollout
    window; once DMARC is at `p=reject` (§5.3), tighten to `-all`
    (hard fail) for symmetric strictness.

- Proxy status: **DNS only**
- TTL: Auto

### 4.2 If Cloudflare already has an SPF record

Check before adding. If a record like
`v=spf1 include:_spf.google.com ~all` already exists (e.g. from a
previous Google Workspace experiment), **edit the existing record** —
don't add a second one. Merge by appending the new `include:` tokens
before `~all`:

```
v=spf1 include:_spf.google.com include:spf.mtasv.net include:amazonses.com ~all
```

### 4.3 Verify

From any shell:

```
dig civicview.app TXT +short | grep spf1
```

Expected output: exactly one line starting with `"v=spf1`. Two lines =
broken SPF — fix immediately.

---

## 5. DMARC — policy progression (none → quarantine → reject)

DMARC tells receivers what to do with mail that fails BOTH SPF and DKIM
alignment. Roll it out in three phases so you can catch
misconfigurations before they bounce real mail.

### 5.1 Phase 1 — Monitoring (`p=none`)

Add immediately after SPF + DKIM are live. Doesn't block any mail; just
asks receivers to email you daily aggregate reports about what's passing
and failing. Run this for 2–4 weeks.

- Type: `TXT`
- Name: `_dmarc`
- Content:

  ```
  v=DMARC1; p=none; rua=mailto:civicview@civicview.app; ruf=mailto:civicview@civicview.app; fo=1; pct=100; adkim=r; aspf=r
  ```

  Breakdown:
  - `v=DMARC1` — version identifier.
  - `p=none` — policy: take no action on failures (monitoring only).
  - `rua=mailto:civicview@civicview.app` — where aggregate XML
    reports go. One per receiver per day.
  - `ruf=mailto:civicview@civicview.app` — where forensic (per-message
    failure) reports go. Lower volume but contains message headers.
  - `fo=1` — generate forensic reports when *any* underlying check
    fails (default is `0` which only reports when both fail; `1` is
    more verbose, useful during rollout).
  - `pct=100` — apply policy to 100% of mail. Stays at 100 across all
    phases.
  - `adkim=r` / `aspf=r` — relaxed alignment. Subdomain mail (e.g.
    a future `mail.civicview.app`) still aligns. Tighten to `s`
    (strict) only if you're certain no subdomains will ever send.

- Proxy status: **DNS only**
- TTL: Auto

### 5.2 Phase 2 — Quarantine (`p=quarantine`)

After 2–4 weeks of `p=none` reports showing 100% pass rate (or after
fixing whatever the reports surface), bump to quarantine. Failing mail
goes to recipient spam folders instead of inboxes — gives you signal
without bouncing legitimate mail.

Edit the existing `_dmarc` record; change `p=none` to `p=quarantine`.
Leave everything else identical. Run for another 2–4 weeks.

### 5.3 Phase 3 — Reject (`p=reject`)

Once `p=quarantine` shows zero forensic reports for legitimate mail,
move to full reject. Receivers refuse failing mail outright (550 SMTP
error to the sender). This is the target state.

Edit `_dmarc` again; change `p=quarantine` to `p=reject`. At the same
time, tighten SPF from `~all` to `-all` (§4.1) for matching strictness.

### 5.4 Aggregate report handling

DMARC aggregate reports arrive as XML attachments — readable but not
fun. Two ways to handle them:

1. **Manual review.** Open the daily reports in the `civicview@`
   inbox; you're looking for `auth_results` lines that show
   `result="fail"`. Tractable while volume is small.
2. **DMARC report parsing service.** Free options:
   [Postmark's DMARC monitoring](https://dmarc.postmarkapp.com) (yes,
   the same Postmark — separate product, free), or
   [dmarcian](https://dmarcian.com) (free tier for low volume). Set
   `rua=mailto:<their-address>@<service>` instead. They send you a
   human-readable weekly summary.

Recommendation: use Postmark's free DMARC monitor since you're already
in the Postmark ecosystem. One less account.

---

## 6. Verification checklist

After all records are live, walk through this before marking the task
complete.

### 6.1 DNS lookups

From any shell (`dig` ships on macOS + Linux; on Windows use `nslookup`
or PowerShell):

```bash
# SPF — expect ONE line.
dig civicview.app TXT +short | grep spf1

# DKIM (Postmark) — expect a long k=rsa; p=… string.
dig 20XXXXX-pm._domainkey.civicview.app TXT +short

# DKIM (Resend) — expect a long p=… string.
dig resend._domainkey.civicview.app TXT +short

# DMARC — expect v=DMARC1; p=none (Phase 1) / p=quarantine (Phase 2) / p=reject (Phase 3).
dig _dmarc.civicview.app TXT +short

# Return-Path (Postmark) — expect pm.mtasv.net.
dig pm-bounces.civicview.app CNAME +short
```

### 6.2 End-to-end test with mail-tester.com

The single best deliverability check, free:

1. Visit [mail-tester.com](https://www.mail-tester.com). They give you
   a random `test-XXXX@srv1.mail-tester.com` address.
2. Trigger a password reset in CivicView for that address (use the
   normal forgot-password flow; the email won't actually deliver
   because there's no real account, but Postmark still sends).
3. Click **Then check your score** on mail-tester.com.

You're aiming for **10 / 10**. Common deductions during initial setup:
- –1 for SPF if `~all` instead of `-all` (acceptable during Phase 1–2).
- –1 for DMARC if `p=none`.
- Missing reverse DNS / PTR (controlled by Postmark, not you).
- HTML content quality issues — irrelevant for plain-text password
  reset.

A 9+ score with the listed acceptable deductions is launch-ready.

### 6.3 MXToolbox SuperTool

[mxtoolbox.com/SuperTool.aspx](https://mxtoolbox.com/SuperTool.aspx)
runs a battery of checks against the domain. Targeted lookups:

- **SPF Record Lookup** — confirms exactly one SPF record.
- **DKIM Lookup** — requires the selector, so two checks:
  `20XXXXX-pm._domainkey.civicview.app` and
  `resend._domainkey.civicview.app`.
- **DMARC Lookup** — confirms the policy.
- **Domain Health** — overall scan; aim for zero red errors.

### 6.4 Real-world inbox test

Send a password reset to a personal Gmail + a personal Outlook /
Hotmail + an iCloud address. All three should:

1. Land in the **inbox**, not spam.
2. Show a "signed by civicview.app" or "via civicview.app" indicator
   in the message header (Gmail collapses this into a dropdown next
   to the sender name).
3. Pass authentication when you click "Show original" (Gmail) — both
   SPF and DKIM should report `PASS`, and DMARC should report `PASS`.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Postmark domain stuck on "Pending verification" after >15 min | DKIM TXT record has the wrong name (missing the selector prefix) or value has extra whitespace | Copy from Postmark again, paste *exactly* — Cloudflare's UI sometimes trims a trailing semicolon |
| `dig … TXT` returns nothing for the DKIM record | TTL hasn't propagated, or the record was added at the wrong zone (e.g. `civicview.app.civicview.app`) | Verify in Cloudflare DNS that the rendered FQDN is correct; wait 5 more minutes |
| Two SPF records show up in DNS | Old Google / Microsoft / vendor record was never removed | Delete the older one or merge `include:` tokens into the new one |
| DMARC reports show high SPF-fail volume | A third-party sender (CRM, marketing tool) is sending on behalf of the domain without being in SPF | Add their `include:` to SPF, or stop them sending from `civicview.app` |
| Mail-tester.com gives `Authenticated-Results: dkim=neutral` | Mail was sent before DKIM record fully propagated | Wait 10 minutes, resend the test |
| Bounces no longer flow to Postmark suppression list | Return-Path CNAME (`pm-bounces`) is missing or proxied through Cloudflare | DNS-only / gray cloud, not orange |
| Resend `Authenticated-Results: dkim=fail` | Resend's DKIM key was rotated and DNS wasn't updated | Resend rotates keys roughly yearly; re-pull from their dashboard |

---

## 8. Rotation + maintenance

| Cadence | Action |
| --- | --- |
| Monthly | Skim the DMARC aggregate report inbox. Any spike in failures → investigate. |
| Quarterly | Re-run mail-tester.com end-to-end. Catches silent provider key rotations. |
| Annually | Re-verify the Postmark + Resend dashboards still show **Verified ✓** on the `civicview.app` domain. Re-issue DKIM keys if a provider prompts. |
| On incident | If a key is suspected compromised (extremely unlikely with hosted providers), Postmark / Resend both have a "Rotate DKIM" button. Rotation publishes a new selector + key; old selector stays valid until DNS removes it. |

---

## 9. Final paste-ready DNS records

Summary table for Cloudflare. Replace `20XXXXX` with the actual selector
Postmark generates for the domain.

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| `TXT` | `@` | `v=spf1 include:spf.mtasv.net include:amazonses.com ~all` | DNS only |
| `TXT` | `20XXXXX-pm._domainkey` | `k=rsa; p=<Postmark public key>` | DNS only |
| `TXT` | `resend._domainkey` | `p=<Resend public key>` | DNS only |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:civicview@civicview.app; ruf=mailto:civicview@civicview.app; fo=1; pct=100; adkim=r; aspf=r` | DNS only |
| `CNAME` | `pm-bounces` | `pm.mtasv.net` | DNS only |

Five records total. Total deliverability hardening cost: $0 (Cloudflare
DNS is free; Postmark + Resend both have free tiers covering launch
volume).

---

## 10. Related docs

- [`SECURITY.md`](./SECURITY.md) — overall hardening posture.
- [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) — runbook if email
  starts bouncing en masse or a key is compromised.
- [`DEPLOY.md`](../DEPLOY.md) — Cloudflare DNS setup baseline.
- [`backend/app/services/email_service.py`](../backend/app/services/email_service.py) — Postmark integration code.
- [`backend/app/services/notifications.py`](../backend/app/services/notifications.py) — Resend integration code.
- [`backend/.env.example`](../backend/.env.example) — env var inventory.
