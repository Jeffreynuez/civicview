# CivicView — Incident Response Runbook

**Read this when something is going wrong. The whole point of this doc is to be
findable and executable when you're stressed at 2am.**

Companion to `SECURITY.md` (which covers prevention) and `DEPLOY.md` (which
covers normal operations).

---

## First 15 minutes — triage checklist

Regardless of which scenario this is, do these five things first:

1. **Don't panic. Don't tweet about it yet.** The first communication you send
   sets the tone for everything that follows. Take a breath.

2. **Confirm the incident is real.** Common false alarms:
   - "The site is down" → check the Render dashboard. The paid plan is
     always-on, so a true outage warrants investigation; check Render's
     status page (status.render.com) first to rule out a provider-side
     incident.
   - "Someone hacked my account" → confirm the user actually tried their correct
     password and isn't just locked out. Check `failed_login_log` if it exists.
   - "I see a 500 error" → check Sentry / Render logs. One-off 500s happen.

3. **Note the time** you became aware. Helpful for the post-mortem timeline.

4. **Decide the severity** (use your judgment, but here's a guide):
   - **SEV-1** — Active breach, data exfiltration in progress, defacement of a
     real rep's page, payment system compromised. Read-only the app immediately
     (see §1 below).
   - **SEV-2** — Suspected breach, leaked credentials, suspicious admin activity.
     Rotate credentials within the hour but don't necessarily take the app down.
   - **SEV-3** — DDoS / abuse traffic, dependency vulnerability published. Hours
     to days to remediate.

5. **Start a running log.** Open a text file or notes doc and write down every
   action you take with a timestamp. You'll need this for the post-mortem and
   potentially for legal/disclosure purposes.

---

## Section 1 — Take the app read-only (emergency stop)

Use this if you suspect an active breach and want to halt further damage while
you investigate.

**Fastest path** (~2 minutes, takes the app fully offline):

1. **Render** → `civicview-api` → Settings → **Suspend Service**. Backend stops
   responding to all requests; existing sessions get connection errors.
2. **Vercel** → project → Settings → Domains → temporarily remove `civicview.app`
   OR set up a `vercel.json` redirect to a static "maintenance" page.

**Less disruptive** (frontend stays up, backend rejects writes):

1. Add a feature flag env var on Render: `READ_ONLY_MODE=true`.
2. Wrap all write endpoints (POST/PUT/PATCH/DELETE) in a check that returns 503
   when the flag is set. This requires code already in place — **add this
   middleware before you need it** (it's listed as a Phase 6+ improvement in
   `SECURITY.md`).

If the issue is specifically Cloudflare-blockable (DDoS, scraper attack):

- **Cloudflare** → Security → Settings → set Security Level to **I'm Under
  Attack**. Inserts a JavaScript challenge on every page load. Real users get
  through with a 5s delay; automated traffic gets blocked at the edge.

---

## Section 2 — Common scenarios

### 2.1 Suspected compromised admin account

You see admin actions in the audit log that you didn't perform, OR you find an
admin account that shouldn't be there.

1. **Remove the email from `ADMIN_EMAILS`** in Render env vars immediately.
   Redeploy auto-fires. ~2 min until the email no longer has admin powers.
2. **Rotate `SESSION_SECRET`** to invalidate every session including the
   attacker's. Generate a new value:
   ```
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
   Set on Render. Redeploys. All users (including you) are logged out.
3. **Reset your own admin password** by signing back in and going through the
   password reset flow.
4. **Audit recent admin actions** — review the moderation queue for any
   suspicious Hide / Unhide / Suspend decisions made in the last 24h. Revert
   anything that looks wrong.
5. **Review email + GitHub access** — if your personal email or GitHub account
   was the entry point, change those passwords and enable 2FA on both (if not
   already on).

### 2.2 Suspected database breach

You see evidence that someone accessed the Postgres directly (unexpected rows,
missing data, suspicious queries in Render's DB logs).

1. **Don't delete anything yet** — you need the evidence for forensics.
2. **Rotate the database password.** Render → `civicview-db` → Info →
   "Rotate Password." This breaks the existing `DATABASE_URL` link; Render
   auto-updates the `civicview-api` env var when DB password rotates. Backend
   redeploys.
3. **Snapshot the current DB state** for forensics: Render → `civicview-db` →
   Backups → "Create Backup Now" (requires Starter+ plan). Note the snapshot ID.
4. **Determine the entry point** — was it a leaked credential? An SQL injection?
   A misconfigured CORS that let a malicious origin call admin endpoints?
   Check Cloudflare's logs for any unusual `/api/admin/*` traffic.
5. **Notify affected users** — if any PII was exposed, you have legal disclosure
   obligations under state breach notification laws (every US state has one;
   California's CCPA is the strictest). Generally: notify "without unreasonable
   delay," typically within 30-45 days. **Consult a lawyer before sending notices
   — incorrect disclosure language can create additional liability.**

### 2.3 Defacement / unauthorized post on a rep's page

A real (claimed) rep page has a post they didn't write.

1. **Hide the post immediately** via the admin queue. The hide is reversible
   if it turns out to be a false report.
2. **Lock the rep account** — there's no built-in lock yet; the workaround is to
   reset their password (via direct DB update) so they can't log in.
3. **Notify the rep directly** — phone or .gov email. Not a public statement
   yet.
4. **Investigate** — was the password leaked? Session hijacked? Admin account
   compromised (which would let an admin post-as-rep, though that path doesn't
   exist in the codebase today)?
5. **Public statement** — if news outlets pick it up, your statement is: "We
   identified the unauthorized content within X minutes of receipt, hidden it,
   and contacted Representative [Name] directly. We are investigating the entry
   point and will share what we learn." Don't speculate about cause.

### 2.4 DDoS or overwhelming traffic

The site is slow / down / throwing 503s. Render dashboard shows CPU pinned.

1. **Cloudflare** → Security → Settings → "I'm Under Attack" mode.
2. **Cloudflare** → Security → WAF → add a temporary block rule for the
   attacker's IP range / country / ASN if identifiable.
3. **Render** → `civicview-api` → temporarily scale to a higher tier if
   sustained legit traffic is the cause (e.g. you got featured somewhere).
4. **Wait it out** — most opportunistic DDoS attacks subside within hours.
   Sustained attacks need Cloudflare Pro ($20/mo) for better detection.

### 2.5 Credential leak (API key in a commit, .env in git, etc.)

GitHub Secret Scanning flagged a committed credential, OR you discover it
yourself.

1. **Rotate the credential immediately** — don't wait. The provider's dashboard
   has a "regenerate" button. List of providers and rotation URLs:
   - Anthropic: console.anthropic.com → API Keys → revoke + create new.
   - Resend: resend.com/api-keys → revoke + create.
   - Google Civic: console.cloud.google.com → APIs & Services → Credentials.
   - Render: render.com → Account Settings → API Keys.
   - Cloudflare: dash.cloudflare.com → My Profile → API Tokens.
   - GitHub: github.com/settings/tokens (personal access tokens).
2. **Update Render env vars** with the new credential.
3. **Verify the leaked credential is dead** — try using it. Should get auth
   error.
4. **Purge from git history** if it was committed to a public repo:
   ```bash
   git filter-repo --invert-paths --path path/to/leaked/file
   git push --force-with-lease
   ```
   **Warning:** force-push rewrites history. Coordinate with anyone else with
   clones.
5. **Don't assume "it was only there for X minutes"** — credential-scraping bots
   poll new commits within seconds. Treat any committed secret as compromised.

---

## Section 3 — Communications template

Draft these before you need them. Adapt for the specific incident.

**Internal first** (yourself + any advisors / counsel):

```
Subject: [CivicView incident] — <one-line summary>

Timeline:
  <time> — Became aware of <thing>
  <time> — Confirmed / ruled out
  <time> — Took action: <what>

Current status: <contained / investigating / resolved>

What I know: <facts>
What I don't know: <gaps>

Next steps:
  - <action>
  - <action>

Should we notify users? <yes/no/maybe — and what would the message say>
```

**To affected users** (if PII exposure confirmed):

```
Subject: Important: A security incident may affect your CivicView account

Hi <name>,

On <date>, we identified <brief factual description of the incident>. We
investigated immediately and <what you did>.

The information potentially affected includes: <list, e.g. email address,
hashed password, district>. We have <no evidence / evidence> of the data
being misused.

We recommend you:
  1. Reset your CivicView password.
  2. Enable two-factor authentication.
  3. If you used the same password elsewhere, change it on those sites too.

If you have questions, please reply to this email or contact us at
civicview@civicview.app.

— Jeffrey De La Nuez, Founder, CivicView
```

**Public statement** (if the incident becomes public):

Keep it factual, brief, and avoid speculation. Examples:

- ✅ "On <date> we became aware of <factual description>. We hid the unauthorized
  content within X minutes, notified the affected representative, and are
  investigating the cause."
- ❌ "We were targeted by a sophisticated attack..." (you don't know that yet)
- ❌ "User data is safe." (don't say this until you've actually confirmed it)

---

## Section 4 — Key rotation procedures

Routine rotation calendar (not incident-driven):

| Credential | Rotation cadence | How |
|---|---|---|
| `SESSION_SECRET` | Every 90 days | Generate new, set on Render, redeploy. Invalidates all sessions. |
| Admin password | Every 90 days | Self-service via login → password reset. |
| Anthropic API key | Every 6 months OR after team change | Console → revoke old, create new, update Render. |
| Resend API key | Every 6 months | Resend dashboard → revoke + create. |
| Cloudflare API tokens | Every 6 months | Cloudflare → My Profile → API Tokens. |
| Database password | Annually OR after suspicion | Render → Info → Rotate Password. |

**During an incident**, rotate everything within a few hours. Be aware that:

- Rotating `SESSION_SECRET` logs out all users (including you).
- Rotating the DB password triggers a backend redeploy automatically.
- Rotating an API key while the app is running causes temporary 500s on the
  affected feature until Render redeploys with the new value.

---

## Section 5 — Database backup + restore

**Status:** automated daily Postgres backups are active on the current
Render paid plan (retained for 7 days). The "Restore from a Render
automatic backup" procedure below is your primary recovery path; the
manual `pg_dump` instructions further down are belt-and-suspenders for
the case where you also want an off-Render copy stored on your own
machine or a private S3 bucket (recommended quarterly at minimum, since
Render's retention doesn't help if Render itself has a major incident).

**Make a manual backup right now:**

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl > backups/civicview-$(date +%Y%m%d-%H%M).sql
```

Run this monthly at minimum. Store the dumps somewhere off Render
(e.g. a private S3 bucket or your own machine).

**Restore from a Render automatic backup:**

1. Render → `civicview-db` → Backups → pick a backup → "Restore."
2. Render creates a NEW database from the backup and gives you a new connection
   string. The original DB is unchanged.
3. Verify the restored DB has the data you expect (`psql <new url>` and run
   spot-check queries).
4. Once verified, swap the live DB connection:
   - Render → `civicview-api` → Environment → update `DATABASE_URL` to the new
     connection string.
   - Redeploys automatically.
5. Once the new DB is live and verified, delete the old (compromised) DB.

**Restore from a manual `pg_dump`:**

```bash
# Create a fresh empty DB first
createdb civicview_restored

# Restore
psql civicview_restored < backups/civicview-YYYYMMDD-HHMM.sql

# Verify
psql civicview_restored -c "SELECT COUNT(*) FROM rep_accounts;"
```

Then point `DATABASE_URL` at the restored DB.

---

## Section 6 — Who to notify

When an incident happens, the notification fan-out depends on severity and
nature. Common contacts:

- **Self / advisor** — first stop, always. Don't tell anyone else until you've
  thought it through.
- **Affected user(s)** — if PII was exposed, individually if a small number,
  via email batch if many.
- **Affected reps / candidates** — directly (.gov email or phone), never via
  public statement first.
- **Anthropic / Render / Cloudflare support** — if you suspect their service
  was the vector (e.g. you think Render's free-tier shared infra leaked
  something), file a support ticket immediately.
- **Counsel** — before any public notice that might involve breach disclosure
  obligations. Find a lawyer with civic-tech or data-privacy experience BEFORE
  you need one (not during an incident).
- **State Attorney General's office** — required in most US states if PII of
  state residents is breached. Each state's threshold and timeline differs.
- **Press** — only after internal communications are sorted. A pre-drafted
  statement is much better than ad-hoc tweets.

---

## Section 7 — After the incident: post-mortem

Within a week of resolution, write up:

1. **Timeline** — what happened, when, who did what.
2. **Root cause** — what allowed the incident to happen.
3. **Impact** — what was affected, how many users.
4. **What worked** — which detection / response steps caught it / mitigated it.
5. **What didn't** — gaps in tooling, procedure, or response time.
6. **Action items** — concrete changes to prevent recurrence. File each as a
   tracked task with an owner and date.

Post-mortems are blameless. They're operational learning, not punishment.

---

## Reference

- `SECURITY.md` — preventive security posture and ongoing operational hygiene.
- `DEPLOY.md` — normal deployment procedures.
- `render.yaml` — backend env var reference.
- `docs/identity-model.pdf` — three-tier auth model.
