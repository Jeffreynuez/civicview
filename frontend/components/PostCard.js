'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import PollCard from './PollCard';
import {
  deletePost,
  updatePost,
  reactToPost,
  resolveImageUrl,
  aiHealth,
  summarizePost,
  reportPost,
  saveItem,
  unsaveItem,
} from '../lib/pagesApi';
import { ThumbsUp, ThumbsDown, ChatText } from './ui';
import IdentityPicker from './IdentityPicker';
import PostActionsMenu from './PostActionsMenu';
import CommentsThread from './polls/CommentsThread';
import { useActiveIdentities, pickEngagementIdentity } from '../lib/activeIdentities';

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
  // Save / unsave this post to the viewing citizen's dashboard
  // (Task #16). Local optimistic override so we don't need a parent
  // patch callback; reverts on error. Only verified citizens get
  // the action (kebab item gated on `citizen` below).
  const [savedOverride, setSavedOverride] = useState(null);
  const [savingBusy, setSavingBusy] = useState(false);
  const isSaved = savedOverride !== null ? savedOverride : !!post.is_saved;
  const handleToggleSave = async () => {
    if (savingBusy) return;
    const next = !isSaved;
    setSavingBusy(true);
    setSavedOverride(next);
    const { error } = await (next
      ? saveItem({ itemType: 'post', itemId: post.id })
      : unsaveItem({ itemType: 'post', itemId: post.id }));
    setSavingBusy(false);
    if (error) setSavedOverride(!next);
  };
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
  const activeIdentities = useActiveIdentities({ isOwner: true });

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

  // ── AI availability ───────────────────────────────────────────────
  // Gates the post-summarize affordance below. If ANTHROPIC_API_KEY
  // isn't set server-side, aiAvailable stays false and the summarize
  // button hides. (Comment AI-filtering now lives in the shared
  // CommentsThread, Task #93.)
  const [aiAvailable, setAiAvailable] = useState(false);
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
            citizen && {
              id: 'save',
              label: isSaved ? 'Saved ✓ · Remove' : 'Save',
              onClick: handleToggleSave,
              disabled: savingBusy,
            },
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

      {/* Comments — unified shared thread (Task #93 inc 3). mode="post"
          hits the same /api/pages/posts/{id}/comments endpoints this card
          used inline; commentScope preserves the owner scope filter and
          onCountChange keeps the "Comments (N)" pill exact. */}
      {commentsOpen && (
        <div style={{ marginTop: '10px' }}>
          <CommentsThread
            mode="post"
            postId={post.id}
            signedIn={!!citizen || isOwner}
            onLoginRequired={onCitizenLoginRequired}
            onCountChange={(delta) => onCommentCountChanged?.(post.id, delta)}
            ownerOfficialId={post.official_id}
            ownerKind={null}
            commentScope={commentScope}
          />
        </div>
      )}
    </article>
  );
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
