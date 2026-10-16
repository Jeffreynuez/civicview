// CivicView: guided-tour content.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Single source of truth for the in-app tour ("Take the tour"). The
// TutorialOverlay component renders this config; lib/tutorial.js holds
// the saved position and the event bridge to app/page.js.
//
// STRUCTURE (Jeffrey, 2026-10-15)
// ───────────────────────────────
// QUICK_START: six steps every new visitor gets from the coach mark and
// the menu, then an end card offering "Explore more topics" or "Done".
// TOUR_TOPICS: optional topics picked from a list, at most three steps
// each. Every track counts its own steps ("Step 2 of 6").
//
// COPY RULES
// ──────────
// At most 30 words per step, one idea per step, plain and friendly. No
// em or en dashes, no all-caps emphasis, no emoji. Every sentence must
// be true of the app today: check a claim against the code before
// writing it. The same wording and treatment for every official, party
// and state; demo picks are random, never chosen by party.
//
// STEP SHAPE
// ──────────
//   id        stable string (only used for keys and screenshots).
//   route     pathname the step lives on ('/', '/polls', '/bills').
//             Navigating is a full page load; the position survives in
//             sessionStorage.
//   target    [data-tutorial] anchor to spotlight: a name, an array of
//             fallbacks (first visible wins), null for no spotlight, or
//             a function of the context below.
//   action    bridge action sent to app/page.js on entry (a name, null,
//             or a function of the context). Unknown actions are
//             ignored.
//   demo      true for live demos: the step waits until `waitFor` (the
//             target by default) has rendered, showing "Opening a live
//             example" meanwhile, and shows fallbackTitle/fallbackBody
//             when the demo fails or times out.
//   title / body   strings, or functions of the context.
//   avoid     anchor of a window the desktop card should stay off too
//             (the sign-in window a step opened), when there is room.
//   placement 'center' puts a no-spotlight card mid-screen on desktop;
//             the default is a corner, so it never covers full-screen
//             content.
//   video     true on the Welcome card: renders the overview button
//             when TOUR_VIDEO_URL is set.
//
// CONTEXT passed to the functions: { compact, signedIn, result }.
//   compact   the navbar is collapsed into the menu (1024px or less).
//   signedIn  a citizen account is signed in.
//   result    what the demo action reported (names, the state opened).

// Bumped when saved positions from an older tour must be discarded
// (v1 was the 36-step tour).
export const TOUR_VERSION = 2;

// A "Watch a 2-minute overview" button appears on the Welcome card
// while this is set. The video comes later; leave it empty until then.
export const TOUR_VIDEO_URL = '';

// The random demo picks require a non-empty profile: detail with a bio
// and committees, plus sponsored bills. Recent votes are required too
// only when this is true. It was false while the GovTrack member-votes
// feed returned nothing; votes now come from the stored official roll
// calls (2026-10-16), so it is on again.
export const TOUR_REQUIRE_VOTES = true;

const tapOrClick = (ctx) => (ctx.compact ? 'Tap' : 'Click');

export const QUICK_START = {
  id: 'quick-start',
  title: 'Quick start',
  steps: [
    {
      id: 'qs-welcome',
      route: '/',
      target: null,
      placement: 'center',
      video: true,
      title: 'Welcome to CivicView',
      body: 'CivicView is a non-partisan way to follow your elected officials. Browsing is free, with no account. You can close this tour anytime and reopen it from the menu.',
    },
    {
      id: 'qs-find',
      route: '/',
      // The address lookup only shows on the national view.
      action: 'tour-national',
      // Phones: just the address field, which fits between the map and
      // the sheet; the whole lookup box does not.
      target: ({ compact }) => (compact ? ['address-lookup-field', 'address-lookup'] : 'address-lookup'),
      title: 'Find your representatives',
      body: 'Enter your address to see who represents you in Congress, or pick any state on the map to browse its officials.',
    },
    {
      id: 'qs-profile',
      route: '/',
      action: 'demo-open-profile',
      demo: true,
      target: 'profile-tabs',
      title: 'A real profile',
      body: ({ result }) => `We opened ${result.name}'s profile, picked at random. These tabs hold their background, issues, committees, sponsored bills and contact details, drawn from public records.`,
      fallbackTitle: 'Profiles',
      fallbackBody: 'Select any person in the list to open their profile: their background, issues, committees, sponsored bills and contact details, drawn from public records.',
    },
    {
      id: 'qs-page',
      route: '/',
      action: 'demo-open-page',
      demo: true,
      target: 'page-tabs',
      title: 'Every official has a page',
      body: ({ result }) => `This is ${result.name}'s page. When an official claims their page, they post updates, polls and events here. Until then, citizens can start polls about the office.`,
      fallbackBody: 'Officials and candidates each have a page. Once claimed, they post updates, polls and events there. Until then, citizens can start polls about the office.',
    },
    {
      id: 'qs-polls',
      route: '/',
      action: 'close-demos',
      target: ({ compact }) => (compact ? 'nav-hamburger' : 'nav-polls'),
      title: 'Polls',
      body: ({ compact }) => (compact
        ? 'The Polls page gathers polls from officials, candidates and citizens in one feed. Open it anytime from Polls in this menu.'
        : 'The Polls page gathers polls from officials, candidates and citizens in one feed. Open it anytime with the Polls button.'),
    },
    {
      id: 'qs-account',
      route: '/',
      action: ({ signedIn }) => (signedIn ? 'close-demos' : 'open-citizen-login'),
      target: ({ signedIn }) => (signedIn ? 'nav-identity' : ['citizen-demo-toggle', 'citizen-login-modal']),
      avoid: 'citizen-login-modal',
      title: 'Try everything with a demo account',
      body: ({ signedIn }) => (signedIn
        ? "You're signed in, and this menu opens your dashboard. At launch, ID.me verification unlocks liking, voting and commenting, and $5 a month adds starting polls."
        : 'Browsing needs no account. A free demo account unlocks everything today. At launch, ID.me verification unlocks liking, voting and commenting, and $5 a month adds starting polls.'),
    },
  ],
};

// Shown after the last quick-start step. No step count.
export const QUICK_START_END = {
  action: 'close-citizen-login',
  title: "You're all set",
  body: "That's the quick start. Pick a topic to learn more, or close the tour and explore. Reopen it anytime from the menu.",
};

export const TOUR_TOPICS = [
  {
    id: 'map',
    title: 'The map and search',
    steps: [
      {
        id: 'map-map',
        route: '/',
        action: 'show-map',
        target: 'map',
        title: 'The map',
        body: (ctx) => `${tapOrClick(ctx)} a state to load its officials, then a district to see that seat's representative and the state's senators. ${tapOrClick(ctx)} outside the U.S. to return to the national view.`,
      },
      {
        id: 'map-divider',
        route: '/',
        target: 'map-divider',
        title: 'Make room',
        body: ({ compact }) => (compact
          ? 'Double-tap or slide the Map bar to hide the map and give the list the whole screen. Do it again to bring the map back.'
          : 'Drag the Map bar to make the panel wider, up to half the screen.'),
      },
      {
        id: 'map-search',
        route: '/',
        target: 'nav-search',
        title: 'Search',
        body: ({ compact }) => (compact
          ? 'Tap the search icon to find members of Congress and candidates by name or state.'
          : 'Search members of Congress and candidates by name or state. Press / to jump to the search box.'),
      },
    ],
  },
  {
    id: 'state',
    title: 'State officials and courts',
    steps: [
      {
        id: 'state-tab',
        route: '/',
        action: 'demo-open-state-tab',
        demo: true,
        target: 'panel-tab-state',
        waitFor: 'state-legislature',
        title: ({ result }) => `${result.stateName} government`,
        body: ({ result }) => `We opened the State tab for ${result.stateName}. It lists the governor, statewide officials and every state legislator.`,
        fallbackTitle: 'State government',
        fallbackBody: "Pick a state on the map, then open its State tab. It lists the governor, statewide officials and every state legislator.",
      },
      {
        id: 'state-legislature',
        route: '/',
        target: 'state-legislature',
        title: 'State legislators',
        body: 'Open a chamber and select any legislator for their profile, with the bills they sponsored from Open States and the issues they focus on.',
      },
      {
        id: 'state-courts',
        route: '/',
        target: 'state-courts',
        title: 'State courts',
        body: 'Court rosters cover Florida so far: its Supreme Court justices and District Courts of Appeal appear at the end of its State tab.',
      },
    ],
  },
  {
    id: 'elections',
    title: 'Elections and your ballot',
    steps: [
      {
        id: 'elections-tab',
        route: '/',
        action: 'demo-open-elections',
        demo: true,
        target: 'election-card',
        title: ({ result }) => `Elections in ${result.stateName}`,
        body: ({ result }) => {
          const tail = 'Each election shows its key dates, its races and the candidates in each race.';
          if (result.reason === 'no-data') return `Election data for ${result.selectedName} isn't in yet, so we opened ${result.stateName}. ${tail}`;
          if (result.reason === 'none') return `We opened ${result.stateName} as an example. ${tail}`;
          return `We opened the Elections tab for ${result.stateName}. ${tail}`;
        },
        fallbackTitle: 'Elections',
        fallbackBody: "Pick a state, then open its Elections tab. Each election shows its key dates, its races and the candidates in each race.",
      },
      {
        id: 'elections-race',
        route: '/',
        target: 'race-card',
        title: 'Races and candidates',
        body: "Open a race to see its candidates. Select a candidate for their profile, including fundraising when it's on file.",
      },
      {
        id: 'elections-ballot',
        route: '/',
        target: ['ballot-mode', 'panel-tab-ballot'],
        title: 'Your ballot',
        body: 'After you look up your address or pick a district on the map, this tab adds Your Ballot: only the races for that place.',
      },
    ],
  },
  {
    id: 'compare',
    title: 'Comparing',
    steps: [
      {
        id: 'compare-button',
        route: '/',
        action: 'tour-lists',
        target: 'compare-button',
        title: 'Compare',
        body: 'Use the compare button on any official or candidate to add them, up to three. A tray at the bottom collects your picks.',
      },
      {
        id: 'compare-view',
        route: '/',
        action: 'demo-compare',
        demo: true,
        target: 'compare-view',
        title: 'Side by side',
        body: ({ result }) => `We compared ${result.names[0]} and ${result.names[1]}, picked at random. You see their issue stances, experience and recent sponsored bills side by side.`,
        fallbackBody: 'Add two or more people and open the tray to see their issue stances, experience and recent sponsored bills side by side.',
      },
    ],
  },
  {
    id: 'pages',
    title: "Official and former officials' pages",
    steps: [
      {
        id: 'pages-claim',
        route: '/',
        action: 'demo-open-page',
        demo: true,
        target: 'page-claim-status',
        title: 'Claimed or not',
        body: 'This line shows whether the official has claimed their page. Once they do, they post updates, polls and events here.',
        fallbackBody: 'Each page shows whether the official has claimed it. Once they do, they post updates, polls and events there.',
      },
      {
        id: 'pages-citizen-polls',
        route: '/',
        target: 'page-citizen-polls',
        title: 'Citizen polls',
        body: 'On an unclaimed page, citizens can start polls about the office. If the official claims the page, those polls close to new votes and keep their results.',
      },
      {
        id: 'pages-former',
        route: '/',
        target: null,
        title: 'When an official leaves office',
        body: "Their page becomes Former, with their years of service. It stays readable, citizens can still comment, and six months later it's archived. Nothing is deleted.",
      },
    ],
  },
  {
    id: 'tracked',
    title: 'My Tracked',
    steps: [
      {
        id: 'tracked-button',
        route: '/',
        action: 'close-demos',
        target: ({ compact }) => (compact ? 'nav-hamburger' : 'nav-tracked'),
        title: 'My Tracked',
        body: ({ compact }) => (compact
          ? 'Use Follow or Track on officials, candidates, bills and elections, and they gather in My Tracked, in this menu. Saving them needs a free account.'
          : 'Use Follow or Track on officials, candidates, bills and elections, and they gather in My Tracked. Saving them needs a free account.'),
      },
      {
        id: 'tracked-window',
        route: '/',
        action: 'open-tracked',
        target: ['tracked-dashboard-link', 'tracked-modal'],
        avoid: 'tracked-modal',
        title: 'Your tracked window',
        body: 'Filter what you track here. Open your dashboard to star one favorite in each group for your Overview.',
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    steps: [
      {
        id: 'notifications-bell',
        route: '/',
        action: 'close-windows',
        target: 'nav-bell',
        title: 'Notifications',
        body: 'The bell collects replies to your comments, election reminders, and new posts, polls and events from officials you track.',
      },
      {
        id: 'notifications-election-reminders',
        route: '/',
        target: 'nav-bell',
        title: 'Election reminders',
        body: 'Where we have official dates for your state, or for an election you track, the bell reminds you of voting deadlines and Election Day. Turn them off anytime.',
      },
      {
        id: 'notifications-channels',
        route: '/',
        target: null,
        title: 'Push and email',
        body: 'Push alerts for officials you track and election reminders work in the CivicView Android app. Email digests arrive at launch.',
      },
    ],
  },
  {
    id: 'feeds',
    title: 'The Polls and Posts feeds',
    steps: [
      {
        id: 'feeds-filters',
        route: '/polls',
        target: 'polls-filters',
        title: 'Filter the feed',
        body: 'Narrow the feed by where polls come from: Congress, the executive branch, the courts, candidates or standalone citizen polls.',
      },
      {
        id: 'feeds-card',
        route: '/polls',
        target: 'feed-card',
        title: 'Vote and discuss',
        body: 'Vote right on a card, explore the results and open the comments. Browsing is free; voting and commenting need an account.',
      },
      {
        id: 'feeds-posts',
        route: '/polls',
        target: 'feed-tabs',
        title: 'Posts',
        body: 'Switch to Posts for updates from officials and candidates who have claimed their pages, all in one feed.',
      },
    ],
  },
  {
    id: 'bills',
    title: 'Floor Bills',
    steps: [
      {
        id: 'bills-controls',
        route: '/bills',
        target: 'bills-controls',
        title: 'Pick a vote',
        body: 'Choose the Senate or the House, then any of the 50 most recent roll-call votes.',
      },
      {
        id: 'bills-chart',
        route: '/bills',
        target: 'bills-chart',
        title: 'Every seat is a member',
        body: (ctx) => `Each seat is one member. ${tapOrClick(ctx)} a seat to see how they voted and open their profile.`,
      },
      {
        id: 'bills-explainer',
        route: '/bills',
        target: 'bills-explainer',
        title: 'What did this vote mean?',
        body: 'Open this for a plain-English guide to what a Yea, a Nay and the outcome meant, plus an optional AI explanation.',
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Your dashboard and the "Act as" picker',
    steps: [
      {
        id: 'dashboard-open',
        route: '/',
        action: 'close-demos',
        target: ({ signedIn }) => (signedIn ? 'nav-identity' : 'nav-citizen-login'),
        title: 'Your dashboard',
        body: ({ signedIn }) => (signedIn
          ? 'Open your dashboard from this menu: the people you follow, your polls, saved items, and settings like your start page.'
          : 'Sign in here, then open your dashboard from the same spot: the people you follow, your polls, saved items, and settings like your start page.'),
      },
      {
        id: 'dashboard-act-as',
        route: '/',
        target: null,
        title: 'The Act as picker',
        body: 'Signed in as a citizen and also as an official or candidate? Each like and vote asks which account is acting, and comments show a Posting as choice.',
      },
    ],
  },
  {
    id: 'feedback',
    title: 'Feedback and Help build this',
    steps: [
      {
        id: 'feedback-form',
        route: '/',
        action: 'open-feedback',
        target: ['feedback-embed', 'feedback-form'],
        title: 'Send feedback',
        body: 'Spotted a bug, a missing feature or wrong information? Tell us here. Every submission is read.',
      },
      {
        id: 'feedback-helpbuild',
        route: '/',
        action: 'open-help-build',
        target: ['helpbuild-meter', 'helpbuild-content'],
        title: 'Help build this',
        body: "See what's built, what's in progress and what's blocked on funding, with every cost cited. An Indiegogo crowdfund is planned for January 2027.",
      },
    ],
  },
];

export const ALL_TRACKS = [QUICK_START, ...TOUR_TOPICS];

export function getTrack(id) {
  return ALL_TRACKS.find((t) => t.id === id) || null;
}

// Resolve a step field that may be a function of the context.
export function resolveField(value, ctx) {
  return typeof value === 'function' ? value(ctx) : value;
}
