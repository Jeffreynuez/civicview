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
    <div className="prm-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="prm-modal" onClick={(e) => e.stopPropagation()}>
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
              <div className="prm-subtotal">{total} response{total === 1 ? '' : 's'} in this view</div>

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
