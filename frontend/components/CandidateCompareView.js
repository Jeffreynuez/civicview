'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchCandidate } from '@/lib/api';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1', NP: '#666' };
const PARTY_BG = { R: '#fde8e8', D: '#e3f0f7', I: '#f0eaff', NP: '#eef' };
const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent', NP: 'Non-partisan' };

/**
 * Side-by-side candidate comparison modal. Unlike the member CompareView
 * (which compares roll-call votes), this one compares issue stances, top
 * priorities, fundraising, experience, and endorsements — the levers that
 * actually matter before a candidate has a voting record.
 */
export default function CandidateCompareView({ open, candidates, onClose }) {
  const [hydrated, setHydrated] = useState({});
  const [loading, setLoading] = useState(false);

  // Fetch full detail for any candidate passed as a stub
  useEffect(() => {
    if (!open || !candidates?.length) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(
      candidates.map(async (c) => {
        if (c.top_issues && c.endorsements) return [c.id, c];
        const { data } = await fetchCandidate(c.id);
        return [c.id, data || c];
      })
    ).then((entries) => {
      if (cancelled) return;
      setHydrated(Object.fromEntries(entries));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, candidates]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const fullCandidates = useMemo(
    () => (candidates || []).map((c) => hydrated[c.id] || c),
    [candidates, hydrated]
  );

  // Union of issue topics across candidates → row per topic.
  // The seed schema stores full stances in `top_issues` as [{name, stance}].
  // Fall back to `issues` for any future payloads that separate the two.
  const issueRows = useMemo(() => {
    const map = new Map();
    for (const c of fullCandidates) {
      const list = [...(c.top_issues || []), ...(c.issues || [])];
      for (const i of list) {
        // Plain-string topics (e.g. chip lists) carry no stance — skip from the table.
        if (typeof i === 'string') continue;
        const key = i.name || i.topic;
        if (!key) continue;
        const val = i.stance || i.position || '';
        if (!val) continue;
        if (!map.has(key)) map.set(key, {});
        map.get(key)[c.id] = val;
      }
    }
    return Array.from(map.entries()).map(([name, byId]) => ({ name, byId }));
  }, [fullCandidates]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Compare candidates"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: '16px',
          width: '100%', maxWidth: '1100px', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--cl-border)',
          background: 'var(--cl-primary)', color: 'white',
        }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Candidate Comparison</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>
              Issues, experience, and fundraising side-by-side
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'rgba(255,255,255,0.18)', color: 'white',
              border: '1px solid rgba(255,255,255,0.35)',
              padding: '4px 12px', borderRadius: '8px', fontSize: '0.82rem',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Candidate column heads */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `140px repeat(${fullCandidates.length}, 1fr)`,
          borderBottom: '1px solid var(--cl-border)',
          background: 'var(--cl-bg)',
        }}>
          <div />
          {fullCandidates.map((c) => {
            const party = c.party || 'NP';
            return (
              <div key={c.id} style={{ padding: '12px 14px', textAlign: 'center', borderLeft: '1px solid var(--cl-border)' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  margin: '0 auto 6px', background: PARTY_BG[party] || '#eef',
                  color: PARTY_COLORS[party] || '#666',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '1rem',
                }}>
                  {c.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.2 }}>{c.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '3px' }}>
                  {PARTY_NAMES[party] || party}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
                  {c.seeking_office}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scrollable compare body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
          {loading && (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--cl-text-light)', fontSize: '0.88rem' }}>
              Loading full profiles…
            </div>
          )}

          {/* Top priorities — render topic names only as chips */}
          <Row label="Top priorities" candidates={fullCandidates} render={(c) => {
            const topics = (c.top_issues || []).map((t) => (typeof t === 'string' ? t : t.name || t.topic)).filter(Boolean);
            if (!topics.length) return <Dash />;
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {topics.slice(0, 6).map((t, idx) => (
                  <span key={idx} style={{
                    fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px',
                    borderRadius: '10px', background: 'var(--cl-bg)', color: 'var(--cl-primary)',
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            );
          }} />

          {/* Hometown / current office */}
          <Row label="Current role" candidates={fullCandidates} render={(c) => (
            c.current_office ? <span>{c.current_office}</span> : <Dash />
          )} />
          <Row label="Hometown" candidates={fullCandidates} render={(c) => (
            c.hometown ? <span>{c.hometown}</span> : <Dash />
          )} />

          {/* Issue stances — one row per union topic */}
          {issueRows.length > 0 && (
            <SectionDivider>Stances on the issues</SectionDivider>
          )}
          {issueRows.map((row, idx) => (
            <Row
              key={row.name + idx}
              label={row.name}
              candidates={fullCandidates}
              render={(c) => row.byId[c.id]
                ? <span style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>{row.byId[c.id]}</span>
                : <Dash />
              }
            />
          ))}

          {/* Endorsements */}
          <SectionDivider>Endorsements</SectionDivider>
          <Row label="Endorsed by" candidates={fullCandidates} render={(c) => {
            const list = (c.endorsements || []).slice(0, 6);
            if (!list.length) return <Dash />;
            return (
              <ul style={{ margin: 0, paddingLeft: '16px', lineHeight: 1.5, fontSize: '0.8rem' }}>
                {list.map((e, idx) => (
                  <li key={idx}>{e.name || e}</li>
                ))}
              </ul>
            );
          }} />

          {/* Experience (timeline) */}
          <SectionDivider>Experience</SectionDivider>
          <Row label="Background" candidates={fullCandidates} render={(c) => {
            const exp = c.experience || [];
            if (!exp.length) return <Dash />;
            return (
              <ul style={{ margin: 0, paddingLeft: '16px', lineHeight: 1.5, fontSize: '0.8rem' }}>
                {exp.slice(0, 4).map((e, idx) => {
                  const from = e.from;
                  const to = e.to;
                  let years = '';
                  if (from && to == null) years = `${from} – Present`;
                  else if (from && to && to !== from) years = `${from}–${to}`;
                  else if (from) years = `${from}`;
                  return (
                    <li key={idx}>
                      <strong>{e.role || e.title}</strong>
                      {e.organization ? ` · ${e.organization}` : ''}
                      {years ? ` (${years})` : ''}
                    </li>
                  );
                })}
              </ul>
            );
          }} />

          {/* Fundraising */}
          <SectionDivider>Fundraising</SectionDivider>
          <Row label="Total raised" candidates={fullCandidates} render={(c) => (
            c.fundraising?.total_raised
              ? <Strong>${fmtMoney(c.fundraising.total_raised)}</Strong>
              : <Dash />
          )} />
          <Row label="Cash on hand" candidates={fullCandidates} render={(c) => (
            c.fundraising?.cash_on_hand
              ? <span>${fmtMoney(c.fundraising.cash_on_hand)}</span>
              : <Dash />
          )} />
          <Row label="Burn rate" candidates={fullCandidates} render={(c) => {
            const raised = c.fundraising?.total_raised;
            const cash = c.fundraising?.cash_on_hand;
            if (!raised || !cash) return <Dash />;
            const burned = raised - cash;
            const pct = Math.round((burned / raised) * 100);
            return <span>{pct}% spent</span>;
          }} />
        </div>
      </div>
    </div>
  );
}

// ─── Row primitive ──────────────────────────────────────────────────
function Row({ label, candidates, render }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `140px repeat(${candidates.length}, 1fr)`,
      borderBottom: '1px solid var(--cl-border)',
      alignItems: 'stretch',
    }}>
      <div style={{
        padding: '10px 14px', fontSize: '0.76rem',
        fontWeight: 700, color: 'var(--cl-text-light)',
        textTransform: 'uppercase', letterSpacing: '0.4px',
        background: 'var(--cl-bg)',
      }}>
        {label}
      </div>
      {candidates.map((c) => (
        <div key={c.id} style={{
          padding: '10px 14px', fontSize: '0.84rem', color: 'var(--cl-text)',
          borderLeft: '1px solid var(--cl-border)',
        }}>
          {render(c)}
        </div>
      ))}
    </div>
  );
}

function SectionDivider({ children }) {
  return (
    <div style={{
      padding: '14px 16px 6px',
      fontSize: '0.78rem', color: 'var(--cl-accent)', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.6px',
      borderTop: '1px solid var(--cl-border)',
      background: 'white',
    }}>
      {children}
    </div>
  );
}

function Dash() {
  return <span style={{ color: 'var(--cl-text-light)', fontStyle: 'italic' }}>—</span>;
}

function Strong({ children }) {
  return <span style={{ fontWeight: 700, color: 'var(--cl-primary)' }}>{children}</span>;
}

function fmtMoney(n) {
  if (typeof n !== 'number') return n;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}
