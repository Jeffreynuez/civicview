'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
import { votePoll } from '../lib/pagesApi';
import { getVoterToken } from '../lib/voterToken';
import IdentityPicker from './IdentityPicker';
import { useActiveIdentities, pickEngagementIdentity } from '../lib/activeIdentities';

/**
 * Poll attached to a post.
 *
 * Three presentation modes (server-chosen, set by the post author):
 *   • full                — bars + percentages visible to everyone.
 *   • hidden              — question plus two collapsible sections
 *                            ("Show results" / "Cast a vote"). Viewers
 *                            expand what they want to see, minimizing
 *                            result-bias before voting.
 *   • reveal_after_close  — paired with closes_at. Options are clickable
 *                            but results stay blacked out until the
 *                            close time passes. Backend zeroes counts
 *                            for non-owner viewers; we trust
 *                            `poll.counts_suppressed` to drive the UI.
 *
 * Closing time is always surfaced as a live countdown ("Closes in 2h
 * 15m") when set and still open, or "Closed" once it passes.
 *
 * Props:
 *   officialId   — page owner id (used for the vote endpoint URL)
 *   poll         — full PollRead payload from the API
 *   isOwner      — true when the logged-in rep owns this page
 *   citizen      — CitizenAccount | null (used for auth gate)
 *   onCitizenLoginRequired — opens the login modal
 *   onUpdated(updatedPoll) — merge the refreshed poll back into the list
 */
export default function PollCard({
  officialId, poll, onUpdated,
  isOwner = false, citizen = null, onCitizenLoginRequired,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Ticking clock for countdown + auto-flip to closed state.
  const [nowTs, setNowTs] = useState(() => Date.now());
  const closesAt = poll.closes_at ? new Date(poll.closes_at) : null;
  const isClosed = closesAt && closesAt.getTime() <= nowTs;

  useEffect(() => {
    if (!closesAt || isClosed) return undefined;
    // Refresh every 30 seconds — enough resolution for an "Xh Xm"
    // display, cheap for the browser. Stops ticking once the poll
    // has closed (no more countdown to update).
    const iv = setInterval(() => setNowTs(Date.now()), 30000);
    return () => clearInterval(iv);
  }, [poll.closes_at, isClosed]);  // eslint-disable-line react-hooks/exhaustive-deps

  const mode = poll.presentation_mode || 'full';
  const countsSuppressed = poll.counts_suppressed || false;
  const hasVoted = poll.voter_choice_id != null;
  const total = poll.total_votes || 0;
  const activeScope = poll.active_scope || 'country';
  const activeScopeLabel = poll.active_scope_label || '';
  const breakdown = poll.scope_totals || {};
  const maxVotes = useMemo(
    () => poll.options.reduce((m, o) => Math.max(m, o.vote_count || 0), 0),
    [poll.options],
  );

  // Clickability: anyone signed in can click while the poll is open.
  // Phase 2/4c self-engagement: reps + candidates voting on their
  // OWN page use their session and write a row keyed on
  // author_rep_id / author_candidate_id.
  const canClick = !isClosed;

  // Phase 6 multi-identity: identities the viewer is signed in to,
  // plus the per-identity voter_choices from the server so we can
  // tell who's already voted on each option.
  const activeIdentities = useActiveIdentities({ isOwner: true });
  const voterChoicesByIdentity = poll.voter_choices || {};
  // Picker state — when set, holds the pending optionId + the
  // narrowed identity list. Renders the IdentityPicker absolutely
  // positioned under the option that was clicked.
  const [votePicker, setVotePicker] = useState(null);

  const fireVote = async (optionId, asIdentity) => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await votePoll(officialId, poll.id, {
      optionId,
      voterToken: getVoterToken(),
      asIdentity,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (data && onUpdated) onUpdated(data);
  };

  const cast = async (optionId) => {
    if (busy || !canClick) return;
    if (!citizen && !isOwner && activeIdentities.length === 0) {
      onCitizenLoginRequired?.();
      return;
    }
    const decision = pickEngagementIdentity({ identities: activeIdentities });
    if (decision.none) {
      onCitizenLoginRequired?.();
      return;
    }
    if (decision.single) {
      await fireVote(optionId, null);
      return;
    }
    // Multi-identity → always show the picker. currentState='voted'
    // when this identity has voted for THIS specific option (not a
    // different option — they can still click to switch votes).
    setVotePicker({
      optionId,
      identities: decision.showPicker.map((id) => ({
        ...id,
        currentState: voterChoicesByIdentity[id.kind] === optionId ? 'voted' : null,
      })),
    });
  };

  const onVotePick = (asIdentity) => {
    const optionId = votePicker?.optionId;
    setVotePicker(null);
    if (optionId != null) fireVote(optionId, asIdentity);
  };

  // ── Shared bits ────────────────────────────────────────────────────
  const renderQuestionHeader = () => (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--cl-text)', flex: 1, minWidth: 0 }}>
        {poll.question}
      </div>
      {!countsSuppressed && (
        <ScopeChip
          scope={activeScope}
          label={activeScopeLabel}
          isDefault={activeScope === (poll.default_visibility_scope || 'country')}
        />
      )}
    </div>
  );

  const renderOptionRow = (opt, { clickable, showCount }) => {
    const pct = showCount && total > 0
      ? Math.round((100 * (opt.vote_count || 0)) / total) : 0;
    const isChoice = poll.voter_choice_id === opt.id;
    const isLeader = showCount && total > 0 && (opt.vote_count || 0) === maxVotes;
    const tooltip = !clickable
      ? ''
      : (!citizen && !isOwner)
        ? 'Sign in as a citizen to vote'
        : hasVoted && !isChoice
          ? 'Click to change your vote'
          : hasVoted && isChoice
            ? ''
            : 'Click to vote';

    return (
      <div key={opt.id} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={clickable ? () => cast(opt.id) : undefined}
        disabled={!clickable || busy}
        aria-disabled={!clickable}
        title={tooltip}
        style={{
          font: 'inherit', color: 'inherit', width: '100%',
          textAlign: 'left', display: 'block',
          position: 'relative',
          padding: '8px 10px',
          border: isChoice ? '1.5px solid var(--cl-accent)' : '1px solid var(--cl-border)',
          borderRadius: '8px',
          background: 'white',
          overflow: 'hidden',
          cursor: !clickable ? 'default' : busy ? 'wait' : 'pointer',
          transition: 'border-color 0.15s',
        }}
        onMouseOver={clickable && !busy ? (e) => {
          if (!isChoice) e.currentTarget.style.borderColor = 'var(--cl-accent)';
        } : undefined}
        onMouseOut={clickable && !busy ? (e) => {
          e.currentTarget.style.borderColor = isChoice ? 'var(--cl-accent)' : 'var(--cl-border)';
        } : undefined}
      >
        {showCount && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${pct}%`,
              background: isChoice
                ? 'rgba(24, 119, 242, 0.18)'
                : isLeader ? 'rgba(24, 119, 242, 0.08)' : 'rgba(0,0,0,0.04)',
              transition: 'width 0.3s ease',
            }}
          />
        )}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.82rem',
          }}
        >
          <span style={{ color: 'var(--cl-text)', fontWeight: isChoice ? 700 : 500 }}>
            {opt.text}
            {isChoice && (
              <span style={{ marginLeft: '6px', color: 'var(--cl-accent)', fontSize: '0.72rem' }}>
                ✓ your vote
              </span>
            )}
            {/* Phase 2 self-engagement: when the rep is the page
                owner and this is their voted option, show an "Author"
                pill in addition to "your vote" so it's explicit who
                cast the vote. Visible only to the owner themselves
                today — exposing the owner's choice to every viewer
                needs a backend field that doesn't exist yet. */}
            {isChoice && isOwner && (
              <span
                style={{
                  marginLeft: '6px', padding: '1px 6px',
                  borderRadius: 999,
                  background: 'var(--cl-accent-soft, #e6f4ea)',
                  color: 'var(--cl-accent)',
                  fontSize: '0.62rem', fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: '0.4px',
                }}
                title="You authored this poll"
              >
                Author
              </span>
            )}
          </span>
          {showCount ? (
            <span style={{ color: 'var(--cl-text-light)', fontVariantNumeric: 'tabular-nums' }}>
              {pct}% · {opt.vote_count || 0}
            </span>
          ) : null}
        </div>
      </button>
      {/* Phase 6 — IdentityPicker anchors to this option's wrapper
          when the user clicked here. currentState is already set on
          each identity by `cast` above so we pass it through. */}
      {votePicker && votePicker.optionId === opt.id && (
        <IdentityPicker
          open
          identities={votePicker.identities || []}
          onPick={onVotePick}
          onClose={() => setVotePicker(null)}
        />
      )}
      </div>
    );
  };

  const renderTimeLine = () => {
    if (isClosed) {
      return <span>Closed{closesAt ? ` · ${closesAt.toLocaleString()}` : ''}</span>;
    }
    if (closesAt) {
      return <span>Closes {formatRemaining(closesAt.getTime() - nowTs, closesAt)}</span>;
    }
    return null;
  };

  const renderFooter = ({ includeBreakdown = true } = {}) => (
    <div
      style={{
        marginTop: '8px', fontSize: '0.72rem', color: 'var(--cl-text-light)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '8px', flexWrap: 'wrap',
      }}
    >
      <span>
        {countsSuppressed
          ? 'Results hidden until close'
          : `${total} ${total === 1 ? 'vote' : 'votes'}`}
        {closesAt && (
          <>{' · '}{renderTimeLine()}</>
        )}
        {!citizen && !isOwner && canClick && !hasVoted && ' · sign in as a citizen to vote'}
      </span>
      {includeBreakdown && !countsSuppressed && (poll.allowed_scopes?.length ?? 0) > 1 && (
        <ScopeBreakdown
          allowed={poll.allowed_scopes || ['country']}
          breakdown={breakdown}
          activeScope={activeScope}
        />
      )}
      {error && <span style={{ color: '#d63031' }}>{error}</span>}
    </div>
  );

  // ── Mode-specific body ─────────────────────────────────────────────
  let body;

  if (mode === 'hidden' && !countsSuppressed) {
    // 'Hidden' mode uses native <details> for the two collapsible
    // sections so keyboard users get the right semantics for free.
    body = (
      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <details style={{ border: '1px solid var(--cl-border)', borderRadius: '8px', background: 'white' }}>
          <summary style={collapsibleSummary}>
            Cast a vote
            <span style={collapsibleHint}>{canClick ? 'pick an option' : isClosed ? 'closed' : 'preview'}</span>
          </summary>
          <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {poll.options.map((opt) =>
              renderOptionRow(opt, { clickable: canClick, showCount: false })
            )}
          </div>
        </details>
        <details style={{ border: '1px solid var(--cl-border)', borderRadius: '8px', background: 'white' }}>
          <summary style={collapsibleSummary}>
            Show results
            <span style={collapsibleHint}>{total} {total === 1 ? 'vote' : 'votes'}</span>
          </summary>
          <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {poll.options.map((opt) =>
              renderOptionRow(opt, { clickable: false, showCount: true })
            )}
          </div>
        </details>
      </div>
    );
  } else if (countsSuppressed) {
    // reveal_after_close, still open, viewer is not the owner. Let
    // citizens vote but blackout all percentages — no bias from an
    // early-vote lead.
    body = (
      <>
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {poll.options.map((opt) =>
            renderOptionRow(opt, { clickable: canClick, showCount: false })
          )}
        </div>
        <div
          style={{
            marginTop: '10px', padding: '8px 10px',
            background: '#fff7e6', border: '1px solid #ffe1a3',
            borderRadius: '8px', color: '#8a6100', fontSize: '0.78rem',
          }}
        >
          <strong>Results hidden until the poll closes.</strong>{' '}
          {closesAt ? `You'll see them after ${closesAt.toLocaleString()}.` : ''}
        </div>
      </>
    );
  } else {
    // 'full' (and 'reveal_after_close' once closed, since counts are
    // no longer suppressed) — classic bar render, always clickable for
    // non-owners on open polls so citizens can flip their vote.
    body = (
      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {poll.options.map((opt) =>
          renderOptionRow(opt, { clickable: canClick, showCount: true })
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: '10px',
        padding: '12px',
        border: '1px solid var(--cl-border)',
        borderRadius: '10px',
        background: 'var(--cl-bg)',
      }}
    >
      {renderQuestionHeader()}
      {body}
      {renderFooter({ includeBreakdown: mode !== 'hidden' })}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────
const collapsibleSummary = {
  cursor: 'pointer',
  padding: '8px 10px',
  fontSize: '0.82rem', fontWeight: 600, color: 'var(--cl-text)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: '8px',
  listStyle: 'none',
};
const collapsibleHint = {
  fontSize: '0.72rem', color: 'var(--cl-text-light)', fontWeight: 500,
};

function formatRemaining(ms, closesAt) {
  if (ms <= 0) return 'just now';
  const totalSec = Math.floor(ms / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const totalHr = Math.floor(totalMin / 60);
  const totalDay = Math.floor(totalHr / 24);
  if (totalMin < 1) return 'in under a minute';
  if (totalMin < 60) return `in ${totalMin}m`;
  if (totalHr < 24) {
    const m = totalMin % 60;
    return `in ${totalHr}h${m ? ` ${m}m` : ''}`;
  }
  if (totalDay < 7) {
    const h = totalHr % 24;
    return `in ${totalDay}d${h ? ` ${h}h` : ''}`;
  }
  return `on ${closesAt.toLocaleDateString()}`;
}

function ScopeChip({ scope, label, isDefault }) {
  const icon = scope === 'country' ? '🇺🇸' : scope === 'state' ? '📍' : scope === 'district' ? '🎯' : '🏙';
  return (
    <span
      title={isDefault ? "Post author's default visibility" : 'Active scope for this view'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '3px 8px', borderRadius: '10px',
        background: 'white', border: '1px solid var(--cl-border)',
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--cl-text-light)',
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true">{icon}</span>
      Showing: {label || scope}
    </span>
  );
}

function ScopeBreakdown({ allowed, breakdown, activeScope }) {
  const parts = allowed.map((s) => {
    const n = {
      country:  breakdown.country_total  || 0,
      state:    breakdown.state_total    || 0,
      district: breakdown.district_total || 0,
      city:     breakdown.city_total     || 0,
    }[s] || 0;
    const label = { country: 'US', state: 'State', district: 'District', city: 'City' }[s] || s;
    return { s, n, label };
  });
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {parts.map(({ s, n, label }) => (
        <span
          key={s}
          style={{
            fontWeight: s === activeScope ? 700 : 500,
            color: s === activeScope ? 'var(--cl-text)' : 'var(--cl-text-light)',
          }}
        >
          {label}: {n}
        </span>
      ))}
    </span>
  );
}
