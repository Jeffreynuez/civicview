'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * HelpBuildThisView — full-page overlay for the project's transparent
 * status: what's shipped, what's in progress, what's blocked on
 * real-dollar funding (with exact amounts and source citations so
 * backers can sanity-check the numbers), the future product features
 * list, and a primary CTA to the crowdfund.
 *
 * Why surface this so prominently? Civic-tech projects live or die
 * on trust. Backers need to see specific numbers tied to specific
 * unlocks ("$1,050 → trademark filing" beats "help fund our growth"
 * by a wide margin), and visitors who can't or won't donate should
 * still be able to see exactly where the project is and where it's
 * going. That's the whole pitch of going grassroots over investor.
 *
 * Layout follows the Claude Design export at
 * /Design Exports/civicview-help-build-this-page/. Styles live in
 * ./HelpBuildThisView.css.
 *
 * Props:
 *   onClose() — collapse the overlay
 *   compactNavbarProps — the slim Navbar shown at the top of the
 *                       overlay (forwarded to <Navbar compact ... />)
 */
import { useEffect, useState } from 'react';
import Navbar from './Navbar';
import './HelpBuildThisView.css';

// Crowdfund link — flip CROWDFUND_LIVE to true once the campaign is up.
// CTA copy + progress meter + per-line "Fund this line" buttons all
// branch on this single flag.
const CROWDFUND_URL = 'https://www.gofundme.com/civicview';
const CROWDFUND_LIVE = false;

// Goal — line-item costs + operating buffer that bridges us to
// recurring subscription revenue. The 5-year financial model (in
// docs/civicview_financial_model.xlsx) shows cumulative break-even
// at the end of Year 3, once we hit ~50K users and ~1,500 paying
// subscribers at the modeled 3% conversion rate. The buffer covers
// ~6 months of Year-2 operations + LLC formation + a modest launch
// push so we don't run out of runway while subscription revenue
// ramps from $1.8K in Y1 to $90K in Y3.
//   One-time line items:    2,400 + 1,050 + 6           =  3,456
//   Year-1 recurring (12mo): (500 + 100 + 350 + 15 + 20)*12 + 15 = 11,835
//                                                       = 15,291
//   + Year-2 runway buffer (6 months)                   ≈  7,000
//   + LLC formation + legal + launch outreach           ≈  2,700
//                                                       ≈ 25,000
const FUND_GOAL = 25000;

// ────────────────────────────────────────────────────────────────────
// CONTENT — single source of truth. Keep entries concise; long-form
// rationale lives in the README. Each blocked-on-funding line carries
// an exact dollar amount and a source the user can audit, which is
// the whole point of going transparent.
// ────────────────────────────────────────────────────────────────────

// What's shipped — 30 items. AI integration, moderation, appeals,
// /polls feed, self-engagement, reply threading, candidate slice
// (auth + composer + dashboard + engagement parity), bill / vote /
// EO AI summaries, official photos, identity-model spec — all in
// the live shipped list. Volume itself is a trust signal — don't
// truncate.
const SHIPPED = [
  ['Interactive U.S. map', 'All 50 states + 435 congressional districts, click to drill in.'],
  ['Federal officials directory', 'President, VP, Cabinet, SCOTUS, House + Senate leadership, all 535 Congress members with profile photos.'],
  ['Florida full coverage', 'State senate + house, statewide execs, 2026 candidates, election dates.'],
  ['Address → rep lookup', 'Street / ZIP / city resolves to a specific representative.'],
  ['Rep pages', 'Posts, polls (4 visibility modes), comments, reactions, owner dashboard, scope filter.'],
  ['Citizen-led polls on unclaimed pages', 'Per-user / per-page caps, archive-on-claim.'],
  ['Standalone citizen polls', 'Not tied to any rep page, global rate-limited.'],
  ['Global /polls feed', 'Kind chips, comments, AI-powered semantic filter.'],
  ['AI integration', 'Claude Haiku 4.5 — comment sentiment + tone, semantic filter chips, post summarization, poll classification.'],
  ['Bill / vote / executive-order AI summaries', 'CRS summary + Haiku plain-English translation on every bill, "What was this vote?" explainer, EO abstract + Haiku translation on every EO. Cached per-bill, per-vote, per-EO.'],
  ['Moderation system', 'Report flow on every surface, auto-hide threshold, admin queue: Dismiss / Hide / Unhide / Suspend, cascade-hide on suspension.'],
  ['Appeals system', 'Citizens and reps can appeal hidden content + suspensions; admin queue with Grant / Deny + reason logging.'],
  ['Email notifications', 'Resend-powered — moderation events, appeal submissions, decisions, suspension notices.'],
  ['Three-identity auth', 'Rep / citizen / candidate sessions with distinct cookies + bearer tokens. Mutually-exclusive on the client, cross-origin-safe cookies.'],
  ['Candidate accounts', 'Self-serve login modal, admin-approved claim flow, dedicated dashboard. Shipped alongside the identity-model spec doc.'],
  ['Candidate page composer', 'Verified candidates can post + manage polls + run events on their own candidate page.'],
  ['Self-engagement', 'Reps + candidates can like, vote, and comment on their own posts and polls. Author badge surfaces page-owner voice in comment threads.'],
  ['Reply threading (two-party)', 'Top-level comments are open to all citizens; replies are gated to the post creator + the original commenter only. Prevents citizen-vs-citizen pile-ons while keeping the rep ↔ constituent conversation flowing.'],
  ['"On the ballot" home surface', 'Key election dates + a featured race.'],
  ['"Popular polls" home surface', 'Rep-authored and citizen-authored polls, mixed.'],
  ['"National activity" home surface', 'Alternating R/D posts.'],
  ['Demo citizen accounts', 'Pick a name + state + district and try the engagement features end-to-end.'],
  ['Constituent dashboard', 'My tracked pages, my polls, my comments, my hidden-by-moderation with one-click appeals.'],
  ['Responsive layouts', 'Mobile + desktop, including a draggable map / panel split on phones.'],
  ['Installable PWA', 'Pin to home screen on Android + iOS for a near-app-store feel.'],
  ['Light-only theme', 'Respects each component’s design; OS dark mode handled at the chrome level.'],
  ['Two waitlists', 'Address verification + "Claim this page" for real reps.'],
  ['Identity model spec', 'Source-of-truth PDF in docs/identity-model.pdf covering the three-tier engagement ladder, verification gates, lifecycle transitions, and the election-win promotion path.'],
];

const IN_PROGRESS = [
  ['Filling out the remaining 49 states', 'Profile photos, issues, experience, state legislators, local-rep data — content work, ongoing.'],
  ['In-app notifications', 'Web-push + in-app feed for replies, page-owner posts, poll-close alerts. Phase 6+ once the candidate slice fully bakes in.'],
  ['Election-win promotion flow', 'Winning candidate → rep account transition (promote-in-place per the identity-model spec), defeated-rep archive to read-only public.'],
  ['Feedback inbox', 'Next item on the build list.'],
  ['Crowdfunding launch + legal structure', 'Forming an LLC, evaluating 501(c)(3).'],
];

// Funding — grouped one-time vs recurring with cluster subtotals.
const FUNDING_ONETIME = [
  {
    title: 'Verified citizen identity (ID.me Relying Party contract)',
    cost: '$2,400',
    costSuffix: 'setup + $1.50/verified user',
    body: 'Real "Verified citizen" badges replace today’s "Unverified" labels. Vote integrity, district-scoped engagement, and abuse moderation all become meaningfully reliable.',
    source: 'ID.me business pricing for civic-tech Relying Parties, id.me/business',
  },
  {
    title: 'Federal trademark filing (CivicView, 3 classes)',
    cost: '$1,050',
    costSuffix: 'one-time',
    body: 'Protects the CivicView name from copycats once the user base grows. Three classes cover software (9), SaaS (42), and online community services (45).',
    source: 'USPTO fee schedule, uspto.gov/learning-and-resources/fees-and-payment',
  },
  {
    title: 'DMCA agent registration',
    cost: '$6',
    costSuffix: 'every 3 years',
    body: 'Required for §512 safe-harbor protection now that citizens can post polls and comments. Without it, the project carries personal liability for any user-generated content.',
    source: 'dmca.copyright.gov',
  },
];

const FUNDING_RECURRING = [
  {
    title: 'ProPublica Congress API (Pro tier)',
    cost: '$500',
    costSuffix: '/ month',
    body: 'Real-time bill text, sponsor lists, roll-call votes, committee membership across all 535 members. Currently we ship a curated snapshot.',
    source: 'projects.propublica.org/api-docs/congress-api — Pro tier for full historical + commercial use',
  },
  {
    title: 'OpenStates API (Pro tier)',
    cost: '$100',
    costSuffix: '/ month',
    body: 'State legislature data for all 50 states. Today we have Florida hand-curated; this unblocks the other 49 states’ state senators, reps, and bills.',
    source: 'openstates.org/pricing',
  },
  {
    title: 'Google Civic Information API (paid tier at scale)',
    cost: '$200–500',
    costSuffix: '/ month at scale',
    body: 'Polling-place lookup, sample-ballot data, official-rep contact info that stays current automatically. Free up to current usage.',
    source: 'developers.google.com/civic-information',
  },
  {
    title: 'Domain renewal — civicview.app',
    cost: '$15',
    costSuffix: '/ year',
    body: 'Keeps the project at its primary domain.',
    source: 'Cloudflare Registrar at-cost pricing',
  },
  {
    title: 'Hosting — Render web service + Postgres (upgraded from free)',
    cost: '~$15',
    costSuffix: '/ month combined',
    body: 'No 50-second spin-up on first visit. Database stays warm.',
    source: 'render.com/pricing — Starter plan eliminates the free-tier cold-start delay',
  },
  {
    title: 'Vercel Pro (frontend)',
    cost: '$20',
    costSuffix: '/ month, only if free tier hits limits',
    body: 'Higher bandwidth + analytics. Held in reserve; the free tier is fine for now.',
    source: 'vercel.com/pricing',
  },
];

// Buffer cluster — bridges the gap between Year-1 line items and the
// point at which subscription revenue covers recurring costs. The
// 5-year financial model projects cumulative break-even at the end
// of Year 3; raising buffer here means we don't have to do an
// emergency top-up campaign in Y2 when paid-user count is still
// climbing toward break-even.
const FUNDING_BUFFER = [
  {
    title: 'Year-2 operating runway (6 months)',
    cost: '$7,000',
    costSuffix: 'one-time buffer',
    body: 'Subscription revenue at the modeled 3% conversion is $1.8K in Y1 and $18K in Y2 — not enough to fully cover the growing ID.me verification bill + Render Pro tier yet. This 6-month cushion buys us through the ramp until paid users cross break-even (~end of Y2 at 300 paying subscribers).',
    source: '5-year financial model — see docs/civicview_financial_model.xlsx',
  },
  {
    title: 'LLC formation + legal + launch outreach',
    cost: '$2,700',
    costSuffix: 'one-time',
    body: 'State LLC filing fee, registered agent, lawyer review of terms of service + privacy policy (required before holding subscription funds or signing the ID.me Relying Party contract), plus a modest civic-tech press / event budget for launch.',
    source: 'Stripe Atlas / LegalZoom comparable pricing + civic-tech event fee schedules',
  },
];

// Roadmap — aspirational features, no cost estimates yet. Dropped
// the standalone "AI integration" entry because AI shipped (it now
// lives in SHIPPED).
const ROADMAP = [
  {
    title: 'Video posts on rep / candidate pages',
    body: 'Needs a transcoding pipeline (Mux or Cloudflare Stream), a sane size cap, and a moderation queue tied into the existing DMCA flow.',
    icon: 'video',
    tag: 'Needs infra',
  },
  {
    title: 'Live-streamed town halls',
    body: 'A rep goes live, citizens get a PWA push notification, the stream archives back into the post feed when it ends.',
    icon: 'live',
    tag: 'Wish list',
  },
  {
    title: '1-on-1 live debates between reps / candidates',
    body: 'Request / accept flow, surfaced on both pages and the On-the-ballot section while live. The high-trust use case for the streaming pipeline.',
    icon: 'debate',
    tag: 'Wish list',
  },
  {
    title: 'Optional citizen nicknames',
    body: 'Verified citizens can choose a display nickname instead of their legal name on public surfaces. Identity verification still happens against the real name underneath.',
    icon: 'nickname',
    tag: 'Privacy',
  },
];

const ONETIME_TOTAL_LABEL = '$3,456 total one-time';
const RECURRING_TOTAL_LABEL = '~$11,800 / first year';
const BUFFER_TOTAL_LABEL = '$9,700 operating buffer';
const LARGEST_PENDING = 'ProPublica · $500/mo';
const LARGEST_PENDING_SUB = 'unlocks all-50-states bill data';

const fmt$ = (n) => '$' + n.toLocaleString('en-US');

export default function HelpBuildThisView({ onClose, compactNavbarProps = {} }) {
  // Lock background scroll while the overlay is up — same pattern as
  // PageView. Prevents iOS rubber-band from exposing the map behind.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Section open/close state — funding section opens by default
  // (it's the trust artifact; receipts visible on first paint).
  const [open, setOpen] = useState(new Set(['money']));
  const toggle = (k) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  });

  return (
    <div
      role="dialog"
      aria-label="Help build CivicView"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1200,
      }}
    >
      <div className="hb-page">
        {/* Compact navbar — same chrome as PageView. */}
        <Navbar compact {...compactNavbarProps} onHome={onClose} />

        {/* Page top bar — back to map, page title, spacer. */}
        <div className="hb-topbar">
          <button type="button" className="hb-topbar__back" onClick={onClose}>
            <ArrowLeftIcon size={14} />
            <span>Back</span>
          </button>
          <div className="hb-topbar__title">Help build CivicView</div>
          <div className="hb-topbar__spacer" aria-hidden />
        </div>

        <div className="hb-scroll">
          <main className="hb-main">
            <Hero />
            <ProgressMeter />

            <Section
              eyebrow="What's shipped"
              title="Already built"
              count={SHIPPED.length}
              isOpen={open.has('shipped')}
              onToggle={() => toggle('shipped')}
              sub={open.has('shipped') ? null : 'Every feature already in production. The volume itself is the trust signal — expand to read the list.'}
            >
              <Checklist items={SHIPPED} kind="shipped" />
            </Section>

            <Section
              eyebrow="What's next"
              title="In progress"
              count={IN_PROGRESS.length}
              isOpen={open.has('progress')}
              onToggle={() => toggle('progress')}
            >
              <Checklist items={IN_PROGRESS} kind="progress" />
            </Section>

            <Section
              modifier="hb-section--money"
              eyebrow="Where the money goes"
              title="Blocked on funding"
              count={FUNDING_ONETIME.length + FUNDING_RECURRING.length + FUNDING_BUFFER.length}
              isOpen={open.has('money')}
              onToggle={() => toggle('money')}
              sub="Every line below is an exact cost with a citation. Backers can verify the numbers themselves; we'd rather over-disclose than handwave."
            >
              <div className="hb-money-intro">
                <span className="hb-money-intro__icon"><InfoIcon size={16} /></span>
                <div>
                  <strong>How to read this.</strong> Each row is one thing we can&rsquo;t ship without funding,
                  paired with the actual contract or pricing page. Grouped into one-time costs (paid once),
                  recurring (paid every month or year, on top), and an operating buffer that bridges us to
                  subscription-revenue break-even per our 5-year financial model.
                </div>
              </div>
              <MoneyCluster
                title="One-time costs"
                sub="paid once, then done"
                items={FUNDING_ONETIME}
                total={ONETIME_TOTAL_LABEL}
              />
              <MoneyCluster
                title="Recurring costs"
                sub="ongoing infra + data licenses"
                items={FUNDING_RECURRING}
                total={RECURRING_TOTAL_LABEL}
              />
              <MoneyCluster
                title="Operating buffer"
                sub="bridges us to subscription break-even"
                items={FUNDING_BUFFER}
                total={BUFFER_TOTAL_LABEL}
              />
            </Section>

            <Section
              eyebrow="On the roadmap"
              title="Future product features"
              count={ROADMAP.length}
              isOpen={open.has('roadmap')}
              onToggle={() => toggle('roadmap')}
              sub={open.has('roadmap') ? 'Aspirational — no costs yet. These get a "Fund this" treatment only after we scope the infra.' : null}
            >
              <Roadmap />
            </Section>

            <Footer />
          </main>
        </div>

        <StickyMobileCTA />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="hb-hero">
      {/* Faint watermark behind the headline — radial circles forming a
          large CIVIC·TECH glyph at low opacity. */}
      <svg className="hb-hero__watermark" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48" fill="none" stroke="white" strokeWidth="0.8" />
        <path d="M50 4 V96 M4 50 H96" stroke="white" strokeWidth="0.4" />
        <circle cx="50" cy="50" r="32" fill="none" stroke="white" strokeWidth="0.4" />
        <circle cx="50" cy="50" r="16" fill="none" stroke="white" strokeWidth="0.4" />
        <text x="50" y="56" textAnchor="middle" fontSize="11" fontWeight="800" fill="white" fontFamily="Geist">
          CIVIC&middot;TECH
        </text>
      </svg>

      <div className="hb-hero__inner">
        <div className="hb-hero__eyebrow">Grassroots Civic Tech</div>
        <h1 className="hb-hero__headline">
          Every civic app stops at <em>&ldquo;here&rsquo;s your rep.&rdquo;</em><br />
          We&rsquo;re making politicians actually accessible.
        </h1>
        <p className="hb-hero__body">
          CivicView gives every U.S. citizen a direct line to their representatives &mdash;
          track their votes, see their posts, ask them questions in polls, push back in comments,
          all scoped to the district they actually represent. Below is a transparent breakdown
          of what&rsquo;s built, what&rsquo;s in progress, and what specific dollar amounts unlock the rest.
          {' '}<strong>No equity, no ads, no investor carve-outs</strong> &mdash; just citizens funding citizen infrastructure.
        </p>

        <div className="hb-hero__cta-row">
          {CROWDFUND_LIVE ? (
            <a href={CROWDFUND_URL} target="_blank" rel="noopener noreferrer" className="hb-cta hb-cta--primary">
              <HeartIcon size={16} />
              <span>Back the crowdfund</span>
            </a>
          ) : (
            <span className="hb-cta hb-cta--pending" aria-disabled="true">
              Crowdfund launching soon
            </span>
          )}
          <a href="#money" className="hb-cta hb-cta--ghost">See where the money goes &rarr;</a>
        </div>

        <div className="hb-hero__assurance">
          <span>Costs + buffer to break-even</span>
          <span className="hb-hero__dot" />
          <span>Every line cited</span>
          <span className="hb-hero__dot" />
          <span>Operated by one person, for now</span>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PROGRESS METER
// Pre-launch: hatched bar, "$X to fully unlock" framing, "Pre launch"
// tile copy. Live: yellow fill, raised-amount, day countdown. The
// raised amount + backers + days-left wire to the backend when the
// crowdfund opens; today they're zero/placeholder.
// ─────────────────────────────────────────────────────────────────────
function ProgressMeter() {
  const goal = FUND_GOAL;
  const raised = CROWDFUND_LIVE ? 0 : 0;
  const pct = CROWDFUND_LIVE && goal > 0 ? Math.round((raised / goal) * 100) : 0;
  return (
    <section className={`hb-progress ${CROWDFUND_LIVE ? '' : 'hb-progress--prelaunch'}`}>
      <div>
        <div className="hb-progress__nums">
          {CROWDFUND_LIVE ? (
            <>
              <span className="hb-progress__raised">{fmt$(raised)}</span>
              <span className="hb-progress__goal">
                raised of <strong>{fmt$(goal)}</strong> to fully unlock CivicView
              </span>
            </>
          ) : (
            <>
              <span className="hb-progress__raised hb-progress__raised--muted">{fmt$(goal)}</span>
              <span className="hb-progress__goal">
                to fully unlock CivicView &mdash; <strong>one-time costs + first year of recurring</strong>
              </span>
            </>
          )}
        </div>
        <div className="hb-progress__subline">
          {CROWDFUND_LIVE
            ? <>Covers ID.me setup, federal trademark, DMCA agent, and 12 months of ProPublica, OpenStates, Google Civic, hosting, and domain. Surplus rolls into year&nbsp;2.</>
            : <>Bar fills in once the campaign opens. The total below is itemized, sourced, and broken into <em>&ldquo;fund this line&rdquo;</em>&nbsp;buttons.</>}
        </div>
        <div className="hb-progress__bar">
          {CROWDFUND_LIVE && (
            <>
              <span
                className="hb-progress__pct"
                style={{ left: `${Math.min(Math.max(pct, 6), 94)}%` }}
              >
                {pct}%
              </span>
              <div className="hb-progress__fill" style={{ width: `${pct}%` }} />
            </>
          )}
        </div>
      </div>

      <div className="hb-progress__tiles">
        <div className="hb-tile">
          <span className="hb-tile__eye">Backers</span>
          {CROWDFUND_LIVE
            ? <span className="hb-tile__num">0</span>
            : <span className="hb-tile__num hb-tile__num--sm" style={{ color: 'var(--cl-text-muted)' }}>&mdash;</span>}
          <span className="hb-tile__sub">
            {CROWDFUND_LIVE ? 'across the campaign' : 'opens with the campaign'}
          </span>
        </div>
        <div className="hb-tile">
          <span className="hb-tile__eye">Days remaining</span>
          {CROWDFUND_LIVE
            ? <span className="hb-tile__num">&mdash;</span>
            : <span className="hb-tile__num hb-tile__num--sm" style={{ color: 'var(--cl-text-muted)' }}>Pre&nbsp;launch</span>}
          <span className="hb-tile__sub">
            {CROWDFUND_LIVE ? 'until campaign close' : 'launch tba — subscribe to be notified'}
          </span>
        </div>
        <div className="hb-tile">
          <span className="hb-tile__eye">Largest unlock pending</span>
          <span className="hb-tile__num hb-tile__num--sm">{LARGEST_PENDING}</span>
          <span className="hb-tile__sub">{LARGEST_PENDING_SUB}</span>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// COLLAPSIBLE SECTION SHELL
// ─────────────────────────────────────────────────────────────────────
function Section({ eyebrow, title, count, sub, isOpen, onToggle, modifier = '', children }) {
  const headerId = `${title.replace(/\s+/g, '-').toLowerCase()}-header`;
  const panelId = `${title.replace(/\s+/g, '-').toLowerCase()}-panel`;
  return (
    <section
      id={modifier === 'hb-section--money' ? 'money' : undefined}
      className={`hb-section ${modifier} ${isOpen ? 'is-open' : ''}`}
    >
      <button
        type="button"
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="hb-section__head"
        onClick={onToggle}
      >
        <div className="hb-section__head-text">
          <div className="hb-section__eyebrow">{eyebrow}</div>
          <div className="hb-section__title-row">
            <h2 className="hb-section__title">{title}</h2>
            {typeof count === 'number' && <span className="hb-section__count cl-num">{count}</span>}
          </div>
          {sub && <p className="hb-section__sub">{sub}</p>}
        </div>
        <span className="hb-section__chev" aria-hidden>
          <ChevronDownIcon size={18} />
        </span>
      </button>
      <div id={panelId} role="region" aria-labelledby={headerId} className="hb-section__body">
        {children}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CHECKLIST (shipped + in-progress)
// ─────────────────────────────────────────────────────────────────────
function Checklist({ items, kind }) {
  const Icon = kind === 'shipped' ? CheckIcon : GearIcon;
  return (
    <ul className="hb-checklist">
      {items.map(([title, detail], i) => (
        <li key={i} className={`hb-check hb-check--${kind}`}>
          <span className="hb-check__icon"><Icon size={12} /></span>
          <div className="hb-check__body">
            <strong>{title}</strong>
            <div className="hb-check__detail">{detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MONEY CLUSTER (one-time / recurring)
// ─────────────────────────────────────────────────────────────────────
function MoneyCluster({ title, sub, items, total }) {
  return (
    <div className="hb-money-cluster">
      <div className="hb-money-cluster__head">
        <div className="hb-money-cluster__title">
          {title}
          {sub && <span className="hb-money-cluster__title-sub">&middot; {sub}</span>}
        </div>
        <div className="hb-money-cluster__total">{total}</div>
      </div>
      {items.map((item, i) => (
        <article key={i} className="hb-money">
          <div className="hb-money__title">{item.title}</div>
          <div className="hb-money__cost">
            {item.cost}
            <span className="hb-money__cost-suffix">{item.costSuffix}</span>
          </div>
          <p className="hb-money__body">{item.body}</p>
          <div className="hb-money__footer">
            <div className="hb-money__source">
              <span className="hb-money__source-label">Source:</span>{item.source}
            </div>
            {CROWDFUND_LIVE ? (
              <a
                href={CROWDFUND_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hb-money__fund"
              >
                <HeartIcon size={12} />
                <span>Fund this line</span>
              </a>
            ) : (
              <span
                className="hb-money__fund hb-money__fund--pending"
                title="We'll route your donation here once the crowdfund opens"
              >
                Fund this line at launch
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROADMAP
// ─────────────────────────────────────────────────────────────────────
function Roadmap() {
  return (
    <div className="hb-roadmap">
      {ROADMAP.map((feat, i) => {
        const IconComp = ROADMAP_ICONS[feat.icon] || VideoIcon;
        return (
          <article key={i} className="hb-feature">
            <span className="hb-feature__tag">{feat.tag}</span>
            <div className="hb-feature__head">
              <span className="hb-feature__icon"><IconComp size={18} /></span>
              <div className="hb-feature__title">{feat.title}</div>
            </div>
            <p className="hb-feature__body">{feat.body}</p>
          </article>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FOOTER + STICKY MOBILE CTA
// ─────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <div className="hb-footer">
      {CROWDFUND_LIVE ? (
        <a href={CROWDFUND_URL} target="_blank" rel="noopener noreferrer" className="hb-cta hb-cta--primary">
          <HeartIcon size={16} />
          <span>Back the crowdfund</span>
        </a>
      ) : (
        <span className="hb-cta hb-cta--pending hb-cta--pending-light">
          Crowdfund launching soon
        </span>
      )}
      <p className="hb-footer__caption">
        Questions or feedback? Use the Feedback tab in the navbar &mdash;
        we read every submission and either turn it into a fix, an
        update, or a new entry on the future-features list.
      </p>
    </div>
  );
}

function StickyMobileCTA() {
  return (
    <div className="hb-sticky-cta">
      <div className="hb-sticky-cta__inner">
        {CROWDFUND_LIVE ? (
          <a href={CROWDFUND_URL} target="_blank" rel="noopener noreferrer" className="hb-cta hb-cta--primary">
            <HeartIcon size={14} />
            <span>Back the crowdfund</span>
          </a>
        ) : (
          <span className="hb-cta hb-cta--pending hb-cta--pending-light">
            Crowdfund launching soon
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// GLYPHS — lifted from /Design Exports/civicview-help-build-this-page/
// project/help-build/Icons.jsx. Inlined here so the file is
// self-contained.
// ─────────────────────────────────────────────────────────────────────
function ArrowLeftIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M14 6 L8 12 L14 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronDownIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M5 12 l5 5 l9 -10" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function GearIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.4 5.4 L7.5 7.5 M16.5 16.5 L18.6 18.6 M5.4 18.6 L7.5 16.5 M16.5 7.5 L18.6 5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function HeartIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 21s-7-4.5-9.5-9C.5 8 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6.5 4 4.5 8C19 16.5 12 21 12 21Z" />
    </svg>
  );
}
function InfoIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="rgba(255,186,8,0.18)" />
      <path d="M12 8 v.01 M12 11 v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function VideoIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="3" y="6" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" fill="rgba(65,90,119,0.18)" />
      <path d="M16 10 L21 7 V17 L16 14 Z" fill="rgba(65,90,119,0.32)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function LiveIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M7.5 7.5 a6 6 0 0 0 0 9 M16.5 7.5 a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M4.5 4.5 a10 10 0 0 0 0 15 M19.5 4.5 a10 10 0 0 1 0 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.55" />
    </svg>
  );
}
function DebateIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M3 5 H12 V13 H7 L4 16 V13 H3 Z" fill="rgba(65,90,119,0.22)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M21 9 H12 V17 H17 L20 20 V17 H21 Z" fill="rgba(45,106,79,0.22)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function NicknameIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.8" fill="rgba(45,106,79,0.18)" />
      <path d="M5 20c0-3 3-5.5 7-5.5s7 2.5 7 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="rgba(45,106,79,0.18)" />
      <circle cx="12" cy="9" r="1.4" fill="currentColor" />
    </svg>
  );
}

const ROADMAP_ICONS = {
  video: VideoIcon,
  live: LiveIcon,
  debate: DebateIcon,
  nickname: NicknameIcon,
};
