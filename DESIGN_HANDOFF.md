# CivicView — Design Handoff

This document seeds Claude Design with the context it needs to do meaningful design work on CivicView. The codebase is feature-complete through Phase 1.5 — the engineering work is at a stopping point and the project is ready for a visual design pass.

---

## 1. What CivicView is

CivicView is a Next.js 14 + FastAPI web app that gives US citizens a clearer path to understanding and connecting with their elected representatives. The first state with full coverage is Florida; federal-level data covers all 50 states.

The app has two distinct user types and a third unauthenticated viewing mode:

| User type        | What they do                                                                                        |
|------------------|------------------------------------------------------------------------------------------------------|
| **Citizen**      | Browses reps, follows officials, comments on rep posts, likes/dislikes posts + comments, votes in polls. Demo seed: 60 Florida-heavy accounts. |
| **Rep / candidate** | Claims their own page, posts updates, attaches polls (with timer + visibility modes), uploads images, sees an engagement dashboard scoped to their constituents. Demo seed: 4 accounts (Donalds, Sanders, DeSantis, Donalds-campaign). |
| **Anonymous viewer** | Read-only — sees the map, profile pages, posts, comments, and aggregate poll results.            |

**Demo conceit, important to honor in design:** every citizen identity is currently *self-attested* (no real verification). Production will add USPS / id.me-style address verification. Until then, every citizen-authored thing surfaces an "Unverified" badge — that's an intentional truth-in-UI choice, not a polish gap.

---

## 2. Tech stack reality

- **Frontend:** Next.js 14 (App Router), React 18.
- **Styling:** Hybrid. Tailwind is configured (`tailwind.config.js`, `postcss.config.js`) and color tokens are extended, but **39 of 39 components use inline `style={{}}`**, with only 5 also using `className=`. Tailwind is mostly unused in practice. A design pass could either (a) keep inline styles and just tune them, (b) migrate selected components to Tailwind utility classes, or (c) introduce CSS Modules. We have no strong opinion — pick what fits the polish you're applying.
- **Icons:** Hand-rolled inline SVGs. No icon library — opportunity to bring in `lucide-react` (already used in the project's other artifacts) for consistency.
- **Animation:** None. No transitions, no enter/exit animations, no page transitions. Plenty of room to tasteful-up.
- **Mobile:** Most layouts assume desktop. Some (modals, PersonCard) handle narrow widths; most don't. Mobile responsiveness is a known gap.
- **Dark mode:** Doesn't exist. Light-only.

---

## 3. Design tokens (current)

Defined in `frontend/app/globals.css`:

```css
:root {
  --primary:       #1b263b;   /* navy — navbar, primary copy emphasis */
  --primary-light: #415a77;
  --accent:        #2d6a4f;   /* deep green — buttons, links, active states */
  --accent-light:  #40916c;
  --bg:            #f8f9fa;   /* page background */
  --card-bg:       #ffffff;   /* card surfaces */
  --text:          #1a1a2e;   /* primary text */
  --text-light:    #555;      /* secondary text */
  --republican:    #e63946;   /* GOP red */
  --democrat:      #457b9d;   /* Dem blue */
  --border:        #dee2e6;
}
```

**Spacing:** No formal scale — components use ad-hoc values (`6px`, `8px`, `10px`, `12px`, `14px`, `16px`, `18px`). Establishing a 4 / 8 / 12 / 16 / 24 / 32 scale would be a nice early move.

**Type:** Single system stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`). No defined type scale; sizes are inline (`0.68rem` – `1.5rem`). The `.68rem` micro-text shows up a lot in chips/labels and could use rationalization.

**Border radius:** `6px`, `8px`, `10px`, `12px`, `14px`, `999px` (pill). Tighter scale would help.

**Shadows:** Sparse — `0 2px 6px rgba(0,0,0,0.04)` for sticky bars, `0 12px 36px rgba(0,0,0,0.18)` for dropdowns, `0 20px 60px rgba(0,0,0,0.28)` for modals. Could use a defined elevation system.

---

## 4. Component inventory (39 components)

Path: `frontend/components/`. Components grouped by role:

### Navigation & chrome
- `Navbar.js` — top bar: logo, search, Citizen-login pill, Subscribe, Committees, My Tracked, notification bell
- `NotificationBanner.js` — slide-down banner for ephemeral messages
- `NotificationBellMenu.js` — bell dropdown with channel prefs

### Map & state selection
- `MapView.js` — US map with district overlays + zoom slider
- `PanelResizer.js` — drag handle between map and side panel
- `SidePanel.js` — wraps state-level views (Congress / State / Local / Ballot tabs)
- `AddressLookup.js` — search-by-address geocoder

### State / regional views
- `StatewideOfficialsTab.js` — governor, AG, cabinet, judiciary
- `LocalOfficialsTab.js` — major cities + cities + counties + districts sub-nav
- `BallotTab.js` — upcoming elections with `useVoterInfo` hook for personalized ballot
- `NationalOfficialsPanel.js` — landing view: Executive / Judicial / Congress / Elections tabs

### Person / profile
- `PersonCard.js` — list-row card for a single rep/candidate (avatar, party, follow + compare + page buttons)
- `ProfileView.js` — full-screen profile with role-aware tab set (Overview / Issues / Experience / Bills / Votes / Events / Page)
- `CandidateProfile.js` — separate-but-similar profile for declared candidates
- `CompareView.js` / `CompareTray.js` — side-by-side comparison
- `CandidateCompareView.js` / `CandidateCompareTray.js` — candidate variants
- `OnBallotBadge.js`, `SelectionBadge.js`, `FollowButton.js`, `CompareButton.js`, `TrackElectionButton.js` — small inline affordances

### **Pages & engagement (Phase 1 + 1.5 — the design-heavy area)**
- `PageView.js` — full-viewport overlay containing a rep's social-style page (header, owner controls, scope filter, composer or dashboard, post feed, upcoming-events aside)
- `PostCard.js` — single post (header, body, image gallery, optional poll, reactions, comments). Inline helpers `PostImageGallery` (lightbox) and `CommentReactionButton`.
- `PostComposer.js` — owner-only writer (body + poll builder + scope picker + close-time picker + presentation-mode picker + image uploader + thumbnails)
- `PollCard.js` — poll display with three modes (`full` / `hidden` / `reveal_after_close`), live countdown, scope chip, scope breakdown
- `RepEventComposer.js` — owner-only event creator
- `Dashboard.js` — owner-only constituent dashboard (summary cards + top posts + top commenters + reactions breakdown)
- `OwnerScopeFilter.js` — sticky chip row, owner-only, filters poll/reaction/comment counts by Country/State/District/City
- `ViewerScopeFilter.js` — sticky chip row, non-owners, affects polls only
- `PageButton.js` — opens a rep's page from any list/profile

### Modals
- `RepLoginModal.js` — rep email/password + demo-account picker
- `CitizenLoginModal.js` — citizen email/password + filterable demo-account picker (60 entries)
- `CitizenWaitlistModal.js` — pre-Phase-2 email capture
- `ClaimPageModal.js` — for unclaimed pages, captures rep contact info
- `CommitteesModal.js` — browse-by-committee
- `MyTrackedModal.js` — bills + officials + elections all-in-one

### Library modules (`frontend/lib/`)
- `auth.js`, `citizenAuth.js` — pub-sub auth stores (rep + citizen)
- `pagesApi.js` — Pages-feature fetchers (posts, polls, reactions, comments, images, dashboard)
- `api.js` — primary backend API client (Congress, states, officials, etc.)
- `trackedBills.js`, `trackedOfficials.js`, `trackedElections.js` — localStorage-backed stores
- `notificationPrefs.js`, `channelPrefs.js` — preference storage

---

## 5. Major surfaces (page-level views)

In rough order of design priority based on what we've built recently:

1. **PageView (rep page) — owner perspective.** This is the densest surface in the app. Owner sees: header card → Feed/Dashboard toggle → sticky scope filter → composer (text + poll + scope + timer + presentation + image picker + thumbnails) → post feed with images, polls, reactions, comments → upcoming-events aside. Lots to organize visually.
2. **PageView (rep page) — citizen perspective.** Same chrome, but composer is hidden, viewer scope filter replaces owner filter, comment dropdown gains "From my district / state" options, every comment gets like/dislike pills.
3. **Dashboard.** Currently functional but visually plain — summary cards in a grid, reactions card, top-posts and top-commenters lists. Big opportunity for hierarchy + delight.
4. **NationalOfficialsPanel.** First impression when a user lands without a state selected. Currently text-heavy.
5. **PersonCard list rows.** Already had a pass (party-letter chip, stacked Follow/Compare-above-Page) but visual polish opportunity remains.
6. **Modals (login, claim, waitlist).** Functional, very utilitarian — could feel like product, not just demo.
7. **MapView landing.** US map sits to the left of the side panel; visual styling is minimal.
8. **CompareView.** Tables of attributes side-by-side; needs visual treatment.

---

## 6. Known polish gaps (hit list)

A non-exhaustive list of things we noticed while building, in no priority order:

- **Loading states are text-only** ("Loading page…", "Loading dashboard…"). No skeletons, no shimmers.
- **Empty states are text-only** ("No comments yet.", "Byron Donalds hasn't posted anything yet.", "No upcoming events posted."). Would benefit from illustrations or at least better typography.
- **Reaction buttons** (post + comment): functional but plain. Up/down pills with counts, no animation on click.
- **PostImageGallery layout** improvises by image count (1, 2, 3, 4, 5+); the 3-image and 5-image layouts could be more elegant.
- **PostComposer is dense** when a poll is attached — body, options, scope pills, timer radio group, presentation pills, and image strip all stacked. Visual hierarchy could help users move through it sequentially.
- **OwnerScopeFilter / ViewerScopeFilter** chips are functional but rectangular and feel like form widgets; they could feel more like a filter affordance.
- **The "Subscribe" button in the navbar** is a bright yellow that breaks slightly with the rest of the palette. Feels demo-y.
- **Sticky-scroll behavior** is in place for scope filters but could feel smoother (no fade-in shadow as content scrolls under).
- **Dashboard summary cards** are basic stat cards; would benefit from sparklines, deltas, or stronger emphasis on what's actionable.
- **Top-engaged posts in Dashboard** are clickable but don't preview imagery or the poll question; they could be richer.
- **Citizen-login modal demo-list** is a long scroll of 60 accounts; the filter helps but the visual treatment is utilitarian.
- **Lightbox** (PostImageGallery) is functional but the close button + counter could feel more native.
- **No animation anywhere** — modal open/close, scope-filter activation, post insertion, dashboard transitions all snap with no transition.
- **No mobile layout** for most surfaces. The page view, in particular, would need rethinking for narrow widths.
- **"Unverified" badge** is intentional but visually noisy — appears next to every citizen name. Could use a more refined treatment.
- **Date formatting** is inconsistent (some `toLocaleString`, some `toLocaleDateString`, some custom). One pass could unify.
- **Party color coding** uses `--republican` / `--democrat` for chips and bars but pale-green `--accent` for everything else, which sometimes competes visually.

---

## 7. Demo-only / intentional choices — please preserve

Things that *look* like polish gaps but aren't — these are load-bearing for the demo's honesty or for security:

- **The "Unverified" badge** on every citizen-authored thing (post comments, dashboard rows). This is non-negotiable — production verification doesn't exist yet.
- **The "Demo preview — these accounts are self-attested" yellow notice** in `CitizenLoginModal`. Stays until real identity verification ships.
- **The owner-only / non-owner asymmetry** on filters. Owner has `OwnerScopeFilter` (filters polls + reactions + comment_count + comment-list scope). Non-owners have `ViewerScopeFilter` (polls only). This isn't an oversight — it's brigade-prevention. Don't accidentally unify them.
- **Reveal-after-close polls show 0 counts pre-close** for non-owners. Don't add a "show me anyway" override — the whole point is non-influence before the close.
- **Two distinct cookies (`cl_session` for reps, `cl_citizen` for citizens)** so a single browser can hold both identities for testing. Don't unify the auth UI in a way that obscures this.
- **Demo passwords visible** in seed JSON files (`backend/demo_accounts.json`, `backend/demo_citizen_accounts.json`). Visible-in-UI passwords are part of the demo flow ("Shared demo password: ***REDACTED-DURING-PUBLIC-FLIP-AUDIT***"). Production removes both files.
- **The 5-images-per-post / 5MB-each / JPEG/PNG/WebP limits** are intentional and enforced server-side. Don't loosen the UI to imply otherwise.
- **The 4 / 8 / 24 hour / specific-date close-time options** are the only time formats supported by the timer; don't add ones the backend won't compute.

---

## 8. Suggested priority order for the design pass

If you're starting from a blank slate, I'd recommend tackling in this order:

1. **Establish a design system layer** — formal type scale, spacing scale, elevation, refined color usage. Document in a `frontend/app/design-tokens.css` or similar so future components inherit. Decide whether to actually use Tailwind or keep inline styles consistent.
2. **PageView** (rep page) — the highest-traffic surface and the densest. Owner perspective first, then citizen, then anonymous.
3. **Dashboard** — visually impactful win with bounded scope. Better hierarchy, sparklines, more delight in the summary cards.
4. **Modals** — login flows are the first thing every demo tester sees. Worth a pass.
5. **Loading + empty states across the board** — quick polish multiplier.
6. **Animations + transitions** — once layout is stable, motion sells the experience.
7. **NationalOfficialsPanel** — first impression on landing, currently underwhelming.
8. **PersonCard** + lists — small but everywhere.
9. **MapView styling** — district fills, hover, selected state. Map area is large screen real-estate.
10. **Mobile layouts** — separate, large, optional for demo but necessary before any soft launch.

---

## 9. How to run locally (so you can grab live screenshots)

**Backend:**
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate         # Windows
# source venv/bin/activate      # macOS/Linux
pip install -r requirements.txt
# Create backend/.env with CONGRESS_API_KEY and GOOGLE_CIVIC_API_KEY
uvicorn app.main:app --reload --port 8000
```

On startup the backend will:
- Auto-create a SQLite DB at `backend/civicview.db`
- Auto-migrate schema (logged on stdout)
- Seed 4 demo rep accounts + 60 demo citizen accounts

**Frontend:**
```bash
cd frontend
npm install
npm run dev          # starts Next.js on http://localhost:3000
```

**Demo credentials:**
- Rep accounts (any of these, password `***REDACTED-DURING-PUBLIC-FLIP-AUDIT***`):
  - `byron.donalds@civicview-demo.com` (FL-19 House rep — most-built-out demo persona)
  - `bernie.sanders@civicview-demo.com` (VT senator)
  - `ron.desantis@civicview-demo.com` (FL governor)
  - `donalds.campaign@civicview-demo.com` (FL gubernatorial candidate)
- Citizen accounts (60, password `***REDACTED-DURING-PUBLIC-FLIP-AUDIT***`):
  - 50 across Florida (10 in FL-19 / Naples for cluster richness)
  - 10 in CA, TX, NY, IL, PA, OH, GA, WA, MI, VA
  - All in `backend/demo_citizen_accounts.json`

**Best demo path for screenshots:**
1. Open `http://localhost:3000`
2. Sign in as `byron.donalds@civicview-demo.com`, navigate to his page (FL → Congress → Byron Donalds → Page button)
3. Write a post with a poll + 2 images → publish
4. Sign out, sign in as `maria.hernandez@civicview-voters.com` (FL-19 citizen) → react, comment, vote
5. Sign back in as Donalds → switch to Dashboard view → flip scope filter

---

## 10. Files you'll touch most

If Claude Design is making changes, these are the files most likely to land on:

| File                                    | Why                                                      |
|-----------------------------------------|----------------------------------------------------------|
| `frontend/app/globals.css`              | Define design tokens, spacing scale, type scale, animations |
| `frontend/components/PageView.js`       | Densest UI; layout is half the polish                    |
| `frontend/components/PostCard.js`       | Reactions, comments, image gallery, lightbox             |
| `frontend/components/PostComposer.js`   | Owner's primary input surface                            |
| `frontend/components/Dashboard.js`      | Most opportunity for delight                             |
| `frontend/components/PollCard.js`       | Three modes + countdown — needs care                     |
| `frontend/components/Navbar.js`         | First-impression polish                                   |
| `frontend/components/CitizenLoginModal.js` + `RepLoginModal.js` | First demo touchpoint                |

Steer clear of (no design value, large risk of regression):
- `frontend/lib/*` — pure data/auth plumbing
- `backend/**/*` — server logic; no UI

---

## 11. Repo

`https://github.com/Jeffreynuez/civicview` (private)

Main branch only. Clean commit history starts at `Phase 1.5 feature-complete: …`.

---

**Have at it. Honor the demo-only callouts in section 7, prioritize section 8, and the rest is yours.**
