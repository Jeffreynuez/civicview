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
import IdentityPicker from '../IdentityPicker';

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
  // Auto-expand the composer when the user clicks Reply on a comment
  // row. Keeps the collapsed-by-default UX out of the way for the
  // common case (scanning) but doesn't surprise the user who just
  // clicked an obvious "I want to reply" affordance.
  useEffect(() => {
    if (replyingTo != null) setComposerOpen(true);
  }, [replyingTo]);

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
      <div className="thread__composer-row">
        <button
          type="button"
          className={`thread__composer-toggle ${composerOpen ? 'is-open' : ''}`}
          onClick={() => setComposerOpen((v) => !v)}
          aria-expanded={composerOpen}
        >
          {composerOpen ? '▾' : '▸'} {replyingTo ? 'Reply' : 'Add comment'}
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
              onClick={() => handlePost(replyingTo)}
              disabled={!signedIn || posting || !draft.trim()}
            >
              {posting ? 'Posting…' : (replyingTo ? 'Reply' : 'Post')}
            </button>
          </div>
          {postError && <div className="thread__post-error">{postError}</div>}
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
              citizen={citizen}
              rep={rep}
              candidate={candidate}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              onReact={handleReact}
              onDelete={handleDelete}
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
  citizen,
  rep,
  candidate,
  replyingTo,
  setReplyingTo,
  onReact,
  onDelete,
  onReport,
  reactPicker,
  onReactPick,
  onClosePicker,
  replies = [],
  showReplies = false,
  onToggleReplies,
}) {
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
      </div>
      <div className="thread__c-body">{c.body}</div>
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
        {isMine ? (
          <button
            type="button"
            className="thread__c-link thread__c-link--del"
            onClick={() => onDelete(c.id)}
          >
            Delete
          </button>
        ) : (
          <button
            type="button"
            className="thread__c-link"
            onClick={() => onReport(c.id)}
          >
            Report
          </button>
        )}
        {/* Reply only appears on top-level comments (Phase 3 rule:
            replies-to-replies aren't supported, threads stay one
            level deep). */}
        {!isReply && (
          <button
            type="button"
            className="thread__c-link thread__c-link--accent"
            onClick={() => {
              setReplyingTo(c.id);
              setTimeout(() => {
                document.querySelector('.thread__textarea')?.focus();
              }, 0);
            }}
          >
            {replyingTo === c.id ? 'Replying…' : 'Reply'}
          </button>
        )}
      </div>
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
