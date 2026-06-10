'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /stats — expanded analytics surface (Task #71, shipped 2026-06-10).
 *
 * Reads /api/stats/detail (60s server-side TTL cache — deliberately a
 * separate endpoint from the home hero's /api/stats/summary so the
 * home page stays fast no matter how much depth this page grows).
 *
 * Data honesty rules (CLAUDE.md / project hard rules):
 *   • Every number is either a live COUNT() over CivicView's own
 *     tables or a structural fact about US government (535 members,
 *     9 justices, 50 states). Nothing fabricated or estimated.
 *   • No fake fallback payload — if the API is unreachable we show an
 *     explicit error state with a retry, never zeros pretending to be
 *     data. (Render free-tier cold starts make the first request after
 *     idle slow — the error copy mentions retrying for that reason.)
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { fetchStatsDetail } from '@/lib/api';

export default function StatsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchStatsDetail()
      .then((d) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '48px 24px 80px',
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

      <h1
        style={{
          margin: '24px 0 8px',
          fontSize: 'var(--cl-text-3xl)',
          fontWeight: 800,
          letterSpacing: 'var(--cl-tracking-tight)',
        }}
      >
        CivicView stats
      </h1>
      <p
        style={{
          color: 'var(--cl-text-light)',
          margin: '0 0 32px',
          lineHeight: 'var(--cl-leading-normal)',
        }}
      >
        A live snapshot of the platform and the government it covers — who
        has joined, how citizens are engaging, and how much civic content
        is available to explore. Every figure is counted from live
        CivicView data or is a structural fact about US government.
      </p>

      {loading && (
        <div style={noticeStyle('var(--cl-card)')}>Loading live stats…</div>
      )}

      {!loading && error && (
        <div style={noticeStyle('var(--cl-warning-soft)')}>
          <strong>Couldn’t load stats.</strong> The data service may be
          waking up — give it a few seconds and{' '}
          <button
            type="button"
            onClick={load}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: 'var(--cl-accent)',
              fontWeight: 700,
              fontSize: 'inherit',
              fontFamily: 'inherit',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            try again
          </button>
          .
        </div>
      )}

      {!loading && !error && data && (
        <>
          <Section title="The government CivicView covers">
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
          </Section>

          <Section title="Who's on CivicView">
            <TileGrid
              tiles={[
                { value: data.citizens_total, label: 'Citizen accounts' },
                { value: data.citizens_verified, label: 'Verified citizens' },
                { value: data.citizens_demo, label: 'Demo accounts' },
                { value: data.reps_joined, label: 'Reps joined' },
                { value: data.candidates_joined, label: 'Candidates joined' },
              ]}
            />
            <WeeklyChart
              title="Citizen signups — last 8 weeks"
              buckets={data.signups_by_week}
            />
          </Section>

          <Section title="Engagement">
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
            <WeeklyChart
              title="Poll votes — last 8 weeks"
              buckets={data.poll_votes_by_week}
            />
          </Section>

          <Section title="Civic content library">
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
          </Section>

          {data.citizens_by_state?.length > 0 && (
            <Section title="Citizens by state">
              <StateBars rows={data.citizens_by_state} />
            </Section>
          )}

          <p
            style={{
              marginTop: 40,
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
        </>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────
// Presentational pieces (page-local)
// ─────────────────────────────────────────────────────────────────

function noticeStyle(background) {
  return {
    padding: '16px 20px',
    background,
    border: '1px solid var(--cl-border)',
    borderRadius: 'var(--cl-radius-md)',
    marginBottom: 32,
    fontSize: 'var(--cl-text-sm)',
    color: 'var(--cl-text)',
  };
}

const footnoteStyle = {
  margin: '12px 0 0',
  fontSize: 'var(--cl-text-xs)',
  color: 'var(--cl-text-muted)',
  lineHeight: 'var(--cl-leading-normal)',
};

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2
        style={{
          margin: '0 0 16px',
          fontSize: 'var(--cl-text-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--cl-tracking-wider)',
          color: 'var(--cl-text-light)',
          fontWeight: 700,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function TileGrid({ tiles }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 16,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          style={{
            padding: 20,
            background: 'var(--cl-card)',
            border: '1px solid var(--cl-border)',
            borderRadius: 'var(--cl-radius-md)',
          }}
        >
          <div style={{ fontSize: 'var(--cl-text-3xl)', fontWeight: 800, lineHeight: 1.1 }}>
            {Number(t.value).toLocaleString()}
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
            {t.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Eight-week column chart. Pure CSS bars (no chart dependency) — the
 *  buckets come zero-filled from the backend so weeks never skip. */
function WeeklyChart({ title, buckets }) {
  if (!buckets?.length) return null;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const fmt = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return (
    <div
      style={{
        marginTop: 16,
        padding: '16px 20px 12px',
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-md)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--cl-text-2xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--cl-tracking-wider)',
          color: 'var(--cl-text-light)',
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
        {buckets.map((b) => (
          <div
            key={b.week_start}
            title={`Week of ${fmt(b.week_start)}: ${b.count.toLocaleString()}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
          >
            <div
              style={{
                height: `${Math.max((b.count / max) * 100, b.count > 0 ? 4 : 1)}%`,
                background: b.count > 0 ? 'var(--cl-accent)' : 'var(--cl-border)',
                borderRadius: '4px 4px 0 0',
                minHeight: 2,
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          fontSize: 'var(--cl-text-2xs)',
          color: 'var(--cl-text-muted)',
        }}
      >
        <span>{fmt(buckets[0].week_start)}</span>
        <span>{fmt(buckets[buckets.length - 1].week_start)}</span>
      </div>
    </div>
  );
}

/** Horizontal bars — citizens per state, top 15, descending. */
function StateBars({ rows }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {rows.map((r) => (
        <div key={r.state} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 28,
              fontSize: 'var(--cl-text-xs)',
              fontWeight: 700,
              color: 'var(--cl-text-light)',
            }}
          >
            {r.state}
          </span>
          <div style={{ flex: 1, height: 10, background: 'var(--cl-bg)', borderRadius: 5, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(r.count / max) * 100}%`,
                height: '100%',
                background: 'var(--cl-accent)',
                borderRadius: 5,
                minWidth: 2,
              }}
            />
          </div>
          <span style={{ width: 56, textAlign: 'right', fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text)' }}>
            {r.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
