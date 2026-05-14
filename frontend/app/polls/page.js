'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /polls — global polls feed.
 *
 * The user-engagement safety net: when every rep page is unclaimed
 * and no rep has posted anything, citizens can still drive
 * meaningful civic-engagement here. Shows every active poll across
 * the entire app — rep-authored, citizen-led on unclaimed pages, and
 * citizen standalone polls (no specific target). Filter chips switch
 * between kinds; a "Start a poll" affordance lets signed-in citizens
 * post a standalone poll (per-citizen cap of 1 active).
 *
 * Voting / commenting / detailed engagement still happens on the
 * source rep page (clicking a citizen-or-rep poll card jumps there).
 * Standalone polls have no source page; they live and die here.
 *
 * AI filter chips (Funny / Critical / Skeptical / etc.) land in
 * Phase C of the Polls feature — the chip row in this commit is
 * just the kind filter (All / Rep / Citizen / Standalone).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  fetchPollsFeed,
  createStandalonePoll,
} from '@/lib/pagesApi';
import { useCitizenAuth } from '@/lib/citizenAuth';

const KIND_FILTERS = [
  { id: 'all',        label: 'All polls' },
  { id: 'rep',        label: 'From reps' },
  { id: 'citizen',    label: 'From citizens (on rep pages)' },
  { id: 'standalone', label: 'Standalone' },
];

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatCount(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export default function PollsPage() {
  const { citizen } = useCitizenAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kindFilter, setKindFilter] = useState('all');
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchPollsFeed({
      kind: kindFilter === 'all' ? undefined : kindFilter,
    });
    setLoading(false);
    if (err || !data) {
      setError(err || 'Could not load polls.');
      setItems([]);
      return;
    }
    setItems(data.items || []);
  }, [kindFilter]);

  useEffect(() => { load(); }, [load]);

  const onCreated = (poll) => {
    setComposerOpen(false);
    // Optimistically prepend the freshly-created poll so the user
    // sees it land at the top of the list without waiting for the
    // full re-fetch.
    if (poll) {
      setItems((prev) => [normalizeCreatedPoll(poll, citizen), ...prev]);
    }
    // Also refresh from the server so counts and ordering are in
    // sync with whatever else may have happened in the interim.
    load();
  };

  return (
    <main style={{ padding: '24px 20px 60px', fontFamily: 'var(--cl-font-sans)', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, fontFamily: 'var(--cl-font-display)' }}>
          Polls
        </h1>
        <Link href="/" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>← CivicView home</Link>
      </div>
      <p style={{ color: 'var(--cl-text-light)', fontSize: '0.92rem', marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
        Every active poll on the site — what reps are asking constituents,
        what citizens are asking each other and the officials who serve them,
        and standalone polls on civic topics that don&rsquo;t belong to any
        single page.
      </p>

      {/* Filter chips + Start-a-poll button */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          marginBottom: 16,
        }}
      >
        {KIND_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setKindFilter(f.id)}
            style={{
              padding: '6px 12px',
              border: `1px solid ${kindFilter === f.id ? 'var(--cl-accent)' : 'var(--cl-border)'}`,
              background: kindFilter === f.id ? 'var(--cl-accent)' : 'white',
              color: kindFilter === f.id ? 'white' : 'var(--cl-text)',
              borderRadius: 999,
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {citizen ? (
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            style={{
              padding: '6px 14px',
              border: '1px solid var(--cl-accent)',
              background: 'var(--cl-accent)',
              color: 'white',
              borderRadius: 8,
              fontSize: '0.86rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ✨ Start a poll
          </button>
        ) : (
          <span style={{ color: 'var(--cl-text-light)', fontSize: '0.84rem' }}>
            Sign in to start a poll
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--cl-danger-soft)',
            color: 'var(--cl-danger-text)',
            border: '1px solid var(--cl-danger-border)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            fontSize: '0.86rem',
          }}
        >
          {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div style={{ color: 'var(--cl-text-light)', padding: 30, textAlign: 'center' }}>
          Loading polls…
        </div>
      )}
      {!loading && items.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--cl-border)',
            borderRadius: 12,
            padding: '40px 24px',
            textAlign: 'center',
            color: 'var(--cl-text-light)',
          }}
        >
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--cl-text)', marginBottom: 6 }}>
            No polls in this view yet.
          </div>
          <p style={{ fontSize: '0.92rem', margin: '0 auto', maxWidth: 480, lineHeight: 1.55 }}>
            {kindFilter === 'standalone'
              ? 'Standalone polls live here when citizens ask broad civic questions that don’t belong on a single rep’s page.'
              : 'When reps and citizens start posting polls, they’ll appear here. Click "Start a poll" to be the first.'}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}
        >
          {items.map((p) => <PollFeedCard key={p.id} poll={p} />)}
        </div>
      )}

      {composerOpen && (
        <StandaloneComposer
          onCancel={() => setComposerOpen(false)}
          onCreated={onCreated}
        />
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// One poll card on /polls.
// Lighter-weight than the rep-page PollCard — read-only, no in-place
// voting. Standalone polls are also non-clickable since they have no
// source page; rep-page polls deep-link to their source.
// ─────────────────────────────────────────────────────────────────────
function PollFeedCard({ poll }) {
  const isStandalone = poll.kind === 'standalone';
  const isRep = poll.kind === 'rep';
  const href = !isStandalone && poll.official_id
    ? `/?page=${encodeURIComponent(poll.official_id)}`
    : null;

  const cardBody = (
    <article
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl, 14px)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
      }}
    >
      {/* Top row — author + kind / page tag */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--cl-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {poll.author}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)' }}>
            {poll.role || (isRep ? 'Representative' : 'Citizen')} · {relTime(poll.created_at)}
          </div>
        </div>
        <KindTag kind={poll.kind} pageTag={poll.page_tag} party={poll.party} />
      </div>

      {/* Question */}
      <div style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--cl-text)', lineHeight: 1.4 }}>
        {poll.question}
      </div>

      {/* Option bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(poll.options || []).map((opt, i) => (
          <div
            key={i}
            style={{
              position: 'relative',
              background: 'var(--cl-bg)',
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: '0.84rem',
              overflow: 'hidden',
            }}
          >
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: 0, bottom: 0, left: 0,
                width: `${opt.percent || 0}%`,
                background: 'var(--cl-accent-soft)',
                zIndex: 0,
              }}
            />
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--cl-text)' }}>{opt.label}</span>
              <span style={{ color: 'var(--cl-text-light)', fontWeight: 600 }}>{opt.percent || 0}%</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: 2 }}>
        <span><strong style={{ color: 'var(--cl-text)' }}>{formatCount(poll.votes)}</strong> votes · <strong style={{ color: 'var(--cl-text)' }}>{formatCount(poll.comments)}</strong> comments</span>
        {href && <span style={{ color: 'var(--cl-accent)', fontWeight: 600 }}>Open page →</span>}
      </div>
    </article>
  );

  // If we have a source page, wrap in a link. Standalone polls
  // render as a non-clickable card today; in-place voting on the
  // standalone is a Phase C improvement.
  if (href) {
    return (
      <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
        {cardBody}
      </a>
    );
  }
  return cardBody;
}

function KindTag({ kind, pageTag, party }) {
  const label =
    kind === 'standalone' ? 'Standalone'
      : kind === 'rep' ? (pageTag || (party ? `Rep · ${party}` : 'Rep'))
      : (pageTag || 'Citizen');
  const tone =
    kind === 'standalone' ? { bg: '#fff7e6', fg: '#8a6100', border: '#ffe1a3' }
      : kind === 'rep' ? { bg: '#eef4ff', fg: '#1d4ed8', border: '#bcd4ff' }
      : { bg: 'var(--cl-accent-soft)', fg: 'var(--cl-accent)', border: 'transparent' };
  return (
    <span
      style={{
        padding: '2px 8px',
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.border}`,
        borderRadius: 999,
        fontSize: '0.7rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// Helper to shape a freshly-created standalone poll into the same
// row shape the feed endpoint emits, so the optimistic prepend
// doesn't break the card render.
function normalizeCreatedPoll(citizenPollRead, citizen) {
  const inner = citizenPollRead.poll || {};
  return {
    id: citizenPollRead.id,
    kind: 'standalone',
    author: citizen?.display_name || 'You',
    role: citizen?.state ? `${citizen.state}${citizen.city ? ` · ${citizen.city}` : ''}` : null,
    party: null,
    official_id: null,
    page_tag: null,
    created_at: inner.created_at || new Date().toISOString(),
    question: inner.question,
    options: (inner.options || []).map((o) => ({ label: o.text, percent: 0, count: 0 })),
    votes: 0,
    comments: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Standalone poll composer modal.
// Minimal — just a question + 2-8 options. Closes-at and presentation
// mode are deferred to a "More options" expander if/when users ask.
// ─────────────────────────────────────────────────────────────────────
function StandaloneComposer({ onCancel, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const canSubmit =
    question.trim().length > 0 &&
    options.filter((o) => o.trim()).length >= 2 &&
    !submitting;

  const setOption = (i, value) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  };
  const addOption = () => {
    if (options.length >= 8) return;
    setOptions((prev) => [...prev, '']);
  };
  const removeOption = (i) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    const { data, error } = await createStandalonePoll({
      question: question.trim(),
      options: cleanOptions,
    });
    setSubmitting(false);
    if (error || !data) {
      setErr(error || 'Could not create poll.');
      return;
    }
    onCreated(data);
  };

  return (
    <div
      role="dialog"
      aria-label="Start a standalone poll"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          padding: 20,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Start a standalone poll</h2>
          <button type="button" onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--cl-text-light)', fontSize: '0.9rem' }}>
            Cancel
          </button>
        </div>
        <p style={{ fontSize: '0.84rem', color: 'var(--cl-text-light)', margin: 0, lineHeight: 1.5 }}>
          Standalone polls aren&rsquo;t tied to any single rep&rsquo;s page.
          Use this for federal-policy questions, cross-jurisdictional issues,
          or anything that affects everyone. You can have one active standalone
          poll at a time — close it to start another.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Question</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
            placeholder="What do you want to ask?"
            rows={3}
            maxLength={500}
            style={{
              padding: '8px 10px',
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              fontSize: '0.92rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', alignSelf: 'flex-end' }}>{question.length}/500</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Options (2–8)</span>
          {options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={opt}
                onChange={(e) => setOption(i, e.target.value.slice(0, 255))}
                placeholder={`Option ${i + 1}`}
                maxLength={255}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 8,
                  fontSize: '0.88rem',
                  fontFamily: 'inherit',
                }}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  style={{
                    padding: '0 10px',
                    border: '1px solid var(--cl-border)',
                    background: 'white',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: 'var(--cl-text-light)',
                    fontSize: '0.78rem',
                  }}
                  title="Remove this option"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 8 && (
            <button
              type="button"
              onClick={addOption}
              style={{
                alignSelf: 'flex-start',
                padding: '4px 10px',
                border: '1px dashed var(--cl-border)',
                background: 'transparent',
                borderRadius: 8,
                cursor: 'pointer',
                color: 'var(--cl-accent)',
                fontSize: '0.82rem',
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              + Add option
            </button>
          )}
        </div>

        {err && (
          <div role="alert" style={{ color: '#d63031', fontSize: '0.82rem', background: 'var(--cl-danger-soft)', padding: '6px 10px', borderRadius: 6 }}>
            {err}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 14px',
              background: 'white',
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: '8px 16px',
              background: canSubmit ? 'var(--cl-accent)' : 'var(--cl-border)',
              color: canSubmit ? 'white' : 'var(--cl-text-light)',
              border: '1px solid var(--cl-accent)',
              borderRadius: 8,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Posting…' : 'Post poll'}
          </button>
        </div>
      </form>
    </div>
  );
}
