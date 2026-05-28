'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /stats — placeholder page for the future expanded analytics surface
 * (Task #71, post-launch). Today this page only renders a "Coming
 * soon" panel + the small bundle of stats we already surface in the
 * National Officials hero, so the "More stats →" link from the home
 * page doesn't 404. When Task #71 ships this will become a real
 * analytics dashboard (engagement curves, growth by state, post +
 * poll volume, verified-citizen distribution, etc.).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { fetchStatsSummary } from '@/lib/api';

export default function StatsPage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetchStatsSummary().then(({ data }) => {
      if (mounted) setStats(data);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const tiles = stats
    ? [
        { value: stats.senators,               label: 'Senators' },
        { value: stats.representatives,        label: 'Representatives' },
        { value: stats.scotus_justices,        label: 'SCOTUS Justices' },
        { value: stats.reps_joined,            label: 'Reps joined' },
        { value: stats.verified_citizens,      label: 'Verified citizens' },
        { value: stats.demo_accounts_created,  label: 'Demo accounts created' },
      ]
    : [];

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
        A snapshot of the platform — how many officials we cover, who has
        joined, and how many citizens are using CivicView today.
      </p>

      {/* Coming-soon notice for the bigger analytics surface. */}
      <div
        style={{
          padding: '16px 20px',
          background: 'var(--cl-warning-soft)',
          border: '1px solid var(--cl-border)',
          borderRadius: 'var(--cl-radius-md)',
          marginBottom: 32,
          fontSize: 'var(--cl-text-sm)',
          color: 'var(--cl-text)',
        }}
      >
        <strong>Coming soon:</strong> richer analytics — growth over time,
        engagement by state, post and poll volume, and a verified-citizen
        coverage map. For now this page shows the same top-line counts as
        the home page hero.
      </div>

      {/* Tile grid — live counts. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
            <div
              style={{
                fontSize: 'var(--cl-text-3xl)',
                fontWeight: 800,
                lineHeight: 1.1,
              }}
            >
              {stats ? String(t.value) : '—'}
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

      <p
        style={{
          marginTop: 40,
          fontSize: 'var(--cl-text-xs)',
          color: 'var(--cl-text-muted)',
          lineHeight: 'var(--cl-leading-normal)',
        }}
      >
        Demo accounts is a temporary metric — once ID.me verification is
        live, every signup will count toward Verified citizens instead, and
        this row will retire. Source: <code>/api/stats/summary</code>.
      </p>
    </main>
  );
}
