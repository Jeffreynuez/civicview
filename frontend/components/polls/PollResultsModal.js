// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

'use client';

// PollResultsModal — the "Explore results" window for a poll.
//
// Reused across every poll surface (FeedCard, PostCard, CitizenPollsSection)
// so the explorer stays identical everywhere — do NOT fork it. Styles are
// co-located in PollResultsModal.css per the project's CSS-topology rule.
//
// It fetches the poll's optional demographic form lazily (so feed lists pay
// no N+1), then the aggregate breakdown. Geography scope filtering mirrors the
// poll card; demographic filters + a "break down by" cross-tab appear only when
// the poll has a form. ALL suppression is enforced server-side — this view just
// renders whatever the API returns, including "not enough responses" buckets.

import { useCallback, useEffect, useMemo, useState } from 'react';
import './PollResultsModal.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const SCOPE_LABELS = {
  country: 'Country', state: 'State', district: 'District', city: 'City',
};

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 1000) / 10;
}

// Palette for option series in the cross-tab chart.
const CHART_PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

// Inline-SVG grouped bar chart: one group per (non-suppressed) demographic
// bucket, one bar per poll option, height = option's % share within that
// bucket. No external chart dependency.
function GroupedBarChart({ buckets, options }) {
  const shown = (buckets || []).filter((b) => !b.suppressed && b.total > 0);
  if (!shown.length || !options.length) return null;

  const W = 560, H = 210, padL = 30, padR = 8, padT = 8, padB = 64;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const groupW = plotW / shown.length;
  const innerPad = Math.min(16, groupW * 0.15);
  const gap = 2;
  const barW = Math.max(3, (groupW - innerPad * 2 - gap * (options.length - 1)) / options.length);
  const yOf = (p) => padT + plotH * (1 - p / 100);
  const colorOf = (id) => CHART_PALETTE[options.findIndex((o) => o.id === id) % CHART_PALETTE.length];
  const clip = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : (t || ''));

  return (
    <div className="prm-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Option share within each group" style={{ width: '100%', height: 'auto' }}>
        {/* gridlines + y labels at 0/50/100% */}
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} y1={yOf(g)} x2={W - padR} y2={yOf(g)} stroke="var(--cl-border, #e2e8f0)" strokeWidth="1" />
            <text x={padL - 4} y={yOf(g) + 3} textAnchor="end" fontSize="9" fill="var(--cl-text-light, #64748b)">{g}%</text>
          </g>
        ))}
        {shown.map((b, gi) => {
          const total = (b.options || []).reduce((s, o) => s + (o.count || 0), 0);
          const gx = padL + gi * groupW + innerPad;
          return (
            <g key={b.value}>
              {(b.options || []).map((o, oi) => {
                const p = pct(o.count, total);
                const x = gx + oi * (barW + gap);
                const h = plotH - (yOf(p) - padT);
                return <rect key={o.id} x={x} y={yOf(p)} width={barW} height={Math.max(0, h)} rx="1.5" fill={colorOf(o.id)} />;
              })}
              <text x={padL + gi * groupW + groupW / 2} y={H - padB + 14} textAnchor="middle" fontSize="9" fill="var(--cl-text-light, #64748b)">
                {clip(b.label, 12)}
              </text>
              <text x={padL + gi * groupW + groupW / 2} y={H - padB + 26} textAnchor="middle" fontSize="8" fill="var(--cl-text-light, #94a3b8)">
                n={b.total}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="prm-chart-legend">
        {options.map((o) => (
          <span key={o.id} className="prm-chart-legend-item">
            <span className="prm-chart-swatch" style={{ background: colorOf(o.id) }} />
            {o.text != null ? o.text : `Option ${o.id}`}
          </span>
        ))}
      </div>
    </div>
  );
}

// Build an aggregate CSV of the CURRENT explorer view. Never includes raw
// individual rows (we only ever hold aggregates); suppressed buckets are
// emitted as a labeled row with no counts, mirroring what is shown on screen.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildResultsCsv({ question, scope, filters, minCell, data, options }) {
  const rows = [];
  const line = (...cells) => rows.push(cells.map(csvCell).join(','));
  line('CivicView poll results — aggregate, self-reported, unverified');
  line('Poll question', question || '');
  line('Geography scope', scope);
  const fstr = Object.entries(filters || {}).map(([k, v]) => `${k}=${v}`).join('; ');
  line('Demographic filters', fstr || '(none)');
  line('Minimum group size', minCell);
  line('Responses in view', data?.subset_total ?? 0);
  line('');

  if (data?.suppressed) {
    line('Results hidden — fewer than the minimum group size for this cut.');
  } else {
    const denom = (data?.options || []).reduce((t, o) => t + (o.count || 0), 0);
    line('Option', 'Count', 'Percent');
    for (const o of (data?.options || [])) {
      line(o.text != null ? o.text : `Option ${o.id}`, o.count, `${pct(o.count, denom)}%`);
    }
  }

  if (data?.breakdown) {
    line('');
    line(`By ${data.breakdown.prompt}`);
    line('Group', 'Group responses', 'Option', 'Count', 'Percent');
    const labelFor = (id) => {
      const m = (options || []).find((o) => o.id === id);
      return m && m.text != null ? m.text : `Option ${id}`;
    };
    for (const b of data.breakdown.buckets) {
      if (b.suppressed) {
        line(b.label, b.total, `(hidden — fewer than ${minCell} responses)`, '', '');
        continue;
      }
      const bd = (b.options || []).reduce((t, o) => t + (o.count || 0), 0);
      for (const o of (b.options || [])) {
        line(b.label, b.total, labelFor(o.id), o.count, `${pct(o.count, bd)}%`);
      }
    }
  }
  return rows.join('\n');
}

export default function PollResultsModal({ pollId, question, open, onClose }) {
  const [questions, setQuestions] = useState([]);   // attached form questions
  const [scope, setScope] = useState('country');
  const [filters, setFilters] = useState({});        // { question_key: value }
  const [by, setBy] = useState('');                  // '' = none
  const [data, setData] = useState(null);            // breakdown response
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  // Lazily fetch the attached demographic form once per open.
  useEffect(() => {
    if (!open || pollId == null) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/polls/${pollId}/demographics`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setQuestions(j.questions || []);
      } catch { /* form is optional — ignore */ }
    })();
    return () => { alive = false; };
  }, [open, pollId]);

  const loadBreakdown = useCallback(async () => {
    if (pollId == null) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('scope', scope);
      for (const [k, v] of Object.entries(filters)) {
        if (v) params.set(`filter_${k}`, v);
      }
      if (by) params.set('by', by);
      const r = await fetch(
        `${API_BASE}/api/polls/${pollId}/results/breakdown?${params.toString()}`,
      );
      if (!r.ok) throw new Error('Could not load results');
      setData(await r.json());
    } catch (e) {
      setError(e.message || 'Could not load results');
    } finally {
      setLoading(false);
    }
  }, [pollId, scope, filtersKey, by]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) loadBreakdown();
  }, [open, loadBreakdown]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const allowed = data?.allowed_scopes || ['country'];
  const minCell = data?.min_cell ?? 10;
  const options = data?.options || [];
  const total = data?.subset_total || 0;
  const optTotal = options.reduce((s, o) => s + (o.count || 0), 0);

  const setFilter = (key, value) =>
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });

  const downloadCsv = () => {
    const csv = buildResultsCsv({ question, scope, filters, minCell, data, options });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poll-${pollId}-results.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const renderBars = (opts, denom) => (
    <ul className="prm-bars">
      {opts.map((o) => (
        <li key={o.id} className="prm-bar-row">
          <div className="prm-bar-label">
            <span>{o.text != null ? o.text : `Option ${o.id}`}</span>
            <span className="prm-bar-num">{pct(o.count, denom)}% · {o.count}</span>
          </div>
          <div className="prm-bar-track">
            <span className="prm-bar-fill" style={{ width: `${pct(o.count, denom)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="prm-overlay" role="region" aria-label="Explore results">
      <div className="prm-modal">
        <header className="prm-header">
          <div>
            <div className="prm-eyebrow">Explore results</div>
            {question && <h2 className="prm-question">{question}</h2>}
          </div>
          <button type="button" className="prm-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <p className="prm-disclaimer">
          Demographics are <strong>self-reported and unverified</strong>, optional for voters,
          and shown only in aggregate. Cuts with fewer than {minCell} responses are hidden to
          protect privacy.
        </p>

        <div className="prm-filters">
          {/* Geography scope — mirrors the poll card. */}
          <label className="prm-field">
            <span>Geography</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {allowed.map((s) => (
                <option key={s} value={s}>{SCOPE_LABELS[s] || s}</option>
              ))}
            </select>
          </label>

          {/* Demographic filters — one per attached question. */}
          {questions.map((q) => (
            <label key={q.key} className="prm-field">
              <span>{q.prompt}{q.tier === 'sensitive' ? ' *' : ''}</span>
              <select
                value={filters[q.key] || ''}
                onChange={(e) => setFilter(q.key, e.target.value)}
              >
                <option value="">Any</option>
                {q.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}

          {/* Break down by */}
          {questions.length > 0 && (
            <label className="prm-field">
              <span>Break down by</span>
              <select value={by} onChange={(e) => setBy(e.target.value)}>
                <option value="">— None —</option>
                {questions.map((q) => (
                  <option key={q.key} value={q.key}>{q.prompt}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {questions.some((q) => q.tier === 'sensitive') && (
          <p className="prm-note">* Sensitive category — answering was optional.</p>
        )}

        <div className="prm-results">
          {loading && <div className="prm-status">Loading…</div>}
          {error && <div className="prm-status prm-error">{error}</div>}

          {!loading && !error && data && (
            <>
              <div className="prm-subtotal-row">
                <span className="prm-subtotal">{total} response{total === 1 ? '' : 's'} in this view</span>
                {data && (
                  <button type="button" className="prm-csv-btn" onClick={downloadCsv}>Download CSV</button>
                )}
              </div>

              {data.suppressed ? (
                <div className="prm-suppressed">
                  Not enough responses to show this cut (need at least {minCell}).
                </div>
              ) : (
                renderBars(options, optTotal)
              )}

              {data.breakdown && !data.suppressed && (
                <div className="prm-breakdown">
                  <h3 className="prm-breakdown-title">By {data.breakdown.prompt}</h3>
                  <GroupedBarChart buckets={data.breakdown.buckets} options={options} />
                  {data.breakdown.buckets.map((b) => (
                    <div key={b.value} className="prm-bucket">
                      <div className="prm-bucket-head">
                        <span>{b.label}</span>
                        <span className="prm-bucket-n">{b.total}</span>
                      </div>
                      {b.suppressed ? (
                        <div className="prm-suppressed prm-suppressed--sm">
                          Hidden — fewer than {minCell} responses.
                        </div>
                      ) : (
                        renderBars(
                          b.options.map((bo) => ({
                            ...bo,
                            text: (options.find((o) => o.id === bo.id) || {}).text,
                          })),
                          b.options.reduce((s, o) => s + (o.count || 0), 0),
                        )
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
