'use client';

import { useEffect, useState } from 'react';
import PollCard from './PollCard';
import {
  deletePost,
  reactToPost,
  clearReaction,
  listComments,
  createComment,
  deleteComment,
  reactToComment,
  resolveImageUrl,
} from '../lib/pagesApi';

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

  // ── Reactions ──────────────────────────────────────────────────────
  const handleReact = async (kind) => {
    if (!citizen) {
      onCitizenLoginRequired?.();
      return;
    }
    const { data, error } = await reactToPost(post.id, kind);
    if (error) {
      setErr(error);
      return;
    }
    if (data && onReactionChanged) onReactionChanged(post.id, data);
  };

  // ── Comments ───────────────────────────────────────────────────────
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState(null); // null = not loaded yet
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentErr, setCommentErr] = useState(null);
  // Sort/filter control. `latest` is the default; my_district and
  // my_state are citizen-only filters that ride on the same dropdown
  // for a single point of UX. Anonymous viewers and owners see a
  // trimmed option list (see OPTIONS below in the render).
  const [commentSort, setCommentSort] = useState('latest');

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
  const handleCommentReact = async (commentId, kind) => {
    if (!citizen) {
      onCitizenLoginRequired?.();
      return;
    }
    const { data, error } = await reactToComment(commentId, kind);
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
                }
              : c
          )
        : prev
    );
  };

  const handleSubmitComment = async () => {
    if (!citizen) {
      onCitizenLoginRequired?.();
      return;
    }
    const body = commentDraft.trim();
    if (!body) return;
    setCommentBusy(true);
    setCommentErr(null);
    const { data, error } = await createComment(post.id, body);
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

  const handleDeleteComment = async (comment) => {
    const ok = typeof window !== 'undefined'
      ? window.confirm('Delete this comment?') : true;
    if (!ok) return;
    const { error } = await deleteComment(comment.id);
    if (error) {
      setCommentErr(error);
      return;
    }
    setComments((prev) => (prev ? prev.filter((x) => x.id !== comment.id) : prev));
    onCommentCountChanged?.(post.id, -1);
  };

  return (
    <article
      id={`post-${post.id}`}
      style={{
        padding: '14px',
        border: '1px solid var(--border)',
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
            background: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)',
            border: '1px solid var(--border)', flexShrink: 0,
          }}
        >
          {initials || '•'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>
            {author.display_name || 'Unknown'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
            {author.role ? `${author.role} · ` : ''}{timeAgo(post.created_at)}
          </div>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            title="Delete this post"
            aria-label="Delete post"
            style={{
              border: '1px solid var(--border)',
              background: 'white',
              color: '#d63031',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Delete
          </button>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          marginTop: '10px',
          fontSize: '0.92rem',
          lineHeight: 1.55,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {post.body}
      </div>

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
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <ReactionButton
          kind="up"
          count={reactions.up_count}
          active={myReaction === 'up'}
          disabled={busy}
          onClick={() => handleReact('up')}
          title={citizen ? 'Like' : 'Sign in as a citizen to like'}
        />
        <ReactionButton
          kind="down"
          count={reactions.down_count}
          active={myReaction === 'down'}
          disabled={busy}
          onClick={() => handleReact('down')}
          title={citizen ? 'Dislike' : 'Sign in as a citizen to dislike'}
        />
        <button
          type="button"
          onClick={() => setCommentsOpen((o) => !o)}
          style={{
            border: '1px solid var(--border)', background: 'white',
            color: 'var(--text)', fontSize: '0.78rem',
            cursor: 'pointer', padding: '5px 10px',
            borderRadius: '999px',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {commentsOpen ? 'Hide' : 'Comments'} ({post.comment_count || 0})
        </button>
        {!citizen && (
          <span
            style={{
              fontSize: '0.72rem', color: 'var(--text-light)',
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
          {/* Composer */}
          <div
            style={{
              display: 'flex', gap: '8px', alignItems: 'flex-start',
              padding: '8px', border: '1px solid var(--border)',
              borderRadius: '10px', background: 'var(--bg)',
            }}
          >
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value.slice(0, 1000))}
              placeholder={citizen ? 'Add a comment…' : 'Sign in as a citizen to comment'}
              disabled={!citizen || commentBusy}
              rows={2}
              style={{
                flex: 1, resize: 'vertical', minHeight: '40px',
                padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: '8px',
                fontSize: '0.82rem', fontFamily: 'inherit',
                color: 'var(--text)', background: 'white',
                boxSizing: 'border-box',
              }}
              onFocus={() => { if (!citizen) onCitizenLoginRequired?.(); }}
            />
            <button
              type="button"
              onClick={handleSubmitComment}
              disabled={!citizen || commentBusy || !commentDraft.trim()}
              style={{
                border: '1px solid var(--accent)',
                background: citizen && commentDraft.trim() && !commentBusy ? 'var(--accent)' : 'var(--bg)',
                color: citizen && commentDraft.trim() && !commentBusy ? 'white' : 'var(--text-light)',
                padding: '7px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem', fontWeight: 700,
                cursor: (!citizen || commentBusy || !commentDraft.trim()) ? 'not-allowed' : 'pointer',
                flexShrink: 0,
              }}
            >
              {commentBusy ? 'Sending…' : 'Post'}
            </button>
          </div>
          {commentErr && (
            <div style={{ color: '#d63031', fontSize: '0.72rem', marginTop: '6px' }}>
              {commentErr}
            </div>
          )}

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
              style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 600 }}
            >
              Sort
            </label>
            <select
              id={`comment-sort-${post.id}`}
              value={commentSort}
              onChange={(e) => setCommentSort(e.target.value)}
              style={{
                padding: '4px 26px 4px 10px',
                border: '1px solid var(--border)', borderRadius: '999px',
                background: 'white', color: 'var(--text)',
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

          {/* Comment list */}
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {commentsLoading && (
              <div style={{ color: 'var(--text-light)', fontSize: '0.78rem', padding: '6px 4px' }}>
                Loading comments…
              </div>
            )}
            {!commentsLoading && comments?.length === 0 && (
              <div style={{ color: 'var(--text-light)', fontSize: '0.78rem', padding: '6px 4px' }}>
                No comments yet.
              </div>
            )}
            {comments?.map((c) => {
              const canDelete = isOwner || (citizen && c.citizen_display_name === citizen.display_name);
              // ^ author-match by display_name is a soft heuristic because
              // the GET comments endpoint doesn't return citizen_id to
              // non-owners for privacy. The 403 from the backend is the
              // real gate; this just decides whether to *show* the button.
              const locLabel = [c.scope_district, c.scope_city].filter(Boolean).join(' · ');
              return (
                <div
                  key={c.id}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'white',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>
                      {c.citizen_display_name}
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
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-light)' }}>
                      {timeAgo(c.created_at)}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text)', marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {c.body}
                  </div>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center',
                      marginTop: '6px', gap: '6px', flexWrap: 'wrap',
                    }}
                  >
                    <CommentReactionButton
                      kind="up"
                      count={c.up_count || 0}
                      active={c.my_reaction === 'up'}
                      onClick={() => handleCommentReact(c.id, 'up')}
                      title={citizen ? 'Like' : 'Sign in as a citizen to like'}
                    />
                    <CommentReactionButton
                      kind="down"
                      count={c.down_count || 0}
                      active={c.my_reaction === 'down'}
                      onClick={() => handleCommentReact(c.id, 'down')}
                      title={citizen ? 'Dislike' : 'Sign in as a citizen to dislike'}
                    />
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-light)', marginLeft: '4px' }}>
                      {locLabel || c.scope_state || ''}
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(c)}
                        style={{
                          marginLeft: 'auto',
                          border: 'none', background: 'transparent',
                          color: '#d63031', fontSize: '0.7rem',
                          fontWeight: 600, cursor: 'pointer', padding: '2px 4px',
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}

function ReactionButton({ kind, count, active, disabled, onClick, title }) {
  const isUp = kind === 'up';
  const accent = isUp ? '#1877f2' : '#c33333';
  const icon = isUp ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={active ? accent : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={active ? accent : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
    </svg>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 10px',
        borderRadius: '999px',
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        background: active ? (isUp ? '#e3f0fc' : '#fde8e8') : 'white',
        color: active ? accent : 'var(--text)',
        fontSize: '0.78rem', fontWeight: active ? 700 : 500,
        cursor: disabled ? 'wait' : 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {icon}
      {count}
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
  const accent = isUp ? '#1877f2' : '#c33333';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        background: active ? (isUp ? '#e3f0fc' : '#fde8e8') : 'white',
        color: active ? accent : 'var(--text-light)',
        fontSize: '0.7rem', fontWeight: active ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill={active ? accent : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {isUp
          ? <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          : <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />}
      </svg>
      {count}
    </button>
  );
}
