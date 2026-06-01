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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown } from '../ui';
import {
  listComments,
  createComment,
  deleteComment,
  updateComment,
  reactToComment,
  clearCommentReaction,
  reportComment,
  filterComments,
  listCitizenPollComments,
  createCitizenPollComment,
  deletePollComment,
  reportPollComment,
  reactToPollComment,
  clearPollCommentReaction,
} from '../../lib/pagesApi';
import { useCitizenAuth } from '../../lib/citizenAuth';
import { useAuth as useRepAuth } from '../../lib/auth';
import { useCandidateAuth } from '../../lib/candidateAuth';
import { useActiveIdentities, pickEngagementIdentity } from '../../lib/activeIdentities';
import IdentityPicker, { PostingAsPicker } from '../IdentityPicker';
import PostActionsMenu from '../PostActionsMenu';

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
  // Two-party reply gate inputs — passed in by FeedCard so we can
  // mirror the rep/candidate-page rule on the /polls + /posts feed:
  // only the page owner (rep / candidate whose official_id matches
  // ownerOfficialId) and the parent comment's author may reply.
  ownerOfficialId = null,
  ownerKind = null, // 'rep' | 'candidate' | 'citizen' | 'standalone' | null
  // When true the parent entity is closed/archived: the thread stays
  // readable but no new comments or replies are allowed. Used by closed
  // citizen polls (the read view + existing replies remain visible).
  archived = false,
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

  // Close the "Posting as" menu when the user clicks anywhere outside
  // it. Matches the dismissal pattern every other dropdown in the app
  // already follows (IdentityPicker, PostingAsPicker, StateDropdown).
  // Listener is only registered while the menu is open so we don't
  // pay the cost on every render.
  const identityMenuRef = useRef(null);
  useEffect(() => {
    if (!identityMenuOpen) return undefined;
    const onDown = (e) => {
      if (identityMenuRef.current && !identityMenuRef.current.contains(e.target)) {
        setIdentityMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setIdentityMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [identityMenuOpen]);

  const [comments, setComments] = useState(null);     // null = loading
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('latest');

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(null);
  // Both composer + AI filter start COLLAPSED — users opt in with the
  // header dropdown triggers. Keeps the card chrome lighter for the
  // common "scan the thread" path.
  const [composerOpen, setComposerOpen] = useState(false);
  const [aiFilterOpen, setAiFilterOpen] = useState(false);

  const [activeTones, setActiveTones] = useState([]);
  const [semQuery, setSemQuery] = useState('');
  const [filterIds, setFilterIds] = useState(null);   // null = no AI filter
  const [filterBusy, setFilterBusy] = useState(false);

  const [shown, setShown] = useState(PAGE_SIZE);
  const [replyingTo, setReplyingTo] = useState(null); // commentId
  // Reply UX (post-unification): clicking Reply on a comment row
  // renders an inline reply composer UNDER the target comment in
  // CommentRow. The top "Add comment" composer is dedicated to
  // creating new top-level comments and no longer reacts to
  // replyingTo. The earlier auto-expand useEffect has been removed.
  // Inline reply state below.
  const [replyDraft, setReplyDraft] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState(null);
  // Identity for the inline reply composer — separate from the top
  // composer's activeIdentity so the user's identity choice for a
  // reply doesn't leak into a new top-level comment (and vice versa).
  const [replyAsIdentity, setReplyAsIdentity] = useState(null);

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

  // Bucket the flat comment list into top-level + a map of
  // parent_comment_id → replies. Top-level are comments whose
  // parent_comment_id is null/undefined; replies are everything else.
  // Reply order is oldest-first inside each parent's pool so the
  // conversation reads chronologically when expanded.
  const topLevel = useMemo(() => sortedFiltered.filter((c) => !c.parent_comment_id), [sortedFiltered]);
  const repliesByParent = useMemo(() => {
    const m = new Map();
    for (const c of sortedFiltered) {
      if (!c.parent_comment_id) continue;
      if (!m.has(c.parent_comment_id)) m.set(c.parent_comment_id, []);
      m.get(c.parent_comment_id).push(c);
    }
    // Replies render oldest-first regardless of the parent sort
    // (a reply thread reads top-to-bottom chronologically).
    for (const [, arr] of m) {
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    return m;
  }, [sortedFiltered]);
  const visible = topLevel.slice(0, shown);
  // Per-parent "Show replies" expansion state. Sticks for the life
  // of the thread (closing the FeedCard unmounts the thread so the
  // set resets).
  const [expandedReplies, setExpandedReplies] = useState(() => new Set());

  // Per-row engagement-identity picker. Multi-identity users get a
  // popover next to the comment's like/dislike button (mirrors the
  // FeedCard pattern). `null` = no picker open. Shape:
  //   { commentId, kind: 'up' | 'down', identities: [...] }
  const [commentReactPicker, setCommentReactPicker] = useState(null);

  // Engagement identities — used to decide whether to pop the picker
  // and to populate its rows. isOwner=true so rep + candidate sessions
  // can engage from the feed surface (where they don't strictly "own"
  // each card's page, but the as_identity contract honors the explicit
  // choice — same path FeedCard uses).
  const engageIdentities = useActiveIdentities({ isOwner: true });

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
    // Deliberately NOT calling onMutated here — the comment was
    // posted; the local thread refreshes above. Calling the parent's
    // load() would refetch the entire feed and visibly scroll-jump
    // the user back to the top. The feed's comment count will be
    // slightly stale until its next natural refresh, which is fine.
  };

  // Inline reply submission. Mirrors handlePost above but uses the
  // per-row replyDraft state instead of the top composer's draft, so
  // the two composers don't share text. Called from the CommentRow's
  // inline reply form.
  const handlePostReply = async (parentId) => {
    if (!signedIn) { onLoginRequired?.(); return; }
    const text = (replyDraft || '').trim();
    if (!text || replyBusy || parentId == null) return;
    setReplyBusy(true);
    setReplyError(null);
    const create = mode === 'poll'
      ? createCitizenPollComment(pollId, text, parentId, replyAsIdentity || activeIdentity)
      : createComment(postId, text, parentId, replyAsIdentity || activeIdentity);
    const { error: err } = await create;
    setReplyBusy(false);
    if (err) {
      setReplyError(typeof err === 'string' ? err : 'Could not post reply.');
      return;
    }
    setReplyDraft('');
    setReplyingTo(null);
    await load();
  };

  // Comment edit saved — update the matching row in-place so the
  // body + edited_at re-render without a full thread refetch.
  const handleEditSaved = (updated) => {
    setComments((prev) => (
      Array.isArray(prev)
        ? prev.map((x) => (x.id === updated.id ? updated : x))
        : prev
    ));
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

  // Fire the actual reaction request — split out from handleReact so
  // both the single-identity and multi-identity (picker-finalized)
  // paths share the same dispatch.
  const fireReact = async (commentId, kind, asIdentity, currentlyActive) => {
    const fn = mode === 'poll'
      ? (currentlyActive
          ? clearPollCommentReaction(commentId, asIdentity)
          : reactToPollComment(commentId, kind, asIdentity))
      : (currentlyActive
          ? clearCommentReaction(commentId, asIdentity)
          : reactToComment(commentId, kind, asIdentity));
    const { error: err } = await fn;
    if (err) {
      setError(typeof err === 'string' ? err : 'Could not record reaction.');
      return;
    }
    await load();
  };

  const handleReact = (commentId, kind, _legacyCurrentlyActive) => {
    if (!signedIn) { onLoginRequired?.(); return; }
    // Decide which identity acts. Mirrors FeedCard:
    //   • Zero identities → login prompt.
    //   • One identity   → fire immediately, toggle based on whether
    //                      that identity's my_reactions already shows
    //                      the same kind.
    //   • Multi          → pop the per-row picker. Final dispatch
    //                      happens in onCommentReactPick once the
    //                      user picks an identity.
    const decision = pickEngagementIdentity({ identities: engageIdentities });
    if (decision.none) { onLoginRequired?.(); return; }
    // Find the row's per-identity map. CommentRead surfaces my_reactions
    // as { citizen: 'up'|'down'|null, rep: ..., candidate: ... } — see
    // PR #9 followup #2. Falls back to the legacy single my_reaction
    // when an older backend response is in flight.
    const row = (comments || []).find((c) => c.id === commentId);
    const myReactions = row?.my_reactions || {};
    if (decision.single) {
      const already = (myReactions[decision.single] || row?.my_reaction) === kind;
      fireReact(commentId, kind, decision.single, already);
      return;
    }
    setCommentReactPicker({
      commentId,
      kind,
      identities: decision.showPicker.map((id) => ({
        ...id,
        // ✓ stamp only when this identity has reacted with THIS
        // specific kind. Matches the FeedCard picker semantics.
        currentState: myReactions[id.kind] === kind ? kind : null,
      })),
    });
  };

  const onCommentReactPick = (asIdentity) => {
    const pending = commentReactPicker;
    setCommentReactPicker(null);
    if (!pending) return;
    const row = (comments || []).find((c) => c.id === pending.commentId);
    const myReactions = row?.my_reactions || {};
    const already = (myReactions[asIdentity] || row?.my_reaction) === pending.kind;
    fireReact(pending.commentId, pending.kind, asIdentity, already);
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
        <div ref={identityMenuRef} className="thread__identity thread__identity--picker">
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

      {/* Composer — collapsed by default behind an "Add comment ▾"
          trigger next to the identity badge. Replying via a comment-
          row's Reply button auto-expands the composer (see the Reply
          onClick handler below). */}
      {archived ? (
        <div
          className="thread__closed"
          style={{ padding: '8px 0', fontSize: '0.8rem', color: 'var(--cl-text-muted)', fontStyle: 'italic' }}
        >
          This poll is closed to new comments.
        </div>
      ) : (
        <>
          <div className="thread__composer-row">
            <button
              type="button"
              className={`thread__composer-toggle ${composerOpen ? 'is-open' : ''}`}
              onClick={() => setComposerOpen((v) => !v)}
              aria-expanded={composerOpen}
            >
              {composerOpen ? '▾' : '▸'} Add comment
            </button>
          </div>
          {composerOpen && (
            <>
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
                  onClick={() => handlePost(null)}
                  disabled={!signedIn || posting || !draft.trim()}
                >
                  {posting ? 'Posting…' : 'Post'}
                </button>
              </div>
              {postError && <div className="thread__post-error">{postError}</div>}
            </>
          )}
        </>
      )}

      {/* Sort + AI filter trigger */}
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
        <button
          type="button"
          className={`thread__filter-toggle ${aiFilterOpen ? 'is-open' : ''}`}
          onClick={() => setAiFilterOpen((v) => !v)}
          aria-expanded={aiFilterOpen}
        >
          {aiFilterOpen ? '▾' : '▸'} AI filter
        </button>
      </div>

      {aiFilterOpen && (
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
      )}

      {/* Comments — nested rendering. We bucket the flat list into
          top-level comments + a children map keyed on parent_comment_id.
          Each top-level renders its replies under a collapsed
          "Show replies (N)" toggle so a busy thread doesn't fill the
          card. The 5-newest pagination cap still applies to TOP-LEVEL
          comments only; replies under an expanded parent always render
          in full because the user explicitly opened them. */}
      <div className="thread__list">
        {error && <div className="thread__error">{error}</div>}
        {comments === null && <div className="thread__loading">Loading comments…</div>}
        {comments !== null && visible.length === 0 && (
          <div className="thread__empty">
            {filterIds ? 'No comments match this filter.' : 'No comments yet.'}
          </div>
        )}
        {visible.map((c) => {
          const replies = repliesByParent.get(c.id) || [];
          return (
            <CommentRow
              key={c.id}
              c={c}
              isReply={false}
              archived={archived}
              citizen={citizen}
              rep={rep}
              candidate={candidate}
              ownerOfficialId={ownerOfficialId}
              ownerKind={ownerKind}
              engageIdentities={engageIdentities}
              replyAsIdentity={replyAsIdentity}
              setReplyAsIdentity={setReplyAsIdentity}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              replyDraft={replyDraft}
              setReplyDraft={setReplyDraft}
              replyBusy={replyBusy}
              replyError={replyError}
              onPostReply={handlePostReply}
              signedIn={signedIn}
              onReact={handleReact}
              onDelete={handleDelete}
              onEditSaved={handleEditSaved}
              onReport={handleReport}
              reactPicker={commentReactPicker}
              onReactPick={onCommentReactPick}
              onClosePicker={() => setCommentReactPicker(null)}
              replies={replies}
              showReplies={expandedReplies.has(c.id)}
              onToggleReplies={() => setExpandedReplies((prev) => {
                const next = new Set(prev);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                return next;
              })}
            />
          );
        })}
      </div>

      {topLevel.length > shown && (
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

// CommentRow — one comment item. Used twice: top-level + nested
// (when `isReply` is true the visual indents under the parent).
// Splitting it out keeps the parent map clean and lets the
// "Show replies" toggle render an arbitrary count of children.
function CommentRow({
  c,
  isReply,
  archived,
  citizen,
  rep,
  candidate,
  ownerOfficialId,
  ownerKind,
  engageIdentities = [],
  replyAsIdentity,
  setReplyAsIdentity,
  replyingTo,
  setReplyingTo,
  replyDraft,
  setReplyDraft,
  replyBusy,
  replyError,
  onPostReply,
  signedIn,
  onReact,
  onDelete,
  onEditSaved,
  onReport,
  reactPicker,
  onReactPick,
  onClosePicker,
  replies = [],
  showReplies = false,
  onToggleReplies,
}) {
  // Local edit state (Task #41) — kept inside CommentRow so only the
  // row being edited rerenders on every keystroke. Save bubbles the
  // updated comment up via onEditSaved so the parent thread can
  // refresh its row.
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState(null);

  const beginEdit = () => {
    setIsEditing(true);
    setEditDraft(c.body || '');
    setEditErr(null);
  };
  const cancelEdit = () => {
    setIsEditing(false);
    setEditDraft('');
    setEditErr(null);
  };
  const saveEdit = async () => {
    const trimmed = (editDraft || '').trim();
    if (!trimmed) {
      setEditErr('Comment cannot be empty.');
      return;
    }
    setEditBusy(true);
    const { data, error } = await updateComment(c.id, trimmed);
    setEditBusy(false);
    if (error) {
      setEditErr(error);
      return;
    }
    setIsEditing(false);
    setEditDraft('');
    if (typeof onEditSaved === 'function') onEditSaved(data);
  };

  // isMine across all three identity columns — a rep / candidate
  // viewing their own comment sees Delete; everyone else sees Report.
  const isMine = !!(
    (citizen && c.citizen_id === citizen.id) ||
    (rep && c.author_rep_id === rep.id) ||
    (candidate && c.author_candidate_id === candidate.id)
  );
  const upActive = c.my_reaction === 'up';
  const downActive = c.my_reaction === 'down';
  // Per-row picker open-state. Compare against the centrally-tracked
  // commentReactPicker so only ONE picker is open across the thread.
  const upPickerOpen = !!reactPicker && reactPicker.commentId === c.id && reactPicker.kind === 'up';
  const downPickerOpen = !!reactPicker && reactPicker.commentId === c.id && reactPicker.kind === 'down';
  const loc = [c.scope_district || c.scope_state, c.scope_city].filter(Boolean).join(' · ');
  return (
    <div className={`thread__comment ${isReply ? 'is-reply' : ''}`}>
      <div className="thread__c-head">
        <span className="thread__c-name">{c.citizen_display_name || c.author || 'Citizen'}</span>
        {c.verified === false && <span className="thread__c-unverified">Unverified</span>}
        <span className="thread__c-date">{relTime(c.created_at)}</span>
        {c.edited_at && (
          <span
            className="thread__c-edited"
            title={`Edited ${relTime(c.edited_at)}`}
            style={{ marginLeft: '4px', fontSize: '0.7rem', fontStyle: 'italic', color: 'var(--cl-text-light)' }}
          >
            · edited
          </span>
        )}
      </div>
      {isEditing ? (
        <div className="thread__c-body" style={{ margin: '4px 0' }}>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={3}
            maxLength={1000}
            disabled={editBusy}
            style={{
              width: '100%', padding: '6px', borderRadius: '6px',
              border: '1px solid var(--cl-border)',
              fontFamily: 'inherit', fontSize: '0.85rem',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={saveEdit}
              disabled={editBusy || !(editDraft || '').trim()}
              className="thread__c-link"
              style={{
                padding: '3px 10px', borderRadius: '6px',
                border: '1px solid var(--cl-accent)',
                background: 'var(--cl-accent)', color: 'white',
                fontWeight: 600,
                cursor: editBusy ? 'wait' : 'pointer',
              }}
            >
              {editBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={editBusy}
              className="thread__c-link"
              style={{
                padding: '3px 10px', borderRadius: '6px',
                border: '1px solid var(--cl-border)',
                background: 'white', color: 'var(--cl-text)',
                fontWeight: 600,
                cursor: editBusy ? 'wait' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          {editErr && (
            <div style={{ marginTop: '4px', color: '#d63031', fontSize: '0.72rem' }}>
              {editErr}
            </div>
          )}
        </div>
      ) : (
        <div className="thread__c-body">{c.body}</div>
      )}
      <div className="thread__c-actions">
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            className={`thread__c-react ${upActive ? 'is-active up' : ''}`}
            onClick={() => onReact(c.id, 'up', upActive)}
            aria-label="Like"
          >
            <ThumbsUp size={13} active={upActive} color="up" />
            <span>{c.up_count || 0}</span>
          </button>
          <IdentityPicker
            open={upPickerOpen}
            identities={upPickerOpen ? reactPicker.identities : []}
            onPick={onReactPick}
            onClose={onClosePicker}
          />
        </span>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className={`thread__c-react ${downActive ? 'is-active down' : ''}`}
            onClick={() => onReact(c.id, 'down', downActive)}
            aria-label="Dislike"
          >
            <ThumbsDown size={13} active={downActive} color="down" />
            <span>{c.down_count || 0}</span>
          </button>
          <IdentityPicker
            open={downPickerOpen}
            identities={downPickerOpen ? reactPicker.identities : []}
            onPick={onReactPick}
            onClose={onClosePicker}
          />
        </span>
        {loc && <span className="thread__c-location">{loc}</span>}
        <span className="thread__c-spacer" />
        {/* Edit / Delete / Report consolidated into the kebab (⋮) so the
            row stays uncluttered and the destructive Delete is out of
            accidental-tap range. Reply stays a visible button to the
            right — it's a primary action with its own composer/cancel
            state. Edit is offered only to the author and only while not
            already editing; Delete to the author, Report to everyone
            else. Reuses the same PostActionsMenu as the post + poll
            cards so the overflow affordance is identical across surfaces. */}
        <PostActionsMenu
          ariaLabel="Comment actions"
          items={[
            isMine && !isEditing && {
              id: 'edit',
              label: 'Edit',
              onClick: beginEdit,
              disabled: editBusy,
            },
            isMine
              ? { id: 'delete', label: 'Delete', onClick: () => onDelete(c.id), destructive: true }
              : { id: 'report', label: 'Report', onClick: () => onReport(c.id) },
          ].filter(Boolean)}
        />
        {/* Reply only appears on top-level comments (Phase 3 rule:
            replies-to-replies aren't supported, threads stay one
            level deep). */}
        {!isReply && !archived && (
          <button
            type="button"
            className="thread__c-link thread__c-link--accent"
            onClick={() => {
              // Toggle: clicking Reply on the open row cancels;
              // clicking on any other row switches the inline
              // composer to that row.
              if (replyingTo === c.id) {
                setReplyingTo(null);
                setReplyDraft('');
              } else {
                setReplyingTo(c.id);
                setReplyDraft('');
              }
            }}
          >
            {replyingTo === c.id ? 'Cancel reply' : 'Reply'}
          </button>
        )}
      </div>
      {/* Inline reply composer — renders just under the target
          comment so the user can see what they're replying to.
          Two-party gate: only the page owner (rep / candidate whose
          id matches ownerOfficialId) and the parent comment's
          author may reply. The filtered list drives the
          PostingAsPicker's options so a non-allowed identity
          never appears as a choice. */}
      {!isReply && replyingTo === c.id && (() => {
        const repOwnsThisPage = !!(rep && ownerOfficialId && rep.official_id === ownerOfficialId);
        const candOwnsThisPage = !!(candidate && ownerOfficialId && candidate.candidate_id === ownerOfficialId);
        const isCommentAuthor = !!(citizen && c.citizen_id != null && c.citizen_id === citizen.id);
        const replyAllowed = (engageIdentities || []).filter((id) => {
          if (id.kind === 'rep' && repOwnsThisPage) return true;
          if (id.kind === 'candidate' && candOwnsThisPage) return true;
          if (id.kind === 'citizen' && isCommentAuthor) return true;
          return false;
        });
        const effectiveReplyAs = (
          replyAllowed.find((id) => id.kind === replyAsIdentity)?.kind
          || replyAllowed[0]?.kind
          || null
        );
        if (replyAllowed.length === 0) {
          return (
            <div className="thread__inline-reply">
              <div className="thread__inline-reply-empty">
                Only the page owner and this comment's author can reply.
                <button
                  type="button"
                  className="thread__inline-reply-cancel"
                  onClick={() => { setReplyingTo(null); setReplyDraft(''); }}
                  style={{ marginLeft: 8 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }
        return (
        <div className="thread__inline-reply">
          <PostingAsPicker
            identities={replyAllowed}
            value={effectiveReplyAs}
            onChange={setReplyAsIdentity}
          />
          <textarea
            rows="2"
            className="thread__textarea thread__textarea--inline"
            placeholder={signedIn
              ? `Reply to ${c.citizen_display_name || c.author || 'this comment'}…`
              : 'Sign in to reply'}
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value.slice(0, 1000))}
            disabled={!signedIn || replyBusy}
            autoFocus
          />
          <div className="thread__inline-reply-row">
            <span className="thread__inline-reply-count">{(replyDraft || '').length}/1000</span>
            <button
              type="button"
              className="thread__inline-reply-cancel"
              onClick={() => { setReplyingTo(null); setReplyDraft(''); }}
              disabled={replyBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="thread__inline-reply-post"
              onClick={() => {
                if (effectiveReplyAs && replyAsIdentity !== effectiveReplyAs) {
                  setReplyAsIdentity(effectiveReplyAs);
                }
                onPostReply(c.id);
              }}
              disabled={!signedIn || replyBusy || !(replyDraft || '').trim()}
            >
              {replyBusy ? 'Posting…' : 'Post reply'}
            </button>
          </div>
          {replyError && (
            <div className="thread__inline-reply-error">{replyError}</div>
          )}
        </div>
        );
      })()}
      {/* "Show replies" toggle + nested children. Only on top-level
          comments with at least one reply. */}
      {!isReply && replies.length > 0 && (
        <div className="thread__replies">
          <button
            type="button"
            className="thread__replies-toggle"
            onClick={onToggleReplies}
            aria-expanded={showReplies}
          >
            {showReplies ? '⯆' : '⯈'} {showReplies ? 'Hide' : 'Show'} replies ({replies.length})
          </button>
          {showReplies && (
            <div className="thread__replies-list">
              {replies.map((r) => (
                <CommentRow
                  key={r.id}
                  c={r}
                  isReply
                  citizen={citizen}
                  rep={rep}
                  candidate={candidate}
                  setReplyingTo={setReplyingTo}
                  onReact={onReact}
                  onDelete={onDelete}
                  onReport={onReport}
                  reactPicker={reactPicker}
                  onReactPick={onReactPick}
                  onClosePicker={onClosePicker}
                />
              ))}
            </div>
          )}
        </div>
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
