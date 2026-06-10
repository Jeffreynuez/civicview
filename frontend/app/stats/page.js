'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /stats — expanded analytics surface (Task #71; redesigned 2026-06-10).
 *
 * Layout: collapsible category sections ("dropdowns") in the home
 * page's circled-chevron style. "The government CivicView covers"
 * starts open so the page never looks empty; everything else starts
 * collapsed with a one-line preview in the header. Open/closed state
 * persists per visitor (localStorage 'cv:stats:open'), matching the
 * home-page section-collapse convention.
 *
 * Data honesty rules unchanged: every number is a live COUNT() from
 * /api/stats/detail (60s server TTL) or a structural fact about US
 * government. No fabricated fallback — the error state says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { fetchStatsDetail } from '@/lib/api';

const OPEN_KEY = 'cv:stats:open';
const DEFAULT_OPEN = { government: true };

export default function StatsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(DEFAULT_OPEN);

  // Restore per-visitor section state after mount (SSR-safe).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null');
      if (saved && typeof saved === 'object') setOpen({ ...DEFAULT_OPEN, ...saved });
    } catch { /* fresh visitor */ }
  }, []);

  const toggle = useCallback((id) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchStatsDetail()
      .then((d) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => Number(n || 0).toLocaleString();

  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '40px 24px 80px',
        fontFamily: 'var(--cl-font-sans)',
        color: 'var(--cl-text)',
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: 'var(--cl-text-sm)',
          color: 'var(--cl-accent)',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        ← Home
      </Link>

      {/* Hero */}
      <div style={{ margin: '28px 0 8px' }}>
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: 'var(--cl-tracking-wider)',
            fontSize: 'var(--cl-text-2xs)',
            fontWeight: 800,
            color: 'var(--cl-accent)',
            marginBottom: 8,
          }}
        >
          Transparency
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--cl-text-3xl)',
            fontWeight: 800,
            letterSpacing: 'var(--cl-tracking-tight)',
            lineHeight: 1.15,
          }}
        >
          CivicView stats
        </h1>
        <div
          style={{
            width: 56,
            height: 4,
            borderRadius: 2,
            background: 'var(--cl-accent)',
            margin: '14px 0 14px',
          }}
        />
        <p
          style={{
            color: 'var(--cl-text-light)',
            margin: 0,
            maxWidth: 620,
            lineHeight: 'var(--cl-leading-normal)',
          }}
        >
          A live snapshot of the platform and the government it covers.
          Every figure is counted from live CivicView data or is a
          structural fact about US government — nothing estimated,
          nothing made up.
        </p>
      </div>

      {loading && (
        <div style={noticeStyle('var(--cl-card)')}>
          <Pulse /> Loading live stats…
        </div>
      )}

      {!loading && error && (
        <div style={noticeStyle('var(--cl-warning-soft)')}>
          <strong>Couldn’t load stats.</strong> The data service may be
          waking up — give it a few seconds and{' '}
          <button
            type="button"
            onClick={load}
            style={{
              background: 'transparent', border: 'none', padding: 0,
              color: 'var(--cl-accent)', fontWeight: 700, fontSize: 'inherit',
              fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            try again
          </button>
          .
        </div>
      )}

      {!loading && !error && data && (
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <StatSection
            id="government"
            title="The government CivicView covers"
            preview={`${fmt(data.senators + data.representatives)} members of Congress · ${data.states_covered} states`}
            open={!!open.government}
            onToggle={toggle}
            icon={<LandmarkIcon />}
          >
            <TileGrid
              tiles={[
                { value: data.senators + data.representatives, label: 'Members of Congress' },
                { value: data.senators, label: 'Senators' },
                { value: data.representatives, label: 'Representatives' },
                { value: data.scotus_justices, label: 'SCOTUS justices' },
                { value: data.states_covered, label: 'States covered' },
              ]}
            />
            <p style={footnoteStyle}>
              Structural facts — 100 Senators, 435 Representatives, and 9
              Supreme Court justices are set by law; CivicView seeds
              officials for all 50 states.
            </p>
          </StatSection>

          <StatSection
            id="people"
            title="Who's on CivicView"
            preview={`${fmt(data.citizens_total)} citizen account${data.citizens_total === 1 ? '' : 's'} · ${fmt(data.reps_joined + data.candidates_joined)} officials`}
            open={!!open.people}
            onToggle={toggle}
            icon={<PeopleIcon />}
          >
            <TileGrid
              tiles={[
                { value: data.citizens_total, label: 'Citizen accounts' },
                { value: data.citizens_verified, label: 'Verified citizens' },
                { value: data.citizens_demo, label: 'Demo accounts' },
                { value: data.reps_joined, label: 'Reps joined' },
                { value: data.candidates_joined, label: 'Candidates joined' },
              ]}
            />
            <WeeklyChart title="Citizen signups — last 8 weeks" buckets={data.signups_by_week} />
          </StatSection>

          <StatSection
            id="engagement"
            title="Engagement"
            preview={`${fmt(data.poll_votes)} poll vote${data.poll_votes === 1 ? '' : 's'} · ${fmt(data.posts + data.polls)} posts & polls`}
            open={!!open.engagement}
            onToggle={toggle}
            icon={<PulseIcon />}
          >
            <TileGrid
              tiles={[
                { value: data.posts, label: 'Posts' },
                { value: data.polls, label: 'Polls' },
                { value: data.poll_votes, label: 'Poll votes' },
                { value: data.comments, label: 'Comments' },
                { value: data.reactions, label: 'Reactions' },
                { value: data.tracked_items, label: 'Items tracked' },
                { value: data.saved_items, label: 'Items saved' },
              ]}
            />
            <WeeklyChart title="Poll votes — last 8 weeks" buckets={data.poll_votes_by_week} />
          </StatSection>

          <StatSection
            id="content"
            title="Civic content library"
            preview={`${fmt(data.bill_summaries)} bill summaries`}
            open={!!open.content}
            onToggle={toggle}
            icon={<BookIcon />}
          >
            <TileGrid
              tiles={[
                { value: data.bill_summaries, label: 'Bill summaries' },
                { value: data.eo_summaries, label: 'Executive-order summaries' },
                { value: data.vote_explainers, label: 'Vote explainers' },
              ]}
            />
            <p style={footnoteStyle}>
              Plain-language summaries generated from official sources
              (Congress.gov, the Federal Register) so legislation is
              readable without legalese.
            </p>
          </StatSection>

          {data.citizens_by_state?.length > 0 && (
            <StatSection
              id="geography"
              title="Citizens by state"
              preview={`top: ${data.citizens_by_state[0].state} (${fmt(data.citizens_by_state[0].count)})`}
              open={!!open.geography}
              onToggle={toggle}
              icon={<MapPinIcon />}
            >
              <StateBars rows={data.citizens_by_state} />
            </StatSection>
          )}

          <p
            style={{
              marginTop: 16,
              fontSize: 'var(--cl-text-xs)',
              color: 'var(--cl-text-muted)',
              lineHeight: 'var(--cl-leading-normal)',
            }}
          >
            Demo accounts is a temporary metric — once ID.me verification is
            live, signups will count toward Verified citizens and that row
            will retire. Live counts refresh every minute. Source:{' '}
            <code>/api/stats/detail</code>
            {data.generated_at ? ` · generated ${new Date(data.generated_at).toLocaleString()}` : ''}.
          </p>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────
// Collapsible section — home page's circled-chevron convention
// ─────────────────────────────────────────────────────────────────

function StatSection({ id, title, preview, open, onToggle, icon, children }) {
  return (
    <section
      style={{
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-md)',
        background: 'var(--cl-card)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '14px 16px',
          background: open ? 'var(--cl-accent-soft, rgba(46,125,50,0.06))' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--cl-font-sans)',
          textAlign: 'left',
          transition: 'background var(--cl-duration-fast) var(--cl-ease-standard)',
        }}
      >
        <Chevron open={open} />
        <span style={{ display: 'inline-flex', color: 'var(--cl-accent)', flexShrink: 0 }}>
          {icon}
        </span>
        <span
          style={{
            textTransform: 'uppercase',
            letterSpacing: 'var(--cl-tracking-wider)',
            fontSize: 'var(--cl-text-2xs)',
            fontWeight: 800,
            color: 'var(--cl-text-light)',
          }}
        >
          {title}
        </span>
        {!open && preview && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 'var(--cl-text-xs)',
              color: 'var(--cl-text-muted)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {preview}
          </span>
        )}
      </button>
      {open && <div style={{ padding: '4px 16px 18px' }}>{children}</div>}
    </section>
  );
}

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
        <path d="M4 2l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tiles with count-up numbers
// ─────────────────────────────────────────────────────────────────

function useCountUp(target, durationMs = 650) {
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return undefined;
    startedRef.current = true;
    const n = Number(target) || 0;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* SSR */ }
    if (reduce || n <= 0) { setValue(n); return undefined; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min((t - t0) / durationMs, 1);
      // ease-out cubic — fast start, gentle landing
      setValue(Math.round(n * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function Tile({ value, label }) {
  const shown = useCountUp(value);
  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'var(--cl-bg)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-md)',
        borderTop: '3px solid var(--cl-accent)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--cl-text-2xl)',
          fontWeight: 800,
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {shown.toLocaleString()}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 'var(--cl-text-2xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--cl-tracking-wider)',
          color: 'var(--cl-text-light)',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function TileGrid({ tiles }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 12,
        marginTop: 10,
      }}
    >
      {tiles.map((t) => <Tile key={t.label} value={t.value} label={t.label} />)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Charts (CSS-only, no dependencies)
// ─────────────────────────────────────────────────────────────────

function WeeklyChart({ title, buckets }) {
  if (!buckets?.length) return null;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const fmtW = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return (
    <div
      style={{
        marginTop: 14,
        padding: '14px 16px 10px',
        background: 'var(--cl-bg)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-md)',
      }}
    >
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 'var(--cl-text-2xs)', textTransform: 'uppercase',
            letterSpacing: 'var(--cl-tracking-wider)', color: 'var(--cl-text-light)',
            fontWeight: 700,
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 'var(--cl-text-2xs)', color: 'var(--cl-text-muted)' }}>
          peak {max.toLocaleString()}
        </span>
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'flex-end', gap: 8, height: 92,
          borderBottom: '1px solid var(--cl-border)', paddingBottom: 1,
        }}
      >
        {buckets.map((b) => (
          <div
            key={b.week_start}
            title={`Week of ${fmtW(b.week_start)}: ${b.count.toLocaleString()}`}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              justifyContent: 'flex-end', height: '100%',
            }}
          >
            <div
              style={{
                height: `${Math.max((b.count / max) * 100, b.count > 0 ? 5 : 1.5)}%`,
                background: b.count > 0
                  ? 'linear-gradient(180deg, var(--cl-accent) 0%, var(--cl-accent) 55%, rgba(46,125,50,0.55) 100%)'
                  : 'var(--cl-border)',
                borderRadius: '5px 5px 0 0',
                minHeight: 2,
                transition: 'height var(--cl-duration-fast) var(--cl-ease-standard)',
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 6,
          fontSize: 'var(--cl-text-2xs)', color: 'var(--cl-text-muted)',
        }}
      >
        <span>{fmtW(buckets[0].week_start)}</span>
        <span>{fmtW(buckets[buckets.length - 1].week_start)}</span>
      </div>
    </div>
  );
}

function StateBars({ rows }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div
      style={{
        marginTop: 10,
        padding: '14px 16px',
        background: 'var(--cl-bg)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {rows.map((r, i) => (
        <div key={r.state} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 18, textAlign: 'right',
              fontSize: 'var(--cl-text-2xs)', color: 'var(--cl-text-muted)', fontWeight: 600,
            }}
          >
            {i + 1}
          </span>
          <span
            style={{
              width: 28, fontSize: 'var(--cl-text-xs)', fontWeight: 800,
              color: 'var(--cl-text)',
            }}
          >
            {r.state}
          </span>
          <div
            style={{
              flex: 1, height: 12, background: 'var(--cl-card)',
              border: '1px solid var(--cl-border)', borderRadius: 6, overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(r.count / max) * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, var(--cl-accent), rgba(46,125,50,0.65))',
                borderRadius: 6,
                minWidth: 3,
              }}
            />
          </div>
          <span
            style={{
              width: 56, textAlign: 'right',
              fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {r.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Small bits
// ─────────────────────────────────────────────────────────────────

function noticeStyle(background) {
  return {
    marginTop: 28,
    padding: '16px 20px',
    background,
    border: '1px solid var(--cl-border)',
    borderRadius: 'var(--cl-radius-md)',
    fontSize: 'var(--cl-text-sm)',
    color: 'var(--cl-text)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };
}

const footnoteStyle = {
  margin: '12px 0 0',
  fontSize: 'var(--cl-text-xs)',
  color: 'var(--cl-text-muted)',
  lineHeight: 'var(--cl-leading-normal)',
};

function Pulse() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10, height: 10, borderRadius: '50%',
        background: 'var(--cl-accent)', display: 'inline-block',
        animation: 'cvStatsPulse 1.2s ease-in-out infinite',
      }}
    >
      <style>{'@keyframes cvStatsPulse { 0%,100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }'}</style>
    </span>
  );
}

// Inline icon glyphs — 16px, stroke = currentColor (accent via parent).
function LandmarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6.5L8 3l6 3.5" /><path d="M3.5 7v5M6.5 7v5M9.5 7v5M12.5 7v5" /><path d="M2 13.5h12" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="2.2" /><path d="M1.8 13c.5-2.4 1.9-3.6 3.7-3.6S8.7 10.6 9.2 13" /><circle cx="11" cy="6.5" r="1.8" /><path d="M10.5 9.6c1.9 0 3.2 1 3.7 3.4" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 8.5h3l1.5-4 3 7 1.5-3h4" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3.5C6.8 2.6 4.9 2.3 2.5 2.5v10.6c2.4-.2 4.3.1 5.5 1 1.2-.9 3.1-1.2 5.5-1V2.5c-2.4-.2-4.3.1-5.5 1z" /><path d="M8 3.5v10.6" />
    </svg>
  );
}
function MapPinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 10-9 0C3.5 9.8 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.6" />
    </svg>
  );
}
