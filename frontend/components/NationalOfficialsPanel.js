'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchElections, fetchFederalOfficials, fetchStatsSummary, fetchRecentVotes } from '@/lib/api';
import { fetchPopularPolls, fetchPostsFeed } from '@/lib/pagesApi';
import { useAuth as useRepAuth } from '@/lib/auth';
import { useCandidateAuth } from '@/lib/candidateAuth';
import FeedCard from './polls/FeedCard';
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
import CivicViewLogo from './brand/CivicViewLogo';

// ─────────────────────────────────────────────────────────────────
// formatCount — render an integer as a tile-friendly short label.
//
// We want the CivicView Stats tiles to stay roughly the same visual
// width regardless of the underlying count, so a viral demo-signup
// spike to 12,438 doesn't blow out the row layout. Rules:
//
//   < 1,000             →  "0".."999"        (literal)
//   1,000 .. 9,999      →  "1.2k"            (one decimal, drop .0)
//   10,000 .. 999,999   →  "12k", "415k"     (no decimal)
//   1,000,000+          →  "1.2M", "3M"      (one decimal, drop .0)
//
// Anything non-finite or negative renders as "0" so a transient
// fetch failure can't push "NaN" into the hero.
// ─────────────────────────────────────────────────────────────────
function formatCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return '0';
  if (num < 1000) return String(Math.trunc(num));
  if (num < 10000) {
    const v = (num / 1000).toFixed(1);
    return `${v.endsWith('.0') ? v.slice(0, -2) : v}k`;
  }
  if (num < 1_000_000) return `${Math.trunc(num / 1000)}k`;
  const v = (num / 1_000_000).toFixed(1);
  return `${v.endsWith('.0') ? v.slice(0, -2) : v}M`;
}

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

      <HomeBillsSection />

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
  // Stats bundle is fetched from GET /api/stats/summary on mount.
  // Endpoint returns:
  //   - structural counts (Senators / Representatives / SCOTUS) — these
  //     are constitutional facts baked into the backend, not COUNT()s,
  //     so they don't flicker when our data layer reseeds.
  //   - reps_joined: live COUNT(RepAccount.is_active)
  //   - verified_citizens: live COUNT(CitizenAccount.verified=True).
  //     Will read 0 until ID.me ships — that's an honest signal.
  //   - demo_accounts_created: live COUNT(CitizenAccount.verified=False).
  //     Temporary tile while we're pre-verification; will be retired
  //     to /stats after ID.me launches.
  //
  // The fetch falls back to structural defaults (100 / 435 / 9 + 0s)
  // if the backend is offline so the hero still renders. We compact
  // big counts to human-friendly suffixes (12.4k, 1.2M) so a viral
  // demo-signup spike doesn't blow out the tile width.
  const [statsData, setStatsData] = useState(null);
  useEffect(() => {
    let mounted = true;
    fetchStatsSummary()
      .then(({ data }) => {
        if (mounted) setStatsData(data);
      })
      .catch(() => {
        // fetchStatsSummary already returns fallback on error — this
        // catch is defensive only.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const STATS = useMemo(() => {
    const s = statsData || {
      senators: 100,
      representatives: 435,
      scotus_justices: 9,
      reps_joined: 0,
      verified_citizens: 0,
      demo_accounts_created: 0,
    };
    return [
      { value: formatCount(s.senators),               label: 'Senators' },
      { value: formatCount(s.representatives),        label: 'Representatives' },
      { value: formatCount(s.scotus_justices),        label: 'SCOTUS Justices' },
      { value: formatCount(s.reps_joined),            label: 'Reps joined' },
      { value: formatCount(s.verified_citizens),      label: 'Verified citizens' },
      // Demo accounts tile is intentionally placed last so it's the
      // first thing to drop off the row at narrow widths. Removed
      // when ID.me verification ships and `verified_citizens` becomes
      // a meaningful non-zero number (Task #71 will absorb the
      // detail breakdown into the expanded /stats page).
      { value: formatCount(s.demo_accounts_created),  label: 'Demo accounts created' },
    ];
  }, [statsData]);

  // CivicView Stats dropdown — starts collapsed per design feedback.
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

          {/* CivicView Stats — wrapped in a collapsible so the hero CTA
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
              <>
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
                {/* "More stats →" — entry point to the future /stats
                    expanded analytics page (Task #71). Sized
                    deliberately small so the tiles remain the visual
                    anchor; the link is a quiet follow-up affordance,
                    not a call-to-action. */}
                <div style={{ marginTop: 14 }}>
                  <Link
                    href="/stats"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 'var(--cl-text-sm)',
                      fontWeight: 600,
                      color: 'var(--cl-accent)',
                      textDecoration: 'none',
                      fontFamily: 'var(--cl-font-sans)',
                    }}
                  >
                    More stats <ArrowRight size={12} active />
                  </Link>
                </div>
              </>
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
            <CivicViewLogo
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
// Live data via GET /api/feed/posts — the same endpoint /posts uses
// for its canonical feed, capped to 3 items for the home-page
// sample. Reusing the endpoint guarantees the cards here look and
// behave identically to /posts (likes, comments accordion, edit /
// delete affordances, login-required gating) — single source of
// truth for the post-feed shape.
//
// Cards render through the shared FeedCard component (kind='post')
// so every fix to the canonical feed lands here for free. Singleton
// comments-open state lives at the section level so opening one
// thread closes any other already-open thread.
//
// Empty-state behavior: when the API returns `items: []` (fresh-
// launch state) or errors, the explanatory ActivityEmptyState tile
// renders instead of the card list. An "All posts →" link lives
// below the cards as the overflow path to the canonical feed.
// ─────────────────────────────────────────────────────────────────

function NationalActivitySection({ onRequestVerify, citizen }) {
  // Sign-in computation mirrors GrassrootsFeed (/polls + /posts): any
  // identity (citizen / rep / candidate) counts. FeedCard uses signedIn
  // as the engagement gate — react / comment actions require it.
  // We pull rep + candidate auth here (citizen is already a prop) so a
  // rep or candidate visiting the home page can still interact with
  // posts in the National activity section without bouncing through
  // the citizen-login modal.
  const { me: rep } = useRepAuth();
  const { candidate } = useCandidateAuth();
  const signedIn = !!citizen || !!rep || !!candidate;

  // National Activity is collapsible like the rest of the NOP sections.
  // Defaults to collapsed because the feed is full-fat FeedCards now —
  // even three of them push the page tall on first load. Users who
  // want to scan current activity expand the section; their choice
  // persists across reloads.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:activity', false);

  // Lazy-fetch on first expand. Skipping the fetch while collapsed
  // saves a round-trip on the (common) case of users who don't open
  // the section. Once fetched, the result sticks until a reload — we
  // don't bother with revalidation because the home-page feed is
  // intentionally a lightly-stale summary. `null` = not loaded yet.
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Singleton comments accordion — only one card's thread is open at
  // a time. Same pattern GrassrootsFeed uses on /polls + /posts so the
  // home-page National activity behaves identically to the canonical
  // feed when a user opens a comment thread.
  const [openCommentId, setOpenCommentId] = useState(null);
  const toggleComments = useCallback((cardId) => {
    setOpenCommentId((prev) => (prev === cardId ? null : cardId));
  }, []);

  // Shared loader. Splitting it out of useEffect so the FeedCard
  // onMutated callback (fired by destructive actions like delete-post)
  // can re-trigger a full reload.
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    // Same endpoint /posts uses, capped to the home-page sample size.
    // No `kinds` or `state` filter — National activity is a broad
    // sweep across rep + candidate authors nationwide. Five cards
    // (Jeffrey's call, May 28) — enough sampling to feel like real
    // activity without dominating the page.
    const { data, error: err } = await fetchPostsFeed({ limit: 5 });
    if (err || !data) {
      setError(true);
      setItems([]);
    } else {
      setItems(Array.isArray(data.items) ? data.items : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Trigger once per (open transition × empty result). `loading` is
    // intentionally NOT in the deps — having it there would re-run
    // this effect when setLoading(true) flips the state, which
    // cancels the in-flight fetch via the cleanup function before it
    // can resolve (the symptom: skeleton tiles that never go away).
    if (!open || items !== null) return;
    let cancelled = false;
    (async () => {
      await load();
      // No cancel-aware setState here — load() owns its own state
      // updates and a short fetch + cheap setItems is fine to apply
      // even on a fast unmount.
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items]);

  // In-place patch for a single card (preferred over a full reload —
  // no scroll jump, only the touched card re-renders). Mirrors
  // GrassrootsFeed's onCardUpdated implementation exactly so the two
  // surfaces stay behaviorally identical.
  const handleCardUpdated = useCallback((cardId, patch) => {
    setItems((prev) => (prev || []).map((it) => (
      it.id === cardId
        ? { ...it, ...patch, viewer: { ...(it.viewer || {}), ...(patch.viewer || {}) } }
        : it
    )));
  }, []);

  return (
    <section style={{ padding: '32px 24px 16px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Past 24 hours"
          title="National activity"
          subhead="Recent posts from reps and candidates across the country"
          chip={null}
          collapsible
          open={open}
          onToggle={toggleOpen}
        />
        {open && (
          <>
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} height={200} radius={16} />
                ))}
              </div>
            )}
            {!loading && items && items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((p) => (
                  <FeedCard
                    key={p.id}
                    card={p}
                    kind="post"
                    isCommentsOpen={openCommentId === p.id}
                    onToggleComments={() => toggleComments(p.id)}
                    signedIn={signedIn}
                    onLoginRequired={onRequestVerify}
                    onCardUpdated={handleCardUpdated}
                    onMutated={load}
                    citizenViewer={citizen}
                  />
                ))}
              </div>
            )}
            {!loading && items && items.length === 0 && (
              <ActivityEmptyState error={error} />
            )}
            {/* "All posts →" — entry point to the /posts canonical
                feed. Always rendered when items exist, regardless of
                auth state — anyone can browse /posts, the FeedCards
                there gate interaction the same way these do. */}
            {!loading && items && items.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <Link
                  href="/posts"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'transparent',
                    color: 'var(--cl-accent)',
                    fontSize: 'var(--cl-text-sm)',
                    fontWeight: 600,
                    textDecoration: 'none',
                    fontFamily: 'var(--cl-font-sans)',
                  }}
                >
                  All posts
                  <ArrowRight size={12} active color="accent" />
                </Link>
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

// ────────────────────────────────────────────────────────────────
// POPULAR POLLS — live data from GET /api/feed/popular-polls.
//
// The endpoint now returns the SAME rich feed-item shape as the
// /polls feed (ordered by total votes instead of recency), so this
// section renders through the shared FeedCard component (kind='poll')
// exactly like the /polls page and the rep/candidate pages. Voting,
// like / dislike, the comments accordion, the kebab menu, and the
// "Act as" identity picker all work inline — no more static bar-chart
// preview. Every fix that lands on FeedCard ships here for free.
//
// Empty-state behavior matches National activity: PollsEmptyState
// renders when the API returns `items: []` (fresh-launch state) or
// errors. An "All polls →" link below the cards is the overflow path
// to the canonical /polls feed; anonymous viewers fall through
// FeedCard's onLoginRequired gate on any engagement action.
// ────────────────────────────────────────────────────────────────

function PopularPollsSection({ onRequestVerify, citizen }) {
  // Sign-in computation mirrors NationalActivitySection (and
  // GrassrootsFeed on /polls): any identity — citizen, rep, or
  // candidate — counts as signed in for FeedCard's engagement gate.
  // We pull rep + candidate auth here so a rep or candidate visiting
  // the home page can vote / like / comment on a popular poll without
  // bouncing through the citizen-login modal.
  const { me: rep } = useRepAuth();
  const { candidate } = useCandidateAuth();
  const signedIn = !!citizen || !!rep || !!candidate;

  // Collapsible like every NOP section. Defaults collapsed: the feed
  // is now full-fat FeedCards (tall) rather than the old compact
  // bar-chart grid, so forcing it open would push the sections below
  // it well off the fold.
  const [open, toggleOpen] = usePersistentToggle('cl:nop:popular-polls', false);

  // Lazy-fetch on first expand. `loading` is intentionally NOT in the
  // effect deps — see NationalActivitySection for the cancellation
  // loop this avoids. `null` = not loaded yet.
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Singleton comments accordion — one open thread at a time, matching
  // /polls and the National activity section.
  const [openCommentId, setOpenCommentId] = useState(null);
  const toggleComments = useCallback((cardId) => {
    setOpenCommentId((prev) => (prev === cardId ? null : cardId));
  }, []);

  // Shared loader so FeedCard's onMutated (destructive actions like
  // close-poll) can re-trigger a full reload.
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    // Rich feed items ordered by total votes. Five cards — matches the
    // National activity sample size (Jeffrey's May 28 call).
    const { data, error: err } = await fetchPopularPolls({ limit: 5 });
    if (err || !data) {
      setError(true);
      setItems([]);
    } else {
      setItems(Array.isArray(data.items) ? data.items : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open || items !== null) return;
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items]);

  // In-place patch for one card — no scroll jump, only the touched
  // card re-renders. Mirrors NationalActivitySection / GrassrootsFeed.
  const handleCardUpdated = useCallback((cardId, patch) => {
    setItems((prev) => (prev || []).map((it) => (
      it.id === cardId
        ? { ...it, ...patch, viewer: { ...(it.viewer || {}), ...(patch.viewer || {}) } }
        : it
    )));
  }, []);

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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} height={220} radius={16} />
                ))}
              </div>
            )}
            {!loading && items && items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((p) => (
                  <FeedCard
                    key={p.id}
                    card={p}
                    kind="poll"
                    isCommentsOpen={openCommentId === p.id}
                    onToggleComments={() => toggleComments(p.id)}
                    signedIn={signedIn}
                    onLoginRequired={onRequestVerify}
                    onCardUpdated={handleCardUpdated}
                    onMutated={load}
                    citizenViewer={citizen}
                  />
                ))}
              </div>
            )}
            {!loading && items && items.length === 0 && (
              <PollsEmptyState error={error} />
            )}
            {/* "All polls →" — entry point to the /polls canonical feed.
                Always rendered when items exist, regardless of auth state:
                anyone can browse /polls, and the FeedCards there gate
                interaction the same way these do. Replaces the old
                "Sign in to vote" CTA, which was dead weight once FeedCard
                started handling anonymous viewers via onLoginRequired. */}
            {!loading && items && items.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <Link
                  href="/polls"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'transparent',
                    color: 'var(--cl-accent)',
                    fontSize: 'var(--cl-text-sm)',
                    fontWeight: 600,
                    textDecoration: 'none',
                    fontFamily: 'var(--cl-font-sans)',
                  }}
                >
                  All polls
                  <ArrowRight size={12} active color="accent" />
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// HomeBillsSection — "Bills" home-page section (Phase B). Surfaces the
// latest Senate + House roll-call vote as compact cards that link into
// the /bills page. Lightweight: uses the recent-votes list only (cite +
// status + tally + date) — no per-member fetch. Sits between Popular
// polls and Browse by state.
// ─────────────────────────────────────────────────────────────────
function homeVoteStatus(result) {
  const s = (result || '').toLowerCase();
  if (s.includes('confirm')) return { label: 'Confirmed', good: true };
  if (s.includes('reject')) return { label: 'Rejected', good: false };
  if (s.includes('fail')) return { label: 'Failed', good: false };
  if (s.includes('pass') || s.includes('agreed') || s.includes('well taken')) return { label: 'Passed', good: true };
  return { label: result || 'Result', good: true };
}

function HomeVoteCard({ vote }) {
  const st = homeVoteStatus(vote.result);
  const chamber = vote.chamber === 'senate' ? 'Senate' : 'House';
  const cite = vote.issue || vote.title || ('Roll ' + vote.rollcall);
  const yea = (vote.tally && vote.tally.yea) || 0;
  const nay = (vote.tally && vote.tally.nay) || 0;
  const total = (yea + nay) || 1;
  const yeaPct = (yea / total) * 100;
  return (
    <Link
      href="/bills"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-2xl)',
        boxShadow: 'var(--cl-shadow-card)',
        padding: '14px 16px',
        fontFamily: 'var(--cl-font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Eyebrow tone="accent">{chamber + ' · ' + (vote.kind === 'nomination' ? 'Nomination' : 'Passage')}</Eyebrow>
        <span
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: 'var(--cl-radius-pill)',
            fontSize: '0.68rem',
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            background: st.good ? 'var(--cl-success-soft)' : 'var(--cl-danger-soft)',
            color: st.good ? 'var(--cl-success-text)' : 'var(--cl-danger-text)',
            border: '1px solid ' + (st.good ? 'var(--cl-success-border)' : 'var(--cl-danger-border)'),
            whiteSpace: 'nowrap',
          }}
        >
          {st.label}
        </span>
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--cl-text-lg)', fontWeight: 700, letterSpacing: '-0.01em' }}>{cite}</span>
        {vote.date && <span style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-muted)' }}>{vote.date}</span>}
      </div>
      {vote.question && (
        <p
          style={{
            margin: '4px 0 10px',
            fontSize: 'var(--cl-text-sm)',
            color: 'var(--cl-text-light)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {vote.question}
        </p>
      )}
      <div style={{ display: 'flex', height: 20, borderRadius: 'var(--cl-radius-sm)', overflow: 'hidden', border: '1px solid var(--cl-border)' }}>
        <div style={{ width: yeaPct + '%', background: '#2d6a4f', color: '#fff', fontSize: '0.66rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
          {yeaPct > 16 ? 'Yea ' + yea : ''}
        </div>
        <div style={{ width: (100 - yeaPct) + '%', background: '#d63031', color: '#fff', fontSize: '0.66rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
          {100 - yeaPct > 16 ? 'Nay ' + nay : ''}
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-muted)' }}>{'Yea ' + yea + ' · Nay ' + nay}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--cl-accent)', fontSize: 'var(--cl-text-sm)', fontWeight: 600 }}>
          View chart
          <ArrowRight size={12} active color="accent" />
        </span>
      </div>
    </Link>
  );
}

function HomeBillsSection() {
  const [open, setOpen] = useState(true);
  const [senate, setSenate] = useState(null);
  const [house, setHouse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [s, h] = await Promise.all([
      fetchRecentVotes('senate', 1),
      fetchRecentVotes('house', 1),
    ]);
    const sv = (s.data && s.data[0]) || null;
    const hv = (h.data && h.data[0]) || null;
    setSenate(sv);
    setHouse(hv);
    if (!sv && !hv) setError(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasAny = !!(senate || house);

  return (
    <section style={{ padding: '32px 24px 16px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="On the floor"
          title="Bills"
          subhead="The latest roll-call votes in the Senate and House."
          chip={null}
          collapsible
          open={open}
          onToggle={() => setOpen((o) => !o)}
        />
        {open && (
          <>
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Skeleton height={132} radius={16} />
                <Skeleton height={132} radius={16} />
              </div>
            )}
            {!loading && hasAny && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {senate && <HomeVoteCard vote={senate} />}
                {house && <HomeVoteCard vote={house} />}
              </div>
            )}
            {!loading && error && (
              <div
                style={{
                  background: 'var(--cl-card)',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 'var(--cl-radius-2xl)',
                  padding: '22px 16px',
                  textAlign: 'center',
                  color: 'var(--cl-text-muted)',
                  fontSize: 'var(--cl-text-sm)',
                }}
              >
                No recent floor votes right now. Check back when Congress is in session.
              </div>
            )}
            {!loading && hasAny && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <Link
                  href="/bills"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'transparent',
                    color: 'var(--cl-accent)',
                    fontSize: 'var(--cl-text-sm)',
                    fontWeight: 600,
                    textDecoration: 'none',
                    fontFamily: 'var(--cl-font-sans)',
                  }}
                >
                  View all votes
                  <ArrowRight size={12} active color="accent" />
                </Link>
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


// NOTE: The previous ActivityPostRow component was removed when
// NationalActivitySection switched to rendering the shared FeedCard
// (kind='post') in PR #72. The home-page National activity cards
// now match the /posts canonical feed bit-for-bit — likes, comments
// accordion, edit / delete, login gating — instead of a stripped
// row with a "Sign in to participate →" link.

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
              <CivicViewLogo size={20} variant="color" />
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
          {/* About column — links to the five legal/info pages under
              app/. All routes use the LegalPageLayout shared chrome
              (navbar + back button + content container). Task #85
              added these — before that the column was placeholder
              labels with onClick=null that rendered as muted text. */}
          <FooterColumn
            heading="About"
            links={[
              { label: 'Methodology',         href: '/methodology' },
              { label: 'Editorial standards', href: '/editorial-standards' },
              { label: 'Privacy',             href: '/privacy' },
              { label: 'Terms of service',    href: '/terms' },
              { label: 'Contact',             href: '/contact' },
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
  // Each link supports three shapes (in priority order):
  //   { label, href }     → real route link via <a href>. Used by the
  //                         About column for /methodology, /privacy,
  //                         /terms, /contact, /editorial-standards.
  //   { label, onClick }  → in-page action. Used by Browse + Citizen
  //                         columns (scroll-to-section, open modal).
  //   { label }           → muted placeholder. Reserved for future
  //                         columns where the destination doesn't yet
  //                         exist.
  const linkStyle = {
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 'var(--cl-text-sm)',
    color: 'var(--cl-text)',
    fontFamily: 'var(--cl-font-sans)',
    cursor: 'pointer',
    textAlign: 'left',
    textDecoration: 'none',
  };
  return (
    <div>
      <Eyebrow style={{ marginBottom: 10 }}>{heading}</Eyebrow>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {links.map((l) => {
          const onHoverEnter = (e) => { e.currentTarget.style.color = 'var(--cl-accent)'; };
          const onHoverLeave = (e) => { e.currentTarget.style.color = 'var(--cl-text)'; };
          return (
            <li key={l.label}>
              {l.href ? (
                <a
                  href={l.href}
                  style={linkStyle}
                  onMouseOver={onHoverEnter}
                  onMouseOut={onHoverLeave}
                >
                  {l.label}
                </a>
              ) : typeof l.onClick === 'function' ? (
                <button
                  type="button"
                  onClick={l.onClick}
                  style={linkStyle}
                  onMouseOver={onHoverEnter}
                  onMouseOut={onHoverLeave}
                >
                  {l.label}
                </button>
              ) : (
                // Inactive placeholder — rendered as muted text so
                // users don't try to click destinations that don't
                // exist yet. None of the current columns use this
                // path after Task #85 wired the About column to real
                // routes, but the shape stays for future use.
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
        {/* photo_url (snake_case from federal_officials.json) and
            photoUrl (camelCase from elsewhere in the codebase) are
            both supported. Avatar falls back to initials cleanly if
            the URL 404s. */}
        <Avatar
          src={person.photo_url || person.photoUrl || person.image}
          name={person.name}
          party={person.party}
          size="lg"
        />
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
                photoUrl: person.photo_url || person.photoUrl || person.image,
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
        <Avatar
          src={person.photo_url || person.photoUrl || person.image}
          name={person.name}
          party={person.party}
          size="md"
        />
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
                photoUrl: person.photo_url || person.photoUrl || person.image,
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
