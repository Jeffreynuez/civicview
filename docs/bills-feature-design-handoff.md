# Bills & Votes — Design Handoff (Phase A: `/bills` page)

**For:** Claude Design
**From:** Jeffrey De La Nuez (with Claude Cowork)
**Date:** 2026-05-30 · **Revision:** pass 2 (incorporates Jeffrey's review of the first design pass)
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
│   ◜ hemicycle; party-blocked, state-sorted; 2-letter state   │
│     abbr under every seat; outcome "216–201" centered ◝       │
│   legend: ◼R·Yea ◻R·Nay ◼D·Yea ◻D·Nay ⊘Present ▢Not-voting   │
├─────────────────────────────────────────────────────────────┤
│  FULL RECORD — House, every member   [search all] [CSV]       │
│  two columns · page toggle top + bottom (5 pages)             │
│   ✓ FL R Donalds     │   ✕ CA D Pelosi                       │
│   ✓ TX R Cloud       │   – NY D Ocasio-Cortez                │
│   …                  │   …                                    │
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
3. **Tally bar (pass 2):** horizontal proportional bar. **Yea = classic green
   (`--cl-accent` / `--cl-success` family), Nay = classic red (`--cl-danger`
   family)** — Jeffrey's call; he reviewed mono / slate / classic and chose
   classic. Present/Not-Voting in `--cl-text-muted`. Keep these tones distinct
   from the *seat* Yea/Nay encoding (party hue + fill) so the bar and chart read
   as two separate things. Counts use `.cl-num` (tabular). Show counts + %.
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
  interior, 1.5px colored border); **Present = hatched fill**; **Not Voting =
  empty `--cl-border` gray**. All four must be distinguishable in grayscale.
- **Seat shape + size:** rounded square (`--cl-radius-xs`). **Small size** (pass 2:
  Jeffrey accepted small squares as the trade-off needed to fit a 2-letter state
  label under every seat). (Hex cartogram is P2 / out of scope.)
- **State abbr under every seat (pass 2):** a 2-letter state label sits beneath
  each square (e.g., `FL`, `NY`), even at small type, so individual seats are
  identifiable. It is a *supplementary* cue — the seat's full `aria-label` still
  carries name + state + position, so micro-text is never the only way to ID a
  seat. This label requirement drives the seat spacing (and the mobile scroll).
- **Organization / ordering (pass 2 — "make it more organized"):** clean,
  evenly-spaced concentric rows. Seats **party-blocked — Dem left, Rep right,
  Independents adjacent to their caucus — and sorted by state within each block**,
  so same-state seats sit together and the abbreviations read in order. Keeps the
  outcome obvious (color blocks) while making states findable. **Rebuild the
  Senate the same way** — tidy rows, 2 seats per state grouped; the first pass
  read as scattered/random and that's the main thing to fix. *Alternative to mock
  for comparison:* one state label per state-group rather than per-seat, to cut
  repetition on large delegations (e.g., CA ×52).
- **Center label:** outcome margin (e.g., "216–201") in `.cl-h1`, with a small
  "Passed/Failed/Confirmed/Rejected" beneath.
- **Legend:** compact row beneath the arc, all five seat states (R·Yea, R·Nay,
  D·Yea, D·Nay, Present, Not-voting).

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

### Component 6 — Full record list (pass 2)

Below the chart, titled "Full record — every member". Each row is the accessible,
mobile-first equivalent of a seat. Default sort **state ▸ party**.

**Condensed two-column layout (pass 2):** rows run in **two columns side by side**
on desktop/tablet; **single column on mobile** (two columns + icon + initials is
too tight on a phone). Each compact row, left → right:
- **Status icon only** (no "Voted Yea/Nay" text): **✓ = Yea** (green), **✕ = Nay**
  (red), **– = did not vote** (muted), and a distinct **4th glyph for Present**
  (e.g., `⊘` or `P` — Jeffrey's list named only three; Present still needs one).
- **State abbr** on the left (e.g., `AL`).
- **Party badge** (R/D/I — existing `.feed-card__kind` chip: `padding 2px 8px`,
  `font-size 10px`, `weight 800`, `--cl-radius-xs`).
- **Member full name** (e.g., "Donalds, Byron") — pass 2 reverted from initials;
  initials made scanning for a specific person too hard.
- **No right-side state** (already shown on the left) and **no trailing arrow**
  (the mini-card carries the profile link). The whole row stays the click/focus
  target that opens the mini-card.

**Pagination (pass 2):** page toggle at **top and bottom** of the list.
- **House:** 5 pages — pages 1–4 = 100 members each, page 5 = 35 (435 total).
- **Senate:** 1 page (100).
- **Search spans the full set, not just the current page** — searching name/state
  filters all 435 and jumps to the page with matches (don't hide people behind
  pagination). Keep the **CSV download** (exports the full record).
- Whole row → member profile window (same target as the seat mini-card link).
  Hover: row background `--cl-bg-soft`. Two-column DOM order should read sensibly
  for keyboard/SR (row-major), see Accessibility.

> **Real-data note:** the prototype uses seeded data, so names are synthetic. In
> production these are real member full names (not initials).

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

## Responsive behavior (pass 2 — resolved)

The 435-seat House chart **with per-seat state labels** is the central responsive
challenge.

| Breakpoint | Seat chart | Full-record list |
|---|---|---|
| **Desktop ≥1025px** | Full interactive hemicycle, small seat size + state label under each seat | Two columns, below chart |
| **Tablet 901–1024px** | Hemicycle scales via container-query off panel width; seats stay small, labels kept | Two columns, below chart |
| **Mobile ≤900px** | **Horizontally scrollable full chart** with **extra seat separation** so the state labels fit and stay legible (Jeffrey's pick). At-a-glance outcome label stays centered. | **Single column**, below chart |

**Decision (pass 2):** mobile uses the **scrollable full chart** (not the compact
overview I first recommended) so the per-seat state labels stay present and
readable. Trade-off to keep in view: with labels the mobile chart is wide and
scroll-heavy, so the **list is realistically the primary "find a member" tool on
mobile**, with the chart as the at-a-glance outcome. Give the scroll a clear
affordance (edge fade + arrows, as in the mock).

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

## Resolved decisions (pass 2)

The original three open questions are now resolved:
1. **Mobile seat-chart strategy** → **scrollable full chart** with extra seat
   separation for labels (not the compact overview); list goes single-column.
2. **Seat size + ordering** → **small** size (needed to fit a 2-letter state label
   under every seat); **party-blocked, state-sorted within block**; per-seat state
   label; Senate rebuilt into tidy rows.
3. **Tally-bar tones** → **classic green Yea / red Nay** (Jeffrey's call), kept
   distinct from the seat encoding.

## Still open (for Claude Design, pass 2)

1. **"Present" glyph** — Jeffrey's list named only ✓ Yea / ✕ Nay / – no-vote.
   Present needs its own distinct symbol in both the list and the seat legend.
   Blocking for the list.
2. **State-label repetition** — mock both per-seat labels AND one-label-per-state-
   group so Jeffrey can compare the clutter (large delegations like CA ×52).
3. **Legend density** — six seat states in one compact row; confirm it fits at
   mobile width without awkward wrapping.
4. **Senate independents** — visual treatment for "I, caucuses with D/N" in the
   by-party line and seat hue.
5. **Two-column list reading order** — confirm row-major DOM order so keyboard/SR
   traversal is sensible across the two columns.
