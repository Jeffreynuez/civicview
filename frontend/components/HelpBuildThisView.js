'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * HelpBuildThisView — full-page overlay that publishes the project's
 * transparent status: what's shipped, what's in progress, what's
 * blocked on real-dollar funding (with exact amounts and source
 * citations so backers can sanity-check the numbers), the future
 * product features list, and a primary CTA to the crowdfund.
 *
 * Why surface this so prominently? Civic-tech projects live or die on
 * trust. Backers need to see specific numbers tied to specific
 * unlocks ("$1,050 → trademark filing" beats "help fund our growth"
 * by a wide margin), and visitors who can't or won't donate should
 * still be able to see exactly where the project is and where it's
 * going. That's the whole pitch of going grassroots over investor.
 *
 * Props:
 *   onClose() — collapse the overlay
 *   compactNavbar — the slim Navbar shown at the top of the overlay
 *                   for consistency with PageView's chrome.
 */
import { useEffect } from 'react';
import Navbar from './Navbar';

// Placeholder until the user has the actual crowdfund URL. Updating
// this in one place propagates through every CTA on the page.
const CROWDFUND_URL = 'https://www.gofundme.com/civicview';
const CROWDFUND_LIVE = false; // flip to true once the campaign is up

// ── Content — single source of truth for what's done / WIP / blocked.
// Keep entries short; long-form rationale lives in the README. Each
// blocked-on-funding line carries an exact dollar amount and a source
// the user can audit, which is the whole point of going transparent.

const DONE = [
  'Interactive U.S. map with all 50 states and 435 congressional districts',
  'Federal officials directory: President, Vice President, Cabinet, SCOTUS, House + Senate leadership',
  'Florida coverage: state senate + house, statewide executives, 2026 candidates, election dates',
  'Address lookup that resolves a street address, ZIP, or city name to your specific representative',
  'Rep pages with posts, polls (4 visibility modes), comments, reactions, an owner dashboard, and an engagement scope filter',
  'Citizen-led polls on unclaimed rep pages: 1 active per user per page, 20 active polls per page cap, archive-on-claim, moderation reports',
  '"On the ballot" home-page surface with key election dates and a featured race',
  '"Popular polls" home-page surface mixing rep-authored and citizen-authored polls',
  '"National activity" home-page surface alternating R/D posts',
  'Self-serve demo citizen accounts — any visitor can pick a name + state + district and try the engagement features end-to-end',
  'Mobile + desktop responsive layouts, including a draggable map/panel split on phones',
  'Installable PWA on Android + iOS — pin to home screen for a near-app-store experience',
  'Light-only theme that respects each component\'s design (OS dark mode handled at the chrome level)',
  'Address verification waitlist, "Claim this page" waitlist for real reps',
];

const WIP = [
  'Filling out the remaining 49 states with full profile photos, issues, experience, state legislators, and local-rep data — content work, ongoing',
  'Feedback inbox (next item on the build list)',
  'Crowdfunding launch + tax / legal structure (forming an LLC, evaluating 501(c)(3))',
];

// Funding items. Each has:
//   item        — what the money buys
//   cost        — display string with the exact figure
//   citation    — where the number comes from, plus URL when applicable
//   unlocks     — what the user / project gets when this is funded
const FUNDING = [
  {
    item: 'Verified citizen identity (ID.me Relying Party contract)',
    cost: '~$2,400 setup + ~$1.50 per verified user',
    citation: 'ID.me business pricing for civic-tech Relying Parties (id.me/business)',
    unlocks:
      'Real "Verified citizen" badges replace today\'s "Unverified" labels. Vote integrity, district-scoped engagement, and abuse moderation all become meaningfully reliable.',
  },
  {
    item: 'Federal trademark filing — CivicView wordmark + glyph',
    cost: '$1,050 — three classes × $350 (TEAS Standard)',
    citation: 'USPTO fee schedule, uspto.gov/learning-and-resources/fees-and-payment',
    unlocks: 'Protects the CivicView name from copycats once the user base grows. Three classes cover software (9), SaaS (42), and online community services (45).',
  },
  {
    item: 'DMCA agent registration',
    cost: '$6 every 3 years',
    citation: 'dmca.copyright.gov',
    unlocks: 'Required for §512 safe-harbor protection now that citizens can post polls and comments. Without it, the project carries personal liability for any user-generated content.',
  },
  {
    item: 'ProPublica Congress API (Pro tier)',
    cost: '$500 / month',
    citation: 'projects.propublica.org/api-docs/congress-api/ — Pro tier for full historical + commercial use',
    unlocks: 'Real-time bill text, sponsor lists, roll-call votes, committee membership across all 535 members. Currently we ship a curated snapshot.',
  },
  {
    item: 'OpenStates API (Pro tier)',
    cost: '$100 / month',
    citation: 'openstates.org/pricing',
    unlocks: 'State legislature data for all 50 states. Today we have Florida hand-curated; this unblocks the other 49 states\' state senators, reps, and bills.',
  },
  {
    item: 'Google Civic Information API (paid tier at scale)',
    cost: 'Free up to current usage; estimated $200–500 / month at scale',
    citation: 'developers.google.com/civic-information',
    unlocks: 'Polling-place lookup, sample-ballot data, official-rep contact info that stays current automatically.',
  },
  {
    item: 'Domain renewal — civicview.app',
    cost: '$15 / year',
    citation: 'Cloudflare Registrar at-cost pricing',
    unlocks: 'Keeps the project at its primary domain.',
  },
  {
    item: 'Hosting — Render web service + Postgres (upgraded from free)',
    cost: '~$15 / month combined',
    citation: 'render.com/pricing — Starter plan eliminates the free-tier cold-start delay',
    unlocks: 'No 50-second spin-up on first visit. Database stays warm.',
  },
  {
    item: 'Vercel Pro (frontend) — only if free tier hits limits',
    cost: '$20 / month',
    citation: 'vercel.com/pricing',
    unlocks: 'Higher bandwidth quotas, better cache-purge, team features. Defer until usage demands it.',
  },
];

const FUTURE_FEATURES = [
  {
    title: 'Video posts on rep / candidate pages',
    detail: 'Let verified reps attach video to their posts. Needs a transcoding pipeline (Mux or Cloudflare Stream), a size cap, and a moderation queue tied into the existing DMCA flow.',
  },
  {
    title: 'Live-streamed town halls',
    detail: 'Rep goes Live, citizens get a push notification using the PWA stack already in place, the stream archives back into their post feed afterward. Pairs naturally with the existing Pages comment thread.',
  },
  {
    title: '1-on-1 live debates between reps / candidates',
    detail: 'Request / accept flow where one official can challenge another to a scheduled live debate. Surfaced on both their pages and on the On-the-ballot home section while live. Same streaming infrastructure as town halls.',
  },
  {
    title: 'Optional citizen nicknames',
    detail: 'Verified citizens can choose a display nickname instead of their legal name on every public surface. Identity verification still happens against the real name + address; the community just sees the user\'s chosen handle.',
  },
];

const AI_FEATURES = {
  title: 'AI integration (planned — xAI / Grok)',
  detail:
    'Once funding allows, integrate an LLM (xAI Grok or comparable) for: bill-summary generation in plain English, personalized civic digests by user district, automatic detection of campaign-finance anomalies, and a "what changed since I last checked" feed. xAI has a public API — this is a regular dev integration, not a partnership ask.',
};

export default function HelpBuildThisView({ onClose, compactNavbarProps = {} }) {
  // Lock background scroll while the overlay is up — same pattern as
  // PageView. Prevents iOS rubber-band from exposing the map behind.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Help build CivicView"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1200,
        background: 'var(--cl-bg)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Compact navbar at the top — same chrome the PageView overlay
          uses. The user can sign in / out, hit Subscribe, jump to My
          Tracked from inside this view. */}
      <div style={{ flex: '0 0 auto' }}>
        <Navbar compact {...compactNavbarProps} onHome={onClose} />
      </div>

      {/* Page-level top bar — Back to map, page title, no rep-login
          because this isn't a rep page. */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '10px 18px',
          background: 'white',
          borderBottom: '1px solid var(--cl-border)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--cl-border)', background: 'white',
            color: 'var(--cl-text)', fontSize: '0.85rem', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div
          style={{
            fontSize: '0.9rem', fontWeight: 700, color: 'var(--cl-text)',
            textAlign: 'center', flex: 1, minWidth: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          Help build CivicView
        </div>
        <div style={{ width: 60 }} aria-hidden /> {/* spacer for layout balance */}
      </div>

      {/* Scrollable content. Single scroll container so the in-page
          anchor links (if we add them later) work without juggling
          multiple scroll contexts. */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px 64px' }}>
          {/* Hero */}
          <HeroBlock />

          <SectionTitle eyebrow="What's shipped" title="Already built" />
          <CheckList items={DONE} icon="check" />

          <SectionTitle eyebrow="What's next" title="In progress" />
          <CheckList items={WIP} icon="gear" />

          <SectionTitle
            eyebrow="Where the money goes"
            title="Blocked on funding"
            subtitle="Every line below is an exact cost with a citation. Backers can verify the numbers themselves; we'd rather over-disclose than handwave."
          />
          <FundingTable rows={FUNDING} />

          <SectionTitle
            eyebrow="On the roadmap"
            title="Future product features"
            subtitle="What we want to build once the funding side gets stable. Each entry is a real feature with real infra implications, not a wish list."
          />
          <FeatureCardList items={FUTURE_FEATURES} />

          <SectionTitle eyebrow="Future direction" title={AI_FEATURES.title} />
          <p
            style={{
              fontSize: '0.95rem',
              lineHeight: 1.55,
              color: 'var(--cl-text)',
              background: 'var(--cl-card)',
              border: '1px solid var(--cl-border)',
              borderRadius: 12,
              padding: 16,
              margin: 0,
            }}
          >
            {AI_FEATURES.detail}
          </p>

          {/* Footer CTA — second crack at the GoFundMe button after the
              user has read the whole pitch. */}
          <div style={{ marginTop: 40, textAlign: 'center' }}>
            <FundButton inline />
            <p
              style={{
                marginTop: 12,
                fontSize: '0.78rem',
                color: 'var(--cl-text-light)',
                fontStyle: 'italic',
              }}
            >
              Questions or feedback? Use the Feedback tab in the navbar —
              we read every submission and either turn it into a fix, an
              update, or a new entry on the future-features list.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hero block — short mission statement + primary GoFundMe CTA.
// ─────────────────────────────────────────────────────────────────────
function HeroBlock() {
  return (
    <section
      style={{
        background: 'linear-gradient(135deg, var(--cl-primary), #2a3d5a)',
        color: 'white',
        borderRadius: 16,
        padding: '28px 24px',
        marginBottom: 28,
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'rgba(255,255,255,0.7)',
          marginBottom: 8,
        }}
      >
        Grassroots civic tech
      </div>
      <h1
        style={{
          fontSize: '1.7rem',
          fontWeight: 800,
          margin: 0,
          marginBottom: 12,
          lineHeight: 1.2,
          fontFamily: 'var(--cl-font-display)',
        }}
      >
        Every civic app stops at &ldquo;here&apos;s your rep.&rdquo; <br />
        We&rsquo;re making politicians actually answerable.
      </h1>
      <p
        style={{
          fontSize: '0.95rem',
          lineHeight: 1.55,
          margin: 0,
          marginBottom: 20,
          color: 'rgba(255,255,255,0.88)',
        }}
      >
        CivicView gives every U.S. citizen a direct line to their
        representatives — track their votes, see their posts, ask them
        questions in polls, push back in comments, all scoped to the
        district they actually represent. Below is a transparent breakdown
        of what&rsquo;s built, what&rsquo;s in progress, and what specific
        dollar amounts unlock the rest. No equity, no ads, no investor
        carve-outs — just citizens funding citizen infrastructure.
      </p>
      <FundButton primary />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Primary GoFundMe button. Disabled / grayed when the campaign isn't
// live yet so visitors aren't sent to a 404 — clearer than hiding it.
// ─────────────────────────────────────────────────────────────────────
function FundButton({ primary = false, inline = false }) {
  const label = CROWDFUND_LIVE ? 'Back the project on GoFundMe →' : 'Crowdfund launching soon';
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: inline ? '12px 20px' : '12px 18px',
    borderRadius: 999,
    fontFamily: 'inherit',
    fontWeight: 700,
    fontSize: inline ? '1rem' : '0.95rem',
    cursor: CROWDFUND_LIVE ? 'pointer' : 'not-allowed',
    border: 'none',
    textDecoration: 'none',
    transition: 'transform 0.15s ease',
  };
  const variant = primary
    ? {
        background: 'var(--cl-warning, #ffba08)',
        color: '#1a1a1a',
      }
    : {
        background: 'var(--cl-accent)',
        color: 'white',
      };
  const disabledStyle = CROWDFUND_LIVE
    ? {}
    : { opacity: 0.6, background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)' };

  if (!CROWDFUND_LIVE) {
    return (
      <span
        role="button"
        aria-disabled
        style={{ ...base, ...variant, ...disabledStyle }}
      >
        {label}
      </span>
    );
  }
  return (
    <a
      href={CROWDFUND_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...base, ...variant }}
    >
      {label}
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section title with optional eyebrow + subtitle.
// ─────────────────────────────────────────────────────────────────────
function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div style={{ marginTop: 32, marginBottom: 14 }}>
      {eyebrow && (
        <div
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--cl-accent)',
            marginBottom: 6,
          }}
        >
          {eyebrow}
        </div>
      )}
      <h2
        style={{
          fontSize: '1.3rem',
          fontWeight: 700,
          margin: 0,
          color: 'var(--cl-text)',
          fontFamily: 'var(--cl-font-display)',
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontSize: '0.88rem',
            lineHeight: 1.5,
            color: 'var(--cl-text-light)',
            margin: 0,
            marginTop: 6,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Check / gear list — used for DONE and WIP.
// ─────────────────────────────────────────────────────────────────────
function CheckList({ items, icon }) {
  const iconColor = icon === 'check' ? 'var(--cl-accent)' : 'var(--cl-warning-text, #b06b00)';
  return (
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {items.map((text, i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            background: 'var(--cl-card)',
            border: '1px solid var(--cl-border)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: '0.88rem',
            lineHeight: 1.45,
            color: 'var(--cl-text)',
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              marginTop: 2,
              color: iconColor,
              fontWeight: 800,
              fontSize: '0.95rem',
            }}
          >
            {icon === 'check' ? '✓' : '⚙'}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Funding table — line-by-line cost breakdown with citations.
// ─────────────────────────────────────────────────────────────────────
function FundingTable({ rows }) {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            padding: '14px 16px',
            borderTop: i === 0 ? 'none' : '1px solid var(--cl-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: '0.95rem',
                fontWeight: 700,
                color: 'var(--cl-text)',
                flex: 1,
                minWidth: 0,
              }}
            >
              {r.item}
            </div>
            <div
              style={{
                fontSize: '0.95rem',
                fontWeight: 700,
                color: 'var(--cl-accent)',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--cl-font-mono)',
              }}
            >
              {r.cost}
            </div>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--cl-text)', lineHeight: 1.5 }}>
            {r.unlocks}
          </div>
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--cl-text-light)',
              fontStyle: 'italic',
            }}
          >
            Source: {r.citation}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Card list for the longer future-features descriptions.
// ─────────────────────────────────────────────────────────────────────
function FeatureCardList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it, i) => (
        <article
          key={i}
          style={{
            background: 'var(--cl-card)',
            border: '1px solid var(--cl-border)',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <h3
            style={{
              fontSize: '0.98rem',
              fontWeight: 700,
              margin: 0,
              marginBottom: 6,
              color: 'var(--cl-text)',
            }}
          >
            {it.title}
          </h3>
          <p
            style={{
              fontSize: '0.85rem',
              lineHeight: 1.5,
              color: 'var(--cl-text-light)',
              margin: 0,
            }}
          >
            {it.detail}
          </p>
        </article>
      ))}
    </div>
  );
}
