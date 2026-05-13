'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchElections, fetchFederalOfficials } from '@/lib/api';
import { fetchNationalActivity, fetchPopularPolls } from '@/lib/pagesApi';
import { STATE_NAME_TO_CODE } from '@/lib/constants';
import SelectionBadge from './SelectionBadge';
import FollowButton from './FollowButton';
import CompareButton from './CompareButton';
import PageButton from './PageButton';
import {
  Avatar,
  PartyChip,
  Eyebrow,
  Skeleton,
  EmptyState,
  ArrowRight,
  Building,
  CheckCircle,
} from './ui';
import CivicLensLogo from './brand/CivicLensLogo';

// ─────────────────────────────────────────────────────────────────
// usePersistentToggle — localStorage-backed boolean state.
//
// SSR-safe: the first render (server + initial client) returns the
// caller's default. On mount we read localStorage and update if a
// stored value exists. Toggling writes the new value back so it
// survives reloads. Used by every collapsible section on this surface
// so a user who collapses Senate (or expands Browse-by-state) doesn't
// have to do it again next visit.
// ─────────────────────────────────────────────────────────────────
function usePersistentToggle(key, defaultOpen) {
  const [value, setValue] = useState(defaultOpen);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === '1') setValue(true);
      else if (stored === '0') setValue(false);
    } catch {
      // localStorage can throw in private-mode Safari; fall back to
      // in-memory state silently.
    }
  }, [key]);
  const toggle = useCallback(() => {
    setValue((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* see above */
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}

// ─────────────────────────────────────────────────────────────────
// Color tables — resolve through the canonical --cl-* tokens. Soft
// tints back the chips (per design system "party fills are pill-only");
// the solid variants are for chip text and the small avatar hue dots.
// ─────────────────────────────────────────────────────────────────
const PARTY_COLORS = {
  R: 'var(--cl-republican)',
  D: 'var(--cl-democrat)',
  I: 'var(--cl-independent)',
};
const PARTY_SOFT = {
  R: 'var(--cl-republican-soft)',
  D: 'var(--cl-democrat-soft)',
  I: 'var(--cl-independent-soft)',
};

/**
 * NationalOfficialsPanel — landing surface for unauthenticated visitors.
 *
 * Phase 3D structural rewrite: replaces the prior tabs-based layout
 * (Executive / Judicial / Congress / Elections) with the locked-in
 * scrolling landing page from Claude Design. Sections render top-to-
 * bottom in priority order:
 *
 *   1. Hero — headline + subhead + verify-address CTA + stats bar
 *   2. Executive Branch — President + VP big cards, Cabinet grid
 *   3. Senate Leadership — tiered cards (floor + whips)
 *   4. House Leadership — tiered cards (floor + whips/caucus)
 *   5. Supreme Court — 9-justice grid
 *   6. Verification CTA strip — "Make this your own."
 *   7. Footer — BROWSE / CITIZEN / ABOUT + non-endorsement disclaimer
 *
 * Data wiring is unchanged from the prior implementation: same call
 * to /api/federal-officials, same shape (executive / judiciary /
 * congress). The Elections tab is intentionally dropped — citizens
 * see their ballot in the BallotTab; surfacing it here inflates the
 * political-content density on what should be a neutral landing.
 *
 * Props are unchanged from the prior implementation.
 */
export default function NationalOfficialsPanel({
  onSelectPerson,
  onNotify,
  onCompareToggle,
  compareIds,
  // Opens the rep's page (post feed / dashboard) when a visitor clicks
  // the "Page" button on a card. Wired from page.js → handleOpenPage.
  onOpenPage,
  // New: opens the citizen-login modal when a visitor hits the
  // hero / CTA-strip "Find my reps" buttons. Optional — falls back
  // to onNotify if not provided.
  onRequestVerify,
  // Browse-by-state grid hands off to the parent's state-selection
  // handler. Wired through SidePanel → page.js's handleStateSelect
  // (a no-op if missing — grid still renders, clicks are inert).
  onStatePick,
  // Click on a candidate card in the On-the-ballot section opens the
  // candidate profile. Wired through SidePanel → page.js's
  // handleCandidateSelect.
  onCandidatePick,
  // Currently signed-in citizen (or null if anonymous). Used by the
  // National Activity section to swap "Sign in to participate" CTAs for
  // a "View thread" affordance once the visitor is authenticated, and
  // by the On-the-ballot section to determine which state's race to
  // surface.
  citizen,
  // Footer Citizen-column wires. Both opt-in: if missing, the link is
  // rendered as inactive (no cursor + muted color).
  //   onOpenTracked - opens the My Tracked modal (mirrors the navbar
  //                   "My Tracked" button + the in-footer "Notifications"
  //                   link, which routes to the same modal because that's
  //                   where per-item notification prefs live today).
  //   onSubscribe   - opens the citizen-waitlist / Subscribe modal
  //                   (mirrors the navbar Subscribe button).
  onOpenTracked,
  onSubscribe,
}) {
  // Refs for footer Browse-column scroll-to-section links. Each section
  // renders inside a wrapper div with one of these refs attached, so the
  // footer handlers can call scrollIntoView without any global IDs.
  const executiveRef = useRef(null);
  const senateRef = useRef(null);
  const houseRef = useRef(null);
  const browseRef = useRef(null);

  const scrollToRef = (ref) => {
    if (ref?.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchFederalOfficials();
        if (cancelled) return;
        setData(res?.data || null);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerifyClick = () => {
    if (onRequestVerify) onRequestVerify();
    else if (onNotify) onNotify('Verification flow coming soon — sign in as a citizen for the demo preview.');
  };

  if (loading) {
    // The Hero is data-independent (stats are static numbers), so we can
    // render it immediately even while the federal-officials API is in
    // flight. Below it we render section-shaped skeletons that match the
    // alternating bg-soft / bg-card striping of the real page so the
    // loaded state slots in without a layout shift.
    return (
      <div style={{ fontFamily: 'var(--cl-font-sans)' }}>
        <Hero onVerifyClick={handleVerifyClick} />
        <SectionSkeleton eyebrow="Article II" title="Executive Branch" cardCount={6} bg="card" />
        <SectionSkeleton eyebrow="Article I · Section 3" title="Senate Leadership" cardCount={4} bg="soft" />
        <SectionSkeleton eyebrow="Article I · Section 2" title="House Leadership" cardCount={4} bg="card" />
        <SectionSkeleton eyebrow="Article III" title="Supreme Court of the United States" cardCount={9} bg="soft" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<Building size={36} active color="muted" />}
        headline="Federal data unavailable"
        body="Start the API to load President, Cabinet, Supreme Court, and Congress leadership."
        tone="muted"
      />
    );
  }

  const exec = data.executive || {};
  const congress = data.congress || {};
  const judiciary = data.judiciary || {};

  return (
    <div style={{ fontFamily: 'var(--cl-font-sans)' }}>
      <Hero onVerifyClick={handleVerifyClick} />

      <OnTheBallotSection
        citizen={citizen}
        onCandidatePick={onCandidatePick}
        onRequestVerify={handleVerifyClick}
        onStatePick={onStatePick}
      />

      <div ref={executiveRef}>
        <ExecutiveBranchSection
          exec={exec}
          onSelectPerson={onSelectPerson}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
          onOpenPage={onOpenPage}
        />
      </div>

      <div ref={senateRef}>
        <SenateLeadershipSection
          senate={congress.senate || {}}
          congressNumber={congress.congress_number}
          onSelectPerson={onSelectPerson}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
          onOpenPage={onOpenPage}
        />
      </div>

      <div ref={houseRef}>
        <HouseLeadershipSection
          house={congress.house || {}}
          congressNumber={congress.congress_number}
          onSelectPerson={onSelectPerson}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
          onOpenPage={onOpenPage}
        />
      </div>

      <SCOTUSSection
        sc={judiciary.supreme_court || {}}
        onSelectPerson={onSelectPerson}
        onNotify={onNotify}
        onCompareToggle={onCompareToggle}
        compareIds={compareIds}
        onOpenPage={onOpenPage}
      />

      <NationalActivitySection
        onRequestVerify={handleVerifyClick}
        citizen={citizen}
      />

      <PopularPollsSection
        onRequestVerify={handleVerifyClick}
        citizen={citizen}
      />

      <div ref={browseRef}>
        <BrowseByStateSection onStatePick={onStatePick} />
      </div>

      <VerificationCTAStrip onVerifyClick={handleVerifyClick} />

      <Footer
        onJumpExecutive={() => scrollToRef(executiveRef)}
        onJumpSenate={() => scrollToRef(senateRef)}
        onJumpHouse={() => scrollToRef(houseRef)}
        onJumpBrowse={() => scrollToRef(browseRef)}
        onVerify={handleVerifyClick}
        onOpenTracked={onOpenTracked}
        onSubscribe={onSubscribe}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 1. HERO
// ─────────────────────────────────────────────────────────────────
function Hero({ onVerifyClick }) {
  // Stats are demo placeholders — production should pull live counts
  // from /api/all-members + a verified-citizens count from the citizen
  // auth backend. Hardcoding here so the hero feels populated even when
  // the backend is offline.
  //
  // "States covered" was dropped (50 is implicit for any US-civic app);
  // replaced with chamber + SCOTUS counts that give the visitor a
  // meaningful sense of the surface area covered. "Reps joined" is a
  // fake CivicLens-side stat (officials with a claimed Page on the
  // platform) — same scaffolding pattern as "Verified citizens".
  const STATS = [
    { value: '100',   label: 'Senators' },
    { value: '435',   label: 'Representatives' },
    { value: '9',     label: 'SCOTUS Justices' },
    { value: '47',    label: 'Reps joined' },
    { value: '12.4k', label: 'Verified citizens' },
  ];

  // CivicLens Stats dropdown — starts collapsed per design feedback.
  // The numbers are a "nice to have" peek; collapsing them by default
  // moves the verify-address CTA closer to the fold and reduces
  // first-paint cognitive load. Persisted so a user who opens it once
  // doesn't have to re-open it on every reload.
  const [statsOpen, toggleStats] = usePersistentToggle('cl:nop:stats', false);

  // Container-width-aware layout. NOP renders inside the resizable
  // SidePanel, which can be anywhere from ~300px to full-viewport. When
  // narrow we drop to single column and hide the hero visual; the lens-
  // and-flag mark is decorative, not load-bearing, so hiding it at small
  // widths is fine.
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout: visual appears once the container has room for a SMALL
  // brand mark (~80px), then scales smoothly up to its full 280px as
  // the panel widens. This avoids the previous "pop in at full size"
  // jump — instead the visual fades in small and grows gradually.
  //
  //   < 540  : single column, no visual (panel too narrow for any
  //            two-column hero)
  //   540    : visual pops in at 80px (small, lands cleanly to the
  //            right of the text)
  //   540 → 1040 : linear scale 80 → 280
  //   ≥ 1040 : visual at full 280px
  const showVisual = containerWidth >= 540;
  const visualSize = showVisual
    ? Math.min(280, 80 + ((containerWidth - 540) / 500) * 200)
    : 0;

  return (
    <section
      ref={containerRef}
      style={{
        // Top padding trimmed (was 40) since AddressLookup sits directly
        // above this and the stacked padding burned ~70px of whitespace
        // between the "Use my location" pill and the "National officials
        // · 119th Congress" eyebrow. 20 keeps a clean visual break
        // without the air gap.
        padding: '20px 24px 32px',
        background: 'var(--cl-card)',
        borderBottom: '1px solid var(--cl-border)',
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: showVisual ? 'minmax(0, 1.4fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: 32,
          alignItems: 'center',
        }}
      >
        <div>
          <Eyebrow>National officials · 119th Congress</Eyebrow>
          <h1
            className="cl-h1"
            style={{
              margin: '8px 0 12px',
              fontSize: 'var(--cl-text-3xl)',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: 'var(--cl-tracking-tight)',
            }}
          >
            The people in{' '}
            <span
              style={{
                background: 'var(--cl-warning-soft)',
                padding: '0 6px',
                borderRadius: 'var(--cl-radius-xs)',
              }}
            >
              your federal government,
            </span>{' '}
            in one place.
          </h1>
          <p
            className="cl-body"
            style={{
              color: 'var(--cl-text-light)',
              maxWidth: 540,
              margin: '0 0 20px',
              lineHeight: 'var(--cl-leading-normal)',
            }}
          >
            Browse the President, Vice President, Cabinet, Senate, House, and
            your own state&rsquo;s delegation. Verify your address to follow
            your reps and respond to what they say — in your district.
          </p>

          <button
            type="button"
            onClick={onVerifyClick}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 44,
              padding: '0 18px',
              background: 'var(--cl-accent)',
              color: 'var(--cl-text-on-dark)',
              border: 'none',
              borderRadius: 'var(--cl-radius-md)',
              fontSize: 'var(--cl-text-md)',
              fontWeight: 700,
              fontFamily: 'var(--cl-font-sans)',
              cursor: 'pointer',
              boxShadow: 'var(--cl-shadow-sticky)',
              transition: 'background var(--cl-duration-fast) var(--cl-ease-standard)',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--cl-accent-light)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'var(--cl-accent)'; }}
          >
            Find my reps
            <ArrowRight size={14} active color="onDark" />
          </button>
          <div
            style={{
              marginTop: 8,
              fontSize: 'var(--cl-text-2xs)',
              color: 'var(--cl-text-muted)',
            }}
          >
            Address used to match your district. Never shared, never sold.
          </div>

          {/* CivicLens Stats — wrapped in a collapsible so the hero CTA
              ("Find my reps") sits closer to the fold on first paint.
              The numbers are interesting context but not load-bearing
              for someone landing here for the first time, so we hide
              them behind a chevron header that the user can expand
              when they want to peek. */}
          <div
            style={{
              marginTop: 28,
              paddingTop: 20,
              borderTop: '1px solid var(--cl-border)',
            }}
          >
            <button
              type="button"
              onClick={toggleStats}
              aria-expanded={statsOpen}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: 'var(--cl-font-sans)',
              }}
            >
              <Chevron open={statsOpen} />
              <span
                style={{
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--cl-tracking-wider)',
                  fontSize: 'var(--cl-text-2xs)',
                  fontWeight: 800,
                  color: 'var(--cl-text-light)',
                }}
              >
                CivicView Stats
              </span>
            </button>
            {statsOpen && (
              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  gap: 32,
                  flexWrap: 'wrap',
                }}
              >
                {STATS.map((s) => (
                  <div key={s.label}>
                    <div
                      className="cl-num"
                      style={{
                        fontSize: 'var(--cl-text-2xl)',
                        fontWeight: 800,
                        color: 'var(--cl-text)',
                        lineHeight: 1.1,
                      }}
                    >
                      {s.value}
                    </div>
                    <div
                      className="cl-eyebrow"
                      style={{ marginTop: 2 }}
                    >
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hero visual — magnify-lens-flag mark on a navy tinted plate.
            Below 540px container width, the visual is hidden and the
            hero collapses to single column. Above 540px, the visual
            renders at a size proportional to container width (80px
            minimum, 280px capped). The plate's padding scales with
            the logo size so it always frames the mark consistently.
            CSS transitions on width/height/padding give a smooth
            grow effect when the user resizes the panel. */}
        {showVisual && (
          <div
            style={{
              background: 'var(--cl-primary)',
              borderRadius: 'var(--cl-radius-2xl)',
              padding: Math.max(12, visualSize * 0.1),
              aspectRatio: '1 / 1',
              maxWidth: 360,
              width: '100%',
              justifySelf: 'end',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'padding var(--cl-duration-base) var(--cl-ease-standard)',
            }}
            aria-hidden="true"
          >
            <CivicLensLogo
              size={visualSize}
              variant="reverse"
              style={{
                transition: 'width var(--cl-duration-base) var(--cl-ease-standard), height var(--cl-duration-base) var(--cl-ease-standard)',
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 1.5 ON THE BALLOT — Election center + featured state race.
//
// Two stacked blocks:
//   A. Election center — text-only "It's election season" overview
//      with key 2026 dates. State-specific dates if we have data
//      for the citizen's state, federal-cycle fallback otherwise.
//   B. Featured race — pulls the citizen's state's headline race
//      (governor or first state-level race) and renders 6 candidate
//      cards. Empty state for unseeded states; verify-address CTA
//      for anonymous visitors.
//
// Lives between the Hero (CivicView Stats) and the Executive Branch
// section per spec — elections is a primary product feature and
// belongs above the institutional stack on first paint.
// ─────────────────────────────────────────────────────────────────

// Format a YYYY-MM-DD string as "Aug 18, 2026" for human display.
// Handles invalid input gracefully — returns the raw string back.
function formatBallotDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`); // noon to dodge timezone-fencepost
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Reverse the STATE_NAME_TO_CODE map so we can resolve "Florida" from "FL".
function stateNameFor(code) {
  if (!code) return '';
  const upper = code.toUpperCase();
  const entry = Object.entries(STATE_NAME_TO_CODE).find(([, c]) => c === upper);
  return entry ? entry[0] : upper;
}

function OnTheBallotSection({ citizen, onCandidatePick, onRequestVerify, onStatePick }) {
  const stateCode = citizen?.state ? citizen.state.toUpperCase() : null;
  const stateName = stateNameFor(stateCode);

  const [open, toggleOpen] = usePersistentToggle('cl:nop:ballot', true);

  // Single fetch keyed off the citizen's state. The backend's
  // /api/elections/{state} endpoint already EXPANDS candidate IDs
  // into full candidate records inside each race's
  // primary_candidates and general_candidates fields, so the
  // frontend doesn't need a second pass to resolve the references.
  // (Earlier attempt did a second fetchAllCandidates() + Map
  // lookup; that was a no-op because the IDs had already been
  // swapped for objects, so every lookup returned undefined and
  // the empty state always rendered.)
  const [elections, setElections] = useState(null);
  const [electionsLoading, setElectionsLoading] = useState(false);

  useEffect(() => {
    if (!stateCode) {
      setElections(null);
      return;
    }
    let cancelled = false;
    setElectionsLoading(true);
    fetchElections(stateCode).then((elec) => {
      if (cancelled) return;
      setElections(elec?.data || null);
      setElectionsLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setElections(null);
      setElectionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [stateCode]);

  // Pick the headline race. Preference order: open seat governor →
  // any state-level executive seat → first race overall. The 2026 FL
  // demo data has Governor as the marquee, which falls cleanly out
  // of these rules.
  const headlineRace = useMemo(() => {
    if (!elections?.races?.length) return null;
    const byOffice = elections.races.find((r) => /governor/i.test(r.office || ''));
    if (byOffice) return byOffice;
    const stateExec = elections.races.find(
      (r) => r.level === 'state' && r.seat_type === 'executive'
    );
    return stateExec || elections.races[0];
  }, [elections]);

  // The /api/elections endpoint already expands candidate IDs into full
  // candidate records server-side (see elections_service._resolve_race),
  // so we can iterate the arrays directly. Cap at 6 cards for the
  // home-page surface (full ballot lives in the side-panel BallotTab
  // once a state is selected).
  //
  // We deliberately do NOT preserve the R → D → I → general order from
  // the source JSON — that biased the 6-card preview toward whichever
  // pool happened to come first (in FL's case, the 8-strong R primary
  // pushed every other party off the home page). Instead we pool
  // everything together, dedupe, and Fisher-Yates shuffle so each
  // visit surfaces a different mix across parties (Rs, Ds, Is, NPAs,
  // and general-election candidates). `shuffleTick` is a state
  // variable we bump on a 12s interval below to keep the cards
  // rotating while the user lingers on the page.
  const [shuffleTick, setShuffleTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setShuffleTick((t) => t + 1), 12000);
    return () => clearInterval(id);
  }, []);
  // Two memos here: one for the deduped pool (drives the "X of N total"
  // caption — independent of shuffle, so the number is stable), one
  // for the visible 6 (depends on shuffleTick so the cards rotate).
  // Splitting them avoids a re-render of the count every 12 seconds.
  const featuredPool = useMemo(() => {
    if (!headlineRace) return [];
    const all = [
      ...(headlineRace.primary_candidates?.R || []),
      ...(headlineRace.primary_candidates?.D || []),
      ...(headlineRace.primary_candidates?.I || []),
      ...(headlineRace.general_candidates || []),
    ];
    const seen = new Set();
    const unique = [];
    for (const c of all) {
      if (!c || !c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push(c);
    }
    return unique;
  }, [headlineRace]);

  const featuredCandidates = useMemo(() => {
    if (featuredPool.length === 0) return [];
    // Fisher-Yates on a copy so we don't mutate the upstream array.
    const shuffled = featuredPool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, 6);
    // shuffleTick is intentionally a dep — bumping it on the interval
    // re-runs this useMemo and reshuffles the visible 6.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredPool, shuffleTick]);

  return (
    <section style={{ padding: '32px 24px 16px', background: 'var(--cl-bg-soft)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="2026 cycle"
          title="On the ballot"
          subhead="Key dates and candidates running in your district."
          chip={null}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          <>
            {/* A. Election center — text-only "what's happening" block. */}
            <ElectionCenter elections={elections} stateCode={stateCode} stateName={stateName} />

            {/* B. Featured race — state's headline race. */}
            <div style={{ marginTop: 20 }}>
              <SubsectionLabel>Race in focus</SubsectionLabel>

              {/* Anonymous: prompt for address verification. */}
              {!stateCode && (
                <FeaturedRaceVerifyPrompt onRequestVerify={onRequestVerify} />
              )}

              {/* Logged-in citizen: load + render race or empty state. */}
              {stateCode && electionsLoading && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 10,
                  }}
                >
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'var(--cl-card)',
                        border: '1px solid var(--cl-border)',
                        borderRadius: 'var(--cl-radius-xl)',
                        padding: 12,
                      }}
                    >
                      <Skeleton variant="card" />
                    </div>
                  ))}
                </div>
              )}

              {stateCode && !electionsLoading && (!headlineRace || featuredCandidates.length === 0) && (
                <FeaturedRaceEmpty stateName={stateName} />
              )}

              {stateCode && !electionsLoading && headlineRace && featuredCandidates.length > 0 && (
                <FeaturedRaceCards
                  race={headlineRace}
                  candidates={featuredCandidates}
                  totalCount={featuredPool.length}
                  onCandidatePick={onCandidatePick}
                  stateCode={stateCode}
                  stateName={stateName}
                  onStatePick={onStatePick}
                />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// Election-center sub-block — text-only "It's election season" with
// 4 key dates. Uses state-specific dates if present, falls back to
// just the federal general-election date when not.
function ElectionCenter({ elections, stateCode, stateName }) {
  const k = elections?.key_dates || null;
  const dates = [
    k?.primary && { label: 'Primary', value: formatBallotDate(k.primary) },
    k?.general && { label: 'General', value: formatBallotDate(k.general) },
    k?.voter_registration_deadline_general && {
      label: 'Register by',
      value: formatBallotDate(k.voter_registration_deadline_general),
    },
    k?.vote_by_mail_request_deadline_general && {
      label: 'Vote-by-mail',
      value: formatBallotDate(k.vote_by_mail_request_deadline_general),
    },
  ].filter(Boolean);

  // Federal-cycle fallback when state has no curated dates yet.
  const fallbackDates = [
    { label: 'General', value: 'Nov 3, 2026' },
  ];

  const renderDates = dates.length > 0 ? dates : fallbackDates;
  const headline = stateCode
    ? `It's election season in ${stateName}.`
    : "It's election season.";

  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-2xl)',
        padding: 16,
      }}
    >
      <div className="cl-eyebrow">Election center</div>
      <h3
        style={{
          margin: '6px 0 6px',
          fontSize: 'var(--cl-text-lg)',
          fontWeight: 700,
          color: 'var(--cl-text)',
          letterSpacing: 'var(--cl-tracking-tight)',
        }}
      >
        {headline}
      </h3>
      <p
        className="cl-body-sm"
        style={{ color: 'var(--cl-text-light)', margin: '0 0 12px' }}
      >
        Track candidates running for federal, state, and local office. Bookmark
        races, follow candidates, and get notified before key deadlines.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        {renderDates.map((d) => (
          <div
            key={d.label}
            style={{
              padding: '10px 12px',
              background: 'var(--cl-bg-soft)',
              border: '1px solid var(--cl-border)',
              borderRadius: 'var(--cl-radius-md)',
            }}
          >
            <div className="cl-eyebrow" style={{ marginBottom: 2 }}>
              {d.label}
            </div>
            <div
              className="cl-num"
              style={{
                fontSize: 'var(--cl-text-md)',
                fontWeight: 700,
                color: 'var(--cl-text)',
              }}
            >
              {d.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Anonymous-visitor empty state for the featured race — clear CTA
// back to address verification. We don't try to fake a sample race
// here; the user explicitly preferred a clean "we'll show you your
// ballot once we know where you live" prompt.
function FeaturedRaceVerifyPrompt({ onRequestVerify }) {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px dashed var(--cl-border-strong)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: '24px 18px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 'var(--cl-text-md)',
          fontWeight: 600,
          color: 'var(--cl-text)',
          marginBottom: 4,
        }}
      >
        Sign in to see your district's race.
      </div>
      <div
        style={{
          fontSize: 'var(--cl-text-sm)',
          color: 'var(--cl-text-light)',
          marginBottom: 12,
        }}
      >
        Verify your address to see your complete ballot — federal, state, and local.
      </div>
      <button
        type="button"
        onClick={onRequestVerify}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          background: 'var(--cl-accent)',
          color: 'var(--cl-text-on-dark)',
          border: 'none',
          borderRadius: 'var(--cl-radius-md)',
          fontSize: 'var(--cl-text-sm)',
          fontWeight: 700,
          fontFamily: 'var(--cl-font-sans)',
          cursor: 'pointer',
        }}
      >
        Verify your address
        <ArrowRight size={12} active color="onDark" />
      </button>
    </div>
  );
}

// Logged-in-citizen empty state — their state isn't seeded yet.
function FeaturedRaceEmpty({ stateName }) {
  return (
    <EmptyState
      icon={<Building size={32} active color="muted" />}
      headline={`Election results coming soon for ${stateName || 'your state'}.`}
      body="We're rolling out 2026 candidate data state by state. Tracked notifications will fire as soon as your races land."
      tone="muted"
    />
  );
}

// The actual race card grid — header line + 6 candidate cards using
// the same CompactPersonCard component as Cabinet / SCOTUS.
function FeaturedRaceCards({ race, candidates, totalCount, onCandidatePick, stateCode, stateName, onStatePick }) {
  // The full-field link is only meaningful when we know which state
  // to deep-link to AND we have a parent handler wired (page.js's
  // handleStateSelect). If onStatePick is missing, fall back to the
  // existing static caption.
  const canDeepLink = !!(stateCode && onStatePick);
  // Always show the "Showing X of N" caption when there are >6
  // candidates in the race, so the user knows there's more to see
  // on the state page even though only 6 fit on the home surface.
  // Falls back to candidates.length if totalCount wasn't passed
  // (older callers pre-dated the count threading).
  const total = totalCount ?? candidates.length;
  return (
    <div>
      <div
        style={{
          marginBottom: 10,
          padding: '8px 12px',
          background: 'var(--cl-card)',
          border: '1px solid var(--cl-border)',
          borderRadius: 'var(--cl-radius-md)',
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 'var(--cl-text-md)',
            fontWeight: 700,
            color: 'var(--cl-text)',
          }}
        >
          {race.office}
        </span>
        {race.open_seat && (
          <span
            style={{
              fontSize: 'var(--cl-text-2xs)',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 'var(--cl-radius-pill)',
              background: 'var(--cl-warning-soft)',
              color: 'var(--cl-warning-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Open seat
          </span>
        )}
        {candidates.length >= 6 && (
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text-muted)',
              }}
            >
              Showing {candidates.length} / {total} total — full field on the state page
            </span>
            {canDeepLink && (
              <button
                type="button"
                onClick={() => onStatePick(stateCode, stateName, { tab: 'ballot' })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  background: 'var(--cl-accent)',
                  color: 'var(--cl-text-on-dark)',
                  border: 'none',
                  borderRadius: 'var(--cl-radius-pill)',
                  fontSize: 'var(--cl-text-2xs)',
                  fontWeight: 700,
                  fontFamily: 'var(--cl-font-sans)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                aria-label={`View full ballot for ${stateName || stateCode}`}
              >
                View {stateName || stateCode} page
                <ArrowRight size={12} active color="onDark" />
              </button>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
        }}
      >
        {candidates.map((c) => (
          <CompactPersonCard
            key={c.id}
            person={c}
            eyebrow={`Candidate · ${c.party || 'NPA'}`}
            meta={c.hometown || c.city || null}
            onClick={onCandidatePick ? () => onCandidatePick(c) : null}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 2. EXECUTIVE BRANCH
// ─────────────────────────────────────────────────────────────────
function ExecutiveBranchSection({ exec, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  const pres = exec.president;
  const vp = exec.vice_president;
  const cabinet = exec.cabinet || [];
  // Branch sections expand by default — the user wants the surface to
  // feel populated on first paint, not gated behind 4 chevrons. The
  // toggle exists so a user who's just looking for SCOTUS or Browse-
  // by-state can collapse the upstream sections to scroll less.
  // Persisted to localStorage so a user's collapse choices survive
  // reloads.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:exec', true);
  // Cabinet is its own collapsible inside Executive — defaults to
  // collapsed because there are 15 cards and the President + VP are
  // the headline content. Persisted so an open Cabinet survives
  // reloads.
  const [cabinetOpen, toggleCabinet] = usePersistentToggle('cl:nop:cabinet', false);

  return (
    <section style={{ padding: '32px 24px 16px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Article II"
          title="Executive Branch"
          subhead={
            pres?.serving_since
              ? `The administration in power · sworn in ${formatLongDate(pres.serving_since)}`
              : 'The administration in power'
          }
          chip={null}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />

        {open && (<>
        {/* President + VP — large hero-tier cards, 2 columns at desktop */}
        {(pres || vp) && (
          <div>
            <SubsectionLabel>President &amp; Vice President</SubsectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 12,
              }}
            >
              {pres && (
                <BigPersonCard
                  person={pres}
                  eyebrow="President of the United States"
                  meta={
                    pres.serving_since
                      ? `Since ${new Date(pres.serving_since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                      : null
                  }
                  onClick={onSelectPerson ? () => onSelectPerson(pres, 'president') : null}
                  followTarget={{ ...pres, role_type: 'president', chamber: 'Executive Branch' }}
                  onNotify={onNotify}
                  onCompareToggle={onCompareToggle}
                  compareIds={compareIds}
                  onOpenPage={onOpenPage}
                />
              )}
              {vp && (
                <BigPersonCard
                  person={vp}
                  eyebrow="Vice President of the United States"
                  meta={
                    vp.serving_since
                      ? `Since ${new Date(vp.serving_since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                      : null
                  }
                  onClick={onSelectPerson ? () => onSelectPerson(vp, 'vice_president') : null}
                  followTarget={{ ...vp, role_type: 'vice_president', chamber: 'Executive Branch' }}
                  onNotify={onNotify}
                  onCompareToggle={onCompareToggle}
                  compareIds={compareIds}
                  onOpenPage={onOpenPage}
                />
              )}
            </div>
          </div>
        )}

        {/* Cabinet — compact grid, 4 cols at desktop. Collapsible
            because the 15-card grid is a lot of vertical real estate
            on top of President + VP. */}
        {cabinet.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <SubsectionLabel
              collapsible
              open={cabinetOpen}
              onToggle={toggleCabinet}
            >
              Cabinet
              <span
                style={{
                  marginLeft: 8,
                  color: 'var(--cl-text-muted)',
                  fontWeight: 400,
                  fontSize: 'var(--cl-text-2xs)',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                Nominated by the President · confirmed by the Senate
              </span>
            </SubsectionLabel>
            {cabinetOpen && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 10,
                }}
              >
                {cabinet.map((c) => (
                  <CompactPersonCard
                    key={c.id}
                    person={c}
                    eyebrow={c.role}
                    onClick={onSelectPerson ? () => onSelectPerson(c, 'cabinet') : null}
                    followTarget={{ ...c, role_type: 'cabinet', chamber: c.department || 'Cabinet' }}
                    onNotify={onNotify}
                    onCompareToggle={onCompareToggle}
                    compareIds={compareIds}
                    onOpenPage={onOpenPage}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        </>)}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 3. SENATE LEADERSHIP
// ─────────────────────────────────────────────────────────────────
function SenateLeadershipSection({ senate, congressNumber, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  // Hooks first — Senate may render before data hydrates, in which case
  // `leadership` is empty and we early-return null below. The hook call
  // has to happen before any conditional return so React's hook order
  // stays stable across renders.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:senate', true);
  const leadership = senate.leadership || [];
  if (leadership.length === 0) return null;
  const breakdown = senate.party_breakdown || {};
  const total = (breakdown.R || 0) + (breakdown.D || 0) + (breakdown.I || 0);

  return (
    <section style={{ padding: '32px 24px 16px', background: 'var(--cl-bg-soft)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Article I · Section 3"
          title="Senate Leadership"
          subhead={
            total > 0
              ? `${total} senators · ${breakdown.R || 0}R · ${breakdown.D || 0}D${breakdown.I ? ` · ${breakdown.I}I` : ''}`
              : null
          }
          chip={<PartyBalanceChip breakdown={breakdown} />}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          <LeadershipGrid
            leadership={leadership}
            chamber="U.S. Senate"
            onSelectPerson={onSelectPerson}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 4. HOUSE LEADERSHIP
// ─────────────────────────────────────────────────────────────────
function HouseLeadershipSection({ house, congressNumber, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  // See SenateLeadershipSection comment — hooks must precede the
  // conditional early return so we don't violate the rules of hooks
  // when leadership data hydrates from empty into populated.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:house', true);
  const leadership = house.leadership || [];
  if (leadership.length === 0) return null;
  const breakdown = house.party_breakdown || {};
  const total = (breakdown.R || 0) + (breakdown.D || 0) + (breakdown.I || 0);

  return (
    <section style={{ padding: '32px 24px 16px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Article I · Section 2"
          title="House Leadership"
          subhead={
            total > 0
              ? `${total} representatives · ${breakdown.R || 0}R · ${breakdown.D || 0}D${breakdown.I ? ` · ${breakdown.I}I` : ''}`
              : null
          }
          chip={<PartyBalanceChip breakdown={breakdown} />}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          <LeadershipGrid
            leadership={leadership}
            chamber="U.S. House of Representatives"
            onSelectPerson={onSelectPerson}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 5. SUPREME COURT
// ─────────────────────────────────────────────────────────────────
function SCOTUSSection({ sc, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  // Same hook-order contract as the leadership sections above.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:scotus', true);
  const justices = sc.members || [];
  if (justices.length === 0) return null;

  return (
    <section style={{ padding: '32px 24px 16px', background: 'var(--cl-bg-soft)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Article III"
          title={sc.body_name || 'Supreme Court of the United States'}
          subhead={
            sc._note ||
            'Justices are nominated by the President, confirmed by the Senate, and serve during good behavior.'
          }
          chip={null}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {justices.map((j) => (
              <CompactPersonCard
                key={j.id}
                person={j}
                eyebrow={j.role + (j.chief ? ' · presiding' : '')}
                meta={j.appointed_by ? `Appointed by ${j.appointed_by}` : null}
                onClick={onSelectPerson ? () => onSelectPerson(j, 'scotus') : null}
                followTarget={{ ...j, role_type: 'scotus', chamber: sc.body_name || 'Supreme Court' }}
                onNotify={onNotify}
                onCompareToggle={onCompareToggle}
                compareIds={compareIds}
                onOpenPage={onOpenPage}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 6. NATIONAL ACTIVITY FEED
//
// Live data via GET /api/feed/national-activity — recent non-deleted
// posts authored by RepAccounts, ordered by created_at DESC. The
// shape returned by the API uses `created_at` (ISO timestamp) and
// `official_id`; we normalize to the shape ActivityPostRow expects
// (`when` as a relative string) at the section boundary so the row
// component stays generic.
//
// Empty-state behavior: when no rep has posted yet (fresh-launch
// state), the API returns `items: []` and we render an explanatory
// tile instead of the row list. The tile points at how the section
// will populate so the surface still feels intentional.
// ─────────────────────────────────────────────────────────────────

// Convert an ISO-8601 timestamp from the API into a short relative-
// time string ("14m ago", "2h ago", "Mar 4"). Mirrors the helper in
// PostCard.js — kept inline because this file already has a number
// of small render helpers and the duplication is cheaper than adding
// a shared module.
function nationalTimeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

function NationalActivitySection({ onRequestVerify, citizen }) {
  // When a citizen is signed in, the per-row "Sign in to participate" CTA
  // and the section-level "Sign in to follow these reps" CTA are hidden —
  // an authenticated user can already react / comment on each post via
  // the rep's PageView and follow reps from the profile view. Anonymous
  // visitors still see both CTAs as the primary entry point into the
  // citizen-login flow.
  const isAuthed = !!citizen;
  // National Activity is collapsible like the rest of the NOP sections.
  // Defaults to collapsed because the feed is six full-width post cards
  // and tends to dominate the page below it; users who want to scan
  // current activity can expand. Persisted across reloads.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:activity', false);

  // Lazy-fetch on first expand. Skipping the fetch while collapsed
  // saves a round-trip on the (common) case of users who don't open
  // the section. Once fetched, the result sticks until a reload — we
  // don't bother with revalidation because the home-page feed is
  // intentionally a lightly-stale summary.
  const [items, setItems] = useState(null);   // null = not loaded yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || items !== null || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      const { data, error: err } = await fetchNationalActivity({ limit: 6 });
      if (cancelled) return;
      if (err || !data) {
        setError(true);
        setItems([]);
      } else {
        setItems(Array.isArray(data.items) ? data.items : []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, items, loading]);

  return (
    <section style={{ padding: '32px 24px 16px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Past 24 hours"
          title="National activity"
          subhead="Recent posts from reps across the country, newest first"
          chip={null}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          <>
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} height={120} radius={16} />
                ))}
              </div>
            )}
            {!loading && items && items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((apiPost) => (
                  <ActivityPostRow
                    key={apiPost.id}
                    post={{
                      // Normalize API shape to the row component's
                      // contract. role / party may be null when the
                      // rep isn't in the curated federal-officials
                      // index; PartyChip + Avatar both handle null
                      // by rendering a neutral chip / initials.
                      id: apiPost.id,
                      author: apiPost.author,
                      role: apiPost.role || '',
                      party: apiPost.party || null,
                      body: apiPost.body,
                      likes: apiPost.likes || 0,
                      comments: apiPost.comments || 0,
                      when: nationalTimeAgo(apiPost.created_at),
                    }}
                    onRequestVerify={onRequestVerify}
                    isAuthed={isAuthed}
                  />
                ))}
              </div>
            )}
            {!loading && items && items.length === 0 && (
              <ActivityEmptyState error={error} />
            )}
            {!isAuthed && items && items.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={onRequestVerify}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cl-accent)',
                    fontSize: 'var(--cl-text-sm)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--cl-font-sans)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  Sign in to follow these reps
                  <ArrowRight size={12} active color="accent" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// Empty-state tile for National activity. Shown when no rep has
// posted yet, OR when the API call failed (so the user always sees
// something intentional instead of a blank gap). Error vs. empty is
// reflected only in the body copy — the visual is the same so a
// transient failure doesn't look catastrophic.
function ActivityEmptyState({ error }) {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px dashed var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: '28px 20px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--cl-accent-soft)',
          margin: '0 auto 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-hidden
      >
        <Building size={22} active color="accent" />
      </div>
      <div
        style={{
          fontSize: 'var(--cl-text-md)',
          fontWeight: 700,
          color: 'var(--cl-text)',
          marginBottom: 6,
        }}
      >
        {error ? 'Activity unavailable right now' : 'No recent posts yet'}
      </div>
      <p
        style={{
          fontSize: 'var(--cl-text-sm)',
          color: 'var(--cl-text-light)',
          margin: 0,
          maxWidth: 540,
          marginLeft: 'auto',
          marginRight: 'auto',
          lineHeight: 1.55,
        }}
      >
        {error
          ? 'We couldn’t reach the feed. Try again in a moment.'
          : 'When verified reps claim their CivicView pages and start posting, the latest activity from across the country will surface here.'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// POPULAR POLLS — live data from GET /api/feed/popular-polls.
//
// The endpoint returns the highest-vote-count active polls across
// the whole app — a mix of rep-authored (attached to a Post) and
// citizen-authored (standalone, on unclaimed rep pages). The API
// shape uses `kind: 'rep'|'citizen'` and `created_at`; we normalize
// to PopularPollCard's existing contract (`authorType`, `when`) at
// the section boundary so the card component stays unchanged.
//
// Empty-state behavior matches National activity: an explanatory
// tile when no polls have any votes yet, an error variant of the
// same tile when the API fetch fails.
// ─────────────────────────────────────────────────────────────────

// Format vote / comment counts in a feed-friendly way: 12483 → "12.5k",
// 968 → "968". Mirrors the convention the rest of the app uses on
// post engagement counters.
function formatPollCount(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function PopularPollsSection({ onRequestVerify, citizen }) {
  const isAuthed = !!citizen;
  // Same persistence pattern as every other NOP section. Defaults to
  // collapsed: this is a multi-card grid, large enough that forcing
  // it open would push every section below it off the fold.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:popular-polls', false);

  // Lazy-fetch on first expand — same pattern as NationalActivitySection.
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || items !== null || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      const { data, error: err } = await fetchPopularPolls({ limit: 9 });
      if (cancelled) return;
      if (err || !data) {
        setError(true);
        setItems([]);
      } else {
        setItems(Array.isArray(data.items) ? data.items : []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, items, loading]);

  return (
    <section style={{ padding: '32px 24px 16px', background: 'var(--cl-bg-soft)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Trending now"
          title="Popular polls"
          subhead="The most-voted polls from reps and citizens across the country"
          chip={null}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          <>
            {loading && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 12,
                }}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={220} radius={16} />
                ))}
              </div>
            )}
            {!loading && items && items.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 12,
                }}
              >
                {items.map((apiPoll) => (
                  <PopularPollCard
                    key={apiPoll.id}
                    poll={{
                      // Normalize API → card shape. Card reads
                      // poll.authorType ('rep' | 'citizen'); the API
                      // returns poll.kind, same semantics.
                      id: apiPoll.id,
                      authorType: apiPoll.kind === 'citizen' ? 'citizen' : 'rep',
                      author: apiPoll.author,
                      role: apiPoll.role || '',
                      party: apiPoll.party || null,
                      when: nationalTimeAgo(apiPoll.created_at),
                      question: apiPoll.question,
                      options: Array.isArray(apiPoll.options) ? apiPoll.options : [],
                      votes: apiPoll.votes || 0,
                      comments: apiPoll.comments || 0,
                    }}
                    onRequestVerify={onRequestVerify}
                    isAuthed={isAuthed}
                  />
                ))}
              </div>
            )}
            {!loading && items && items.length === 0 && (
              <PollsEmptyState error={error} />
            )}
            {!isAuthed && items && items.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={onRequestVerify}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cl-accent)',
                    fontSize: 'var(--cl-text-sm)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--cl-font-sans)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  Sign in to vote and join the discussion
                  <ArrowRight size={12} active color="accent" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// Empty-state tile for Popular polls. Same visual language as
// ActivityEmptyState — different copy that nudges visitors toward
// the citizen-led poll feature (which is how the app generates
// engagement before reps have onboarded).
function PollsEmptyState({ error }) {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px dashed var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: '28px 20px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--cl-accent-soft)',
          margin: '0 auto 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-hidden
      >
        <CheckCircle size={22} active color="accent" />
      </div>
      <div
        style={{
          fontSize: 'var(--cl-text-md)',
          fontWeight: 700,
          color: 'var(--cl-text)',
          marginBottom: 6,
        }}
      >
        {error ? 'Polls unavailable right now' : 'No polls yet — be the first.'}
      </div>
      <p
        style={{
          fontSize: 'var(--cl-text-sm)',
          color: 'var(--cl-text-light)',
          margin: 0,
          maxWidth: 540,
          marginLeft: 'auto',
          marginRight: 'auto',
          lineHeight: 1.55,
        }}
      >
        {error
          ? 'We couldn’t reach the polls feed. Try again in a moment.'
          : 'Polls authored by reps and by verified citizens on unclaimed rep pages will surface here, sorted by total votes. Open any rep’s page and start one to seed the feed.'}
      </p>
    </div>
  );
}

// One card per poll. Renders bars + percentages from the API payload
// (live data via /api/feed/popular-polls). Tapping a bar without
// being authed prompts the citizen-login flow; future iterations
// could deep-link to the source rep page for the authed case.
function PopularPollCard({ poll, onRequestVerify, isAuthed }) {
  const isCitizenPoll = poll.authorType === 'citizen';
  const handleVoteClick = () => {
    if (!isAuthed && onRequestVerify) onRequestVerify();
    // When authed, we'd normally open the source post / page in a
    // future iteration. For demo this is a no-op so users don't get
    // a dead-end.
  };
  return (
    <article
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Author row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Avatar
          name={poll.author}
          party={isCitizenPoll ? null : poll.party}
          size="sm"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 'var(--cl-text-sm)',
                color: 'var(--cl-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {poll.author}
            </span>
            {isCitizenPoll ? (
              <span
                style={{
                  fontSize: 'var(--cl-text-2xs)',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 'var(--cl-radius-pill)',
                  background: 'var(--cl-accent-soft)',
                  color: 'var(--cl-accent)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Citizen
              </span>
            ) : (
              <PartyChip party={poll.party} />
            )}
          </div>
          <div
            style={{
              fontSize: 'var(--cl-text-xs)',
              color: 'var(--cl-text-muted)',
            }}
          >
            {poll.role} · {poll.when}
          </div>
        </div>
      </div>

      {/* Question */}
      <div
        style={{
          fontSize: 'var(--cl-text-md)',
          fontWeight: 600,
          color: 'var(--cl-text)',
          lineHeight: 1.35,
        }}
      >
        {poll.question}
      </div>

      {/* Options — horizontal bars with percentage on the right.
          Tinted with cl-accent-soft so the bar stands out without
          implying a tally is in progress (this is demo data). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {poll.options.map((opt, i) => {
          const isLeader = poll.options.every((o, j) => j === i || o.percent <= opt.percent);
          return (
            <button
              key={i}
              type="button"
              onClick={handleVoteClick}
              style={{
                position: 'relative',
                width: '100%',
                textAlign: 'left',
                background: 'var(--cl-bg-soft)',
                border: `1px solid ${isLeader ? 'var(--cl-accent)' : 'var(--cl-border)'}`,
                borderRadius: 'var(--cl-radius-md)',
                padding: '8px 12px',
                cursor: 'pointer',
                fontFamily: 'var(--cl-font-sans)',
                overflow: 'hidden',
              }}
            >
              {/* Filled bar (background tint scaled by percent). */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: `${opt.percent}%`,
                  background: isLeader ? 'var(--cl-accent-soft)' : 'var(--cl-bg)',
                  zIndex: 0,
                  transition: 'width 200ms ease',
                }}
                aria-hidden
              />
              <div
                style={{
                  position: 'relative',
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--cl-text-sm)',
                    fontWeight: isLeader ? 700 : 500,
                    color: 'var(--cl-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt.label}
                </span>
                <span
                  style={{
                    fontSize: 'var(--cl-text-sm)',
                    fontWeight: 700,
                    color: isLeader ? 'var(--cl-accent)' : 'var(--cl-text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {opt.percent}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer engagement: votes, comments. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 'var(--cl-text-xs)',
          color: 'var(--cl-text-muted)',
          paddingTop: 4,
          borderTop: '1px solid var(--cl-border)',
        }}
      >
        <span>
          <strong style={{ color: 'var(--cl-text)' }}>{formatPollCount(poll.votes)}</strong> votes
        </span>
        <span>
          <strong style={{ color: 'var(--cl-text)' }}>{formatPollCount(poll.comments)}</strong> comments
        </span>
      </div>
    </article>
  );
}

function ActivityPostRow({ post, onRequestVerify, isAuthed }) {
  return (
    <article
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Avatar name={post.author} party={post.party} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              flexWrap: 'wrap',
              fontSize: 'var(--cl-text-sm)',
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--cl-text)' }}>
              {post.author}
            </span>
            <PartyChip party={post.party} size="xs" />
            <span style={{ color: 'var(--cl-text-light)' }}>· {post.role}</span>
            <span style={{ color: 'var(--cl-text-muted)', marginLeft: 'auto' }}>
              {post.when}
            </span>
          </div>
          <p
            className="cl-body-sm"
            style={{
              margin: '8px 0 0',
              color: 'var(--cl-text)',
              lineHeight: 'var(--cl-leading-normal)',
            }}
          >
            {post.body}
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              marginTop: 10,
              fontSize: 'var(--cl-text-xs)',
              color: 'var(--cl-text-muted)',
            }}
          >
            <span className="cl-num">{post.likes.toLocaleString()} reactions</span>
            <span aria-hidden="true">·</span>
            <span className="cl-num">{post.comments} comments</span>
            {!isAuthed && (
              <button
                type="button"
                onClick={onRequestVerify}
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--cl-accent)',
                  fontSize: 'var(--cl-text-xs)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--cl-font-sans)',
                }}
              >
                Sign in to participate →
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────
// 7. BROWSE BY STATE
//
// Alphabetical grid of all 50 states + DC. The SVG geographic-map
// version from the design is deferred to a future polish pass; the
// grid is the accessible, scannable fallback. Each state pill calls
// the parent's onStatePick handler — wired through SidePanel to
// page.js's handleStateSelect so clicks bring up the state's officials
// in the side panel.
// ─────────────────────────────────────────────────────────────────

const STATES_FOR_GRID = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

function BrowseByStateSection({ onStatePick }) {
  // Browse-by-state is collapsed by default — the map already gives the
  // primary geographic entry point, and the 51-pill grid is a sizable
  // chunk of vertical real estate. Most visitors won't need to scan the
  // alphabetical fallback, so we hide it by default and let the curious
  // tap the chevron to open it. Persisted across reloads.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:browse', false);
  return (
    <section style={{ padding: '32px 24px 16px', background: 'var(--cl-bg-soft)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="All 50 states · plus DC"
          title="Browse by state"
          subhead="Pick a state to see its governor, senators, House delegation, and state legislature."
          chip={null}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          /* Grid: keeps 2 columns even at narrow side-panel widths. The
             minmax floor of 110px + auto-fit lets the panel fall back to
             1 column only at extreme narrow widths (<~250px). At wider
             widths it auto-expands to 3+ columns. */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: 6,
            }}
          >
            {STATES_FOR_GRID.map(([code, name]) => (
              <StatePill
                key={code}
                code={code}
                name={name}
                onClick={onStatePick ? () => onStatePick(code, name) : null}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StatePill({ code, name, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-md)',
        fontFamily: 'var(--cl-font-sans)',
        fontSize: 'var(--cl-text-sm)',
        color: 'var(--cl-text)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color var(--cl-duration-fast) var(--cl-ease-standard), background var(--cl-duration-fast) var(--cl-ease-standard)',
        textAlign: 'left',
      }}
      onMouseOver={
        clickable
          ? (e) => {
              e.currentTarget.style.borderColor = 'var(--cl-accent)';
              e.currentTarget.style.background = 'var(--cl-accent-soft)';
            }
          : undefined
      }
      onMouseOut={
        clickable
          ? (e) => {
              e.currentTarget.style.borderColor = 'var(--cl-border)';
              e.currentTarget.style.background = 'var(--cl-card)';
            }
          : undefined
      }
    >
      <span
        className="cl-num"
        style={{
          fontSize: 'var(--cl-text-2xs)',
          fontWeight: 800,
          color: 'var(--cl-text-light)',
          background: 'var(--cl-bg-soft)',
          padding: '2px 5px',
          borderRadius: 'var(--cl-radius-xs)',
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {code}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// 8. VERIFICATION CTA STRIP
// ─────────────────────────────────────────────────────────────────
function VerificationCTAStrip({ onVerifyClick }) {
  // Flex with wrap — button stays on the right at wide widths, drops
  // below the text at narrow widths. Both items have a generous min-
  // width so they don't squish together; once the row can't fit them
  // side-by-side, the button wraps under the heading + body cleanly.
  return (
    <section
      style={{
        padding: '32px 24px',
        margin: '24px 24px 0',
        maxWidth: 1180,
        background: 'var(--cl-primary)',
        color: 'var(--cl-text-on-dark)',
        borderRadius: 'var(--cl-radius-2xl)',
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 24,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2
            className="cl-h1"
            style={{
              color: 'var(--cl-text-on-dark)',
              margin: '0 0 8px',
              letterSpacing: 'var(--cl-tracking-tight)',
            }}
          >
            Make this your own.
          </h2>
          <p
            className="cl-body-sm"
            style={{
              color: 'var(--cl-text-on-dark-soft)',
              margin: 0,
              maxWidth: 520,
              lineHeight: 'var(--cl-leading-normal)',
            }}
          >
            Verify your home address to surface your senators, your
            representative, your committees, and to track and respond to
            what they say. CivicView never shares or sells your address.
          </p>
        </div>
        <button
          type="button"
          onClick={onVerifyClick}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            height: 44,
            padding: '0 20px',
            background: 'var(--cl-accent)',
            color: 'var(--cl-text-on-dark)',
            border: 'none',
            borderRadius: 'var(--cl-radius-md)',
            fontSize: 'var(--cl-text-sm)',
            fontWeight: 700,
            fontFamily: 'var(--cl-font-sans)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background var(--cl-duration-fast) var(--cl-ease-standard)',
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'var(--cl-accent-light)'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'var(--cl-accent)'; }}
        >
          Verify your address
          <ArrowRight size={14} active color="onDark" />
        </button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 7. FOOTER
// ─────────────────────────────────────────────────────────────────
function Footer({
  onJumpExecutive,
  onJumpSenate,
  onJumpHouse,
  onJumpBrowse,
  onVerify,
  onOpenTracked,
  onSubscribe,
}) {
  return (
    <footer
      style={{
        marginTop: 32,
        padding: '32px 24px',
        background: 'var(--cl-card)',
        borderTop: '1px solid var(--cl-border)',
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) repeat(3, minmax(0, 1fr))',
            gap: 32,
            marginBottom: 24,
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <CivicLensLogo size={20} variant="color" />
              <span
                style={{
                  fontFamily: 'var(--cl-font-display)',
                  fontWeight: 700,
                  fontSize: 'var(--cl-text-md)',
                  color: 'var(--cl-text)',
                }}
              >
                CivicView
              </span>
            </div>
            <p
              style={{
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text-light)',
                lineHeight: 'var(--cl-leading-normal)',
                margin: 0,
                maxWidth: 320,
              }}
            >
              CivicView does not endorse any candidate, party, or position.
              We surface what officials say and do — and let citizens respond
              in their own districts.
            </p>
          </div>
          {/* Browse column — every link scrolls to its corresponding NOP
              section. */}
          <FooterColumn
            heading="Browse"
            links={[
              { label: 'Executive branch', onClick: onJumpExecutive },
              { label: 'Senate', onClick: onJumpSenate },
              { label: 'House', onClick: onJumpHouse },
              { label: 'Browse by state', onClick: onJumpBrowse },
            ]}
          />
          {/* Citizen column — wired to the same handlers as their navbar
              counterparts so the footer becomes a fallback entry point.
              "Subscribe" was renamed from "Subscribe to a rep" — you can
              already subscribe to / follow individual reps via the Follow
              button on every profile card; the Subscribe modal is the
              email-list waitlist for the product itself. "Notifications"
              routes to the My Tracked modal because that's where per-item
              notification prefs live today. */}
          <FooterColumn
            heading="Citizen"
            links={[
              { label: 'Verify your address', onClick: onVerify || null },
              { label: 'My tracked', onClick: onOpenTracked || null },
              { label: 'Notifications', onClick: onOpenTracked || null },
              { label: 'Subscribe', onClick: onSubscribe || null },
            ]}
          />
          {/* About column — placeholders for static pages we haven't built
              yet. Rendered as inactive (no cursor, muted color). */}
          <FooterColumn
            heading="About"
            links={[
              { label: 'Methodology', onClick: null },
              { label: 'Editorial standards', onClick: null },
              { label: 'Privacy', onClick: null },
              { label: 'Contact', onClick: null },
            ]}
          />
        </div>
        <div
          style={{
            paddingTop: 16,
            borderTop: '1px solid var(--cl-border)',
            fontSize: 'var(--cl-text-2xs)',
            color: 'var(--cl-text-muted)',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>© {new Date().getFullYear()} CivicView — All rights reserved.</span>
          <span>·</span>
          <span>Data sourced from official chamber records, FEC filings, and verified office staff.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ heading, links }) {
  return (
    <div>
      <Eyebrow style={{ marginBottom: 10 }}>{heading}</Eyebrow>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {links.map((l) => {
          const active = typeof l.onClick === 'function';
          return (
            <li key={l.label}>
              {active ? (
                <button
                  type="button"
                  onClick={l.onClick}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 'var(--cl-text-sm)',
                    color: 'var(--cl-text)',
                    fontFamily: 'var(--cl-font-sans)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.color = 'var(--cl-accent)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.color = 'var(--cl-text)';
                  }}
                >
                  {l.label}
                </button>
              ) : (
                // Inactive link — rendered as muted text so users don't
                // try to click placeholders for pages that don't exist
                // yet (Methodology, Editorial standards, etc.).
                <span
                  aria-disabled="true"
                  style={{
                    fontSize: 'var(--cl-text-sm)',
                    color: 'var(--cl-text-muted)',
                    fontFamily: 'var(--cl-font-sans)',
                    cursor: 'default',
                  }}
                >
                  {l.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared section header
// ─────────────────────────────────────────────────────────────────
function SectionHeader({ eyebrow, title, subhead, chip, collapsible = false, open = true, onToggle }) {
  // When `collapsible`, the entire header becomes a click target that
  // toggles the parent section's body. The chevron rotates 90° when
  // open, and the subhead is suppressed in the collapsed state so the
  // collapsed row stays compact (a single ~32px tall scannable row).
  const titleNode = (
    <h2
      className="cl-h1"
      style={{
        margin: 0,
        fontSize: 'var(--cl-text-2xl)',
        fontWeight: 700,
        letterSpacing: 'var(--cl-tracking-tight)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {collapsible && <Chevron open={open} />}
      <span>{title}</span>
    </h2>
  );

  const headerInner = (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 4,
        }}
      >
        <Eyebrow tone="accent">{eyebrow}</Eyebrow>
        {chip}
      </div>
      {titleNode}
      {subhead && open && (
        <div
          className="cl-body-sm"
          style={{ color: 'var(--cl-text-light)', marginTop: 4 }}
        >
          {subhead}
        </div>
      )}
    </>
  );

  if (collapsible) {
    return (
      <header style={{ marginBottom: open ? 16 : 0 }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {headerInner}
        </button>
      </header>
    );
  }

  return <header style={{ marginBottom: 16 }}>{headerInner}</header>;
}

function SubsectionLabel({ children, collapsible = false, open = true, onToggle }) {
  // Shared visual style for both static and collapsible variants.
  const baseStyle = {
    textTransform: 'uppercase',
    letterSpacing: 'var(--cl-tracking-wider)',
    fontSize: 'var(--cl-text-2xs)',
    fontWeight: 800,
    color: 'var(--cl-text-light)',
    marginBottom: open ? 8 : 0,
    paddingBottom: 6,
    borderBottom: '1px solid var(--cl-border)',
  };

  if (collapsible) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          ...baseStyle,
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--cl-border)',
          cursor: 'pointer',
          fontFamily: 'var(--cl-font-sans)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Chevron open={open} />
        <span style={{ flex: 1 }}>{children}</span>
      </button>
    );
  }

  return <div style={baseStyle}>{children}</div>;
}

// ─────────────────────────────────────────────────────────────────
// Party-balance chip (shown next to section eyebrow on Senate / House)
// ─────────────────────────────────────────────────────────────────
function PartyBalanceChip({ breakdown }) {
  const r = breakdown.R || 0;
  const d = breakdown.D || 0;
  const i = breakdown.I || 0;
  if (r + d + i === 0) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 10px',
        background: 'var(--cl-bg-soft)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-pill)',
      }}
    >
      <PartyDot color={PARTY_COLORS.R} count={r} label="R" />
      <PartyDot color={PARTY_COLORS.D} count={d} label="D" />
      {i > 0 && <PartyDot color={PARTY_COLORS.I} count={i} label="I" />}
    </span>
  );
}

function PartyDot({ color, count, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
        aria-hidden="true"
      />
      <span
        className="cl-num"
        style={{
          fontSize: 'var(--cl-text-2xs)',
          fontWeight: 700,
          color: 'var(--cl-text)',
        }}
      >
        {label} · {count}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Big person card — used for President + VP + Cabinet hero tier
// ─────────────────────────────────────────────────────────────────
function BigPersonCard({ person, eyebrow, meta, onClick, followTarget, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  const memberCmpId = followTarget && (followTarget.bioguide_id || followTarget.id);
  const isComparing = Boolean(compareIds && memberCmpId && compareIds.has(memberCmpId));
  const clickable = typeof onClick === 'function';
  return (
    <article
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
          : undefined
      }
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-2xl)',
        padding: 18,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color var(--cl-duration-fast) var(--cl-ease-standard), box-shadow var(--cl-duration-fast) var(--cl-ease-standard)',
      }}
      onMouseOver={clickable ? (e) => { e.currentTarget.style.borderColor = 'var(--cl-accent)'; e.currentTarget.style.boxShadow = 'var(--cl-shadow-card)'; } : undefined}
      onMouseOut={clickable ? (e) => { e.currentTarget.style.borderColor = 'var(--cl-border)'; e.currentTarget.style.boxShadow = 'none'; } : undefined}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <Avatar name={person.name} party={person.party} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Eyebrow tone="accent">{eyebrow}</Eyebrow>
          <h3
            style={{
              margin: '4px 0 4px',
              fontSize: 'var(--cl-text-lg)',
              fontWeight: 700,
              color: 'var(--cl-text)',
              letterSpacing: 'var(--cl-tracking-tight)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              lineHeight: 1.2,
            }}
          >
            {person.name}
            {person.party && <PartyChip party={person.party} size="sm" variant="soft" />}
          </h3>
          {meta && (
            <div
              style={{
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text-light)',
              }}
            >
              {meta}
            </div>
          )}
          {person.selection_method && (
            <div style={{ marginTop: 6 }}>
              <SelectionBadge method={person.selection_method} detail={person.selection_detail} />
            </div>
          )}
        </div>
      </div>
      {(followTarget || compareIds || onOpenPage) && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid var(--cl-divider)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {followTarget && (
            <FollowButton member={followTarget} size="sm" onNotify={onNotify} />
          )}
          {onCompareToggle && memberCmpId && (
            <CompareButton
              member={followTarget}
              isComparing={isComparing}
              onCompareToggle={onCompareToggle}
              size="sm"
            />
          )}
          {onOpenPage && memberCmpId && (
            <PageButton
              size="sm"
              officialId={memberCmpId}
              onOpen={(id) => onOpenPage(id, {
                displayName: person.name,
                role: person.role || person.title || eyebrow || '',
                photoUrl: person.photoUrl,
              })}
            />
          )}
          {clickable && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-accent)',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              View profile
              <ArrowRight size={12} color="accent" active />
            </span>
          )}
        </div>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────
// Compact person card — used for Cabinet, SCOTUS, leadership tiers
// ─────────────────────────────────────────────────────────────────
function CompactPersonCard({ person, eyebrow, meta, onClick, followTarget, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  const memberCmpId = followTarget && (followTarget.bioguide_id || followTarget.id);
  const isComparing = Boolean(compareIds && memberCmpId && compareIds.has(memberCmpId));
  const clickable = typeof onClick === 'function';
  return (
    <article
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
          : undefined
      }
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 12,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color var(--cl-duration-fast) var(--cl-ease-standard)',
      }}
      onMouseOver={clickable ? (e) => { e.currentTarget.style.borderColor = 'var(--cl-accent)'; } : undefined}
      onMouseOut={clickable ? (e) => { e.currentTarget.style.borderColor = 'var(--cl-border)'; } : undefined}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Avatar name={person.name} party={person.party} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow && (
            <div
              className="cl-eyebrow"
              style={{ color: 'var(--cl-text-light)' }}
            >
              {eyebrow}
            </div>
          )}
          {/* Name row — party chip on the LEFT (so it never gets
              pushed below the name when the name is long), name on
              the right with ellipsis truncation. flexWrap is
              `nowrap` so the chip + name stay on a single line. The
              chip has flex-shrink: 0 so the name takes any
              squeeze, never the chip. */}
          <div
            style={{
              fontSize: 'var(--cl-text-sm)',
              fontWeight: 700,
              color: 'var(--cl-text)',
              marginTop: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'nowrap',
              minWidth: 0,
            }}
          >
            {person.party && (
              <span style={{ flexShrink: 0 }}>
                <PartyChip party={person.party} size="xs" />
              </span>
            )}
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}>
              {person.name}
            </span>
          </div>
          {/* Meta line is ALWAYS rendered — even when there's no
              state/city/residency to show — so every card in a grid
              has the same height. Without this, candidates whose
              meta is set are taller than candidates whose meta is
              null, and any UI that cycles through candidates (the
              Race-in-Focus shuffle) jumps every 12 seconds as the
              cards swap. The non-breaking space gives the line its
              natural height without rendering visible text. */}
          <div
            style={{
              fontSize: 'var(--cl-text-2xs)',
              color: 'var(--cl-text-light)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            aria-hidden={!meta || undefined}
          >
            {meta || ' '}
          </div>
        </div>
      </div>
      {/* Action row — Follow / Compare / Page sit below the name+meta
          line. Mirrors the BigPersonCard treatment so every member card
          surfaces the same engagement affordances. Card height grows
          slightly to accommodate; small buttons (sm = 24px) keep it
          compact. */}
      {(followTarget || compareIds || onOpenPage) && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid var(--cl-divider)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {followTarget && (
            <FollowButton member={followTarget} size="sm" onNotify={onNotify} />
          )}
          {onCompareToggle && memberCmpId && (
            <CompareButton
              member={followTarget}
              isComparing={isComparing}
              onCompareToggle={onCompareToggle}
              size="sm"
            />
          )}
          {onOpenPage && memberCmpId && (
            <PageButton
              size="sm"
              officialId={memberCmpId}
              onOpen={(id) => onOpenPage(id, {
                displayName: person.name,
                role: person.role || person.title || eyebrow || '',
                photoUrl: person.photoUrl,
              })}
            />
          )}
        </div>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────
// Leadership grid — renders senate / house leadership in tiered rows.
// Tier 1 (floor leadership): Speaker / Majority Leader / Minority Leader
// Tier 2 (whips, caucus chairs, pro tempore, etc.): everyone else
// ─────────────────────────────────────────────────────────────────
function LeadershipGrid({ leadership, chamber, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  // Sort floor leadership to the top tier — anything matching these
  // role keywords. Everything else lands in the second tier.
  const FLOOR_KEYWORDS = ['speaker', 'majority leader', 'minority leader', 'president pro tempore', 'pro tempore'];
  const isFloorRole = (role) => {
    if (!role) return false;
    const r = role.toLowerCase();
    return FLOOR_KEYWORDS.some((kw) => r.includes(kw));
  };

  const floor = leadership.filter((m) => isFloorRole(m.role));
  const supporting = leadership.filter((m) => !isFloorRole(m.role));

  return (
    <div>
      {floor.length > 0 && (
        <>
          <SubsectionLabel>Floor leadership</SubsectionLabel>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
              marginBottom: supporting.length > 0 ? 20 : 0,
            }}
          >
            {floor.map((m) => (
              <BigPersonCard
                key={m.id}
                person={m}
                eyebrow={[m.role, m.state].filter(Boolean).join(' · ')}
                meta={null}
                onClick={onSelectPerson ? () => onSelectPerson(m, 'congress_leader') : null}
                followTarget={{ ...m, role_type: 'congress_leader', chamber: m.chamber || chamber }}
                onNotify={onNotify}
                onCompareToggle={onCompareToggle}
                compareIds={compareIds}
                onOpenPage={onOpenPage}
              />
            ))}
          </div>
        </>
      )}
      {supporting.length > 0 && (
        <>
          <SubsectionLabel>
            {chamber.includes('Senate') ? 'Whips & assistant leaders' : 'Whips & caucus chairs'}
          </SubsectionLabel>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {supporting.map((m) => (
              <CompactPersonCard
                key={m.id}
                person={m}
                eyebrow={[m.role, m.state].filter(Boolean).join(' · ')}
                onClick={onSelectPerson ? () => onSelectPerson(m, 'congress_leader') : null}
                followTarget={{ ...m, role_type: 'congress_leader', chamber: m.chamber || chamber }}
                onNotify={onNotify}
                onCompareToggle={onCompareToggle}
                compareIds={compareIds}
                onOpenPage={onOpenPage}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function formatLongDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Section-shaped loading skeleton — rendered while the federal-officials
// API is in flight. Matches the SectionHeader + card-grid layout so the
// real content can swap in without a layout jump. `bg="soft"` mirrors
// the bg-soft striped sections (Senate, SCOTUS); `bg="card"` mirrors the
// card-bg sections (Executive, House).
function SectionSkeleton({ eyebrow, title, cardCount = 6, bg = 'card' }) {
  return (
    <section
      style={{
        padding: '32px 24px 16px',
        background: bg === 'soft' ? 'var(--cl-bg-soft)' : undefined,
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <Eyebrow tone="accent">{eyebrow}</Eyebrow>
          <h2
            className="cl-h1"
            style={{
              margin: '4px 0 0',
              fontSize: 'var(--cl-text-2xl)',
              fontWeight: 700,
              letterSpacing: 'var(--cl-tracking-tight)',
              color: 'var(--cl-text-light)',
            }}
          >
            {title}
          </h2>
        </header>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          {Array.from({ length: cardCount }).map((_, i) => (
            <div
              key={i}
              style={{
                background: 'var(--cl-card)',
                border: '1px solid var(--cl-border)',
                borderRadius: 'var(--cl-radius-xl)',
                padding: 12,
              }}
            >
              <Skeleton variant="card" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Single-glyph chevron used by every collapsible header on this surface
// (CivicView Stats, Executive, Senate, House, SCOTUS, National Activity,
// Browse-by-state, and the Cabinet subsection). Wraps the chevron in a
// circular accent-tinted pill so the toggle reads as a discoverable
// affordance instead of fading into the title — matches the same green
// pill treatment we use for the profile-hero collapse on rep pages.
// Rotates 0° (collapsed) → 90° (open) on a fast standard easing.
function Chevron({ open }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: 'var(--cl-accent-soft, rgba(46,125,50,0.10))',
        border: '1px solid var(--cl-accent)',
        color: 'var(--cl-accent)',
        flexShrink: 0,
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 12 12"
        style={{
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform var(--cl-duration-fast) var(--cl-ease-standard)',
        }}
      >
        <path
          d="M3 1.5L8 6L3 10.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
