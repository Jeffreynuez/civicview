// CivicView — guided-tour segment config.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Single source of truth for the in-app tutorial ("Take the tour").
// The TutorialOverlay component renders this config; lib/tutorial.js
// holds the state machine that walks it.
//
// SHAPE
// ─────
// Each segment:
//   id      — stable string key (persisted in progress storage; don't rename
//             casually — a rename orphans saved progress for that segment).
//   title   — short label shown in the segment list.
//   tier    — 'browse' | 'account' | 'verified' | 'subscriber'.
//             Drives the badge next to the title. TODAY every tier is
//             reachable because demo accounts carry both grants
//             (verified_method='demo', is_subscribed=True — see
//             auth_citizen.demo_signup). When ID.me + Stripe go live,
//             the split is a config change HERE (plus badge copy in
//             TIER_BADGES), not a rewrite: gate 'verified' + 'subscriber'
//             segments behind the citizen's real flags.
//   steps   — ordered walkthrough steps. Each step:
//     route     — pathname the step lives on ('/', '/polls', '/bills').
//                 Navigating is a full page load (matches how the navbar
//                 links work); tour progress survives via sessionStorage.
//     target    — value of a [data-tutorial="…"] anchor to spotlight, or
//                 null for a panel-only step. Missing targets degrade
//                 gracefully to panel-only (never block the tour).
//     action    — optional app action emitted over the event bridge
//                 (lib/tutorial.js emitTutorialAction) so the tour can
//                 open the REAL surface (My Tracked window, Feedback,
//                 Help Build, citizen login). page.js listens and maps
//                 these onto its existing open/close handlers.
//     title/body — the step copy. Keep it plain, non-partisan, and
//                 action-oriented ("try it now" — the spotlight is
//                 non-blocking, so the page stays fully interactive).
//
// ORDER (agreed with Jeffrey 2026-07-23): Welcome → Map & finding your
// reps → Home page → Rep profiles → Compare → Official pages → Accounts →
// My Tracked → Notifications → Polls & Posts → Floor Bills → Dashboard &
// engagement → Feedback → Help build this.

export const TIER_BADGES = {
  browse: null, // free-for-everyone segments carry no badge
  account: { label: 'Account', title: 'Available once you create a (free demo) account' },
  verified: { label: 'Verified', title: 'Will require ID.me verification at launch — open to demo accounts today' },
  subscriber: { label: '$5/mo', title: 'Will be part of the $5/month subscription at launch — open to demo accounts today' },
};

export const TUTORIAL_SEGMENTS = [
  {
    id: 'welcome',
    title: 'Welcome',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: null,
        title: 'Welcome to CivicView',
        body: 'CivicView is a non-partisan platform for following your elected officials — what they sponsor, how they vote, and what they say — and for engaging with them directly. Browsing is free for everyone, forever. This quick tour walks through every surface of the app. Jump to any topic on the list, or close the tour at any time with the ✕ — you can reopen it later from the ☰ menu.',
      },
      {
        route: '/',
        target: null,
        title: 'How the tour works',
        body: 'The tour points at real parts of the live app — nothing is a mockup, and the page stays fully usable while the tour is open. Feel free to click around and try each feature as it comes up. Use Next and Back here, or pick any topic from the list.',
      },
    ],
  },
  {
    id: 'map',
    title: 'The map & finding your reps',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'map',
        title: 'The interactive U.S. map',
        body: 'This map is the front door. Click any state to load its full roster — members of Congress, state legislators, statewide officials, and upcoming elections. Once a state is open you can click an individual congressional district to zoom in further. Clicking the water outside the U.S. resets the view.',
      },
      {
        route: '/',
        target: 'map-divider',
        title: 'Open and close the map',
        body: 'The bar between the map and the panel is a handle. On phones, double-tap it — or slide it — to close the map and give the panel the whole screen, and again to bring the map back. On desktop, drag it to resize the split. Press Next and we’ll tuck the map away on mobile so you can see more of the panel.',
      },
      {
        route: '/',
        target: 'address-lookup',
        // Collapse the mobile map on entry so the address lookup (and
        // the rest of the panel) has the screen. No-op on desktop.
        action: 'collapse-map',
        title: 'Find your district by address',
        body: 'Not sure which district you live in? Enter your address here and CivicView finds your congressional district, your state legislative districts, and your county — then filters the list to the people who actually represent you. Your address is used only for the lookup.',
      },
      {
        route: '/',
        target: 'nav-search',
        title: 'Search any rep or candidate',
        body: 'Already know who you’re looking for? The search bar covers every sitting member of Congress and every declared candidate — search by name, state, or office. Tip: on desktop, pressing / focuses the search from anywhere.',
      },
    ],
  },
  {
    id: 'home',
    title: 'The home page',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'side-panel',
        title: 'The national panel',
        body: 'Next to the map lives the main panel. Before you pick a state it shows the national view: the executive branch, the Supreme Court, congressional leadership, live national activity from rep and candidate pages, popular polls, recent floor bills, and a browse-by-state grid.',
      },
      {
        route: '/',
        target: 'side-panel',
        title: 'State tabs: Congress · State · Local · Elections',
        body: 'Once a state is selected, the panel switches to four tabs: Congress (the federal delegation), State (legislators, governor, statewide officials, and the state supreme court), Local (county and city officials), and Elections (upcoming races, candidates, key dates, and your ballot).',
      },
    ],
  },
  {
    id: 'profiles',
    title: 'Rep profiles',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'side-panel',
        title: 'Open any official’s profile',
        body: 'Click any person in the panel to open their full profile: who they are, the committees they sit on, and the issues they focus on — every claim sourced from official records.',
      },
      {
        route: '/',
        target: 'side-panel',
        title: 'Bills, votes & executive orders',
        body: 'Profiles carry the receipts: sponsored bills with plain-English AI summaries, the votes they’ve cast (with a “What was this vote?” explainer), and — for the executive branch — signed executive orders. An AI search toggle on Bills and Votes lets you filter by topic in your own words.',
      },
      {
        route: '/',
        target: 'side-panel',
        title: 'On the ballot?',
        body: 'When a sitting official is also running in an upcoming election, an “On ballot” badge appears on their profile — clicking it jumps straight to that race on the Elections tab, where you can see everyone they’re running against.',
      },
    ],
  },
  {
    id: 'compare',
    title: 'The compare feature',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'side-panel',
        title: 'Compare officials & candidates side-by-side',
        body: 'Every profile and candidate card has a Compare toggle. Add up to three people — officials, candidates, or a mix — and a tray appears at the bottom of the screen.',
      },
      {
        route: '/',
        target: 'compare-tray',
        title: 'The comparison view',
        body: 'Open the tray to see them side-by-side: roles, issue focus, and — for members of Congress — shared roll-call votes with an agreement-rate bar showing how often they voted the same way. It’s the fastest way to see where two people actually differ, based on votes rather than rhetoric.',
      },
    ],
  },
  {
    id: 'pages',
    title: 'Official pages (posts & polls)',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'side-panel',
        title: 'Every official has a page',
        body: 'Beyond the data profile, every rep and candidate has a public page — a moderated, district-scoped channel where verified officials post updates, run polls, and list events like town halls. Open one via “View page” from any profile.',
      },
      {
        route: '/',
        target: null,
        title: 'Claimed vs. unclaimed pages',
        body: 'Pages exist for every official from day one. When the official themselves verifies and claims their page, their posts carry a verified badge and an “Author” marker. On unclaimed pages, citizens can still run polls about that office — the conversation doesn’t wait for the official to show up.',
      },
    ],
  },
  {
    id: 'accounts',
    title: 'Citizen accounts & verification',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'nav-citizen-login',
        title: 'Create a citizen account',
        body: 'Browsing needs no account. To engage — like, vote on polls, comment — you’ll want a citizen account. Right now CivicView is in demo preview: anyone can create a free demo account in seconds, no email verification required, and it unlocks the full engagement experience.',
      },
      {
        route: '/',
        // No spotlight — the login modal supplies its own backdrop and
        // covers the screen; ringing the navbar button underneath it
        // would just point at a dimmed control.
        target: null,
        action: 'open-citizen-login',
        title: 'Try it — the login window',
        body: 'This is the real sign-in window (we just opened it). “Create demo account” gets you in immediately. At launch, accounts will verify through ID.me — a one-time identity check that proves you’re a real U.S. resident of your district, which is what makes every vote and comment on CivicView a verified-constituent signal.',
      },
      {
        route: '/',
        target: null,
        action: 'close-citizen-login',
        title: 'What’s coming at launch',
        body: 'The tiers at launch: browsing stays free for everyone; ID.me-verified citizens can like and vote on polls; a $5/month subscription (the app’s only revenue — no ads, ever) adds creating polls and commenting. Demo accounts get all of it today so you can try everything now.',
      },
    ],
  },
  {
    id: 'tracked',
    title: 'My Tracked',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'nav-tracked',
        title: 'Track what you care about',
        body: 'Almost everything in CivicView is trackable: officials, candidates, bills, and elections. Look for the Track / bookmark affordance on profiles, bills, and races. Your tracked list lives behind this button.',
      },
      {
        route: '/',
        target: 'tracked-modal',
        action: 'open-tracked',
        title: 'Your tracked window',
        body: 'Here’s the real window (we just opened it). Tracked bills alert you when their status changes; tracked officials feed your notifications when they post. With an account, your tracked list syncs across devices, and the dashboard’s “Followed” spotlights let you pin one favorite per category.',
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: 'nav-bell',
        action: 'close-tracked',
        title: 'The notification bell',
        body: 'The bell collects your in-app alerts: status changes on tracked bills, new posts from officials you track, replies, and moderation notices — across every identity you’re signed in as. With an account you can also opt into a weekly email digest of your tracked officials’ activity (off by default; your inbox is safe).',
      },
    ],
  },
  {
    id: 'polls',
    title: 'Polls & Posts',
    tier: 'browse',
    steps: [
      {
        route: '/polls',
        target: 'polls-page',
        title: 'The global Polls feed',
        body: 'This is the app-wide polls feed — every active poll from rep pages, candidate pages, and citizen-created standalone polls, in one place. Filter by state, by branch, or use the AI filter to find polls about a topic in your own words.',
      },
      {
        route: '/polls',
        target: 'polls-page',
        title: 'Posts, comments & results',
        body: 'The Posts tab is the same feed for posts. On any card you can open the comment thread, see live poll results, and — on polls with demographic forms attached — explore aggregate result breakdowns (always anonymized, never individual answers). Engagement needs an account; browsing doesn’t.',
      },
    ],
  },
  {
    id: 'bills',
    title: 'Floor Bills',
    tier: 'browse',
    steps: [
      {
        route: '/bills',
        target: 'bills-page',
        title: 'Bills & Votes — the floor record',
        body: 'Floor Bills (in the ☰ menu from anywhere) shows recent roll-call votes in the Senate and House on an interactive seat chart. Pick a chamber and a vote, then click any seat to see that member’s vote and jump to their profile.',
      },
      {
        route: '/bills',
        target: 'bills-page',
        title: 'What did this vote mean?',
        body: 'Every vote carries a tally by party, a link to the bill on Congress.gov, and a plain-English AI explainer: what a Yea meant, what a Nay meant, and what the outcome does. Vote pages are deep-linkable — share a URL straight to a specific roll call.',
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Your dashboard & engagement',
    tier: 'account',
    steps: [
      {
        route: '/',
        // Signed in → spotlight the identity pill; signed out → the
        // login button (first visible anchor wins).
        target: ['nav-identity', 'nav-citizen-login'],
        title: 'Once you’re signed in',
        body: 'With a citizen account, your identity pill appears here in the navbar. It opens your dashboard: your reps at a glance, upcoming elections, recent activity from people you track, your polls, saved items, and account settings (2FA, start-page preference, and more).',
      },
      {
        route: '/',
        target: null,
        title: 'Liking & voting on polls',
        body: 'Signed-in citizens can like or dislike posts and polls and vote on any poll — rep polls, candidate polls, citizen polls. Results update live. At launch these actions will require ID.me verification, so every tally reads as verified constituents; demo accounts can do all of it today.',
      },
      {
        route: '/',
        target: null,
        title: 'Creating polls & commenting',
        body: 'You can also comment on posts and polls and create your own polls — standalone questions on the Polls page, or polls on any unclaimed official page. Optional demographic forms let your poll collect anonymous, aggregate-only breakdowns. At launch this tier will be part of the $5/month subscription; demo accounts have it now.',
      },
      {
        route: '/',
        target: null,
        title: 'One more thing: multiple identities',
        body: 'If you’re ever signed in as more than one identity — say a citizen AND a verified rep or candidate — every like, vote, and comment asks which identity is acting via an “Act as” picker. You always know who’s speaking.',
      },
    ],
  },
  {
    id: 'feedback',
    title: 'Feedback',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: null,
        action: 'open-feedback',
        title: 'Tell us what you think',
        body: 'This is the Feedback page (we just opened it — it’s in the ☰ menu anytime). CivicView is in active development and feedback genuinely shapes what gets built next. Bugs, confusing screens, missing data, feature ideas — all of it is welcome.',
      },
    ],
  },
  {
    id: 'helpbuild',
    title: 'Help build this',
    tier: 'browse',
    steps: [
      {
        route: '/',
        target: null,
        action: 'open-help-build',
        title: 'How CivicView gets built',
        body: 'This is the transparency page: everything already built, what’s in progress, and what’s blocked on funding — with real dollar amounts. CivicView is a Florida Benefit Corporation with no ads and no venture capital; if you want to help it exist, this page shows exactly where support goes.',
      },
      {
        route: '/',
        target: null,
        action: 'close-help-build',
        title: 'That’s the tour!',
        body: 'You’ve seen the whole app. Reopen this tour anytime from the ☰ menu, and jump straight to any topic from the list. Thanks for being here early — go find your reps. 🇺🇸',
      },
    ],
  },
];

// Flat step count across all segments — used for the "Step X of Y"
// overall progress line in the panel footer.
export const TOTAL_STEPS = TUTORIAL_SEGMENTS.reduce((n, s) => n + s.steps.length, 0);

export function getSegment(id) {
  return TUTORIAL_SEGMENTS.find((s) => s.id === id) || null;
}

export function getSegmentIndex(id) {
  return TUTORIAL_SEGMENTS.findIndex((s) => s.id === id);
}
