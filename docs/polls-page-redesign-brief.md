# CivicView — /polls page redesign brief (for Claude Design)

**Use:** paste the bracketed prompt below into the "Needs work…" input
on the Polls component in the CivicView Design System project. Attach
the current production /polls screenshot as the visual reference.

**Status:** v1 — review + tweak before submitting, then update this
file with any revisions Claude Design produces so the brief and the
exports stay in sync.

---

## Prompt to paste into Claude Design

```
Redesign the /polls page into a tabbed dual-feed surface: Polls (the
existing scope, refined) and Posts (a new feed showing all rep +
candidate posts). The page becomes the unified "Grassroots Feed" hub
of CivicView — one place to see what's being asked + said across the
entire platform without scrolling each rep page individually.

URL routing: /polls (Polls tab, default) and /posts (Posts tab).
Toggling the tab updates the URL via client-side push; both routes
load the same page shell so bookmarking and sharing the right tab
works.

═══════════════════════════════════════════════════════════════════
TABS — TAGGABLE SEGMENTED CONTROL (NEW)
═══════════════════════════════════════════════════════════════════
- Positioned BETWEEN the navy hero and the chip filter row.
- Two pill tabs: "Polls" (default) and "Posts".
- Active tab: solid green (--cl-accent) with white text. Inactive:
  outlined pill with --cl-text color.
- Tab switch animates content: outgoing slides left + fades out,
  incoming slides in from the right + fades in. Duration ~250-300ms.
- The navy hero block ALSO updates per tab — copy + stats change. The
  hero itself shouldn't slide; only the content below the tabs.
- Mobile: full-width segmented control, 44pt minimum hit targets.

═══════════════════════════════════════════════════════════════════
HERO STATS — PER TAB
═══════════════════════════════════════════════════════════════════
- Polls tab hero: existing copy stays as-is, stats = Live polls,
  Votes this week, States.
- Posts tab hero: new copy along the lines of "Every post from
  verified reps + candidates — see what they're saying without
  scrolling each page individually." Stats = Total posts, Posts
  this week, Reps + candidates active.

═══════════════════════════════════════════════════════════════════
CHIP FILTERS — RENAMES + ADDITIVE BEHAVIOR
═══════════════════════════════════════════════════════════════════
Current chips on Polls: All polls, Bill, Committee, Executive,
Judicial, Standalone, From candidates.

Rename:
  - "Bill"      -> "States"
  - "Committee" -> "Congress" (covers both House + Senate)
All other chips keep their current name.

States dropdown (NEW):
  - Tapping the States chip opens a dropdown of all 50 state
    abbreviations + DC (51 entries).
  - Scrollable list with FADE GRADIENTS at top + bottom of the
    scroll area. Top fade only appears once the user has begun
    scrolling. Bottom fade is always visible until the list
    scrolls to its end.
  - Single-select WITHIN the States filter (one state at a time).
  - When a state is selected, the chip label updates to
    "States · FL" (or whichever abbreviation).
  - Filter applies to ALL polls/posts authored by reps + candidates
    in the chosen state, PLUS standalone polls whose author citizen
    has that state set on their profile.
  - Mobile: the dropdown becomes a full-width sheet that doesn't
    overlap the chips above/below.

Posts tab adjustments:
  - Drop the "Standalone" chip — citizens can't author posts.
  - Keep all other chips.
  - "From candidates" stays (candidates can post).

ADDITIVE chip behavior (MAJOR CHANGE):
  - Chips are now multi-select. Multiple chips can be active
    simultaneously and the result set is the union.
  - "All polls" / "All posts" is the deactivator — clicking it
    clears every other chip and shows everything.
  - Active chips: filled state + darker outline.
  - Inactive chips: outlined only.
  - Chip counts update live as the user toggles others.

═══════════════════════════════════════════════════════════════════
CARD CONTENT — MATCH THE REP-PAGE LOOK
═══════════════════════════════════════════════════════════════════
Polls + posts on this feed should match the visual weight and
interaction patterns of the polls + posts rendered on rep pages.
Use the rep page's card layout as the canonical reference; the
/polls cards today look noticeably lighter / more compact, and
that mismatch should go away.

Per-card mandatory elements:
  - Kind chip (top-left): REP / CITIZEN / STANDALONE / CANDIDATE
  - Page tag (next to kind chip): e.g. "BD · FL-19" for rep pages,
    "Standalone" for citizen standalone polls.
  - Timestamp ("5d ago"): shifted LEFT to make room for the close
    button. New stacking left-to-right: kind -> page tag -> timestamp
    -> [close X if applicable, far right].
  - Card body: poll question or post body; collapse posts >400 chars
    to a preview with an "Expand" pill (same pattern as the rep page).
  - Author row: avatar + name + role + "Unverified" pill for
    pre-ID.me citizens.
  - Engagement footer: like / dislike / comments counts with their
    icons.

═══════════════════════════════════════════════════════════════════
INTERACTIVITY — VOTE, REACT, COMMENT, DELETE
═══════════════════════════════════════════════════════════════════
Mirror the rep-page interaction model. Everything that works on the
rep page should work on this feed.

Vote (poll cards):
  - Option rows clickable for any signed-in identity (citizen, rep,
    candidate).
  - For standalone polls: reps + candidates can also vote (use the
    IdentityPicker pattern when 2+ identities are signed in to
    disambiguate which identity casts the vote).
  - "Your vote" indicator on the chosen option (per-identity
    tracking).
  - Backend already supports cross-identity standalone-poll votes.

React (post cards):
  - Like + dislike buttons mirror the rep page exactly.
  - Multi-identity reaction picker when applicable.

Comments (NEW for /polls):
  - "Comments (N)" affordance below each card.
  - Click expands an inline comment thread that exactly mirrors the
    rep-page thread: composer, AI tone filter chips (Positive /
    Critical / Funny / Supportive / Skeptical / Informative), AI
    semantic filter input, identity picker for multi-identity users,
    report flow, two-party reply threading.
  - LAZY LOAD: don't fetch comments until expansion. Cap displayed
    at 5 newest; "View all (N)" link expands to full thread or
    deep-links to the parent rep page for rep/candidate cards.
  - ACCORDION BEHAVIOR: only one comment thread can be open at a
    time. Opening a new card's thread instantly collapses any other
    open thread on the page. Smooth height transition on
    collapse/expand.

Delete (standalone-poll author only):
  - Red X icon, circle outline, top-right corner of the card.
  - Uses --cl-down for the X + border, --cl-down-soft on hover.
  - Clicking opens a confirmation modal: "Close this poll? It moves
    to the archived section of your dashboard and frees your
    standalone-poll slot so you can post another."
  - Confirm calls POST /api/citizen-polls/{id}/close.
  - NOT visible to non-authors, NOT visible to admins (admins use
    the existing report -> moderation flow, not unilateral delete).

═══════════════════════════════════════════════════════════════════
POSTS TAB — NEW CONTENT TYPE
═══════════════════════════════════════════════════════════════════
Posts come from verified reps + candidates only. Citizens can't
post; the "Start a poll" CTA on the Polls tab has no analog on
Posts UNLESS a verified rep or candidate is signed in, in which
case render a "Start a post" CTA that deep-links to their own
page's post composer.

Sort order: by engagement score, most-engaged first. Engagement
score = comments + likes + dislikes + votes (simple sum across all
engagement signals). Tiebreaker is recency.

CRITICAL — post-with-attached-poll splitting:
  Reps + candidates can publish a single post that has a poll
  attached. When this happens, the SAME unit of content should
  appear in BOTH feeds, but as separate cards:
    - On the Posts tab, render the post card. Indicate that it has
      a poll attached with a small badge ("+ poll attached") that
      links to the rep page where the poll can be voted.
    - On the Polls tab, render the poll card. Indicate it's part of
      a post with a small badge ("from a post") that links to the
      rep page where the post body lives.
  This way users browsing one feed surface don't miss content
  authored as a combined unit.

═══════════════════════════════════════════════════════════════════
EMPTY STATES
═══════════════════════════════════════════════════════════════════
- Polls empty (no matches): existing empty illustration + "Try
  clearing your filter — or start a poll yourself." CTA = Clear
  filters + Start a poll (signed-in citizens only).
- Posts empty (no matches): "Try clearing your filter." CTA =
  Clear filters. No "Start a post" unless signed-in rep/candidate.
- AI filter zero-match: lighter inline empty state below the chip
  row, with "Clear filter" + (Polls only) "Start a poll matching
  this".

═══════════════════════════════════════════════════════════════════
LOADING STATES
═══════════════════════════════════════════════════════════════════
- Skeleton cards matching the new card layout (heavier than today
  because of the comment-thread placeholder rows that appear ONLY
  when a thread expands; the initial skeleton shows the card body
  + chips + author row + option/post-body placeholders + the
  footer's counts row).
- Maintain the responsive 3-col / 2-col / 1-col grid at desktop /
  tablet / mobile breakpoints.

═══════════════════════════════════════════════════════════════════
PRESERVE FROM TODAY'S DESIGN
═══════════════════════════════════════════════════════════════════
- Navy hero block visual identity (gradient, type, layout).
- AI tone filter chip row + AI semantic filter input + Apply button.
- Hero stat tiles in the top right.
- Existing color palette + type tokens; do NOT introduce new design
  system colors or fonts.
- The 3-col / 2-col / 1-col responsive grid at the three
  breakpoints.
- The "Start a poll" CTA placement on the Polls tab (top-right inline
  + sticky mobile FAB). Citizen-only.

═══════════════════════════════════════════════════════════════════
VARIANTS TO EXPORT
═══════════════════════════════════════════════════════════════════
Export each at desktop (1440), tablet (820), and mobile (390) widths:

1.  /polls — default tab, signed in
2.  /polls — default tab, signed out
3.  /polls — States dropdown open (visible scroll fade gradients)
4.  /polls — multiple chips active (e.g., States[FL] + Standalone +
    Congress)
5.  /polls — card with inline comment thread expanded
6.  /polls — standalone poll showing the author's red-X delete
    button (top-right)
7.  /polls — post-with-attached-poll showing the "from a post" badge
    linking to the parent
8.  /posts — default tab, signed in
9.  /posts — signed-in rep with "Start a post" CTA visible
10. /posts — post-with-attached-poll showing "+ poll attached" badge
11. Tab transition (mid-animation, slide+fade)
12. Empty state for each tab (no polls match / no posts match)
13. AI filter zero-match in-grid

═══════════════════════════════════════════════════════════════════
DELIVERABLES BACK TO ENGINEERING
═══════════════════════════════════════════════════════════════════
- Updated component specs in the Components section of the design
  system for: PollCard (compact feed variant), PostCard (compact
  feed variant), TabStrip (new segmented control), Chip (additive
  multi-select state), StateDropdown (new).
- CSS tokens for any new states (multi-select chip filled style,
  comment-thread accordion transition, the red-X close button).
- Source SVG or hand-off-to-Claude-Code zip with each variant
  rendered at all three breakpoints.
- Notes on any patterns that should be back-ported to the rep page
  (e.g., if the comment accordion behavior here is better than what
  reps have today, flag it).

Once the design lands, engineering splits implementation into ~4
PRs: backend extensions, polls-tab redesign, posts-tab build,
post-with-poll splitting logic.

When all variants are exported, flip the section status to
"Looks good."
```

---

## Engineering notes (NOT part of the design prompt — for our own reference)

Backend changes needed to support the design:

1. **`/api/feed/polls`** — accept multiple `kind` params (`?kind=rep&kind=standalone`), add `?state=FL` filter that applies to both rep/candidate polls and standalone-citizen polls (the latter via CitizenAccount.state). Already returns `viewer.voter_choice_id` + `viewer.is_author` per Phase 0.

2. **New `/api/feed/posts`** — same filtering surface as polls. Returns posts from RepAccount + CandidateAccount authors. Sort by engagement score (`comments + reactions_up + reactions_down + (poll_votes if attached)`). Lazy comment counts only.

3. **Post-with-poll splitting** — backend doesn't need to split; it returns the same Poll + Post records and the frontend renders each in the appropriate tab. The Poll feed should include a `parent_post_id` field on poll items where applicable; the Post feed should include `has_attached_poll: bool`.

4. **Comments on /polls feed cards** — re-use the existing per-post + per-citizen-poll comment endpoints (`/api/pages/posts/{id}/comments` + `/api/citizen-polls/{id}/comments`). Add to PollCard's expandable thread.

5. **Engagement-score computation** — can be a Python sum at query time for the cap-limited feed result set (~100 items). No new column needed; compute at response time.

Frontend implementation plan:

- **PR 1:** Backend changes (1-3 above).
- **PR 2:** Frontend redesign of the Polls tab with new card layout + inline comments + delete X. Keeps single-tab behavior.
- **PR 3:** Frontend Posts tab + tab segmented control + URL routing.
- **PR 4:** Polish — accordion behavior, post-with-poll badges, edge cases.

Defer to a separate task:
- Save / favorite polls + posts (already Task #16; ties into My Tracked).
- Threat / incitement detection on poll + post content (already Task #41).
