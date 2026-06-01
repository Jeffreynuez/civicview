'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * CitizenPollsSection — feed of citizen-authored polls on a rep page.
 *
 * Shows up on:
 *   • Unclaimed pages: full surface — banner, feed, "Create poll" CTA
 *     for signed-in citizens, comments, report. Anonymous viewers see
 *     the feed but get a "Sign in to vote / comment / report" gate
 *     when they try to engage.
 *   • Claimed pages: the rep's "Pre-claim discussion (N)" archive
 *     section (default visible, dismissible). The active feed is
 *     hidden because the page is now the rep's own.
 *
 * One self-contained component owns:
 *   - data fetch (fetchCitizenPolls)
 *   - rate-limit & role gating (caller_role, caller_has_active_poll)
 *   - per-card vote / comment / report / close handlers
 *   - the create-poll modal
 *   - the report-poll modal
 *
 * Bundling avoids prop-drilling across PageView and keeps the
 * citizen-polls UX in one place — easy to lift out later if we want
 * to render the feed on the home page or a profile.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchCitizenPolls,
  createCitizenPoll,
  voteOnCitizenPoll,
  closeCitizenPoll,
  reportCitizenPoll,
  dismissPreClaimArchive,
} from '../lib/pagesApi';
import IdentityPicker from './IdentityPicker';
import CommentsThread from './polls/CommentsThread';
import { useActiveIdentities, pickEngagementIdentity } from '../lib/activeIdentities';

const REPORT_REASONS = [
  { value: 'spam',           label: 'Spam' },
  { value: 'harassment',     label: 'Harassment' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'off_topic',      label: 'Off-topic' },
  { value: 'impersonation',  label: 'Impersonation' },
  { value: 'other',          label: 'Other' },
];

// ─────────────────────────────────────────────────────────────────────
// Top-level section
// ─────────────────────────────────────────────────────────────────────
export default function CitizenPollsSection({
  officialId,
  ownerName,
  citizen,
  isOwner,
  pageClaimed,
  onCitizenLoginRequired,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  // Active scope chip — country / state / district / city. The
  // backend tells us which scopes this page's office supports
  // (allowed_scopes); the chip row only renders those.
  const [activeScope, setActiveScope] = useState('country');

  const reload = useCallback(async (scopeOverride) => {
    setLoading(true);
    const scope = scopeOverride ?? activeScope;
    const { data: d, error: e } = await fetchCitizenPolls(
      officialId, { scope: scope === 'country' ? undefined : scope },
    );
    if (e) {
      setError(e);
      setLoading(false);
      return;
    }
    setData(d);
    setError(null);
    setLoading(false);
  }, [officialId, activeScope]);

  // Initial load + on officialId change.
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officialId]);

  // Re-fetch when the user changes scope.
  const handleScopeChange = useCallback((next) => {
    setActiveScope(next);
    reload(next);
  }, [reload]);

  // Optimistic vote — replace the poll in `active` with the server's
  // updated payload returned by the vote endpoint, so the bar fills
  // in without a full feed reload.
  const handleVoted = useCallback((updated) => {
    setData((prev) => {
      if (!prev) return prev;
      const replace = (rows) => rows.map((row) => row.id === updated.id ? updated : row);
      return { ...prev, active: replace(prev.active), archived: replace(prev.archived) };
    });
  }, []);

  // Close own poll — moves it from active → archived and frees the
  // citizen's "1 active per page" slot. We just refetch since both
  // buckets shift.
  const handleClosed = useCallback(async (poll) => {
    const ok = window.confirm(
      'Close this poll? You can post a new one on this page once it\'s closed.',
    );
    if (!ok) return;
    const { error: e } = await closeCitizenPoll(poll.id);
    if (e) {
      window.alert(`Couldn't close: ${e}`);
      return;
    }
    reload();
  }, [reload]);

  const handleReported = useCallback((pollId) => {
    // Mark the poll as reported in local state so the button flips to
    // "Reported" without a full reload.
    setData((prev) => {
      if (!prev) return prev;
      const stamp = (rows) => rows.map((row) =>
        row.id === pollId
          ? { ...row, my_report_filed: true, report_count: (row.report_count || 0) + 1 }
          : row,
      );
      return { ...prev, active: stamp(prev.active), archived: stamp(prev.archived) };
    });
  }, []);

  const handleCreated = useCallback((poll) => {
    setData((prev) => {
      if (!prev) {
        return { official_id: officialId, page_claimed: false, active: [poll], archived: [], active_count: 1, active_cap: 20, caller_has_active_poll: true, caller_role: 'subscribed' };
      }
      // New poll lands at the top; bump the rate-limit signals.
      return {
        ...prev,
        active: [poll, ...prev.active],
        active_count: (prev.active_count || 0) + 1,
        caller_has_active_poll: true,
      };
    });
    setCreateOpen(false);
  }, [officialId]);

  const handleDismissArchive = useCallback(async () => {
    if (!isOwner) return;
    const { error: e } = await dismissPreClaimArchive(officialId);
    if (e) {
      window.alert(`Couldn't dismiss: ${e}`);
      return;
    }
    setData((prev) => prev ? { ...prev, archived: [] } : prev);
  }, [isOwner, officialId]);

  // Initial loading state — only block when we have nothing else to
  // render. Once we've fetched once we keep the surface visible across
  // refetches so it doesn't blink.
  if (loading && !data && !error) {
    return (
      <div style={sectionStyle}>
        <div style={{ color: 'var(--cl-text-light)', fontSize: '0.85rem' }}>
          Loading citizen-led discussion…
        </div>
      </div>
    );
  }

  // On fetch error we DON'T disappear the section — the banner +
  // "Start a poll" CTA still render so a citizen on an unclaimed
  // page can see the feature exists. The feed area swaps in a
  // small inline notice. (A failed list endpoint usually just means
  // the backend hasn't been redeployed with the new /api/citizen-
  // polls routes yet; create attempts will surface the same error
  // inline at submit time.)
  if (error && typeof console !== 'undefined') {
    console.warn('CitizenPollsSection: list fetch failed:', error);
  }

  const active = data?.active || [];
  const archived = data?.archived || [];
  const callerRole = data?.caller_role; // 'subscribed' | 'rep_owner' | null
  const isCitizen = !!citizen;
  // Anonymous viewers can read but not vote / comment / create.
  // Subscribed citizens can do all three (subject to the 1-per-page rule).
  // Rep owners on a claimed page see only the archive (active is empty
  // post-claim).
  const canCreate = isCitizen && !pageClaimed && !data?.caller_has_active_poll
    && (data?.active_count || 0) < (data?.active_cap || 20);

  // Suppress the whole section on a claimed page when the rep has
  // dismissed the archive (archived list is empty post-dismiss).
  if (pageClaimed && archived.length === 0) return null;

  // Scope chip row — only render when the office supports more than
  // country scope. President / VP / Cabinet / SCOTUS pages skip the
  // row entirely (allowed_scopes is just ['country']) so we don't
  // surface a single-chip "filter" with nothing to filter against.
  const scopes = data?.allowed_scopes || ['country'];
  const scopeLabels = data?.scope_labels || { country: 'United States' };
  const showScopeFilter = scopes.length > 1;

  return (
    <div style={sectionStyle}>
      <SectionBanner
        ownerName={ownerName}
        pageClaimed={pageClaimed}
        archivedCount={archived.length}
        isOwner={isOwner}
        onDismissArchive={handleDismissArchive}
      />

      {showScopeFilter && (
        <ScopeChipRow
          scopes={scopes}
          labels={scopeLabels}
          active={activeScope}
          onChange={handleScopeChange}
        />
      )}

      {!pageClaimed && (
        <div style={{ marginTop: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              if (!isCitizen) return onCitizenLoginRequired?.();
              setCreateOpen(true);
            }}
            disabled={isCitizen && !canCreate}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: 8,
              background: (isCitizen && !canCreate) ? 'var(--cl-border)' : 'var(--cl-accent)',
              color: 'white',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: (isCitizen && !canCreate) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
            title={
              !isCitizen
                ? 'Sign in as a citizen to start a poll.'
                : data?.caller_has_active_poll
                  ? 'Close your existing poll on this page first.'
                  : (data?.active_count || 0) >= (data?.active_cap || 20)
                    ? 'This page is at the citizen-poll cap.'
                    : ''
            }
          >
            {isCitizen ? '+ Start a poll' : 'Sign in to start a poll'}
          </button>
          <span style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
            {data?.active_count || 0} of {data?.active_cap || 20} active polls on this page
            {data?.caller_has_active_poll ? ' · You already have one open here' : ''}
          </span>
        </div>
      )}

      {/* Active feed (unclaimed pages). On claimed pages this is empty
          and we render the archive section instead. We distinguish
          three "feed empty" reasons: (a) genuine empty — invite the
          user to be the first; (b) fetch failed — tell them so they
          don't think the page is blank on purpose; (c) loading — quiet
          dots. */}
      {!pageClaimed && active.length === 0 && (
        <div
          style={{
            padding: '14px 16px',
            border: '1px dashed var(--cl-border)',
            borderRadius: 10,
            background: 'var(--cl-card)',
            fontSize: '0.86rem',
            color: 'var(--cl-text-light)',
          }}
        >
          {error
            ? "Couldn't reach the citizen-polls service. Try again in a moment — your draft will go through once the connection is back."
            : loading
              ? 'Loading…'
              : `No citizen polls yet. Be the first — start a conversation about what you'd like to ask ${ownerName} once they join.`}
        </div>
      )}
      {!pageClaimed && active.map((poll) => (
        <CitizenPollCard
          key={poll.id}
          poll={poll}
          ownerOfficialId={officialId}
          citizen={citizen}
          isOwner={isOwner}
          archived={false}
          onVoted={handleVoted}
          onClosed={handleClosed}
          onReportClick={() => setReportTarget(poll)}
          onCitizenLoginRequired={onCitizenLoginRequired}
        />
      ))}

      {/* Owner's archived "Pre-claim discussion" section. We only fetch
          this when isOwner is true (the backend gates it) so we just
          render whatever came down. */}
      {pageClaimed && isOwner && archived.length > 0 && (
        <>
          <div style={{ marginTop: 18, marginBottom: 10 }}>
            <div
              style={{
                fontSize: '0.78rem', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.4px',
                color: 'var(--cl-text-light)',
              }}
            >
              Pre-claim discussion · {archived.length} archived poll{archived.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: 4 }}>
              These polls were started by citizens before you claimed this page. They're read-only here, but the citizens who created them keep them in their dashboards.
            </div>
          </div>
          {archived.map((poll) => (
            <CitizenPollCard
              key={poll.id}
              poll={poll}
              ownerOfficialId={officialId}
              citizen={citizen}
              isOwner={isOwner}
              archived
              onVoted={handleVoted}
              onClosed={handleClosed}
              onReportClick={() => setReportTarget(poll)}
              onCitizenLoginRequired={onCitizenLoginRequired}
            />
          ))}
        </>
      )}

      {createOpen && (
        <CreateCitizenPollModal
          officialId={officialId}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {reportTarget && (
        <ReportPollModal
          poll={reportTarget}
          onClose={() => setReportTarget(null)}
          onReported={(pid) => {
            handleReported(pid);
            setReportTarget(null);
          }}
        />
      )}
    </div>
  );
}

const sectionStyle = {
  marginTop: 16,
  padding: '14px 16px 18px',
  background: 'var(--cl-card)',
  border: '2px solid var(--cl-accent-soft, #d8eedd)',
  borderRadius: 14,
};

// ─────────────────────────────────────────────────────────────────────
// Banner — different copy for unclaimed vs. owner-on-claimed-page
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// Scope chip row — Country / State / District / City. Only rendered
// when the page's office supports more than country scope (so
// Cabinet / SCOTUS / President / VP pages skip it entirely). Uses
// the labels the backend computed from the curated officials index
// — we don't redo that derivation here.
// ─────────────────────────────────────────────────────────────────────
function ScopeChipRow({ scopes, labels, active, onChange }) {
  const TITLE = {
    country: 'All US citizens',
    state: 'Citizens in the state this office represents',
    district: 'Citizens in the district this office represents',
    city: 'Citizens in the city this office represents',
  };
  return (
    <div
      style={{
        marginTop: 12,
        marginBottom: 10,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
      role="tablist"
      aria-label="Filter poll vote counts by geographic scope"
    >
      <span
        style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          color: 'var(--cl-text-light)',
        }}
      >
        Filter
      </span>
      {scopes.map((s) => {
        const isActive = active === s;
        const display = s === 'country' ? 'Country' : s.charAt(0).toUpperCase() + s.slice(1);
        const label = labels[s];
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(s)}
            title={TITLE[s]}
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              border: `1px solid ${isActive ? 'var(--cl-accent)' : 'var(--cl-border)'}`,
              background: isActive ? 'var(--cl-accent)' : 'white',
              color: isActive ? 'white' : 'var(--cl-text)',
              fontSize: '0.78rem',
              fontWeight: isActive ? 700 : 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {display}
            {label && s !== 'country' && (
              <span
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--cl-bg)',
                  color: isActive ? 'white' : 'var(--cl-text-light)',
                  letterSpacing: '0.02em',
                }}
              >
                {label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SectionBanner({ ownerName, pageClaimed, archivedCount, isOwner, onDismissArchive }) {
  if (pageClaimed && isOwner) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--cl-text)' }}>
            Citizen-led discussion archive
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)', marginTop: 4 }}>
            Welcome aboard. Citizens started {archivedCount} poll{archivedCount === 1 ? '' : 's'} on this page before you claimed it. Skim what they wanted to talk about, or hide this section.
          </div>
        </div>
        <button
          type="button"
          onClick={onDismissArchive}
          style={{
            padding: '6px 12px',
            border: '1px solid var(--cl-border)',
            background: 'white',
            color: 'var(--cl-text-light)',
            borderRadius: 8,
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Hide section
        </button>
      </div>
    );
  }

  // Unclaimed page banner.
  return (
    <div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: '0.7rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--cl-accent)',
          padding: '3px 8px',
          background: 'var(--cl-accent-soft, #e6f4ea)',
          borderRadius: 999,
          marginBottom: 8,
        }}
      >
        Citizen-led conversation
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--cl-text)' }}>
        While {ownerName} hasn't joined CivicView yet…
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--cl-text-light)', marginTop: 4, lineHeight: 1.4 }}>
        Subscribed citizens can start polls and conversations here. The official's response — and any polls they post — will replace this section if they claim the page.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// One poll card — header + author chip + bars + footer + comments
// ─────────────────────────────────────────────────────────────────────
function CitizenPollCard({
  poll,
  ownerOfficialId,
  citizen,
  isOwner,
  archived,
  onVoted,
  onClosed,
  onReportClick,
  onCitizenLoginRequired,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const author = poll.author || {};
  const inner = poll.poll || {};
  const total = inner.total_votes || 0;
  const myChoice = inner.voter_choice_id || null;
  const isClosed = !!inner.closes_at && new Date(inner.closes_at).getTime() <= Date.now();
  // Phase 2/4c self-engagement: rep / candidate owner of the page
  // this poll lives on can also vote, in addition to any signed-in
  // citizen.
  const canVote = (!!citizen || isOwner) && !archived && !isClosed;
  const isMine = !!citizen && author.id === citizen.id;

  // Phase 6 multi-identity: same picker pattern as PollCard. Pull
  // active identities + the per-identity voter_choices for this
  // poll so we know who's already voted on which option.
  const activeIdentities = useActiveIdentities({ isOwner: true });
  const voterChoicesByIdentity = inner.voter_choices || {};
  const [votePicker, setVotePicker] = useState(null);

  const fireVote = async (optionId, asIdentity) => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await voteOnCitizenPoll(poll.id, optionId, asIdentity);
    setBusy(false);
    if (e) {
      setError(e);
      return;
    }
    if (data && onVoted) onVoted(data);
  };

  const cast = async (optionId) => {
    if (!citizen && !isOwner) return onCitizenLoginRequired?.();
    if (!canVote || busy) return;
    const decision = pickEngagementIdentity({ identities: activeIdentities });
    if (decision.none) return onCitizenLoginRequired?.();
    if (decision.single) return fireVote(optionId, null);
    // Multi-identity → always show the picker. currentState='voted'
    // only when the identity has voted for THIS specific option.
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

  const maxVotes = useMemo(
    () => (inner.options || []).reduce((m, o) => Math.max(m, o.vote_count || 0), 0),
    [inner.options],
  );

  return (
    <article
      style={{
        marginTop: 10,
        background: 'white',
        border: '1px solid var(--cl-border)',
        borderRadius: 12,
        padding: 14,
        opacity: archived ? 0.92 : 1,
      }}
    >
      {/* Header: author + archive pill */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <CitizenAvatar name={author.display_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--cl-text)' }}>
              {author.display_name || 'Citizen'}
            </span>
            <span
              style={{
                fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
                borderRadius: 999,
                background: 'var(--cl-accent-soft, #e6f4ea)',
                color: 'var(--cl-accent)',
                textTransform: 'uppercase', letterSpacing: '0.4px',
              }}
            >
              Citizen
            </span>
            {!author.verified && (
              <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)' }}>(Unverified)</span>
            )}
            {archived && (
              <span
                style={{
                  fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
                  borderRadius: 999,
                  background: 'var(--cl-warning-soft, #fff3e0)',
                  color: 'var(--cl-warning-text, #b06b00)',
                  textTransform: 'uppercase', letterSpacing: '0.4px',
                }}
              >
                {labelForArchiveReason(poll.archived_reason)}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', marginTop: 2 }}>
            {[
              author.congressional_district,
              author.state ? null : null, // district already says state
              author.state && !author.congressional_district ? author.state : null,
              author.city,
              relTime(poll.created_at),
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {/* Per-card actions: report + close */}
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Close — defensive double-check: server-side can_close
              already excludes everyone except the author, but we
              also gate on a non-null citizen here so a stale
              response or session edge case can't render the button
              for someone who isn't even signed in as a citizen. */}
          {!archived && !!citizen && poll.can_close && isMine && (
            <button
              type="button"
              onClick={() => onClosed(poll)}
              style={iconBtnStyle}
              title="Close this poll"
            >
              Close
            </button>
          )}
          {/* Report — needs a citizen session (or rep) to actually
              succeed; for anonymous viewers we skip the button
              instead of letting them mash it for a 401. */}
          {!isMine && !!citizen && !poll.my_report_filed && (
            <button
              type="button"
              onClick={onReportClick}
              style={iconBtnStyle}
              title="Report this poll"
            >
              Report
            </button>
          )}
          {poll.my_report_filed && (
            <span style={{ ...iconBtnStyle, cursor: 'default', color: 'var(--cl-text-light)' }}>
              Reported
            </span>
          )}
        </div>
      </div>

      {/* Question */}
      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--cl-text)', lineHeight: 1.35, marginBottom: 10 }}>
        {inner.question}
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(inner.options || []).map((opt) => {
          const pct = total > 0 ? Math.round((100 * (opt.vote_count || 0)) / total) : 0;
          const isChoice = myChoice === opt.id;
          const isLeader = total > 0 && (opt.vote_count || 0) === maxVotes && maxVotes > 0;
          return (
            <div key={opt.id} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => cast(opt.id)}
              disabled={!canVote || busy}
              style={{
                position: 'relative',
                width: '100%',
                textAlign: 'left',
                background: 'var(--cl-bg)',
                border: `1.5px solid ${isChoice ? 'var(--cl-accent)' : 'var(--cl-border)'}`,
                borderRadius: 8,
                padding: '8px 12px',
                cursor: canVote && !busy ? 'pointer' : 'default',
                fontFamily: 'inherit',
                color: 'var(--cl-text)',
                overflow: 'hidden',
              }}
            >
              <div
                aria-hidden
                style={{
                  position: 'absolute', top: 0, left: 0, bottom: 0,
                  width: `${pct}%`,
                  background: isChoice
                    ? 'rgba(24, 119, 242, 0.18)'
                    : isLeader ? 'rgba(24, 119, 242, 0.08)' : 'rgba(0,0,0,0.04)',
                  transition: 'width 0.3s ease',
                  zIndex: 0,
                }}
              />
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.86rem' }}>
                <span style={{ fontWeight: isChoice ? 700 : 500 }}>
                  {opt.text}
                  {isChoice && (
                    <span style={{ marginLeft: 6, color: 'var(--cl-accent)', fontSize: '0.72rem' }}>✓ your vote</span>
                  )}
                  {/* When the viewer IS the poll author and this is
                      their choice, also surface an "Author" pill so
                      it's visible that the creator did vote in their
                      own poll. Transparency note: until we wire a
                      backend field exposing the author's choice to
                      everyone, this badge only renders for the
                      author themselves — other viewers can't see
                      which option the author picked. */}
                  {isChoice && isMine && (
                    <span
                      style={{
                        marginLeft: 6, padding: '1px 6px',
                        borderRadius: 999,
                        background: 'var(--cl-accent-soft, #e6f4ea)',
                        color: 'var(--cl-accent)',
                        fontSize: '0.62rem', fontWeight: 800,
                        textTransform: 'uppercase', letterSpacing: '0.4px',
                      }}
                      title="You created this poll"
                    >
                      Author
                    </span>
                  )}
                </span>
                <span style={{ color: 'var(--cl-text-light)', fontVariantNumeric: 'tabular-nums' }}>
                  {pct}% · {opt.vote_count || 0}
                </span>
              </div>
            </button>
            {/* Phase 6 — IdentityPicker anchors to this option's
                wrapper. currentState is already set on each identity
                by `cast` above so we just pass them through. */}
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
        })}
      </div>

      {error && (
        <div style={{ marginTop: 8, color: '#c33333', fontSize: '0.78rem' }}>{error}</div>
      )}

      {/* Footer: votes + comments toggle */}
      <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'center', fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
        <span><strong style={{ color: 'var(--cl-text)' }}>{total}</strong> votes</span>
        <button
          type="button"
          onClick={() => setCommentsOpen((v) => !v)}
          style={{
            background: 'transparent', border: 'none', padding: 0,
            color: 'var(--cl-accent)', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '0.78rem',
          }}
        >
          {commentsOpen ? 'Hide' : 'Show'} comments ({poll.comment_count || 0})
        </button>
        {isClosed && <span>· Closed</span>}
        {!isClosed && inner.closes_at && (
          <span>· Closes {new Date(inner.closes_at).toLocaleDateString()}</span>
        )}
      </div>

      {commentsOpen && (
        <CommentsThread
          mode="poll"
          pollId={poll.id}
          signedIn={!!citizen || isOwner}
          onLoginRequired={onCitizenLoginRequired}
          ownerOfficialId={ownerOfficialId}
          ownerKind={null}
          archived={archived}
        />
      )}
    </article>
  );
}

const iconBtnStyle = {
  padding: '4px 10px',
  border: '1px solid var(--cl-border)',
  background: 'white',
  color: 'var(--cl-text-light)',
  borderRadius: 6,
  fontSize: '0.72rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

function CitizenAvatar({ name }) {
  const initials = (name || '?')
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')
    .slice(0, 2);
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: '50%',
        background: 'var(--cl-accent-soft, #e6f4ea)',
        color: 'var(--cl-accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: '0.82rem',
        flexShrink: 0,
      }}
      aria-hidden
    >
      {initials || '•'}
    </div>
  );
}

function labelForArchiveReason(r) {
  switch (r) {
    case 'rep_claimed':    return 'Rep claimed page';
    case 'citizen_closed': return 'Author closed';
    case 'superseded':     return 'Auto-archived';
    case 'reported':       return 'Removed';
    default:               return 'Archived';
  }
}

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────
// Report modal
// ─────────────────────────────────────────────────────────────────────
function ReportPollModal({ poll, onClose, onReported }) {
  const [reason, setReason] = useState('spam');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await reportCitizenPoll(poll.id, { reason, detail: detail.trim() || null });
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    if (data?.already_reported) {
      window.alert('You have already reported this poll.');
    }
    onReported?.(poll.id);
  };

  return (
    <ModalShell title="Report this poll" onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ fontSize: '0.84rem', color: 'var(--cl-text)', marginBottom: 12, lineHeight: 1.4 }}>
          Reports go to the CivicView moderation queue. Only one report per poll, per person — clicking again won't add weight to your first.
        </div>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Reason
          </span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: '100%', marginTop: 4, padding: '8px 10px',
              border: '1px solid var(--cl-border)', borderRadius: 8,
              fontSize: '0.86rem', fontFamily: 'inherit', background: 'white',
              color: 'var(--cl-text)',
            }}
          >
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Details (optional)
          </span>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="Anything specific you'd like the moderators to look at?"
            style={{
              width: '100%', marginTop: 4, padding: '8px 10px',
              border: '1px solid var(--cl-border)', borderRadius: 8,
              fontSize: '0.86rem', fontFamily: 'inherit', background: 'white',
              color: 'var(--cl-text)', resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </label>
        {error && (
          <div style={{ marginBottom: 8, color: '#c33333', fontSize: '0.82rem' }}>{error}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button type="submit" disabled={submitting} style={modalSubmitBtnStyle}>
            {submitting ? 'Reporting…' : 'Report poll'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Create-poll modal — same poll options as a rep, no body / no images
// ─────────────────────────────────────────────────────────────────────
function CreateCitizenPollModal({ officialId, onClose, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [presentation, setPresentation] = useState('full');
  const [timing, setTiming] = useState('none');           // 'none' | 'duration' | 'date'
  const [durationValue, setDurationValue] = useState('1');
  const [durationUnit, setDurationUnit] = useState('days');
  const [dateValue, setDateValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const setOption = (idx, val) => setOptions((prev) => prev.map((o, i) => i === idx ? val : o));
  const addOption = () => setOptions((prev) => prev.length < 4 ? [...prev, ''] : prev);
  const removeOption = (idx) => setOptions((prev) => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev);

  const closesAtIso = useMemo(() => {
    if (timing === 'none') return null;
    if (timing === 'duration') {
      const n = parseFloat(durationValue);
      if (!Number.isFinite(n) || n <= 0) return null;
      const unitMs = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[durationUnit] || 0;
      return new Date(Date.now() + n * unitMs).toISOString();
    }
    if (timing === 'date') {
      if (!dateValue) return null;
      const t = new Date(dateValue).getTime();
      if (Number.isNaN(t) || t <= Date.now()) return null;
      return new Date(t).toISOString();
    }
    return null;
  }, [timing, durationValue, durationUnit, dateValue]);

  const valid = useMemo(() => {
    if (!question.trim()) return false;
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length < 2) return false;
    if (timing !== 'none' && !closesAtIso) return false;
    return true;
  }, [question, options, timing, closesAtIso]);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    const cleanedOptions = options
      .map((o) => o.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    const payload = {
      question: question.trim(),
      options: cleanedOptions,
      presentation_mode: presentation,
    };
    if (closesAtIso) payload.closes_at = closesAtIso;
    const { data, error: err } = await createCitizenPoll(officialId, payload);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onCreated?.(data);
  };

  return (
    <ModalShell title="Start a poll" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)', marginBottom: 12, lineHeight: 1.4 }}>
          You're starting a citizen-led poll on this page. The official hasn't joined yet — your poll will be archived if they claim the page later, but stays in your dashboard.
        </div>

        <label style={fieldLabelStyle}>Question</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
          placeholder="What would you like to ask the rest of the community?"
          style={inputStyle}
        />

        <label style={{ ...fieldLabelStyle, marginTop: 12 }}>Options</label>
        {options.map((opt, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              type="text"
              value={opt}
              onChange={(e) => setOption(idx, e.target.value.slice(0, 255))}
              placeholder={`Option ${idx + 1}`}
              style={{ ...inputStyle, marginTop: 0, flex: 1 }}
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(idx)}
                style={{ width: 32, ...iconBtnStyle, background: 'white' }}
                aria-label="Remove option"
                title="Remove option"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {options.length < 4 && (
          <button
            type="button"
            onClick={addOption}
            style={{
              background: 'transparent', border: 'none', padding: '2px 4px',
              color: 'var(--cl-accent)', fontSize: '0.78rem',
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            + Add option
          </button>
        )}

        {/* Close timing */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed var(--cl-border)' }}>
          <div style={fieldLabelStyle}>When does this poll close?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: 'var(--cl-text)', marginTop: 6 }}>
            <label style={radioRowStyle}>
              <input type="radio" name="cp-timing" checked={timing === 'none'} onChange={() => setTiming('none')} />
              <span>No close time — stays open</span>
            </label>
            <label style={radioRowStyle}>
              <input type="radio" name="cp-timing" checked={timing === 'duration'} onChange={() => setTiming('duration')} />
              <span>After</span>
              <input
                type="number"
                min="1"
                value={durationValue}
                onChange={(e) => { setTiming('duration'); setDurationValue(e.target.value); }}
                style={{ ...inputStyle, marginTop: 0, width: 70 }}
              />
              <select
                value={durationUnit}
                onChange={(e) => { setTiming('duration'); setDurationUnit(e.target.value); }}
                style={{ ...inputStyle, marginTop: 0, width: 'auto', padding: '6px 10px' }}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </label>
            <label style={radioRowStyle}>
              <input type="radio" name="cp-timing" checked={timing === 'date'} onChange={() => setTiming('date')} />
              <span>On</span>
              <input
                type="datetime-local"
                value={dateValue}
                onChange={(e) => { setTiming('date'); setDateValue(e.target.value); }}
                style={{ ...inputStyle, marginTop: 0, width: 'auto' }}
              />
            </label>
            {timing !== 'none' && closesAtIso && (
              <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
                Closes {new Date(closesAtIso).toLocaleString()}
              </div>
            )}
            {timing !== 'none' && !closesAtIso && (
              <div style={{ fontSize: '0.72rem', color: '#c33333', fontStyle: 'italic' }}>
                Pick a moment in the future.
              </div>
            )}
          </div>
        </div>

        {/* Presentation */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed var(--cl-border)' }}>
          <div style={fieldLabelStyle}>Show results?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: 'var(--cl-text)', marginTop: 6 }}>
            <label style={radioRowStyle}>
              <input type="radio" name="cp-pres" checked={presentation === 'full'} onChange={() => setPresentation('full')} />
              <span>Show vote percentages right away</span>
            </label>
            <label style={radioRowStyle}>
              <input type="radio" name="cp-pres" checked={presentation === 'hidden'} onChange={() => setPresentation('hidden')} />
              <span>Hide results until viewer chooses to see them</span>
            </label>
            <label style={{ ...radioRowStyle, opacity: timing === 'none' ? 0.4 : 1 }}>
              <input
                type="radio" name="cp-pres"
                checked={presentation === 'reveal_after_close'}
                disabled={timing === 'none'}
                onChange={() => setPresentation('reveal_after_close')}
              />
              <span>Hide until poll closes (requires a close time)</span>
            </label>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: '#c33333', fontSize: '0.82rem' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button type="submit" disabled={!valid || submitting} style={modalSubmitBtnStyle}>
            {submitting ? 'Publishing…' : 'Publish poll'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modal shell (centered, scrim, close on backdrop / Esc)
// ─────────────────────────────────────────────────────────────────────
function ModalShell({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 14,
          width: wide ? 560 : 440,
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cl-text)' }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', padding: 4,
              fontSize: '1.2rem', color: 'var(--cl-text-light)', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const fieldLabelStyle = {
  display: 'block',
  fontSize: '0.74rem', fontWeight: 700,
  color: 'var(--cl-text-light)',
  textTransform: 'uppercase', letterSpacing: '0.4px',
};

const inputStyle = {
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  border: '1px solid var(--cl-border)',
  borderRadius: 8,
  fontSize: '0.88rem',
  fontFamily: 'inherit',
  background: 'white',
  color: 'var(--cl-text)',
  boxSizing: 'border-box',
};

const radioRowStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  flexWrap: 'wrap',
  cursor: 'pointer',
};

const modalCancelBtnStyle = {
  padding: '8px 14px', border: '1px solid var(--cl-border)',
  background: 'white', color: 'var(--cl-text)',
  borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
  fontFamily: 'inherit',
};

const modalSubmitBtnStyle = {
  padding: '8px 14px', border: 'none',
  background: 'var(--cl-accent)', color: 'white',
  borderRadius: 8, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
  fontFamily: 'inherit',
};
