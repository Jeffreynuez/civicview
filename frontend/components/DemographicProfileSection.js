'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// DemographicProfileSection — manage the opt-in reusable demographic profile.
//
// The profile auto-fills the optional demographic questions on polls so a
// citizen doesn't re-answer every time. STANDARD catalog questions only —
// sensitive categories (party, race, income, religion) are never stored here;
// they stay answer-per-poll. Results are always aggregate-only with min-cell
// suppression, regardless of this profile.

import { useEffect, useState } from 'react';
import {
  fetchDemographicProfile,
  saveDemographicProfile,
  clearDemographicProfile,
} from '../lib/pagesApi';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function DemographicProfileSection() {
  const [questions, setQuestions] = useState([]); // standard-tier only
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // 'saved' | 'cleared' | null

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/polls/demographics/catalog`);
        const j = r.ok ? await r.json() : { questions: [] };
        if (alive) setQuestions((j.questions || []).filter((q) => q.tier !== 'sensitive'));
      } catch { /* optional */ }
      try {
        const { data } = await fetchDemographicProfile();
        if (alive && data && data.answers) setAnswers(data.answers);
      } catch { /* optional */ }
    })();
    return () => { alive = false; };
  }, []);

  const setAnswer = (key, value) =>
    setAnswers((prev) => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      setStatus(null);
      return next;
    });

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await saveDemographicProfile(answers);
      if (data && data.answers) setAnswers(data.answers);
      setStatus('saved');
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await clearDemographicProfile();
      setAnswers({});
      setStatus('cleared');
    } finally {
      setBusy(false);
    }
  };

  const hasAny = Object.keys(answers).length > 0;

  return (
    <section style={{ border: '1px solid var(--cl-border, #e2e8f0)', borderRadius: 12,
                      background: '#fff', padding: '14px 16px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 800 }}>Demographic profile</h3>
      <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--cl-text-light, #64748b)', lineHeight: 1.45 }}>
        Optional. Saved on your account to auto-fill the demographic questions some polls ask, so
        you don&rsquo;t re-answer each time. Standard questions only — sensitive categories
        (party, race, income, religion) are never saved here. Results are always anonymous and
        shown only in aggregate. You can clear this anytime.
      </p>

      {questions.length === 0 ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--cl-text-light, #64748b)', fontStyle: 'italic' }}>
          Loading…
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {questions.map((q) => (
              <label key={q.key} style={{ display: 'flex', flexDirection: 'column', gap: 2,
                                          fontSize: '0.72rem', fontWeight: 600,
                                          color: 'var(--cl-text-light, #64748b)' }}>
                <span>{q.prompt}</span>
                <select
                  value={answers[q.key] || ''}
                  onChange={(e) => setAnswer(q.key, e.target.value)}
                  style={{ fontSize: '0.84rem', padding: '6px 8px', border: '1px solid var(--cl-border, #e2e8f0)',
                           borderRadius: 8, background: '#fff', minWidth: 140 }}
                >
                  <option value="">Not set</option>
                  {q.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <button type="button" onClick={save} disabled={busy}
                    style={{ background: 'var(--cl-primary, #2563eb)', color: '#fff', border: 'none',
                             borderRadius: 8, padding: '7px 16px', fontWeight: 700, fontSize: '0.82rem',
                             cursor: 'pointer' }}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            {hasAny && (
              <button type="button" onClick={clearAll} disabled={busy}
                      style={{ background: 'none', border: '1px solid var(--cl-border, #e2e8f0)', borderRadius: 8,
                               padding: '7px 14px', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
                               color: 'var(--cl-text-light, #64748b)' }}>
                Clear
              </button>
            )}
            {status === 'saved' && <span style={{ fontSize: '0.78rem', color: '#1d5a2c' }}>Saved.</span>}
            {status === 'cleared' && <span style={{ fontSize: '0.78rem', color: 'var(--cl-text-light, #64748b)' }}>Cleared.</span>}
          </div>
        </>
      )}
    </section>
  );
}
