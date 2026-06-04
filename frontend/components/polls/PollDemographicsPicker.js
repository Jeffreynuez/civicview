// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

'use client';

// PollDemographicsPicker — composer-side checklist for attaching an optional
// demographic form to a poll. Fetches the standardized catalog and lets the
// creator pick questions (Standard + a separately-flagged Sensitive group).
// Controlled: props.value = string[] of question keys; props.onChange(keys).
//
// Used by every poll composer (rep/candidate post composer, citizen polls).
// Voters always answer optionally; this only chooses which questions appear.

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function PollDemographicsPicker({ value = [], onChange, threshold = 10, onThresholdChange }) {
  const [catalog, setCatalog] = useState([]);
  const [open, setOpen] = useState((value || []).length > 0);
  const selected = new Set(value || []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/polls/demographics/catalog`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setCatalog(j.questions || []);
      } catch { /* optional feature — ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    // Preserve catalog order for stable display.
    onChange?.(catalog.map((q) => q.key).filter((k) => next.has(k)));
  };

  const standard = catalog.filter((q) => q.tier !== 'sensitive');
  const sensitive = catalog.filter((q) => q.tier === 'sensitive');

  const row = (q) => (
    <label key={q.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', padding: '3px 0', cursor: 'pointer' }}>
      <input type="checkbox" checked={selected.has(q.key)} onChange={() => toggle(q.key)} />
      <span>{q.prompt}</span>
    </label>
  );

  return (
    <div style={{ marginTop: 10, border: '1px solid var(--cl-border, #e2e8f0)', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                 padding: '9px 12px', background: 'var(--cl-bg, #f8fafc)', border: 'none', cursor: 'pointer',
                 fontWeight: 700, fontSize: '0.8rem', color: 'var(--cl-text, #0f172a)' }}
      >
        <span>Add an optional demographic form{selected.size ? ` · ${selected.size} selected` : ''}</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '10px 12px' }}>
          <p style={{ fontSize: '0.74rem', color: 'var(--cl-text-light, #64748b)', margin: '0 0 8px', lineHeight: 1.4 }}>
            Voters answer these optionally — they can always vote without answering, and you only
            ever see aggregate results (small groups are hidden). Self-reported and unverified.
          </p>
          {standard.map(row)}
          {sensitive.length > 0 && (
            <>
              <div style={{ marginTop: 10, fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase',
                            letterSpacing: '0.4px', color: 'var(--cl-text-light, #64748b)' }}>
                Sensitive categories
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--cl-text-light, #64748b)', margin: '2px 0 6px' }}>
                Extra care: these are more personal. Voters can skip any of them.
              </p>
              {sensitive.map(row)}
            </>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 12,
                          fontSize: '0.74rem', fontWeight: 700, color: 'var(--cl-text-light, #64748b)' }}>
            <span>Minimum group size before a breakdown shows</span>
            <select value={threshold} onChange={(e) => onThresholdChange?.(Number(e.target.value))}
                    style={{ fontSize: '0.82rem', padding: '5px 7px', border: '1px solid var(--cl-border, #e2e8f0)',
                             borderRadius: 8, background: '#fff', maxWidth: 220 }}>
              <option value={10}>10 (default)</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span style={{ fontWeight: 500, color: 'var(--cl-text-light, #94a3b8)', fontSize: '0.7rem' }}>
              Higher = more privacy; smaller cuts stay hidden. Cannot go below 10.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
