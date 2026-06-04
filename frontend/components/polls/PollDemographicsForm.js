// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

'use client';

// PollDemographicsForm — the optional demographics step shown AFTER a voter
// casts their vote on a poll that has an attached form. Self-fetches the poll's
// questions and renders nothing if the poll has no form (so callers can mount
// it unconditionally). Every question is optional ("Prefer not to say" = skip).
//
// onSubmit(demographics) is called with a {question_key: value} map (only
// answered questions). onDismiss() hides it. Voting itself already happened —
// this never blocks or gates the vote.

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function PollDemographicsForm({ pollId, onSubmit, onDismiss }) {
  const [questions, setQuestions] = useState(null); // null = loading
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/polls/${pollId}/demographics`);
        const j = r.ok ? await r.json() : { questions: [] };
        if (alive) setQuestions(j.questions || []);
      } catch {
        if (alive) setQuestions([]);
      }
    })();
    return () => { alive = false; };
  }, [pollId]);

  // No form attached, or still loading -> render nothing.
  if (!questions || questions.length === 0) return null;

  const setAnswer = (key, value) =>
    setAnswers((prev) => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit?.(answers); // {} is fine — "prefer not to say" all
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10, border: '1px solid var(--cl-border, #e2e8f0)', borderRadius: 10,
                  background: 'var(--cl-bg, #f8fafc)', padding: '10px 12px' }}>
      <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: 2 }}>
        Optional: tell us a bit about you
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--cl-text-light, #64748b)', margin: '0 0 8px', lineHeight: 1.4 }}>
        The poll creator added these optional questions. Answers are anonymous, never linked to
        you publicly, and shown only in aggregate. Skip any or all.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {questions.map((q) => (
          <label key={q.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.72rem',
                                       fontWeight: 600, color: 'var(--cl-text-light, #64748b)' }}>
            <span>{q.prompt}{q.tier === 'sensitive' ? ' *' : ''}</span>
            <select
              value={answers[q.key] || ''}
              onChange={(e) => setAnswer(q.key, e.target.value)}
              style={{ fontSize: '0.82rem', padding: '5px 7px', border: '1px solid var(--cl-border, #e2e8f0)',
                       borderRadius: 8, background: '#fff', minWidth: 130 }}
            >
              <option value="">Prefer not to say</option>
              {q.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
        <button type="button" onClick={submit} disabled={busy}
                style={{ background: 'var(--cl-primary, #2563eb)', color: '#fff', border: 'none',
                         borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: '0.8rem',
                         cursor: 'pointer' }}>
          {busy ? 'Saving…' : (Object.keys(answers).length ? 'Submit answers' : 'Done')}
        </button>
        <button type="button" onClick={onDismiss}
                style={{ background: 'none', border: 'none', color: 'var(--cl-text-light, #64748b)',
                         fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>
          Skip
        </button>
      </div>
    </div>
  );
}
