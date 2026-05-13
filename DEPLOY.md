# CivicView — Production Deployment Guide

How to put the app on a public URL (`civicview.app`) so anyone can
poke around.

**Stack:**
- Frontend → **Vercel** (Next.js, free tier)
- Backend → **Render** (FastAPI, free tier)
- Database → **Render Postgres** (free tier, 1GB, 30-day retention)
- DNS → **Cloudflare** (already purchased, free)
- Cost: **$0/month** + ~$15/year for the domain

**Free-tier note:** Render's free web service sleeps after 15 minutes
of inactivity and wakes on the next request (~30s cold start).
Acceptable for a demo URL you're sending to a small list of people;
upgrade to Starter ($7/mo) if you need always-on once you're showing
the app to actual investors.

---

## 1. First-time setup: backend on Render

1. Push this repo to GitHub if you haven't already.
2. Go to [render.com](https://render.com) → New + → **Blueprint**.
3. Point it at your repo. Render reads `render.yaml` and proposes
   creating two resources:
   - `civicview-api` (web service)
   - `civicview-db` (Postgres)
   Click "Apply."

4. **Set the secrets** in the `civicview-api` dashboard → Environment:
   - `SESSION_SECRET` — generate locally with:
     ```
     python -c "import secrets; print(secrets.token_urlsafe(48))"
     ```
   - `ALLOWED_ORIGINS` — leave blank for now, fill in after Vercel
     deploy. Will be something like
     `https://civicview.app,https://www.civicview.app`.
   - `CONGRESS_API_KEY` — from <https://api.congress.gov/sign-up/>.
     Optional but most of the federal-officials data fails open
     without it.
   - `GOOGLE_CIVIC_API_KEY` — optional. Leave unset to keep
     BallotTab in its disabled state.

5. The Postgres `DATABASE_URL` is auto-injected by Render — you don't
   set it manually.

6. Trigger a deploy. After ~3-5 min, Render gives you a URL like
   `https://civicview-api.onrender.com`. Test:
   ```
   curl https://civicview-api.onrender.com/
   ```
   Should return JSON with `"app": "CivicView API"`.

7. The startup `seed_demo_accounts()` + `seed_demo_citizens()` calls
   will populate Postgres with the rep + citizen demo accounts on
   first boot. Watch the deploy logs — you should see "civicview-api
   starting up..." followed by table creation + seed messages.

---

## 2. Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → Import Project → pick
   the same repo.

2. **Important:** in the import dialog, set **Root Directory** to
   `frontend`. Vercel needs this because the repo is a monorepo and
   the Next.js project lives inside `frontend/`. Without this it'll
   try to build from the repo root and fail.

3. Framework: Next.js (auto-detected). Build command, output
   directory, install command — all auto.

4. **Environment variable**: add `NEXT_PUBLIC_API_URL` and set it to
   the Render URL from step 1.6:
   ```
   NEXT_PUBLIC_API_URL=https://civicview-api.onrender.com
   ```
   This must be in the **Production** scope (and Preview + Development
   if you want preview deploys to work too — recommended).

5. Deploy. After ~2 min, Vercel gives you a URL like
   `https://civicview-frontend.vercel.app`. Open it. You should see
   the home page with the US map.

6. Open the browser console. If you see CORS errors — that's the
   next step.

---

## 3. Tie the two together (CORS + cookies)

Back in the Render dashboard → `civicview-api` → Environment, set:

- `ALLOWED_ORIGINS=https://civicview-frontend.vercel.app`

(or whatever the Vercel URL is — until step 4 swaps it for the
custom domain).

Render redeploys automatically when env vars change. ~2 min later,
reload the Vercel app. The map should populate with state data,
the address lookup should work, etc.

The `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` env vars are
already set in `render.yaml`, so cross-origin auth (rep login,
citizen login) will work as soon as ALLOWED_ORIGINS is right.

---

## 4. Custom domain: civicview.app via Cloudflare

1. **Vercel** → project → Settings → Domains → Add Domain →
   `civicview.app`. Vercel shows you DNS records to add (CNAME or
   A records pointing at `cname.vercel-dns.com`).

2. **Cloudflare** → DNS → Records → add the records Vercel listed.
   - Set them to **DNS Only** (gray cloud, NOT proxied/orange) for
     the apex `civicview.app` and `www.civicview.app`. Cloudflare
     proxying breaks Vercel's automatic SSL provisioning.

3. Wait ~5-15 min for DNS to propagate. Vercel will issue a Let's
   Encrypt cert automatically and the domain will go green in the
   dashboard.

4. **Update Render's** `ALLOWED_ORIGINS` to the production domain:
   ```
   ALLOWED_ORIGINS=https://civicview.app,https://www.civicview.app
   ```

5. Test in an incognito window: `https://civicview.app` should serve
   the app over HTTPS, the map should populate, and demo logins
   should work.

---

## Known limitations (call these out to investors)

- **Image uploads on rep Pages don't persist.** Render's free tier
  has an ephemeral filesystem — uploaded images survive until the
  service restarts (typically once a day on free, plus on every
  deploy). For the demo flow this is fine; the seeded posts already
  carry their images and most demo paths don't involve uploads.
  Production fix: stash uploads in S3 / R2 / Cloudinary and store
  the URL instead of the bytes. Roughly half a day of work.
- **Cold starts.** Free-tier Render sleeps after 15 minutes idle.
  First-request latency is ~30s. Mitigation: a cron job that hits
  `/` every 10 minutes (uptimerobot.com — free), or upgrade to the
  $7/mo Starter plan for always-on.
- **Free-tier Postgres expires after 30 days** of the original
  database creation. Render will prompt you to upgrade or migrate.
  $7/mo for the Starter Postgres if you decide to keep the demo
  alive past a month.

## Local dev still works

None of the env-var changes break local development. With no
`.env` set, the backend defaults to SQLite at `backend/civiclens.db`,
COOKIE_SECURE=false, COOKIE_SAMESITE=lax, and the localhost CORS
allow-list. `pnpm dev` / `npm run dev` / `uvicorn app.main:app
--reload` all work the same.

---

## Quick reference

| Where | URL after deploy |
|---|---|
| Frontend | `https://civicview.app` |
| Backend | `https://civicview-api.onrender.com` |
| Backend health | `https://civicview-api.onrender.com/` |
| Backend OpenAPI docs | `https://civicview-api.onrender.com/docs` |

| Render env var | Value |
|---|---|
| `DATABASE_URL` | (auto-set) |
| `SESSION_SECRET` | secrets.token_urlsafe(48) |
| `ALLOWED_ORIGINS` | https://civicview.app,https://www.civicview.app |
| `COOKIE_SECURE` | true |
| `COOKIE_SAMESITE` | none |
| `CONGRESS_API_KEY` | from api.congress.gov |
| `GOOGLE_CIVIC_API_KEY` | (optional) |
| `CIVICVIEW_WIPE_REP_DEMO` | (one-shot — see below) |

### One-shot pre-launch wipe: `CIVICVIEW_WIPE_REP_DEMO`

The pre-launch refactor retired the seeded demo rep accounts
(impersonation risk under real politicians' names) and the fixed
60-account seeded citizen list (superseded by the self-serve demo
signup flow). To clear the already-existing data on Render Postgres:

1. Set `CIVICVIEW_WIPE_REP_DEMO=1` in Render env vars.
2. Wait for Render to redeploy (~2 min). Check the deploy logs
   for `Fresh-start wipe complete: removed N rep account(s),
   M citizen poll(s), and K seeded citizen account(s).`
3. **Unset the env var** (or set it to `0`). It's gated, but
   leaving the flag set means every cold start re-runs the wipe —
   harmless when nothing is left to delete, but noisy in the
   logs.

The wipe removes:

- All `RepAccount` rows (cascades to `Post`, `RepEvent`,
  `PostImage`, `PostReaction`, `PostComment`, and rep-authored
  polls).
- All standalone `Poll` rows where `author_kind='citizen'`
  (cascades to their options, votes, comments, reports).
- All `CitizenAccount` rows whose email matches the retired
  Phase 1.5 seed pattern `@example.invalid` (Elena Park,
  Maria Hernandez, et al.).

What is **NOT** touched:

- Self-serve demo citizen accounts created via
  `POST /api/citizen-auth/demo-signup`. These use the email
  pattern `@demo-citizens.civicview.app` and survive the wipe so
  any reviewer mid-session keeps their account.
- Any future verified citizen accounts (post-ID.me).

**After the wipe runs you may also need to clear your browser's
site data for `civicview.app`.** Your browser still holds a
session cookie + localStorage Bearer token for whatever citizen
account you were logged into before the wipe. If that account
was one of the retired seeded ones, it's gone from the DB but
the stale token will keep ghost-logging you in until the token
expires (or you clear it). Clear site data via DevTools →
Application → Storage → Clear site data, or just open the app
in an incognito tab to confirm the wipe worked.

| Vercel env var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | https://civicview-api.onrender.com |
