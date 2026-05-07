# CivicView

A civic-engagement web and mobile app that helps citizens find and follow
their federal, state, and local representatives — bills, votes, town halls,
and what they say in their district.

## Repository layout

- `frontend/` — Next.js 14 (App Router) + React 18 + Tailwind. The user-
  facing web and PWA app.
- `backend/` — FastAPI + SQLAlchemy + SQLite. Address lookup, civic-data
  aggregation, social/Pages feature, citizen + rep auth.
- `Design Exports/` — Reference design-system snapshots (not part of the
  running app).

## Quick start

See [`SETUP_GUIDE.md`](./SETUP_GUIDE.md) for full setup, including how to
run the frontend and backend locally and how to test on a real phone via
the same Wi-Fi or Tailscale.

## License

CivicView is **proprietary software**. All source code, designs, content,
and assets are © 2026 Jeffrey Nuez. All rights reserved.

No part of this repository may be copied, modified, distributed, or
otherwise used without the express written permission of the copyright
holder. See [`LICENSE`](./LICENSE) for full terms.

For licensing inquiries: jeffreynuez1@gmail.com

## Roadmap / future IP work

Tracked in this list rather than as code TODOs:

- **Trademark filing for CivicView** — three classes (9, 42, 45) at
  ~$350/class via the USPTO TEAS Standard path. Deferred until the
  budget allows, since "social media for politicians" doesn't have
  a pre-approved ID Manual entry and writing our own adds $200/class.
- **Copyright registration with the US Copyright Office** — $45–85
  via the eCO portal. Deposit is the first 25 + last 25 pages of
  source code. Worth doing once the codebase stabilizes after the
  next round of features.
- **DMCA agent registration** — $6 every 3 years at
  [dmca.copyright.gov](https://dmca.copyright.gov). Needed for §512
  safe-harbor protection once the rep-Pages comment threads have
  real user traffic. Without a registered agent, we can be held
  liable for whatever users post; with one, we're shielded as long
  as we act on takedown notices. Also need a clear takedown contact
  posted on the site.
- **Open-source carve-outs** — if any subset of CivicView ever ships
  as an open-source library (e.g. the design-system tokens or the
  district-geometry helpers), spin those into a separate repo with
  an OSS license rather than trying to dual-license the monorepo.
