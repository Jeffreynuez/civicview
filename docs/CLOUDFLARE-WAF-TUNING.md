# CivicView — Cloudflare WAF tuning for the admin API

How to keep Cloudflare's edge rate-limit from 429-ing legitimate admin
traffic on `api.civicview.app`. Companion runbook to `SECURITY.md`
(overall hardening) and `INCIDENT-RESPONSE.md`.

**Status:** documented; not yet applied. Apply once the team grows
past one admin OR if the consolidated `/api/admin/dashboard` mitigation
(commit landing alongside this doc) ever stops being sufficient. Until
then this doc is a "ready when you need it" reference.

---

## Background — why this matters

Cloudflare sits in front of `api.civicview.app` (proxied subdomain per
`SECURITY.md` §1) and applies default DDoS / burst-protection rules at
its edge. When a single IP fires several requests against the same path
prefix in rapid succession, Cloudflare can return **429 Too Many
Requests** with an HTML body — and crucially, **without any
`Access-Control-Allow-*` headers**, because the response never reaches
FastAPI's `CORSMiddleware`. To the browser this looks like a CORS
error and renders as "Failed to fetch" in the JS console.

This already bit us twice:

- **Task #35** (commit `a6c856b`) — `adminWhoami()` was called by every
  Navbar mount + the root-layout Force2FAGate, producing 3–10 identical
  concurrent calls per signed-in page load. Fix was module-level
  in-flight promise dedupe in `pagesApi.js`.
- **Task #62** (commit pending) — the `/admin` page fired four parallel
  loaders (reports + appeals + suspended + lockouts) on mount. Adding a
  fifth (lockouts) tipped Cloudflare over its burst threshold. Fix was
  first sequential awaits, then a consolidated `/api/admin/dashboard`
  endpoint that ships all four datasets in one RTT (Task #63).

**The current mitigation is sufficient for one admin.** This doc is
the next layer for when the admin team grows, or if a future feature
re-introduces parallel admin calls.

---

## Two tunable knobs — pick one, not both

### Option A — Bypass the WAF for known admin IPs (recommended)

Tighter, less observable for attackers, no impact on real users. Best
when you have a small fixed set of admin operators with stable IPs (a
home IP + a phone hotspot CIDR + a coworking space, etc.).

### Option B — Raise the per-IP burst threshold on `/api/admin/*`

Loosens the rule globally for that path prefix. Cheaper to set up but
weakens the rate-limit protection for everyone, not just admins. Use
this when admin IPs aren't stable (you travel a lot, hop networks, use
Tailscale exits in different countries, etc.).

---

## Option A — Bypass WAF for admin IPs

### Step 1. Collect your admin IPs

Visit `whatismyipaddress.com` from every device + network you use to
admin CivicView. For each, note:

- **IPv4 address** (e.g. `73.42.18.224`).
- **IPv6 address** (e.g. `2601:601:...`) — if your ISP gives you one.
- Whether it's **dynamic** (changes on router reboot) or **static**.
  For dynamic IPs, capture the broader CIDR your ISP assigns from
  (typically `/24` for residential, `/19` to `/16` for mobile carriers).

Compile the list. Three IPs is usually enough: home + phone + one
backup (coworking, parents' house, etc.).

### Step 2. Add a WAF Custom Rule that skips for those IPs

In Cloudflare dashboard:

1. Select the `civicview.app` zone.
2. **Security** → **WAF** → **Custom rules**.
3. Click **Create rule**.
4. Configure:
   - **Rule name:** `Admin API bypass`
   - **If incoming requests match:**
     - Field: `URI Path`, Operator: `starts with`, Value: `/api/admin/`
     - AND
     - Field: `IP Source Address`, Operator: `is in`, Value:
       `73.42.18.224 2601:601:...:0:0/64 ...` (your list, space-separated)
   - **Then take action:** `Skip` → check **All remaining custom rules**
     AND **Rate limiting rules** AND **Managed rules**.
   - **Place at:** top of the list (priority 1).
5. **Deploy**.

### Step 3. Verify

From an admin IP, open DevTools → Network → reload `/admin`. The
admin API calls should return `200` cleanly with `cf-cache-status:
DYNAMIC` and no `cf-mitigated` header.

From a non-admin IP (e.g. your phone on cellular if home is the only
admin IP), confirm the WAF still rate-limits aggressive bursts. If
you can hit /api/admin/* without auth (the backend returns 403 there),
that's fine — it's the WAF behavior we're verifying, not the auth.

### Step 4. Maintain

When your IP changes (router reboot, new ISP, new device), revisit
Step 1 and add the new IP to the rule's allowlist. Keep the rule
narrow — don't let it grow past 10 entries without re-asking whether
Option B would be cleaner.

---

## Option B — Raise per-IP burst threshold for /api/admin/*

### Step 1. Create a Rate Limiting rule (NOT a regular WAF rule)

In Cloudflare dashboard:

1. Select the `civicview.app` zone.
2. **Security** → **WAF** → **Rate limiting rules**.
3. Click **Create rule**.
4. Configure:
   - **Rule name:** `Admin API — higher burst`
   - **If incoming requests match:**
     - Field: `URI Path`, Operator: `starts with`, Value: `/api/admin/`
   - **When rate exceeds:** 60 requests per 1 minute (tunable).
     - Default Cloudflare burst protection trips around 20–30 req/min
       per IP for sensitive paths. 60/minute gives admin operators
       plenty of headroom for legitimate dashboard loads + tab switches
       + per-tab refreshes without ever hitting the limit.
   - **Then take action:** `Block` (or `Managed Challenge` if you'd
     rather see a CAPTCHA than a hard fail).
   - **Duration:** 10 seconds (or 1 minute if you want stronger
     friction for actual abuse).

### Step 2. Verify

Same as Option A Step 3 — reload `/admin`, confirm clean 200s.

### Step 3. Tune over time

Watch Cloudflare's **Analytics → Security** view. If you see the new
rule firing on legitimate admin traffic, raise the threshold (try
120/min). If you never see it fire even during heavy admin use, the
threshold's fine — leave it.

---

## When to revisit

- **Admin team grows past 1:** Option A becomes harder to maintain
  (more IPs to track). Either switch to Option B with a higher threshold,
  OR set up a VPN/Tailscale exit IP that all admins share + bypass that
  single IP via Option A.
- **You start running admin scripts (cron, monitoring, etc.):** make
  sure those source IPs are added to whichever option you picked.
- **You hit a new "Failed to fetch" on the admin page:** check whether
  it's another `cf-mitigated` 429 (the same class of bug) or something
  else. If it's a WAF issue, this doc is your starting point.

---

## Cross-references

- `SECURITY.md` §1 — Cloudflare proxy setup for `api.civicview.app`
- `INCIDENT-RESPONSE.md` — runbook when the WAF locks you out yourself
- Task #35 — adminWhoami burst dedupe (commit `a6c856b`)
- Task #62 — sequential admin loaders (the band-aid fix this doc replaces)
- Task #63 — consolidated `/api/admin/dashboard` endpoint
- Pinecone memory: `fix-admin-whoami-storm-a6c856b` (cross-reference)
