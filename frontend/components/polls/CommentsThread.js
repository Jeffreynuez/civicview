// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * CommentsThread — inline expanded thread under a /polls feed card.
 *
 * Unifies two backend comment surfaces behind a single component so
 * the polls feed can render comments for any card kind:
 *
 *   • Rep polls   → parent_post_id is set on the feed item; we read +
 *                   write against /api/pages/posts/{post_id}/comments.
 *   • Posts       → same endpoints as rep polls (the post IS the
 *                   conversation root).
 *   • Citizen +
 *     standalone
 *     polls       → /api/citizen-polls/{poll_id}/comments.
 *
 * Pick the right pair by setting `mode` to 'post' or 'poll' and
 * passing the matching `postId` / `pollId`.
 *
 * Features (matching the rep-page thread):
 *
 *   • Identity picker (visible only when ≥2 identities are signed in).
 *   • Composer textarea + Post button.
 *   • Sort dropdown (latest / oldest / most-liked).
 *   • AI tone-filter chips (Positive / Critical / Funny / Supportive /
 *     Skeptical / Informative). Multi-select; backed by
 *     /api/ai/filter-comments.
 *   • AI semantic filter input + Apply (same endpoint).
 *   • Comment items: name + Unverified pill + body + like / dislike /
 *     location / (Delete if own | Report) + Reply (2-party threading).
 *   • Lazy load: parent doesn't mount the thread until the card opens.
 *   • Pagination: shows 5 newest by default with "View all (N)" link.
 *
 * The thread takes its first fetch synchronously on mount; the parent
 * is responsible for unmounting it when the accordion collapses so
 * we don't keep stale state around.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listComments,
  createComment,
  deleteComment,
  reactToComment,
  clearCommentReaction,
  reportComment,
  filterComments,
  listCitizenPollComments,
  createCitizenPollComment,
  deletePollComment,
  reportPollComment,
} from '../../lib/pagesApi';
import { useCitizenAuth } from '../../lib/citizenAuth';
import { useAuth as useRepAuth } from '../../lib/auth';
import { useCandidateAuth } from '../../lib/candidateAuth';

// AI tone presets — same labels + ids the page-level filter uses.
const TONE_PRESETS = [
  { id: 'positive',    label: 'Positive' },
  { id: 'critical',    label: 'Critical' },
  { id: 'funny',       label: 'Funny' },
  { id: 'supportive',  label: 'Supportive' },
  { id: 'skeptical',   label: 'Skeptical' },
  { id: 'informative', label: 'Informative' },
];

const SORT_OPTIONS = [
  { id: 'latest', label: 'Latest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'liked',  label: 'Most liked' },
];

const PAGE_SIZE = 5;

export default function CommentsThread({
  mode,            // 'post' | 'poll'
  postId,          // required when mode === 'post'
  pollId,          // required when mode === 'poll'
  signedIn = false,
  onLoginRequired,
  // Tells the parent (FeedCard) to refetch the feed-item count after
  // a write — so the "Comments (N)" pill stays in sync.
  onMutated,
}) {
  const { citizen } = useCitizenAuth();
  const { me: rep } = useRepAuth();
  const { candidate } = useCandidateAuth();

  // Build the set of identities the user can author as. The order is
  // citizen → rep → candidate, mirroring the engagement-write
  // precedence the rest of the app uses; the picker defaults to
  // whatever's first in this list.
  const availableIdentities = [];
  if (citizen) availableIdentities.push({ id: 'citizen',   label: 'Citizen',   tone: 'citizen',   name: citizen.display_name });
  if (rep)     availableIdentities.push({ id: 'rep',       label: 'Rep',       tone: 'rep',       name: rep.display_name });
  if (candidate) availableIdentities.push({ id: 'candidate', label: 'Candidate', tone: 'candidate', name: candidate.display_name });

  // The active identity for new comments. Sticks to the user's choice
  // until they sign out of that identity; if the chosen identity goes
  // away mid-session, fall back to the first available one.
  const [activeIdentity, setActiveIdentity] = useState(null);
  useEffect(() => {
    if (!availableIdentities.length) {
      setActiveIdentity(null);
      return;
    }
    if (!availableIdentities.find((i) => i.id === activeIdentity)) {
      setActiveIdentity(availableIdentities[0].id);
    }
    // We deliberately omit availableIdentities from the deps — it
    // rebuilds on every render and would re-fire this effect even
    // when nothing meaningful changed. The citizen/rep/candidate
    // refs cover what we actually care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citizen, rep, candidate]);

  const [identityMenuOpen, setIdentityMenuOpen] = useState(false);
  const activeIdentityRecord = availableIdentities.find((i) => i.id === activeIdentity) || availableIdentities[0];

  const [comments, setComments] = useState(null);     // null = loading
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('latest');

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(null);

  const [activeTones, setActiveTones] = useState([]);
  const [semQuery, setSemQuery] = useState('');
  const [filterIds, setFilterIds] = useState(null);   // null = no AI filter
  const [filterBusy, setFilterBusy] = useState(false);

  const [shown, setShown] = useState(PAGE_SIZE);
  const [replyingTo, setReplyingTo] = useState(null); // commentId

  // ── load thread on mount, refetch when sort changes ───────────────
  const load = useCallback(async () => {
    setError(null);
    let data, err;
    if (mode === 'poll') {
      ({ data, error: err } = await listCitizenPollComments(pollId));
    } else {
      ({ data, error: err } = await listComments(postId, { sort }));
    }
    if (err) {
      setError(typeof err === 'string' ? err : 'Could not load comments.');
      setComments([]);
      return;
    }
    // Both endpoints return either `{ items: [...] }` or a bare array
    // depending on the surface. Normalize defensively.
    const items = Array.isArray(data) ? data : (data?.items || []);
    setComments(items);
    setFilterIds(null);  // reset AI filter on every reload
  }, [mode, pollId, postId, sort]);

  useEffect(() => { load(); }, [load]);

  // ── derived: which comments to display after sort + AI filter ─────
  const sortedFiltered = useMemo(() => {
    if (!comments) return [];
    let list = comments;
    if (filterIds) {
      const allow = new Set(filterIds);
      list = list.filter((c) => allow.has(c.id));
    }
    if (sort === 'oldest') {
      list = [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sort === 'liked') {
      list = [...list].sort(
        (a, b) => (b.reactions_up || 0) - (a.reactions_up || 0),
      );
    } else {
      list = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return list;
  }, [comments, sort, filterIds]);

  const visible = sortedFiltered.slice(0, shown);

  // ── handlers ──────────────────────────────────────────────────────
  const handlePost = async (parentId = null) => {
    if (!signedIn) { onLoginRequired?.(); return; }
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    setPostError(null);
    const create = mode === 'poll'
      ? createCitizenPollComment(pollId, text, parentId, activeIdentity)
      : createComment(postId, text, parentId, activeIdentity);
    const { error: err } = await create;
    setPosting(false);
    if (err) {
      setPostError(typeof err === 'string' ? err : 'Could not post comment.');
      return;
    }
    setDraft('');
    setReplyingTo(null);
    await load();
    onMutated?.();
  };

  const handleDelete = async (commentId) => {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return;
    const del = mode === 'poll' ? deletePollComment(commentId) : deleteComment(commentId);
    const { error: err } = await del;
    if (err) {
      setError(typeof err === 'string' ? err : 'Could not delete comment.');
      return;
    }
    await load();
    onMutated?.();
  };

  const handleReport = async (commentId) => {
    const reason = window.prompt('Reason for reporting this comment?');
    if (!reason) return;
    const rep = mode === 'poll'
      ? reportPollComment(commentId, { reason, detail: reason })
      : reportComment(commentId, { reason, detail: reason });
    const { error: err } = await rep;
    if (err) {
      window.alert(`Could not report: ${err}`);
      return;
    }
    window.alert('Thanks — a moderator will review this comment.');
  };

  const handleReact = async (commentId, kind, currentlyActive) => {
    if (!signedIn) { onLoginRequired?.(); return; }
    // post-comment endpoints only today; citizen-poll-comment reactions
    // aren't wired through the same endpoint yet — keep both safe.
    if (mode === 'poll') {
      // No-op stub for now; PR #4 polish can wire poll-comment reactions
      // once the backend mirrors PostComment's reactions surface.
      return;
    }
    const fn = currentlyActive ? clearCommentReaction(commentId) : reactToComment(commentId, kind);
    const { error: err } = await fn;
    if (err) {
      setError(typeof err === 'string' ? err : 'Could not record reaction.');
      return;
    }
    await load();
  };

  const toggleTone = (id) => {
    setActiveTones((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const applyAIFilter = async () => {
    if (mode === 'poll') {
      // AI filter targets the post comments endpoint today. The polls
      // surface gets it in a follow-up once the backend mirrors the
      // same /api/ai/filter-comments shape for poll comments.
      return;
    }
    const prompt = [
      semQuery.trim(),
      activeTones.length ? `tones: ${activeTones.join(', ')}` : '',
    ].filter(Boolean).join('. ');
    if (!prompt) {
      setFilterIds(null);
      return;
    }
    setFilterBusy(true);
    const { data, error: err } = await filterComments({
      source: 'post',
      sourceId: postId,
      prompt,
    });
    setFilterBusy(false);
    if (err) {
      setError(typeof err === 'string' ? err : 'AI filter failed.');
      return;
    }
    setFilterIds(data?.matched_ids || []);
  };

  const clearAIFilter = () => {
    setActiveTones([]);
    setSemQuery('');
    setFilterIds(null);
  };

  // ── render ────────────────────────────────────────────────────────
  return (
    <div className="thread">
      {/* Identity picker — when 2+ identities are signed in the
          badge becomes a click-to-pick dropdown. Single-identity
          users see a static badge; signed-out users see "Guest". */}
      {availableIdentities.length === 0 ? (
        <div className="thread__identity">
          <span className="thread__identity-badge">GUEST</span>
          <span className="thread__identity-name">Sign in to comment</span>
        </div>
      ) : availableIdentities.length === 1 ? (
        <div className="thread__identity">
          <span className={`thread__identity-badge thread__identity-badge--${activeIdentityRecord.tone}`}>
            {activeIdentityRecord.label.toUpperCase()}
          </span>
          <span className="thread__identity-name">{activeIdentityRecord.name}</span>
        </div>
      ) : (
        <div className="thread__identity thread__identity--picker">
          <button
            type="button"
            className="thread__identity-trigger"
            onClick={() => setIdentityMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={identityMenuOpen}
          >
            <span className={`thread__identity-badge thread__identity-badge--${activeIdentityRecord.tone}`}>
              {activeIdentityRecord.label.toUpperCase()}
            </span>
            <span className="thread__identity-name">{activeIdentityRecord.name}</span>
            <span className="thread__identity-chev" aria-hidden="true">▾</span>
          </button>
          {identityMenuOpen && (
            <div className="thread__identity-menu" role="listbox">
              {availableIdentities.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  role="option"
                  aria-selected={activeIdentity === i.id}
                  className={`thread__identity-item ${activeIdentity === i.id ? 'is-selected' : ''}`}
                  onClick={() => {
                    setActiveIdentity(i.id);
                    setIdentityMenuOpen(false);
                  }}
                >
                  <span className={`thread__identity-badge thread__identity-badge--${i.tone}`}>
                    {i.label.toUpperCase()}
                  </span>
                  <span className="thread__identity-name">{i.name}</span>
                  {activeIdentity === i.id && <span className="thread__identity-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <div className="thread__composer">
        <textarea
          rows="2"
          className="thread__textarea"
          placeholder={signedIn ? 'Add a comment…' : 'Sign in to comment'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!signedIn || posting}
        />
        <button
          type="button"
          className="thread__post-btn"
          onClick={() => handlePost(replyingTo)}
          disabled={!signedIn || posting || !draft.trim()}
        >
          {posting ? 'Posting…' : (replyingTo ? 'Reply' : 'Post')}
        </button>
      </div>
      {postError && <div className="thread__post-error">{postError}</div>}

      {/* Sort + AI filters */}
      <div className="thread__controls">
        <label className="thread__sort">
          <span className="thread__sort-label">Sort</span>
          <select
            className="thread__sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="thread__filters">
        <div className="thread__tone-chips">
          {TONE_PRESETS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`thread__tone-chip ${activeTones.includes(t.id) ? 'is-active' : ''}`}
              onClick={() => toggleTone(t.id)}
              aria-pressed={activeTones.includes(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="thread__sem-input"
          value={semQuery}
          onChange={(e) => setSemQuery(e.target.value)}
          placeholder="Filter comments… (e.g. 'about sunset clause')"
        />
        <button
          type="button"
          className="thread__apply"
          onClick={applyAIFilter}
          disabled={filterBusy || mode === 'poll'}
          title={mode === 'poll' ? 'AI filter available on rep posts only for now' : ''}
        >
          {filterBusy ? '…' : 'Apply'}
        </button>
        {filterIds && (
          <button type="button" className="thread__clear-filter" onClick={clearAIFilter}>
            Clear filter ({filterIds.length})
          </button>
        )}
      </div>

      {/* Comments */}
      <div className="thread__list">
        {error && <div className="thread__error">{error}</div>}
        {comments === null && <div className="thread__loading">Loading comments…</div>}
        {comments !== null && visible.length === 0 && (
          <div className="thread__empty">
            {filterIds ? 'No comments match this filter.' : 'No comments yet.'}
          </div>
        )}
        {visible.map((c) => {
          const isMine = !!(citizen && c.citizen_id === citizen.id);
          const upActive = c.viewer_reaction === 'up';
          const downActive = c.viewer_reaction === 'down';
          const loc = [c.scope_district || c.scope_state, c.scope_city].filter(Boolean).join(' · ');
          return (
            <div key={c.id} className="thread__comment">
              <div className="thread__c-head">
                <span className="thread__c-name">{c.citizen_display_name || c.author || 'Citizen'}</span>
                {c.verified === false && <span className="thread__c-unverified">Unverified</span>}
                <span className="thread__c-date">{relTime(c.created_at)}</span>
              </div>
              <div className="thread__c-body">{c.body}</div>
              <div className="thread__c-actions">
                <button
                  type="button"
                  className={`thread__c-react ${upActive ? 'is-active up' : ''}`}
                  onClick={() => handleReact(c.id, 'up', upActive)}
                  aria-label="Like"
                >
                  ▲ <span>{c.reactions_up || 0}</span>
                </button>
                <button
                  type="button"
                  className={`thread__c-react ${downActive ? 'is-active down' : ''}`}
                  onClick={() => handleReact(c.id, 'down', downActive)}
                  aria-label="Dislike"
                >
                  ▼ <span>{c.reactions_down || 0}</span>
                </button>
                {loc && <span className="thread__c-location">{loc}</span>}
                <span className="thread__c-spacer" />
                {isMine ? (
                  <button
                    type="button"
                    className="thread__c-link thread__c-link--del"
                    onClick={() => handleDelete(c.id)}
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    className="thread__c-link"
                    onClick={() => handleReport(c.id)}
                  >
                    Report
                  </button>
                )}
                <button
                  type="button"
                  className="thread__c-link thread__c-link--accent"
                  onClick={() => {
                    setReplyingTo(c.id);
                    // Focus the composer textarea on next paint.
                    setTimeout(() => {
                      document.querySelector('.thread__textarea')?.focus();
                    }, 0);
                  }}
                >
                  {replyingTo === c.id ? 'Replying…' : 'Reply'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {sortedFiltered.length > shown && (
        <button
          type="button"
          className="thread__more"
          onClick={() => setShown(sortedFiltered.length)}
        >
          View all ({sortedFiltered.length}) comments
        </button>
      )}
    </div>
  );
}

// Tiny inline relative-time formatter — same shape PollCard uses.
// Kept local so the thread file has zero shared-helper dependencies.
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString();
}
