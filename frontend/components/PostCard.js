'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import PollCard from './PollCard';
import {
  deletePost,
  updatePost,
  reactToPost,
  clearReaction,
  listComments,
  createComment,
  deleteComment,
  updateComment,
  reactToComment,
  resolveImageUrl,
  aiHealth,
  filterComments,
  summarizePost,
  reportPost,
  reportComment,
} from '../lib/pagesApi';
import { ThumbsUp, ThumbsDown, ChatText } from './ui';
import IdentityPicker, { PostingAsPicker } from './IdentityPicker';
import PostActionsMenu from './PostActionsMenu';
import { useActiveIdentities, pickEngagementIdentity } from '../lib/activeIdentities';
// Raw identity hooks — needed alongside useActiveIdentities so the
// per-identity ownership check (rep.official_id === post.official_id)
// can run for the two-party reply gate. activeIdentities itself
// doesn't surface each identity's underlying id field.
import { useAuth } from '../lib/auth';
import { useCandidateAuth } from '../lib/candidateAuth';

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const now = new Date();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

/**
 * A single post in a rep/candidate's feed.
 *
 * Engagement rules (Phase 1.5):
 *   • Any visitor can read posts + counts.
 *   • Only signed-in citizens can like, dislike, comment, or vote in
 *     polls. When a non-citizen clicks an engagement action we surface
 *     the CitizenLoginModal via `onCitizenLoginRequired`.
 *   • The page owner can delete any comment on their own posts; the
 *     comment author can always delete their own comment.
 *
 * Props:
 *   post                   — full post payload from the API (incl. reactions + comment_count)
 *   officialId             — page owner's id (passed through to PollCard)
 *   isOwner                — true when the logged-in rep owns this page
 *   citizen                — CitizenAccount | null (for gating + self-delete checks)
 *   onCitizenLoginRequired — opens the CitizenLoginModal
 *   onDeleted(postId)      — remove from parent list on soft-delete
 *   onPollUpdated(postId, updatedPoll) — merge a poll update back
 *   onReactionChanged(postId, summary) — merge new reaction summary
 *   onCommentCountChanged(postId, delta) — bump comment_count after a write
 */
export default function PostCard({
  post,
  officialId,
  isOwner,
  citizen,
  onCitizenLoginRequired,
  onDeleted,
  onPollUpdated,
  onReactionChanged,
  onCommentCountChanged,
  // Owner-only: when set, comment listing is filtered to this scope
  // server-side. Non-owners always pass null and see every comment.
  commentScope = null,
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const handleDelete = async () => {
    if (busy) return;
    const ok = typeof window !== 'undefined'
      ? window.confirm('Delete this post? This cannot be undone from the UI.')
      : true;
    if (!ok) return;
    setBusy(true);
    const { error } = await deletePost(post.id);
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    if (onDeleted) onDeleted(post.id);
  };

  const author = post.author || {};
  const initials = (author.display_name || '')
    .split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('');

  const reactions = post.reactions || { up_count: 0, down_count: 0, my_reaction: null };
  const myReaction = reactions.my_reaction;
  // Phase 6 multi-identity: per-identity reactions live on the
  // server (my_reactions). Frontend uses this to decide whether
  // the IdentityPicker pops on click or fires straight through.
  const myReactionsByIdentity = reactions.my_reactions || {};

  // Identities the viewer is signed in to. On the page-owner's own
  // page this includes citizen + rep/candidate; on someone else's
  // page just the citizen (rep/candidate self-engagement is
  // scoped to their own page).
  // Raw identity sessions — used for the per-identity reply-gate
  // ownership check below. Same hooks useActiveIdentities calls
  // internally; declaring them here keeps the call stack flat.
  const { me } = useAuth();
  const { candidate } = useCandidateAuth();
  const activeIdentities = useActiveIdentities({ isOwner });

  // ── Reactions ──────────────────────────────────────────────────────
  // Phase 6 picker state. `reactPicker` holds the pending kind and
  // (when in 'pick' mode) the list of identities the user still
  // needs to disambiguate between, plus the open-anchor flag.
  const [reactPicker, setReactPicker] = useState(null);

  // Internal helper — actually fire the reaction once we know which
  // identity should perform it (or `null` for the default
  // cookie-priority path when only one identity is signed in).
  const fireReaction = async (kind, asIdentity) => {
    const { data, error } = await reactToPost(post.id, kind, asIdentity);
    if (error) {
      setErr(error);
      return;
    }
    if (data && onReactionChanged) onReactionChanged(post.id, data);
  };

  const handleReact = async (kind) => {
    // No identity at all — kick the citizen login flow.
    if (activeIdentities.length === 0) {
      onCitizenLoginRequired?.();
      return;
    }
    const decision = pickEngagementIdentity({ identities: activeIdentities });
    if (decision.single) {
      // One identity total — no picker needed.
      await fireReaction(kind, null);
      return;
    }
    // Multi-identity → always show the picker. Each entry's
    // currentState is set ONLY when that identity has acted with
    // THIS picker's kind (a Down-voter doesn't get a ✓ on the Up
    // picker — they can still click Up to flip, no need to mark).
    setReactPicker({
      kind,
      identities: decision.showPicker.map((id) => ({
        ...id,
        currentState: myReactionsByIdentity[id.kind] === kind ? kind : null,
      })),
    });
  };

  const onReactionPick = (asIdentity) => {
    const kind = reactPicker?.kind;
    setReactPicker(null);
    if (kind) fireReaction(kind, asIdentity);
  };

  // ── Comments ───────────────────────────────────────────────────────
  const [commentsOpen, setCommentsOpen] = useState(false);
  // PR #10 — composer + AI filter start COLLAPSED behind dropdown
  // triggers ("Add comment ▾" and "AI filter ▾"). Keeps the comments
  // section lighter on first open; the user opts in to either tool.
  // CRITICAL: these MUST be declared at PostCard scope — they are
  // referenced from JSX rendered inside the same component. The
  // useEffect below toggles pcComposerOpen when replyOpenFor changes.
  const [pcComposerOpen, setPcComposerOpen] = useState(false);
  const [pcAiFilterOpen, setPcAiFilterOpen] = useState(false);
  const [comments, setComments] = useState(null); // null = not loaded yet
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentErr, setCommentErr] = useState(null);
  // Phase 3 reply threading state. replyOpenFor is the id of the
  // top-level comment whose reply composer is currently expanded
  // (null = no composer open). replyDraft / replyBusy track the
  // in-flight reply text. Only one composer is open at a time so
  // the thread doesn't visually fork.
  const [replyOpenFor, setReplyOpenFor] = useState(null);
  // Reply UX (post-unification): clicking Reply on a comment row
  // renders an inline reply composer UNDER the target comment (see
  // the replyOpenFor === c.id block further down). The top "Add
  // comment" composer no longer reacts to replyOpenFor — it stays
  // dedicated to authoring a new top-level comment, and the inline
  // composer handles every Reply. The auto-expand useEffect that
  // previously toggled pcComposerOpen has been removed.
  // (See the related CommentsThread.js change in the same commit.)
  // PR #10 — per-parent "Show replies" toggle. Tracks which
  // top-level comment ids have their reply pool currently
  // expanded. Sticks for the life of the thread (closing the
  // comments section unmounts the state so a fresh open starts
  // collapsed). Mirrors the /polls CommentsThread pattern (PR #8).
  const [pcExpandedReplies, setPcExpandedReplies] = useState(() => new Set());
  const [replyDraft, setReplyDraft] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  // Phase 6 — which identity authors the next comment / reply. The
  // PostingAsPicker above the textarea drives this. Defaults to
  // the first available identity; user can switch at any time.
  // Each value is null when no identities are present (anonymous).
  const [commentAsIdentity, setCommentAsIdentity] = useState(
    activeIdentities[0]?.kind || null,
  );
  const [replyAsIdentity, setReplyAsIdentity] = useState(
    activeIdentities[0]?.kind || null,
  );
  // Keep the defaults in sync with the live identity list — e.g. if
  // the user signs out of citizen mid-session, drop that choice.
  useEffect(() => {
    if (commentAsIdentity && !activeIdentities.some((i) => i.kind === commentAsIdentity)) {
      setCommentAsIdentity(activeIdentities[0]?.kind || null);
    }
    if (replyAsIdentity && !activeIdentities.some((i) => i.kind === replyAsIdentity)) {
      setReplyAsIdentity(activeIdentities[0]?.kind || null);
    }
    if (!commentAsIdentity && activeIdentities[0]) {
      setCommentAsIdentity(activeIdentities[0].kind);
    }
    if (!replyAsIdentity && activeIdentities[0]) {
      setReplyAsIdentity(activeIdentities[0].kind);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdentities.map((i) => i.kind).join('|')]);
  // Sort/filter control. `latest` is the default; my_district and
  // my_state are citizen-only filters that ride on the same dropdown
  // for a single point of UX. Anonymous viewers and owners see a
  // trimmed option list (see OPTIONS below in the render).
  const [commentSort, setCommentSort] = useState('latest');

  // ── AI-powered comment filter ─────────────────────────────────────
  // `aiFilterIds` is the set of comment IDs that survived the active
  // filter. `null` means no filter is applied (show everything);
  // an empty array means the filter ran and matched nothing. We
  // intentionally use Set for O(1) lookup in render. `aiAvailable`
  // gates the affordance — if ANTHROPIC_API_KEY isn't set on the
  // server, the chip row + free-form input hide entirely so we don't
  // tease users with a broken feature.
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiFilterIds, setAiFilterIds] = useState(null);
  const [aiFilterLabel, setAiFilterLabel] = useState('');
  const [aiFilterBusy, setAiFilterBusy] = useState(false);
  const [aiFilterErr, setAiFilterErr] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  // Probe AI availability once on first mount of any PostCard. The
  // result is process-scoped — across all PostCards on the page —
  // because aiHealth is cheap but not free, and the answer doesn't
  // change within a session.
  useEffect(() => {
    let cancelled = false;
    aiHealth().then(({ data }) => {
      if (!cancelled && data) setAiAvailable(Boolean(data.configured));
    });
    return () => { cancelled = true; };
  }, []);

  const runFilter = async (prompt) => {
    const trimmed = (prompt || '').trim();
    if (!trimmed) return;
    setAiFilterBusy(true);
    setAiFilterErr(null);
    const { data, error } = await filterComments({
      source: 'post',
      sourceId: post.id,
      prompt: trimmed,
    });
    setAiFilterBusy(false);
    if (error || !data) {
      setAiFilterErr(error || 'Filter failed');
      return;
    }
    setAiFilterIds(new Set(data.matched_ids || []));
    setAiFilterLabel(data.explanation || `Filtered: ${trimmed}`);
  };

  const clearFilter = () => {
    setAiFilterIds(null);
    setAiFilterLabel('');
    setAiFilterErr(null);
    setAiPrompt('');
  };

  // ── AI summary ─────────────────────────────────────────────────────
  // Only meaningful for long posts. We render the affordance when
  // (a) AI is available AND (b) the post body is "long" (~300 words).
  // 300 chosen empirically: shorter than a typical statement, longer
  // than a one-liner update. `aiSummary` holds the result; `aiSummaryBusy`
  // gates the button label.
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummaryErr, setAiSummaryErr] = useState(null);
  const bodyWordCount = (post.body || '').trim().split(/\s+/).filter(Boolean).length;
  const showSummarizeButton = aiAvailable && bodyWordCount >= 300;

  const handleSummarize = async () => {
    if (aiSummaryBusy) return;
    setAiSummaryBusy(true);
    setAiSummaryErr(null);
    const { data, error } = await summarizePost(post.id);
    setAiSummaryBusy(false);
    if (error || !data) {
      setAiSummaryErr(error || 'Summary failed');
      return;
    }
    setAiSummary(data);
  };

  const clearSummary = () => {
    setAiSummary(null);
    setAiSummaryErr(null);
  };

  const loadComments = async () => {
    setCommentsLoading(true);
    setCommentErr(null);
    // commentScope is only truthy when the caller is the page owner —
    // for citizens and anonymous viewers the server would 403 any
    // scope= param anyway. Omit the param entirely when null so the
    // response is cacheable.
    //
    // Sort is always sent; filter_by only when the viewer picked a
    // my_* option. Backend falls through to an unfiltered list for
    // anonymous callers passing my_* so we don't need to guard.
    const filterBy =
      commentSort === 'my_district' || commentSort === 'my_state'
        ? commentSort
        : undefined;
    const sort =
      commentSort === 'my_district' || commentSort === 'my_state'
        ? 'latest'
        : commentSort;
    const { data, error } = await listComments(post.id, {
      scope: commentScope || undefined,
      sort,
      filterBy,
    });
    setCommentsLoading(false);
    if (error) {
      setCommentErr(error);
      return;
    }
    setComments(Array.isArray(data) ? data : []);
  };

  // Lazy-load comments when expanded the first time, AND re-fetch
  // whenever the owner flips the scope filter OR the sort/filter
  // dropdown changes. Keying on all three makes the list react to
  // every filter source without duplicated logic.
  useEffect(() => {
    if (commentsOpen) {
      loadComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsOpen, commentScope, commentSort]);

  // Reaction handler for a single comment. Reuses the toggle/flip
  // semantics from post reactions — the backend knows what to do
  // based on the caller's existing reaction.
  // Phase 6 comment-reaction picker state. Keyed by commentId so a
  // user with two open pickers (clicking 👍 on different comments)
  // would get the right one — but we only render one at a time
  // since each comment row has its own picker positioned relative
  // to its own button.
  const [commentReactPicker, setCommentReactPicker] = useState(null);

  const fireCommentReaction = async (commentId, kind, asIdentity) => {
    const { data, error } = await reactToComment(commentId, kind, asIdentity);
    if (error) {
      setCommentErr(error);
      return;
    }
    if (!data) return;
    setComments((prev) =>
      prev
        ? prev.map((c) =>
            c.id === commentId
              ? {
                  ...c,
                  up_count: data.up_count,
                  down_count: data.down_count,
                  my_reaction: data.my_reaction,
                  my_reactions: data.my_reactions || c.my_reactions,
                }
              : c
          )
        : prev
    );
  };

  const handleCommentReact = async (commentId, kind, perCommentReactions) => {
    if (activeIdentities.length === 0) {
      onCitizenLoginRequired?.();
      return;
    }
    const myReactionsByIdentity = perCommentReactions || {};
    const decision = pickEngagementIdentity({ identities: activeIdentities });
    if (decision.single) {
      await fireCommentReaction(commentId, kind, null);
      return;
    }
    // Multi-identity → always show the picker. currentState is set
    // only when the identity has reacted with THIS picker's kind
    // (no ✓ on the 👍 picker for a Down-voter).
    setCommentReactPicker({
      commentId, kind,
      identities: decision.showPicker.map((id) => ({
        ...id,
        currentState: myReactionsByIdentity[id.kind] === kind ? kind : null,
      })),
    });
  };

  const onCommentReactionPick = (asIdentity) => {
    const pending = commentReactPicker;
    setCommentReactPicker(null);
    if (pending) fireCommentReaction(pending.commentId, pending.kind, asIdentity);
  };

  const handleSubmitComment = async () => {
    // Phase 2 self-engagement: the rep owner may comment on their
    // own post. Citizens still need a session. Anonymous viewers
    // get the login modal.
    if (!citizen && !isOwner) {
      onCitizenLoginRequired?.();
      return;
    }
    const body = commentDraft.trim();
    if (!body) return;
    setCommentBusy(true);
    setCommentErr(null);
    // Phase 6: pass the picker-selected identity. Backend respects
    // this when multiple identities are signed in; falls back to
    // cookie priority otherwise.
    const { data, error } = await createComment(
      post.id, body, null, commentAsIdentity,
    );
    setCommentBusy(false);
    if (error) {
      setCommentErr(error);
      return;
    }
    if (data) {
      setComments((prev) => (prev ? [data, ...prev] : [data]));
      setCommentDraft('');
      onCommentCountChanged?.(post.id, +1);
    }
  };

  // Phase 3: post a reply inside a top-level thread. parentId is the
  // top-level comment's id; backend enforces that this caller is
  // allowed to reply (post creator OR parent comment's author) and
  // that the parent itself is top-level (no reply-to-replies).
  const handleSubmitReply = async (parentId, asIdentity = null) => {
    if (!citizen && !isOwner) {
      onCitizenLoginRequired?.();
      return;
    }
    const body = (replyDraft || '').trim();
    if (!body || replyBusy) return;
    setReplyBusy(true);
    setCommentErr(null);
    // Phase 6: thread the picker-selected identity through. The
    // caller passes the per-comment-row effective identity so a
    // user replying to someone else's comment can't accidentally
    // submit as a citizen who'd be 403'd by the two-party rule.
    const { data, error } = await createComment(
      post.id, body, parentId, asIdentity || replyAsIdentity,
    );
    setReplyBusy(false);
    if (error) {
      setCommentErr(error);
      return;
    }
    if (data) {
      // Drop the new reply into the flat list — bucketing in the
      // render groups it under its parent automatically.
      setComments((prev) => (prev ? [data, ...prev] : [data]));
      setReplyDraft('');
      setReplyOpenFor(null);
      onCommentCountChanged?.(post.id, +1);
    }
  };

  const handleDeleteComment = async (comment) => {
    const ok = typeof window !== 'undefined'
      ? window.confirm('Delete this comment?') : true;
    if (!ok) return;
    const { error, data } = await deleteComment(comment.id);
    if (error) {
      setCommentErr(error);
      return;
    }
    // Backend may TOMBSTONE this comment (Task #41) instead of hard-
    // deleting when it has non-deleted replies — the row stays so
    // the thread structure renders, body becomes "[deleted by author]".
    // We can't tell from a 204 response which happened, so we
    // optimistically refresh the comments list to pick up either
    // outcome correctly.
    setComments((prev) => (prev ? prev.filter((x) => x.id !== comment.id) : prev));
    onCommentCountChanged?.(post.id, -1);
  };

  // ── Edit state (Task #41) ───────────────────────────────────────────
  // Post body edit: when truthy, the post body renders as an inline
  // textarea. The string IS the draft body; null/undefined means not
  // editing. Save resets to null; Cancel resets to null.
  const [editingPostBody, setEditingPostBody] = useState(null);
  // Local override for the post body when a successful edit lands.
  // PageView doesn't pass an onMutated handler down (Task #67) so the
  // parent's `post.body` doesn't update after save — without this
  // local override the textarea would close but the rendered body
  // would stay at the OLD text, making the edit appear to vanish.
  const [postBodyOverride, setPostBodyOverride] = useState(null);
  const [postEditedAtOverride, setPostEditedAtOverride] = useState(null);
  // Inline error display for the post-edit textarea — keeps post-save
  // errors visible under the editor instead of dumping them in the
  // comment-error banner where the user might not scroll to see them.
  const [postEditErr, setPostEditErr] = useState(null);
  // Comment edit: tracks which comment id is currently in edit mode
  // and the draft body for it. Only one comment can be edited at a
  // time per post card.
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const beginEditPost = () => {
    setEditingPostBody(post.body || '');
  };
  const cancelEditPost = () => {
    setEditingPostBody(null);
  };
  const handleSavePost = async () => {
    const draft = (editingPostBody || '').trim();
    if (!draft) {
      setPostEditErr('Post body cannot be empty.');
      return;
    }
    setPostEditErr(null);
    setEditBusy(true);
    const { data, error } = await updatePost(post.id, draft);
    setEditBusy(false);
    if (error) {
      setPostEditErr(error);
      return;
    }
    // PageView doesn't pass an onMutated handler today, so capture the
    // updated body + edited_at locally. The textarea closes, the body
    // re-renders from the override, and on the next page reload the
    // backend ships the new body — both paths converge to the same
    // visible state. Still bubble onMutated if the parent ever DOES
    // wire one (defensive future-proofing, no harm if it stays
    // undefined).
    setPostBodyOverride(data?.body ?? draft);
    setPostEditedAtOverride(data?.edited_at ?? new Date().toISOString());
    setEditingPostBody(null);
    if (typeof onMutated === 'function') {
      onMutated({ kind: 'post-edited', post: data });
    }
  };

  const beginEditComment = (comment) => {
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body || '');
  };
  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentBody('');
  };
  const handleSaveComment = async () => {
    const draft = (editingCommentBody || '').trim();
    if (!draft || editingCommentId == null) return;
    setEditBusy(true);
    const { data, error } = await updateComment(editingCommentId, draft);
    setEditBusy(false);
    if (error) {
      setCommentErr(error);
      return;
    }
    // Replace the comment in-place with the updated row from the API.
    setComments((prev) => (
      prev ? prev.map((x) => (x.id === editingCommentId ? data : x)) : prev
    ));
    setEditingCommentId(null);
    setEditingCommentBody('');
  };

  // Comment-level Report. Session-scoped — once reported, the button
  // flips to "Reported ✓" so the user knows it went through and to
  // prevent re-fires. We don't re-render the comment list around it
  // (the comment stays visible; admin review is async).
  const [reportedCommentIds, setReportedCommentIds] = useState(() => new Set());
  const handleReportComment = async (commentId) => {
    // No native browser prompt — just fire-and-confirm. A reason picker
    // is a follow-up if we want to differentiate spam vs. abuse vs.
    // off-topic in the admin queue; for now everything goes in as
    // 'other' and the admin reads the comment body for context.
    const { data, error } = await reportComment(commentId);
    if (error) {
      setCommentErr(error);
      return;
    }
    setReportedCommentIds((prev) => {
      const next = new Set(prev);
      next.add(commentId);
      return next;
    });
    // already_reported=true comes back when the user already reported
    // this comment in a previous session; show the same "Reported ✓"
    // UI either way (no need to distinguish in copy — the admin saw
    // it the first time).
    if (data?.already_reported) {
      // No-op visible state change; the flip above is enough.
    }
  };

  // Post-level Report. Same shape as the comment-level one. Hidden
  // when the viewer IS the page owner (reps don't report their own
  // posts) or when the viewer isn't signed in.
  const [postReported, setPostReported] = useState(false);
  const [postReportBusy, setPostReportBusy] = useState(false);
  const handleReportPost = async () => {
    if (postReportBusy || postReported) return;
    setPostReportBusy(true);
    const { data, error } = await reportPost(post.id);
    setPostReportBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setPostReported(true);
    // already_reported handled the same as a fresh report — visual
    // state lands at "Reported ✓" either way.
    void data;
  };
  const canReportPost = !isOwner && (!!citizen);

  return (
    <article
      id={`post-${post.id}`}
      style={{
        padding: '14px',
        border: '1px solid var(--cl-border)',
        borderRadius: '12px',
        background: 'white',
        marginBottom: '12px',
        transition: 'box-shadow 0.3s, border-color 0.3s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          aria-hidden="true"
          style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: 'var(--cl-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.85rem', fontWeight: 700, color: 'var(--cl-accent)',
            border: '1px solid var(--cl-border)', flexShrink: 0,
          }}
        >
          {initials || '•'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--cl-text)' }}>
            {author.display_name || 'Unknown'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--cl-text-light)' }}>
            {author.role ? `${author.role} · ` : ''}{timeAgo(post.created_at)}
            {(post.edited_at || postEditedAtOverride) && (
              <span
                title={`Edited ${timeAgo(postEditedAtOverride || post.edited_at)}`}
                className="edited-chip"
                style={{
                  marginLeft: '6px', fontSize: '0.7rem', fontStyle: 'italic',
                  color: 'var(--cl-text-light)',
                }}
              >
                · edited
              </span>
            )}
          </div>
        </div>
        {/* Kebab actions menu (Task #77). Consolidates Edit + Delete
            (for the post owner) + Report (for signed-in non-owners)
            into one top-right trigger so the card header stays clean.
            "Reported ✓" indicator sits inline next to the kebab so a
            viewer who already flagged the post sees the receipt
            without having to re-open the menu. Anonymous viewers
            see a grayed-out trigger — no actions available to them
            (Report requires a citizen identity to keep spam pressure
            off the admin queue). */}
        {postReported && (
          <span
            style={{
              fontSize: '0.72rem',
              color: 'var(--cl-text-muted)',
              fontStyle: 'italic',
            }}
          >
            Reported ✓
          </span>
        )}
        <PostActionsMenu
          ariaLabel="Post actions"
          items={[
            isOwner && editingPostBody == null && {
              id: 'edit',
              label: 'Edit',
              onClick: beginEditPost,
              disabled: busy || editBusy,
            },
            isOwner && {
              id: 'delete',
              label: 'Delete',
              onClick: handleDelete,
              disabled: busy,
              destructive: true,
            },
            canReportPost && !postReported && {
              id: 'report',
              label: postReportBusy ? 'Reporting…' : 'Report',
              onClick: handleReportPost,
              disabled: postReportBusy,
            },
          ]}
        />
      </div>

      {/* AI Summary — long posts only. Tucked between header and body
          so it reads as "here's the TL;DR" before the user dives into
          the full text. Once requested, the summary card stays open
          (the user can dismiss it) and the button is hidden so we
          don't double-render the affordance. */}
      {showSummarizeButton && !aiSummary && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={handleSummarize}
            disabled={aiSummaryBusy}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px',
              border: '1px solid var(--cl-border)',
              background: 'var(--cl-accent-soft)',
              color: 'var(--cl-accent)',
              borderRadius: 999,
              fontSize: '0.74rem', fontWeight: 700,
              cursor: aiSummaryBusy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
            title={`Summarize this ${bodyWordCount}-word post into a quick TL;DR`}
          >
            ✨ {aiSummaryBusy ? 'Summarizing…' : 'Summarize'}
          </button>
          {aiSummaryErr && (
            <span style={{ color: '#d63031', fontSize: '0.72rem', marginLeft: 10 }}>
              {aiSummaryErr}
            </span>
          )}
        </div>
      )}
      {aiSummary && (
        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            background: 'var(--cl-accent-soft)',
            border: '1px solid var(--cl-accent-soft)',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 8, marginBottom: 4,
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--cl-accent)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              ✨ AI summary
            </div>
            <button
              type="button"
              onClick={clearSummary}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--cl-text-light)', cursor: 'pointer',
                fontSize: '0.72rem', fontFamily: 'inherit',
              }}
            >
              Dismiss
            </button>
          </div>
          <div
            style={{
              fontSize: '0.86rem',
              lineHeight: 1.55,
              color: 'var(--cl-text)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {aiSummary.summary}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: '0.7rem',
              color: 'var(--cl-text-light)',
              fontStyle: 'italic',
            }}
          >
            Condensed {aiSummary.word_count_original} words → {aiSummary.word_count_summary} words. AI-generated; verify against the full post below.
          </div>
        </div>
      )}

      {/* Body — skip the whole div when the post is poll-only or
          image-only. Without this guard, an empty post.body still
          rendered the wrapper div with marginTop: 10px, leaving a
          dead gap above the poll / image. */}
      {editingPostBody != null ? (
        <div style={{ margin: '8px 0' }}>
          <textarea
            value={editingPostBody}
            onChange={(e) => setEditingPostBody(e.target.value)}
            rows={6}
            disabled={editBusy}
            style={{
              width: '100%', padding: '8px', borderRadius: '6px',
              border: '1px solid var(--cl-border)',
              fontFamily: 'inherit', fontSize: '0.95rem',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              onClick={handleSavePost}
              disabled={editBusy || !(editingPostBody || '').trim()}
              style={{
                padding: '6px 14px', borderRadius: '6px',
                border: '1px solid var(--cl-accent)',
                background: 'var(--cl-accent)', color: 'white',
                fontSize: '0.78rem', fontWeight: 600,
                cursor: editBusy ? 'wait' : 'pointer',
              }}
            >
              {editBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancelEditPost}
              disabled={editBusy}
              style={{
                padding: '6px 14px', borderRadius: '6px',
                border: '1px solid var(--cl-border)',
                background: 'white', color: 'var(--cl-text)',
                fontSize: '0.78rem', fontWeight: 600,
                cursor: editBusy ? 'wait' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          {postEditErr && (
            <div
              role="alert"
              style={{
                marginTop: '6px', padding: '6px 8px',
                color: '#d63031', fontSize: '0.78rem',
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: '6px',
              }}
            >
              {postEditErr}
            </div>
          )}
        </div>
      ) : ((postBodyOverride ?? post.body) || '').trim() && (
        <PostBody body={postBodyOverride ?? post.body} />
      )}

      {/* Image gallery — responsive grid driven by image count so a
          single image gets full width, two sit side-by-side, and
          3–5 tile into a 2- or 3-column layout that still fills the
          card cleanly. */}
      {Array.isArray(post.images) && post.images.length > 0 && (
        <PostImageGallery images={post.images} />
      )}

      {/* Optional poll */}
      {post.poll && (
        <PollCard
          officialId={officialId}
          poll={post.poll}
          isOwner={isOwner}
          citizen={citizen}
          onCitizenLoginRequired={onCitizenLoginRequired}
          onUpdated={(updated) => onPollUpdated && onPollUpdated(post.id, updated)}
        />
      )}

      {/* Reactions + comment toggle */}
      <div
        style={{
          marginTop: '12px',
          paddingTop: '10px',
          borderTop: '1px solid var(--cl-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        {/* Phase 6: the reaction buttons live inside a positioned
            wrapper so the IdentityPicker (when 2+ identities need to
            disambiguate) can anchor directly under whichever button
            was clicked. The picker renders absolutely positioned and
            self-dismisses on outside-click or Escape. */}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <ReactionButton
            kind="up"
            count={reactions.up_count}
            active={myReaction === 'up'}
            disabled={busy}
            onClick={() => handleReact('up')}
            title={
              isOwner ? 'Like (as the post author)'
                : citizen ? 'Like'
                : 'Sign in as a citizen to like'
            }
          />
          {reactPicker && reactPicker.kind === 'up' && (
            <IdentityPicker
              open
              identities={reactPicker.identities}
              mode={reactPicker.mode}
              onPick={onReactionPick}
              onClose={() => setReactPicker(null)}
            />
          )}
        </div>
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <ReactionButton
            kind="down"
            count={reactions.down_count}
            active={myReaction === 'down'}
            disabled={busy}
            onClick={() => handleReact('down')}
            title={
              isOwner ? 'Dislike (as the post author)'
                : citizen ? 'Dislike'
                : 'Sign in as a citizen to dislike'
            }
          />
          {reactPicker && reactPicker.kind === 'down' && (
            <IdentityPicker
              open
              identities={reactPicker.identities}
              mode={reactPicker.mode}
              onPick={onReactionPick}
              onClose={() => setReactPicker(null)}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => setCommentsOpen((o) => !o)}
          style={{
            border: '1px solid var(--cl-border)',
            background: 'var(--cl-card)',
            color: 'var(--cl-text)',
            fontSize: 'var(--cl-text-sm)',
            fontFamily: 'var(--cl-font-sans)',
            cursor: 'pointer',
            padding: '5px 10px',
            height: 30,
            borderRadius: 'var(--cl-radius-pill)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <ChatText size={14} />
          {commentsOpen ? 'Hide' : 'Comments'}{' '}
          (<span className="cl-num">{post.comment_count || 0}</span>)
        </button>
        {!citizen && !isOwner && (
          <span
            style={{
              fontSize: '0.72rem', color: 'var(--cl-text-light)',
              marginLeft: 'auto',
            }}
          >
            Sign in as a citizen to engage
          </span>
        )}
        {err && <span style={{ color: '#d63031', fontSize: '0.72rem' }}>{err}</span>}
      </div>

      {/* Comments panel */}
      {commentsOpen && (
        <div style={{ marginTop: '10px' }}>
          {/* Composer toggle — composer starts collapsed behind this
              trigger, matching the /polls CommentsThread treatment
              (CommentsThread.js:474-487). Replying via a comment-row's
              Reply button auto-expands the composer through the
              existing useEffect at PostCard.js:187. */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => setPcComposerOpen((v) => !v)}
              aria-expanded={pcComposerOpen}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 12px',
                background: pcComposerOpen ? 'var(--cl-accent-soft)' : 'transparent',
                color: pcComposerOpen ? 'var(--cl-accent)' : 'var(--cl-text)',
                border: `1px solid ${pcComposerOpen ? 'var(--cl-accent)' : 'var(--cl-border)'}`,
                borderRadius: 999,
                fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {pcComposerOpen ? '▾' : '▸'} Add comment
            </button>
          </div>
          {pcComposerOpen && (
          <>
          {/* Composer */}
          <div
            style={{
              padding: '8px', border: '1px solid var(--cl-border)',
              borderRadius: '10px', background: 'var(--cl-bg)',
            }}
          >
            {/* Phase 6 "Posting as" picker — shows the active identity
                above the textarea so the user knows who will author
                the comment BEFORE they type. Multi-identity sees a
                dropdown; single-identity sees a non-interactive pill;
                anonymous (no identity) sees nothing. */}
            {activeIdentities.length > 0 && (
              <PostingAsPicker
                identities={activeIdentities}
                value={commentAsIdentity}
                onChange={setCommentAsIdentity}
              />
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value.slice(0, 1000))}
              placeholder={
                isOwner ? 'Add a comment (as the post author)…'
                  : citizen ? 'Add a comment…'
                  : 'Sign in as a citizen to comment'
              }
              // Phase 2 self-engagement: enable composer for the rep
              // that owns this page. Citizens still need a session;
              // anonymous viewers see the placeholder + click-to-sign-in.
              disabled={(!citizen && !isOwner) || commentBusy}
              rows={2}
              style={{
                flex: 1, resize: 'vertical', minHeight: '40px',
                padding: '8px 10px',
                border: '1px solid var(--cl-border)', borderRadius: '8px',
                fontSize: '0.82rem', fontFamily: 'inherit',
                color: 'var(--cl-text)', background: 'white',
                boxSizing: 'border-box',
              }}
              onFocus={() => { if (!citizen && !isOwner) onCitizenLoginRequired?.(); }}
            />
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={(!citizen && !isOwner) || commentBusy || !commentDraft.trim()}
              style={{
                border: '1px solid var(--cl-accent)',
                background: (citizen || isOwner) && commentDraft.trim() && !commentBusy ? 'var(--cl-accent)' : 'var(--cl-bg)',
                color: (citizen || isOwner) && commentDraft.trim() && !commentBusy ? 'white' : 'var(--cl-text-light)',
                padding: '7px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem', fontWeight: 700,
                cursor: ((!citizen && !isOwner) || commentBusy || !commentDraft.trim()) ? 'not-allowed' : 'pointer',
                flexShrink: 0,
              }}
            >
              {commentBusy ? 'Sending…' : 'Post'}
            </button>
            </div>{/* /textarea + Post row */}
          </div>
          {commentErr && (
            <div style={{ color: '#d63031', fontSize: '0.72rem', marginTop: '6px' }}>
              {commentErr}
            </div>
          )}
          </>
          )}{/* /pcComposerOpen */}

          {/* Sort / filter dropdown. my_district / my_state are
              citizen-only filters — hidden from anonymous viewers and
              from the page owner (owners already have the stronger
              OwnerScopeFilter). */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              gap: '8px', marginTop: '10px',
            }}
          >
            <label
              htmlFor={`comment-sort-${post.id}`}
              style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', fontWeight: 600 }}
            >
              Sort
            </label>
            <select
              id={`comment-sort-${post.id}`}
              value={commentSort}
              onChange={(e) => setCommentSort(e.target.value)}
              style={{
                padding: '4px 26px 4px 10px',
                border: '1px solid var(--cl-border)', borderRadius: '999px',
                background: 'white', color: 'var(--cl-text)',
                fontSize: '0.76rem', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <option value="latest">Latest</option>
              <option value="oldest">Oldest</option>
              <option value="most_liked">Most liked</option>
              <option value="most_disliked">Most disliked</option>
              {citizen && !isOwner && citizen.congressional_district && (
                <option value="my_district">From my district ({citizen.congressional_district})</option>
              )}
              {citizen && !isOwner && citizen.state && (
                <option value="my_state">From my state ({citizen.state})</option>
              )}
            </select>
          </div>

          {/* AI-powered comment filter. Hidden entirely when the server
              reports AI is not configured (so we never tease a broken
              feature). Quick chips on the left + free-form prompt on
              the right; an "Active filter" banner appears underneath
              once a filter is applied so the user knows what list
              they're looking at. */}
          {/* AI filter — PR #10: trigger + collapsible body */}
          {aiAvailable && comments && comments.length >= 1 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
                <button
                  type="button"
                  onClick={() => setPcAiFilterOpen((v) => !v)}
                  aria-expanded={pcAiFilterOpen}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 12px',
                    background: pcAiFilterOpen ? 'var(--cl-accent-soft)' : 'transparent',
                    color: pcAiFilterOpen ? 'var(--cl-accent)' : 'var(--cl-text)',
                    border: `1px solid ${pcAiFilterOpen ? 'var(--cl-accent)' : 'var(--cl-border)'}`,
                    borderRadius: 999,
                    fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {pcAiFilterOpen ? '▾' : '▸'} AI filter
                </button>
              </div>
              {pcAiFilterOpen && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6,
                  alignItems: 'center',
                }}
              >
                {[
                  { label: 'Positive', prompt: 'positive comments' },
                  { label: 'Critical', prompt: 'critical comments' },
                  { label: 'Funny', prompt: 'funny comments' },
                  { label: 'Supportive', prompt: 'supportive comments' },
                  { label: 'Skeptical', prompt: 'skeptical comments questioning the data' },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => runFilter(chip.prompt)}
                    disabled={aiFilterBusy}
                    style={{
                      padding: '4px 10px',
                      border: '1px solid var(--cl-border)',
                      borderRadius: 999,
                      background: 'white',
                      color: 'var(--cl-text)',
                      fontSize: '0.74rem', fontWeight: 600,
                      cursor: aiFilterBusy ? 'wait' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runFilter(aiPrompt);
                  }}
                  style={{ display: 'flex', gap: 6, flex: 1, minWidth: 200 }}
                >
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value.slice(0, 300))}
                    placeholder="✨ Filter comments… (e.g. 'show ones from @Fred')"
                    disabled={aiFilterBusy}
                    style={{
                      flex: 1, minWidth: 0,
                      padding: '4px 10px',
                      border: '1px solid var(--cl-border)',
                      borderRadius: 999,
                      background: 'white', color: 'var(--cl-text)',
                      fontSize: '0.74rem', fontFamily: 'inherit',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={aiFilterBusy || !aiPrompt.trim()}
                    style={{
                      padding: '4px 12px',
                      border: '1px solid var(--cl-accent)',
                      background: aiFilterBusy || !aiPrompt.trim() ? 'var(--cl-bg)' : 'var(--cl-accent)',
                      color: aiFilterBusy || !aiPrompt.trim() ? 'var(--cl-text-light)' : 'white',
                      borderRadius: 999,
                      fontSize: '0.74rem', fontWeight: 700,
                      cursor: aiFilterBusy ? 'wait' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {aiFilterBusy ? '…' : 'Apply'}
                  </button>
                </form>
              </div>
              {aiFilterErr && (
                <div style={{ color: '#d63031', fontSize: '0.72rem', marginTop: 6 }}>
                  {aiFilterErr}
                </div>
              )}
              {aiFilterIds !== null && (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px',
                    background: 'var(--cl-accent-soft)',
                    border: '1px solid var(--cl-accent-soft)',
                    borderRadius: 8,
                    fontSize: '0.74rem',
                    color: 'var(--cl-text)',
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {aiFilterLabel} — showing {aiFilterIds.size} of {comments.length}
                  </span>
                  <button
                    type="button"
                    onClick={clearFilter}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--cl-accent)', cursor: 'pointer',
                      fontSize: '0.74rem', fontWeight: 700,
                      fontFamily: 'inherit',
                    }}
                  >
                    Clear ✕
                  </button>
                </div>
              )}
            </div>
              )}
            </div>
          )}

          {/* Comment list — PR #10 height cap so long threads scroll inside the card */}
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
            {commentsLoading && (
              <div style={{ color: 'var(--cl-text-light)', fontSize: '0.78rem', padding: '6px 4px' }}>
                Loading comments…
              </div>
            )}
            {!commentsLoading && comments?.length === 0 && (
              <div style={{ color: 'var(--cl-text-light)', fontSize: '0.78rem', padding: '6px 4px' }}>
                No comments yet.
              </div>
            )}
            {!commentsLoading && comments?.length > 0 && aiFilterIds !== null && aiFilterIds.size === 0 && (
              <div style={{ color: 'var(--cl-text-light)', fontSize: '0.78rem', padding: '6px 4px' }}>
                No comments matched that filter. <button
                  type="button"
                  onClick={clearFilter}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--cl-accent)', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                    padding: 0, marginLeft: 4,
                  }}
                >Show all</button>
              </div>
            )}
            {/* Phase 3 reply threading. Bucket the flat comment list
                into top-level + repliesByParent so the render shows
                each top-level comment with its replies indented
                below. The AI filter operates on top-level only — if
                a top-level passes the filter, all its replies render
                regardless of their individual filter match (a thread
                that passes is a thread you want to read in full).
                Apply the user's chosen sort to top-level here; the
                inner reply pool is always rendered oldest-first
                because conversations read naturally that way. */}
            {(() => {
              const all = comments || [];
              const topLevel = all.filter((c) => c.parent_comment_id == null);
              const repliesByParent = new Map();
              for (const c of all) {
                if (c.parent_comment_id != null) {
                  if (!repliesByParent.has(c.parent_comment_id)) {
                    repliesByParent.set(c.parent_comment_id, []);
                  }
                  repliesByParent.get(c.parent_comment_id).push(c);
                }
              }
              // Replies render oldest-first for conversational flow.
              for (const replies of repliesByParent.values()) {
                replies.sort((a, b) =>
                  new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                );
              }
              const visibleTopLevel = topLevel.filter(
                (c) => aiFilterIds === null || aiFilterIds.has(c.id),
              );
              return visibleTopLevel.map((c) => renderCommentRow(
                c,
                /* depth */ 0,
                repliesByParent.get(c.id) || [],
              ));
            })()}
          </div>
        </div>
      )}
    </article>
  );

  // Render one comment row — used for both top-level comments and
  // their replies. Top-level rows additionally pass `replies` which
  // get rendered indented below + a Reply button gated on the two-
  // party rule. Reply rows have `depth=1` and never carry their own
  // replies (the data model is one-level deep).
  function renderCommentRow(c, depth, replies) {
    // Page-owner authored: either a rep (Phase 2) or a candidate
    // (Phase 4c) commenting on their own page. Both render with
    // the same "Author" badge.
    const isAuthorComment = c.author_kind === 'rep' || c.author_kind === 'candidate';
    const isMyComment = (
      (citizen && c.citizen_id != null && c.citizen_id === citizen.id) ||
      (isOwner && isAuthorComment)
    );
    const canDelete = isMyComment;
    const reporterSignedIn = !!citizen || isOwner;
    const canReport = reporterSignedIn && !isMyComment && !reportedCommentIds.has(c.id);
    const reportedThis = reportedCommentIds.has(c.id);
    const locLabel = [c.scope_district, c.scope_city].filter(Boolean).join(' · ');

    // Two-party reply gate (Phase 3 + 6). Only the page owner AND
    // the top-level comment's original author may reply. Phase 6
    // refinement: when the viewer is signed in to multiple
    // identities, each identity is checked INDIVIDUALLY — a citizen
    // who didn't write this comment isn't allowed to reply just
    // because they happen to also be signed in as the rep. The
    // filtered list drives both the Reply-button visibility AND
    // the PostingAsPicker's available identities, so a non-allowed
    // identity never even shows up as a choice.
    //
    // PER-IDENTITY OWNERSHIP: `isOwner` is true when EITHER the rep
    // OR the candidate owns this page — useful for surface-level
    // gating but too permissive for THIS reply filter. We need to
    // know whether the SPECIFIC identity (rep, candidate) owns the
    // page. Compare each identity's id field against post.official_id.
    // Pre-fix this filter accepted a candidate identity reply on a
    // rep's page just because the rep was also signed in.
    const repOwnsThisPage = !!(me && post.official_id && me.official_id === post.official_id);
    const candidateOwnsThisPage = !!(candidate && post.official_id && candidate.candidate_id === post.official_id);
    const isTopLevel = depth === 0;
    const replyAllowedIdentities = isTopLevel
      ? activeIdentities.filter((id) => {
          // The page-owning rep can reply on their own page.
          if (id.kind === 'rep' && repOwnsThisPage) return true;
          // The page-owning candidate can reply on their own page.
          if (id.kind === 'candidate' && candidateOwnsThisPage) return true;
          // A citizen can reply only when they authored the parent
          // top-level comment themselves (parent-author path).
          if (id.kind === 'citizen' && citizen
              && c.citizen_id != null && c.citizen_id === citizen.id) {
            return true;
          }
          return false;
        })
      : [];
    const canReplyHere = replyAllowedIdentities.length > 0;
    // Pick an "effective" identity for the reply composer's
    // PostingAsPicker. Falls back to the first allowed when the
    // user's last-picked identity isn't allowed on THIS comment.
    const effectiveReplyAs = (
      replyAllowedIdentities.find((id) => id.kind === replyAsIdentity)?.kind
      || replyAllowedIdentities[0]?.kind
      || null
    );

    return (
      <div key={c.id}>
        <div
          style={{
            padding: '8px 10px',
            border: '1px solid var(--cl-border)',
            borderRadius: '8px',
            background: 'white',
            marginLeft: depth > 0 ? '20px' : 0,
            borderLeft: depth > 0 ? '3px solid var(--cl-accent-soft, #d8eccd)' : '1px solid var(--cl-border)',
          }}
        >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--cl-text)' }}>
                      {c.citizen_display_name}
                      {/* Author badge — rep replied to / weighed in
                          on their own post. Takes precedence over
                          the Unverified pill (rep accounts are
                          verified at signup, citizens aren't yet). */}
                      {isAuthorComment ? (
                        <span
                          title="Posted by the page owner."
                          style={{
                            marginLeft: '6px',
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '8px',
                            background: 'var(--cl-accent-soft, #e6f4ea)',
                            color: 'var(--cl-accent)',
                            border: '1px solid var(--cl-accent)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                          }}
                        >
                          Author
                        </span>
                      ) : (
                        <span
                          title="This identity is self-attested; verification ships in a later phase."
                          style={{
                            marginLeft: '6px',
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '8px',
                            background: '#fff7e6',
                            color: '#8a6100',
                            border: '1px solid #ffe1a3',
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                          }}
                        >
                          Unverified
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)' }}>
                      {timeAgo(c.created_at)}
                      {c.edited_at && (
                        <span
                          title={`Edited ${timeAgo(c.edited_at)}`}
                          className="edited-chip"
                          style={{ marginLeft: '4px', fontStyle: 'italic' }}
                        >
                          · edited
                        </span>
                      )}
                    </div>
                  </div>
                  {editingCommentId === c.id ? (
                    <div style={{ marginTop: '4px' }}>
                      <textarea
                        value={editingCommentBody}
                        onChange={(e) => setEditingCommentBody(e.target.value)}
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
                          onClick={handleSaveComment}
                          disabled={editBusy || !(editingCommentBody || '').trim()}
                          style={{
                            padding: '3px 10px', borderRadius: '6px',
                            border: '1px solid var(--cl-accent)',
                            background: 'var(--cl-accent)', color: 'white',
                            fontSize: '0.72rem', fontWeight: 600,
                            cursor: editBusy ? 'wait' : 'pointer',
                          }}
                        >
                          {editBusy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditComment}
                          disabled={editBusy}
                          style={{
                            padding: '3px 10px', borderRadius: '6px',
                            border: '1px solid var(--cl-border)',
                            background: 'white', color: 'var(--cl-text)',
                            fontSize: '0.72rem', fontWeight: 600,
                            cursor: editBusy ? 'wait' : 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.82rem', color: 'var(--cl-text)', marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {c.body}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center',
                      marginTop: '6px', gap: '6px', flexWrap: 'wrap',
                    }}
                  >
                    {/* Phase 6: comment-level reactions get the same
                        IdentityPicker treatment as post-level. Each
                        comment owns its own picker state slot via
                        commentReactPicker.commentId; we render the
                        picker only when this row's id matches. */}
                    <div style={{ position: 'relative', display: 'inline-flex' }}>
                      <CommentReactionButton
                        kind="up"
                        count={c.up_count || 0}
                        active={c.my_reaction === 'up'}
                        onClick={() => handleCommentReact(c.id, 'up', c.my_reactions)}
                        title={
                          (citizen || isOwner) ? 'Like'
                            : 'Sign in as a citizen to like'
                        }
                      />
                      {commentReactPicker
                        && commentReactPicker.commentId === c.id
                        && commentReactPicker.kind === 'up' && (
                        <IdentityPicker
                          open
                          identities={commentReactPicker.identities}
                          mode={commentReactPicker.mode}
                          onPick={onCommentReactionPick}
                          onClose={() => setCommentReactPicker(null)}
                        />
                      )}
                    </div>
                    <div style={{ position: 'relative', display: 'inline-flex' }}>
                      <CommentReactionButton
                        kind="down"
                        count={c.down_count || 0}
                        active={c.my_reaction === 'down'}
                        onClick={() => handleCommentReact(c.id, 'down', c.my_reactions)}
                        title={
                          (citizen || isOwner) ? 'Dislike'
                            : 'Sign in as a citizen to dislike'
                        }
                      />
                      {commentReactPicker
                        && commentReactPicker.commentId === c.id
                        && commentReactPicker.kind === 'down' && (
                        <IdentityPicker
                          open
                          identities={commentReactPicker.identities}
                          mode={commentReactPicker.mode}
                          onPick={onCommentReactionPick}
                          onClose={() => setCommentReactPicker(null)}
                        />
                      )}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--cl-text-light)', marginLeft: '4px' }}>
                      {locLabel || c.scope_state || ''}
                    </div>
                    {canDelete && editingCommentId !== c.id && (
                      <button
                        type="button"
                        onClick={() => beginEditComment(c)}
                        disabled={editBusy}
                        title="Edit this comment (until first reply, after 60s grace)"
                        style={{
                          marginLeft: 'auto',
                          border: 'none', background: 'transparent',
                          color: 'var(--cl-text-light)', fontSize: '0.7rem',
                          fontWeight: 600, cursor: editBusy ? 'wait' : 'pointer', padding: '2px 4px',
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(c)}
                        style={{
                          marginLeft: canDelete && editingCommentId !== c.id ? '0' : 'auto',
                          border: 'none', background: 'transparent',
                          color: '#d63031', fontSize: '0.7rem',
                          fontWeight: 600, cursor: 'pointer', padding: '2px 4px',
                        }}
                      >
                        Delete
                      </button>
                    )}
                    {canReport && (
                      <button
                        type="button"
                        onClick={() => handleReportComment(c.id)}
                        title="Flag this comment for admin review"
                        style={{
                          marginLeft: canDelete ? 0 : 'auto',
                          border: 'none', background: 'transparent',
                          color: 'var(--cl-text-light)', fontSize: '0.7rem',
                          fontWeight: 600, cursor: 'pointer', padding: '2px 4px',
                        }}
                      >
                        Report
                      </button>
                    )}
                    {reportedThis && (
                      <span
                        style={{
                          marginLeft: canDelete ? 0 : 'auto',
                          color: 'var(--cl-text-muted)', fontSize: '0.68rem',
                          fontStyle: 'italic',
                        }}
                      >
                        Reported ✓
                      </span>
                    )}
                    {/* Reply button — visible only on top-level
                        comments AND only to the page owner or the
                        comment's original author. Hidden everywhere
                        else (the backend would 403 anyway). */}
                    {canReplyHere && (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyOpenFor((open) => (open === c.id ? null : c.id));
                          setReplyDraft('');
                        }}
                        style={{
                          marginLeft: (canDelete || canReport || reportedThis) ? 6 : 'auto',
                          border: 'none', background: 'transparent',
                          color: 'var(--cl-accent)', fontSize: '0.7rem',
                          fontWeight: 700, cursor: 'pointer', padding: '2px 4px',
                          fontFamily: 'inherit',
                        }}
                      >
                        {replyOpenFor === c.id ? 'Cancel' : 'Reply'}
                      </button>
                    )}
                  </div>
        </div>

        {/* Replies — top-level rows only. PR #10: gated behind a
            "Show replies (N)" toggle so long reply pools don't blow
            up the visible height of the parent. Composer renders
            below regardless when the user is replying to THIS row. */}
        {isTopLevel && replies && replies.length > 0 && (
          <div style={{ marginTop: 6, marginLeft: 14, paddingLeft: 12, borderLeft: '2px solid var(--cl-border)' }}>
            <button
              type="button"
              onClick={() => setPcExpandedReplies((prev) => {
                const next = new Set(prev);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                return next;
              })}
              aria-expanded={pcExpandedReplies.has(c.id)}
              style={{
                background: 'transparent', border: 0, padding: '4px 0',
                fontSize: '0.74rem', fontWeight: 600,
                color: 'var(--cl-accent)', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {pcExpandedReplies.has(c.id) ? '⯆ Hide' : '⯈ Show'} replies ({replies.length})
            </button>
            {pcExpandedReplies.has(c.id) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {replies.map((r) => renderCommentRow(r, 1, []))}
              </div>
            )}
          </div>
        )}
        {isTopLevel && replyOpenFor === c.id && (
          <div
            style={{
              marginTop: 6, marginLeft: 20,
              padding: 8,
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              background: 'var(--cl-bg)',
            }}
          >
            {/* Phase 6 "Posting as" picker — per Phase-6.1 reply
                gating, we pass the FILTERED replyAllowedIdentities
                list rather than every active identity, so a citizen
                who isn't allowed to reply to THIS comment never
                appears as a choice. Multi-allowed shows a dropdown;
                single-allowed shows a non-interactive pill. */}
            {replyAllowedIdentities.length > 0 && (
              <PostingAsPicker
                identities={replyAllowedIdentities}
                value={effectiveReplyAs}
                onChange={setReplyAsIdentity}
              />
            )}
            <textarea
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value.slice(0, 1000))}
              placeholder={
                isOwner ? 'Reply (as the post author)…'
                  : 'Reply to your comment…'
              }
              rows={2}
              disabled={replyBusy}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid var(--cl-border)', borderRadius: 6,
                fontSize: '0.82rem', fontFamily: 'inherit',
                color: 'var(--cl-text)', background: 'white',
                resize: 'vertical', minHeight: 36, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--cl-text-light)' }}>
                {replyDraft.length}/1000
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => { setReplyOpenFor(null); setReplyDraft(''); }}
                  style={{
                    padding: '5px 10px', border: '1px solid var(--cl-border)',
                    background: 'white', color: 'var(--cl-text-light)',
                    borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmitReply(c.id, effectiveReplyAs)}
                  disabled={replyBusy || !replyDraft.trim()}
                  style={{
                    padding: '5px 12px', border: 'none',
                    background: (replyBusy || !replyDraft.trim()) ? 'var(--cl-border)' : 'var(--cl-accent)',
                    color: 'white', borderRadius: 6,
                    fontSize: '0.72rem', fontWeight: 700,
                    cursor: (replyBusy || !replyDraft.trim()) ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {replyBusy ? 'Posting…' : 'Post reply'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

// Cutoff threshold for the collapse-on-render behavior. Posts whose
// body exceeds this character count render in a clipped frame with a
// gradient fade + "Expand" button anchored at bottom-right. Below the
// threshold the post renders normally (full body, no controls).
// Tuned to roughly the bottom of a 6–7 line paragraph at default
// type sizes — short statements stay uncluttered, longer essays
// don't crowd out everything below them on first paint.
const BODY_COLLAPSE_THRESHOLD_CHARS = 400;
const BODY_COLLAPSED_HEIGHT_PX = 160;

function PostBody({ body }) {
  // Initially collapsed for long posts so the page doesn't open with
  // a wall of text scrolling past the fold. The user clicks Expand
  // to read the rest; Collapse re-clips. Posts under the threshold
  // skip both states and render the body as-is.
  const isLong = (body || '').length > BODY_COLLAPSE_THRESHOLD_CHARS;
  const [expanded, setExpanded] = useState(false);

  if (!isLong) {
    return (
      <div
        style={{
          marginTop: '10px',
          fontSize: '0.92rem',
          lineHeight: 1.55,
          color: 'var(--cl-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {body}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '10px', position: 'relative' }}>
      <div
        style={{
          fontSize: '0.92rem',
          lineHeight: 1.55,
          color: 'var(--cl-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          // Cap the height when collapsed; let it grow naturally
          // when expanded. The transition is purely cosmetic — the
          // user sees the body slide open instead of snap.
          maxHeight: expanded ? 'none' : `${BODY_COLLAPSED_HEIGHT_PX}px`,
          overflow: 'hidden',
          transition: 'max-height 0.25s ease',
          // Reserve a gutter at the bottom for the absolute-positioned
          // Expand/Show less pill so the pill never overlaps the last
          // line of text. ~36px = pill height + bottom anchor +
          // breathing room.
          paddingBottom: expanded ? '40px' : 0,
        }}
      >
        {body}
      </div>

      {/* Gradient fade — sits on top of the bottom edge of the
          collapsed body so the text appears to dissolve rather than
          getting hard-cut. pointer-events:none lets clicks pass
          through to the body underneath (e.g. for text selection). */}
      {!expanded && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0, right: 0, bottom: 0,
            height: 70,
            background: 'linear-gradient(to top, white 30%, rgba(255,255,255,0))',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Expand / Collapse pill, bottom-right corner of the body.
          Uses the same accent green as other primary CTAs so it
          reads as the next action. When expanded we flip the label
          to "Show less" so the user can re-collapse without
          scrolling back to find a separate control. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          position: 'absolute',
          right: 4,
          bottom: 4,
          padding: '5px 12px',
          borderRadius: 999,
          border: '1px solid var(--cl-accent)',
          background: 'var(--cl-accent)',
          color: 'white',
          fontFamily: 'inherit',
          fontSize: '0.72rem',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          zIndex: 2,
        }}
      >
        {expanded ? 'Show less' : 'Expand'}
      </button>
    </div>
  );
}

function ReactionButton({ kind, count, active, disabled, onClick, title }) {
  const isUp = kind === 'up';
  // Design-system tokens. Up active is solid #1877F2 blue; down active is
  // burgundy #8C2929 — moved away from the destructive red so disagreement
  // reads as a separate concept from danger/delete.
  const accent = isUp ? 'var(--cl-up)' : 'var(--cl-down)';
  const softBg = isUp ? 'var(--cl-up-soft)' : 'var(--cl-down-soft)';
  const Icon = isUp ? ThumbsUp : ThumbsDown;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        height: 30,
        borderRadius: 'var(--cl-radius-pill)',
        border: `1px solid ${active ? accent : 'var(--cl-border)'}`,
        background: active ? softBg : 'var(--cl-card)',
        color: active ? accent : 'var(--cl-text)',
        fontSize: 'var(--cl-text-sm)',
        fontWeight: active ? 700 : 500,
        fontFamily: 'var(--cl-font-sans)',
        cursor: disabled ? 'wait' : 'pointer',
        transition:
          'background var(--cl-duration-fast) var(--cl-ease-standard), border-color var(--cl-duration-fast) var(--cl-ease-standard), color var(--cl-duration-fast) var(--cl-ease-standard)',
      }}
    >
      <Icon size={14} active={active} color={isUp ? 'up' : 'down'} />
      <span className="cl-num">{count}</span>
    </button>
  );
}

// Compact version of ReactionButton for use inside a comment row.
// Smaller padding and icons so it doesn't dominate the comment's own
// body text; otherwise shares the same toggle/flip UX semantics.
// Image gallery + inline lightbox. Click a thumbnail to open the
// full-size view; click the backdrop or press Esc to dismiss.
function PostImageGallery({ images }) {
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    if (openIndex === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenIndex(null);
      else if (e.key === 'ArrowRight') setOpenIndex((i) => (i + 1) % images.length);
      else if (e.key === 'ArrowLeft')  setOpenIndex((i) => (i - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, images.length]);

  // Tile layout based on image count:
  //   1 → single column
  //   2 → 2-column even
  //   3 → first full-width, remaining two split beneath
  //   4 → 2x2 grid
  //   5 → 3-col top row, 2-col bottom row
  const count = images.length;
  const gridStyle = (() => {
    if (count === 1) return { gridTemplateColumns: '1fr', gridAutoRows: '320px' };
    if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridAutoRows: '220px' };
    if (count === 3) return { gridTemplateColumns: '1fr 1fr', gridAutoRows: '180px' };
    if (count === 4) return { gridTemplateColumns: '1fr 1fr', gridAutoRows: '180px' };
    return              { gridTemplateColumns: '1fr 1fr 1fr', gridAutoRows: '150px' };
  })();

  return (
    <>
      <div
        style={{
          display: 'grid', gap: '4px',
          marginTop: '10px',
          borderRadius: '10px', overflow: 'hidden',
          ...gridStyle,
        }}
      >
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label={`Open image ${i + 1} of ${count}`}
            style={{
              // Span the first tile across both columns in the 3-image
              // layout for a cleaner composition.
              gridColumn: count === 3 && i === 0 ? '1 / span 2' : undefined,
              padding: 0, border: 'none', cursor: 'pointer',
              background: '#eaeaea',
              overflow: 'hidden',
            }}
          >
            <img
              src={resolveImageUrl(img.url)}
              alt=""
              loading="lazy"
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                display: 'block',
              }}
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenIndex(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1500,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <img
            src={resolveImageUrl(images[openIndex].url)}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          />
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label="Close"
            style={{
              position: 'absolute', top: '18px', right: '18px',
              width: '36px', height: '36px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.14)',
              color: 'white', fontSize: '1.3rem', cursor: 'pointer',
            }}
          >
            ×
          </button>
          {count > 1 && (
            <div
              style={{
                position: 'absolute', bottom: '18px',
                color: 'white', fontSize: '0.82rem',
                background: 'rgba(0,0,0,0.55)',
                padding: '4px 12px', borderRadius: '999px',
              }}
            >
              {openIndex + 1} / {count}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function CommentReactionButton({ kind, count, active, onClick, title }) {
  const isUp = kind === 'up';
  const accent = isUp ? 'var(--cl-up)' : 'var(--cl-down)';
  const softBg = isUp ? 'var(--cl-up-soft)' : 'var(--cl-down-soft)';
  const Icon = isUp ? ThumbsUp : ThumbsDown;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 'var(--cl-radius-pill)',
        border: `1px solid ${active ? accent : 'var(--cl-border)'}`,
        background: active ? softBg : 'var(--cl-card)',
        color: active ? accent : 'var(--cl-text-light)',
        fontSize: 'var(--cl-text-2xs)',
        fontWeight: active ? 700 : 500,
        fontFamily: 'var(--cl-font-sans)',
        cursor: 'pointer',
      }}
    >
      <Icon size={11} active={active} color={isUp ? 'up' : 'down'} />
      <span className="cl-num">{count}</span>
    </button>
  );
}
