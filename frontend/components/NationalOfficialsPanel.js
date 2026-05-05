'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchFederalOfficials } from '@/lib/api';
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
}) {
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
    return (
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton variant="card" withThumbnail />
        <Skeleton variant="list" count={3} />
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

      <ExecutiveBranchSection
        exec={exec}
        onSelectPerson={onSelectPerson}
        onNotify={onNotify}
        onCompareToggle={onCompareToggle}
        compareIds={compareIds}
        onOpenPage={onOpenPage}
      />

      <SenateLeadershipSection
        senate={congress.senate || {}}
        congressNumber={congress.congress_number}
        onSelectPerson={onSelectPerson}
        onNotify={onNotify}
        onCompareToggle={onCompareToggle}
        compareIds={compareIds}
        onOpenPage={onOpenPage}
      />

      <HouseLeadershipSection
        house={congress.house || {}}
        congressNumber={congress.congress_number}
        onSelectPerson={onSelectPerson}
        onNotify={onNotify}
        onCompareToggle={onCompareToggle}
        compareIds={compareIds}
        onOpenPage={onOpenPage}
      />

      <SCOTUSSection
        sc={judiciary.supreme_court || {}}
        onSelectPerson={onSelectPerson}
        onNotify={onNotify}
        onCompareToggle={onCompareToggle}
        compareIds={compareIds}
        onOpenPage={onOpenPage}
      />

      <NationalActivitySection onRequestVerify={handleVerifyClick} />

      <BrowseByStateSection onStatePick={onStatePick} />

      <VerificationCTAStrip onVerifyClick={handleVerifyClick} />

      <Footer />
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
  const STATS = [
    { value: '535',   label: 'Members of Congress' },
    { value: '50',    label: 'States covered' },
    { value: '12.4k', label: 'Verified citizens' },
  ];

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
        padding: '40px 24px 32px',
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

          <div
            style={{
              marginTop: 28,
              paddingTop: 20,
              borderTop: '1px solid var(--cl-border)',
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
// 2. EXECUTIVE BRANCH
// ─────────────────────────────────────────────────────────────────
function ExecutiveBranchSection({ exec, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
  const pres = exec.president;
  const vp = exec.vice_president;
  const cabinet = exec.cabinet || [];

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
        />

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

        {/* Cabinet — compact grid, 4 cols at desktop */}
        {cabinet.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <SubsectionLabel>
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
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 3. SENATE LEADERSHIP
// ─────────────────────────────────────────────────────────────────
function SenateLeadershipSection({ senate, congressNumber, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
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
        />
        <LeadershipGrid
          leadership={leadership}
          chamber="U.S. Senate"
          onSelectPerson={onSelectPerson}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 4. HOUSE LEADERSHIP
// ─────────────────────────────────────────────────────────────────
function HouseLeadershipSection({ house, congressNumber, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
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
        />
        <LeadershipGrid
          leadership={leadership}
          chamber="U.S. House of Representatives"
          onSelectPerson={onSelectPerson}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 5. SUPREME COURT
// ─────────────────────────────────────────────────────────────────
function SCOTUSSection({ sc, onSelectPerson, onNotify, onCompareToggle, compareIds, onOpenPage }) {
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
        />
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
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// 6. NATIONAL ACTIVITY FEED
//
// Seeded mock data for the demo — the design system spec calls for
// a balanced (D/R alternating) feed of recent posts from federal
// officials. Backend integration (a /api/feed/national endpoint
// aggregating posts across federal RepAccounts) is deferred. The
// fictional names + post bodies come from the National Officials
// Panel design review brief; "Alternates 4D · 4R for balanced scan"
// disclosure is preserved as a literal eyebrow line.
// ─────────────────────────────────────────────────────────────────

const NATIONAL_ACTIVITY_DEMO = [
  {
    id: 'na-1', party: 'D',
    author: 'Sen. Marisol Estévez', role: 'D-WA',
    when: '14m ago',
    body: 'Just finished oversight hearing on rural broadband subsidies. Three-year audit shows 41% of disbursed funds never reached households. Filed amendment requiring quarterly milestone reporting before next tranche. Full statement on the page.',
    likes: 1842, comments: 184,
  },
  {
    id: 'na-2', party: 'R',
    author: 'Rep. Chase Holloway', role: 'R-TN-7',
    when: '32m ago',
    body: 'Heard from over 200 small-business owners at the district roundtable today. Top concern by a wide margin: input cost volatility, particularly steel and lumber. Bringing those numbers back to Ways & Means this week.',
    likes: 967, comments: 92,
  },
  {
    id: 'na-3', party: 'D',
    author: 'Rep. Aamir Desai', role: 'D-NJ-3',
    when: '1h ago',
    body: 'Transit bill markup is moving Thursday. The amendment to preserve direct grants for legacy systems made it through committee 8–5. Long road ahead, but a real win for cities like Newark.',
    likes: 612, comments: 38,
  },
  {
    id: 'na-4', party: 'R',
    author: 'Sen. Wendell Marsh', role: 'R-WY',
    when: '2h ago',
    body: 'Joined a bipartisan letter to OMB requesting clear cost estimates on the federal-lands package before any vote moves. Both sides of this debate deserve real numbers.',
    likes: 528, comments: 47,
  },
  {
    id: 'na-5', party: 'D',
    author: 'Sen. Patricia Linn', role: 'D-IL',
    when: '4h ago',
    body: 'Statewide tour stop in Peoria today. Manufacturing town halls keep coming back to one question — how do we keep skilled workers from leaving for the coasts? Apprenticeship reauth is part of the answer.',
    likes: 743, comments: 62,
  },
  {
    id: 'na-6', party: 'R',
    author: 'Rep. Tomas Reyna', role: 'R-TX-22',
    when: '5h ago',
    body: 'Briefing on the border-tech pilot this morning. Pilot has cut processing time per encounter by 38% — encouraging numbers but I want to see the next quarter\'s data before committing to scale.',
    likes: 634, comments: 71,
  },
];

function NationalActivitySection({ onRequestVerify }) {
  return (
    <section style={{ padding: '32px 24px 16px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Past 24 hours"
          title="National activity"
          subhead="What national leaders are saying right now · alternating R / D for balanced scan"
          chip={null}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {NATIONAL_ACTIVITY_DEMO.map((post) => (
            <ActivityPostRow key={post.id} post={post} onRequestVerify={onRequestVerify} />
          ))}
        </div>
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
      </div>
    </section>
  );
}

function ActivityPostRow({ post, onRequestVerify }) {
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
  return (
    <section style={{ padding: '32px 24px 16px', background: 'var(--cl-bg-soft)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="All 50 states · plus DC"
          title="Browse by state"
          subhead="Pick a state to see its governor, senators, House delegation, and state legislature."
          chip={null}
        />
        {/* Grid: keeps 2 columns even at narrow side-panel widths. The
            minmax floor of 110px + auto-fit lets the panel fall back to
            1 column only at extreme narrow widths (<~250px). At wider
            widths it auto-expands to 3+ columns. */}
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
            what they say. CivicLens never shares or sells your address.
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
function Footer() {
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
                CivicLens
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
              CivicLens does not endorse any candidate, party, or position.
              We surface what officials say and do — and let citizens respond
              in their own districts.
            </p>
          </div>
          <FooterColumn
            heading="Browse"
            links={[
              { label: 'Executive branch', onClick: null },
              { label: 'Senate', onClick: null },
              { label: 'House', onClick: null },
              { label: 'Browse by state', onClick: null },
            ]}
          />
          <FooterColumn
            heading="Citizen"
            links={[
              { label: 'Verify your address', onClick: null },
              { label: 'My tracked', onClick: null },
              { label: 'Notifications', onClick: null },
              { label: 'Subscribe to a rep', onClick: null },
            ]}
          />
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
          <span>© {new Date().getFullYear()} CivicLens</span>
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
        {links.map((l) => (
          <li key={l.label}>
            <button
              type="button"
              onClick={l.onClick || (() => {})}
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
            >
              {l.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared section header
// ─────────────────────────────────────────────────────────────────
function SectionHeader({ eyebrow, title, subhead, chip }) {
  return (
    <header style={{ marginBottom: 16 }}>
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
      <h2
        className="cl-h1"
        style={{
          margin: 0,
          fontSize: 'var(--cl-text-2xl)',
          fontWeight: 700,
          letterSpacing: 'var(--cl-tracking-tight)',
        }}
      >
        {title}
      </h2>
      {subhead && (
        <div
          className="cl-body-sm"
          style={{ color: 'var(--cl-text-light)', marginTop: 4 }}
        >
          {subhead}
        </div>
      )}
    </header>
  );
}

function SubsectionLabel({ children }) {
  return (
    <div
      style={{
        textTransform: 'uppercase',
        letterSpacing: 'var(--cl-tracking-wider)',
        fontSize: 'var(--cl-text-2xs)',
        fontWeight: 800,
        color: 'var(--cl-text-light)',
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: '1px solid var(--cl-border)',
      }}
    >
      {children}
    </div>
  );
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
          <div
            style={{
              fontSize: 'var(--cl-text-sm)',
              fontWeight: 700,
              color: 'var(--cl-text)',
              marginTop: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              {person.name}
            </span>
            {person.party && <PartyChip party={person.party} size="xs" />}
          </div>
          {meta && (
            <div
              style={{
                fontSize: 'var(--cl-text-2xs)',
                color: 'var(--cl-text-light)',
                marginTop: 2,
              }}
            >
              {meta}
            </div>
          )}
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
