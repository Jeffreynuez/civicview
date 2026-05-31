# Bills & Votes — Design Handoff (Phase A: `/bills` page)

**For:** Claude Design
**From:** Jeffrey De La Nuez (with Claude Cowork)
**Date:** 2026-05-30
**Companion doc:** `docs/bills-feature-prd.md` (scope, requirements, data sources)
**Tech stack:** Next.js 14 App Router + React 18, vanilla CSS + design-system
tokens (no Tailwind). Co-locate component CSS with the component (CSS topology
rule). Reuse existing patterns — do not fork new card/popover styles.

> **Scope of this handoff:** the **`/bills` page** (Phase A) is specced in full
> — chamber toggle, vote outcome header, interactive seat chart, seat mini-card,
> and vote list. The **home "Bills" section** (Phase B) is specced at the end at
> lower fidelity. The seat chart + its mobile/accessibility story is the crux;
> most attention should go there.

---

## Design tokens to use (already in the system)

Pull from `Design Exports/civiclens-design-system/project/colors_and_type.css`.
Do **not** introduce new raw hex values where a token exists.

| Token | Value | Usage here |
|---|---|---|
| `--cl-primary` | `#1b263b` | Page hero band (matches `/polls` hero) |
| `--cl-accent` | `#2d6a4f` | Active toggle, links, primary CTAs |
| `--cl-accent-soft` | `#e6f3ec` | Active/selected surfaces |
| `--cl-bg` | `#f8f9fa` | Page background |
| `--cl-card` | `#ffffff` | Cards, chart panel, popover |
| `--cl-border` | `#dee2e6` | Card + panel borders |
| `--cl-text` / `--cl-text-light` / `--cl-text-muted` | `#1a1a2e` / `#555` / `#6c757d` | Text hierarchy |
| **`--cl-republican`** | `#e63946` | **Seat hue: Republican** |
| **`--cl-democrat`** | `#457b9d` | **Seat hue: Democrat** |
| **`--cl-independent`** | `#6c3ec1` | **Seat hue: Independent** |
| `--cl-success` / `--cl-success-text` / `--cl-success-soft` | `#27ae60` / `#1e8048` / `#e6f3ec` | "Passed" / "Confirmed" status |
| `--cl-danger` / `--cl-danger-text` / `--cl-danger-soft` | `#d63031` / `#b13b3b` / `#f8d7da` | "Failed" / "Rejected" status |
| `--cl-warning` / `--cl-warning-text` / `--cl-warning-soft` | `#ffba08` / `#8a6100` / `#fff7e6` | "Upcoming" / "On the floor" status |
| `--cl-radius-2xl` / `-xl` / `-lg` / `-pill` | `14px` / `12px` / `10px` / `999px` | Cards / panels / popover / chips |
| `--cl-shadow-card` / `--cl-shadow-pop` | `0 1px 3px rgba(0,0,0,.05)` / `0 12px 36px rgba(0,0,0,.18)` | Cards / popover |
| `--cl-space-*` | 4–48px (4px base) | All spacing |
| `.cl-eyebrow` `.cl-h1` `.cl-h2` `.cl-body` `.cl-meta` `.cl-num` | — | Type roles; `.cl-num` = tabular-nums for tallies |
| Breakpoints | `mobile ≤900px`, `tablet 901–1024px`, `desktop ≥1025px` | `frontend/lib/useViewport.js` |

**Party palette note:** `PARTY_COLORS = { R:'#e63946', D:'#457b9d', I:'#6c3ec1' }`
(`ProfileView.js:34`) is the established, already-softened brand palette. Use it
as-is — this resolves the PRD's "neutral vs partisan palette" open question. The
blue is intentionally a muted slate, not a bright primary, which keeps the chart
reading as factual rather than partisan.

---

## Page: `/bills`

### Overview
A chamber-wide federal vote browser. The user lands on the most recent qualifying
roll-call (passage or nomination) for the default chamber, sees the outcome and a
seat chart of how every member voted, can switch chambers, can switch to other
recent votes, and can click any seat or list row to reach that member's profile
window (`ProfileView`).

### Layout (desktop ≥1025px)

```
┌─────────────────────────────────────────────────────────────┐
│  HERO BAND (--cl-primary)                                     │
│  eyebrow: FEDERAL LEGISLATION                                 │
│  h1: Bills & Votes                                            │
│  sub: See how Congress voted — pick a chamber and a vote.     │
├─────────────────────────────────────────────────────────────┤
│  [ Senate ‹toggle› House ]        ‹recent-votes selector ▾›   │
├─────────────────────────────────────────────────────────────┤
│  VOTE HEADER CARD                                             │
│   H.R. 1041  ·  passage          [ Passed ]  (status chip)    │
│   "This was a vote to pass H.R. 1041 in the House."           │
│   tally bar: Yea 216 ▓▓▓▓▓ · Nay 201 ▓▓▓▓ · NV 13            │
│   By party: R 209–1 · D 7–200 · I 0–0     May 20, 2026        │
├─────────────────────────────────────────────────────────────┤
│  SEAT CHART PANEL (card)                                      │
│        ◜  hemicycle of seats, outcome "216–201" centered  ◝   │
│        legend: ◼ R-Yea ◻ R-Nay ◼ D-Yea ◻ D-Nay ▩ Present     │
├─────────────────────────────────────────────────────────────┤
│  VOTE LIST  (sorted: state ▸ party)      [search] [Download]  │
│   Yea · FL · R · Donalds, Byron            →                  │
│   Nay · CA · D · Pelosi, Nancy             →                  │
│   …                                                           │
└─────────────────────────────────────────────────────────────┘
```

Hero band reuses the `/polls` hero treatment (`--cl-primary` background,
on-dark text, `.polls-hero__eyebrow` / `__title` / `__sub` classes). Body content
sits on `--cl-bg` in a centered max-width column (match `/polls` content width).

---

### Component 1 — Chamber toggle

Reuse the **TabStrip** pattern (`ProfileView.js` tab bar): two segments,
`Senate` / `House`. Active = `--cl-accent` text + `2px solid --cl-accent`
bottom border + weight 600; inactive = `--cl-text-light`, transparent border.
Color transition `150ms`. Default to the chamber with the most recent vote.

| State | Behavior |
|---|---|
| Default | Chamber with newest qualifying vote is active |
| Switch | Loads that chamber's most recent vote + its recent-votes list; chart + header + list all swap |
| Loading | Skeleton in header card + chart panel (see Loading states) |

### Component 2 — Recent-votes selector

A dropdown (reuse popover conventions, `--cl-radius-lg`, `--cl-shadow-pop`)
listing the N most recent qualifying votes for the active chamber. Each row:
bill citation / nomination label · short question · date · result chip.
Selecting one reloads the header + chart + list (URL updates — see deep-link P1).

### Component 3 — Vote header card

Card: `--cl-card`, `1px solid --cl-border`, `--cl-radius-2xl`, padding
`--cl-space-4 --cl-space-5` (16/20px), `--cl-shadow-card`.

Contents, top to bottom:
1. **Title row:** bill citation (`.cl-h2`) + vote-type label (`passage` /
   `nomination`, `.cl-meta`), right-aligned **status chip** (see chips below).
2. **Plain-language question** (`.cl-body`) — e.g., "This was a vote to pass
   H.R. 1041 in the House." (P1: AI explainer expands inline here.)
3. **Tally bar:** horizontal proportional bar, Yea segment in a neutral positive
   tone, Nay in a neutral negative tone, Present/Not-Voting in `--cl-text-muted`.
   Counts use `.cl-num` (tabular). Show raw counts + percentages.
4. **By-party line** + date (`.cl-meta`). Independents shown grouped with their
   caucus and labeled, mirroring the source screenshots ("Independents are
   grouped with the party they caucus with").

> **Tally vs no-tally:** nominations and passage votes always have a tally. The
> "upcoming/on-the-floor" no-tally state only appears in the **home section**,
> not on this page (this page only shows completed roll-calls).

### Component 4 — Seat chart (the crux)

A **hemicycle** (semicircle) of seats — the GovTrack "ideology vote chart" form,
simplified. **100 seats for Senate, 435 for House.**

**Seat encoding (matches the reference screenshots' legend):**
- **Hue = party:** `--cl-republican` / `--cl-democrat` / `--cl-independent`.
- **Fill = position:** **Yea = solid fill**; **Nay = outline only** (white/`--cl-card`
  interior, 1.5px colored border); **Present = ▩ hatched/muted**; **Not Voting =
  empty `--cl-border` gray**.
- **Seat shape:** rounded square (`--cl-radius-xs` on the seat), per Jeffrey's
  "seat square" language. (Hex cartogram is explicitly P2 / out of scope.)
- **Seat ordering:** arrange by **state, then party** within the arc (NOT ideology
  score — keeps it neutral and intuitive). Document the arc-packing rule chosen.
- **Center label:** the outcome margin (e.g., "216–201") in `.cl-h1`, with a
  small "Passed/Failed/Confirmed/Rejected" beneath.
- **Legend:** compact row beneath the arc, using the four+ seat states above.

**Seat interaction:**
| State | Behavior |
|---|---|
| Hover (desktop) | Seat lifts: border to full party hue + `--cl-shadow-focus` ring; cursor pointer; tooltip optional but mini-card is the real affordance |
| Focus (keyboard) | `--cl-shadow-focus` ring (`0 0 0 3px rgba(45,106,79,.18)`) |
| Select (click / Enter / Space) | Opens the **seat mini-card** (Component 5) anchored to the seat |
| Selected | Seat keeps a persistent ring while its mini-card is open |

**This is the hard responsive + a11y problem — see those sections below.**

### Component 5 — Seat mini-card (popover)

Reuse the **IdentityPicker** popover model exactly (`IdentityPicker.js`):
portaled to `document.body`, `position: fixed`, measured in `useLayoutEffect`,
flips vertically/horizontally to stay in viewport, dismiss on **click-outside +
Esc**. Shell: `--cl-card`, `1px solid --cl-border`, `--cl-radius-lg`,
`--cl-shadow-pop`, `min-width: 220px`, padding `--cl-space-2`.

Contents:
- Member **photo** (44px circle, identity-avatar convention) + **name** (`.cl-h3`).
- **Party + state** line (`.cl-meta`) — e.g., "Republican · Florida (FL-19)".
  Party word colored with `PARTY_COLORS`.
- **This-vote position** pill — "Voted Yea" / "Voted Nay" / "Present" / "Did not
  vote", colored by the position encoding.
- **"View profile →"** link → the member's `ProfileView` profile window
  (route `/[state]/[member_slug]`). **Explicitly the profile window, NOT the
  engagement `PageView`.**

### Component 6 — Vote list

Below the chart. Each row is the accessible, mobile-first equivalent of a seat.
Default sort **state ▸ party**; provide a search filter (reuse the Votes-tab
search in `ProfileView`) and a "Download CSV" affordance (the source screenshots
have one; nice civic touch, P1).

Row layout: `[position pill] · [state] · [party badge] · [Name] ………… →`
- Position pill + party badge reuse existing chip styles (`.feed-card__kind`
  sizing: `padding 2px 8px`, `font-size 10px`, `weight 800`, `--cl-radius-xs`).
- Whole row is the click target → member profile window (same target as the
  seat mini-card's link). Hover: row background `--cl-bg-soft`.

---

## States & edge cases (P0-7)

| Condition | Treatment |
|---|---|
| **Loading** | Skeleton: gray header card + a placeholder arc block (do not render 435 empty seats during load) + 6–8 shimmer list rows. Use `--cl-bg-soft` blocks. |
| **Recess / no recent votes** | Friendly empty state in the panel: "Congress isn't recording floor votes right now. Here's the most recent vote from [date]." with a link to that last vote. Never a blank arc. |
| **Voice vote / no roll-call** | If a surfaced action has no per-member data: show header + tally-unavailable note ("This passed by voice vote — no individual record exists.") and **suppress the seat chart** rather than render an empty one. |
| **Fetch failure** | Inline error card: "Couldn't load this vote. [Retry]". Retry hits the cached endpoint. Do not blank the page. |
| **Missing member photo** | Fall back to initials avatar (existing identity-avatar convention). |
| **Unknown party/position** | Neutral gray seat (`--cl-border`) + "Unknown" in mini-card — never miscolor. |
| **Long member / bill names** | Truncate with ellipsis at one line in list rows + mini-card title; full name in `title`/`aria-label`. |

---

## Responsive behavior — **needs a Design decision**

The 435-seat House chart is the central responsive challenge.

| Breakpoint | Seat chart | Vote list |
|---|---|---|
| **Desktop ≥1025px** | Full interactive hemicycle, seats ~10–14px, primary affordance | Secondary, below chart |
| **Tablet 901–1024px** | Hemicycle scales down (container-query off panel width, like `.polls-page`); seats shrink, still interactive | Below chart |
| **Mobile ≤900px** | **Decision needed (see below)** | **Primary affordance** |

**Mobile options for the seat chart (Design to choose, my rec first):**
1. **(Recommended) Compact non-interactive overview + list-driven detail.**
   Render the hemicycle as a small at-a-glance *picture* of the outcome (still
   color-encoded, not individually tappable), and make the **vote list the
   interactive surface** — tapping a row opens the same mini-card. Rationale:
   435 reliable 44px tap targets can't fit a phone; the list already is the
   accessible equivalent, so we lean on it on mobile.
2. Horizontally scrollable full-size chart (seats stay 44px, arc overflows). Keeps
   interaction parity but scroll-to-find a seat is poor UX.
3. Senate-only interactive seats on mobile (100 fit better), House → list-only.

I recommend **#1** — it's the cleanest and reuses the list we're already building.

---

## Accessibility (P0 — treat as first-class, run `accessibility-review` after)

The seat chart is an information graphic with up to 435 interactive children —
the part most likely to fail WCAG. Requirements:

- **Don't put 435 nodes in the tab order.** Implement the seat grid as a single
  composite widget with **roving tabindex**: one seat is tabbable; arrow keys move
  focus seat-to-seat; Enter/Space opens the mini-card. Container `role="group"`
  with `aria-label="House roll-call seats — H.R. 1041"`.
- **Per-seat `aria-label`:** `"{Name}, {Party}, {State}, voted {Position}"`.
- **The vote list is the screen-reader-complete equivalent** — it must convey
  100% of the chart's information as a semantic list/table. A keyboard/SR user can
  ignore the arc entirely and use the list. State this explicitly to QA.
- **Color is never the only signal:** position is also encoded by fill (solid vs
  outline vs hatched) and stated in text in the list + mini-card. Verify R-Yea vs
  D-Yea vs Nay states are distinguishable in grayscale.
- **Contrast:** body/meta text ≥ AA on white. Note `--cl-success` (#27ae60) fails
  AA as text — use `--cl-success-text` (#1e8048) for any "Passed" text; reserve
  the brighter token for fills/dots only.
- **Mini-card popover:** focus moves into it on open, returns to the originating
  seat/row on close; Esc closes; `role="dialog"` + `aria-label`.
- **Touch targets:** list rows + mini-card link ≥ 44px (mobile tab min-width 92px
  precedent in `ProfileView`).
- **`prefers-reduced-motion`:** disable the seat hover-lift + any chart entrance
  animation.

---

## Motion

Reuse proposed motion tokens (`--cl-duration-fast 150ms`, `--cl-ease-standard`).
Keep it minimal — this is a data surface.

| Element | Trigger | Animation | Duration / easing |
|---|---|---|---|
| Chamber toggle | Switch | Active-border + color crossfade | 150ms / standard |
| Seat | Hover/focus | Ring fade-in (shadow-focus); no scale by default | 150ms / standard |
| Mini-card | Open | Fade + 4px rise | 150ms / standard |
| Tally bar | Vote load | Optional one-shot width grow-in | 360ms / standard; **off** under reduced-motion |
| Refresh (home) | Click | Icon spin while fetching | until resolved |

---

## Home "Bills" section (Phase B — lower fidelity, spec for awareness)

Reuse the home **section pattern** (`.section` / `.cl-eyebrow` + `.cl-h2` /
chevron accordion / lazy-load) seen in National activity + Popular polls. Eyebrow
"FEDERAL LEGISLATION", title "Bills". Inside, stacked:

- **Latest Senate** card over **Latest House** card. Each card reuses the
  FeedCard shell (`16px 18px` padding, `--cl-radius-2xl`, `--cl-shadow-card`).
- Card contents: bill citation + title, **status chip**, tally bar **if voted**,
  date. A **refresh** icon-button in the section header re-queries the cached
  recent endpoint.
- **Two card states:** *Upcoming / On the floor* (warning chip, **no tally**) vs
  *Passed / Failed* (success/danger chip, **tally + "View chart →"** link to the
  matching `/bills` vote).
- **"View all →"** link to `/bills`.

### Status chips (shared by page + section)

Pill style off the existing badge convention (`--cl-radius-pill`, `font-size
10px`, `weight 800`, uppercase, `padding 2px 8px`):

| Status | Background / Text |
|---|---|
| Upcoming | `--cl-warning-soft` / `--cl-warning-text` |
| On the floor | `--cl-warning-soft` / `--cl-warning-text` + a small pulsing dot (`--cl-shadow-pulse`) |
| Passed / Confirmed | `--cl-success-soft` / `--cl-success-text` |
| Failed / Rejected | `--cl-danger-soft` / `--cl-danger-text` |

> Reliability note for the chip: House "upcoming/on-floor" is sourced from clean
> weekly XML; **Senate has no clean feed**, so the Senate card may only ever show
> "Recently voted" + result until a source is found. Design the card so a missing
> upcoming-status degrades gracefully (just omit the chip).

---

## Open design questions (for Claude Design)

1. **Mobile seat-chart strategy** — confirm option #1 (compact overview + list-
   driven detail) vs #2/#3. Blocking for the responsive build.
2. **Seat shape + size + arc packing** — exact seat px at each breakpoint and the
   state▸party arc-ordering rule. Blocking for the chart build.
3. **Tally-bar Yea/Nay neutral tones** — pick the two tones (avoid implying
   one side is "good"); confirm they're distinct from the party hues so the bar
   doesn't read as party-colored.
4. **Legend density** — 4–5 seat states in one compact row; confirm it fits at
   mobile width without wrapping awkwardly.
5. **Senate independents** — visual treatment for "I, caucuses with D/N" labeling
   in the by-party line and seat hue.
