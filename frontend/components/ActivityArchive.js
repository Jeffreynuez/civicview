'use client';

// CivicView — activity archive (2026-07-26).
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// One shared component, three mounts — the same feature for every
// identity kind (Jeffrey: "Rep and candidate accounts should have the
// same features"):
//   • Citizen dashboard  → Activity tab   (identity="citizen")
//   • Rep page Dashboard → bottom section (identity="rep")
//   • Candidate page Dashboard → bottom section (identity="candidate")
//
// Two sections:
//   1. "Comments you've made"   — /api/activity/comments (posts +
//      citizen polls, merged newest-first, deleted/edited flagged).
//   2. "Replies you've received" — /api/activity/notifications with
//      kind=reply and include_cleared server-side, so history
//      survives the bell's Clear button (that's the whole point of
//      cleared_at being a soft-clear).
//
// Deep links reuse the bell's non-disruptive URL nudge: open_page
// param + optional #post-<id> hash, which PageView turns into a
// scroll + pulse once the feed mounts.

import { useCallback, useEffect, useState } from 'react';
import {
  fetchActivityComments,
  fetchActivityNotifications,
} from '@/lib/pagesApi';

const PAGE = 20;

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return ''; }
}

function deepLink(officialId, postId) {
  if (!officialId) return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('open_page', officialId);
    u.hash = postId ? `#post-${postId}` : '';
    window.history.pushState({}, '', u.toString());
    // pushState alone doesn't notify listeners — nudge them the same
    // way the browser would on back/forward.
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* SSR / malformed URL — ignore */ }
}

function SectionShell({ title, count, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '8px 10px', borderRadius: 10,
          border: '1px solid var(--cl-border)', background: 'var(--cl-bg, #f7f8f9)',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span style={{
          fontSize: '0.74rem', fontWeight: 800, color: 'var(--cl-primary)',
          textTransform: 'uppercase', letterSpacing: '0.4px',
        }}>
          {title}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {typeof count === 'number' && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--cl-text-light)' }}>
              {count}{count === PAGE || count % PAGE === 0 ? '+' : ''}
            </span>
          )}
          <span aria-hidden="true" style={{
            fontSize: '0.62rem', color: 'var(--cl-text-light)',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms',
          }}>
            ▶
          </span>
        </span>
      </button>
      {open && <div style={{ padding: '8px 2px 0' }}>{children}</div>}
    </div>
  );
}

function LoadMore({ busy, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        width: '100%', padding: '8px 0', borderRadius: 8, cursor: 'pointer',
        border: '1px solid var(--cl-border)', background: 'white',
        color: 'var(--cl-accent)', fontSize: '0.76rem', fontWeight: 700,
        fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? 'Loading…' : 'Load more'}
    </button>
  );
}

export default function ActivityArchive({ identity }) {
  // ── Comments ──
  const [comments, setComments] = useState([]);
  const [commentsMore, setCommentsMore] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);

  // ── Replies received ──
  const [replies, setReplies] = useState([]);
  const [repliesMore, setRepliesMore] = useState(false);
  const [repliesBusy, setRepliesBusy] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(true);

  const [err, setErr] = useState(null);

  const loadComments = useCallback(async (offset) => {
    setCommentsBusy(true);
    const { data, error } = await fetchActivityComments({ identity, limit: PAGE, offset });
    setCommentsBusy(false);
    if (error) { setErr(error); return; }
    setComments((prev) => offset === 0 ? (data.items || []) : [...prev, ...(data.items || [])]);
    setCommentsMore(!!data.has_more);
  }, [identity]);

  const loadReplies = useCallback(async (offset) => {
    setRepliesBusy(true);
    const { data, error } = await fetchActivityNotifications({
      identity, kind: 'reply', limit: PAGE, offset,
    });
    setRepliesBusy(false);
    if (error) { setErr(error); return; }
    setReplies((prev) => offset === 0 ? (data.items || []) : [...prev, ...(data.items || [])]);
    setRepliesMore(!!data.has_more);
  }, [identity]);

  useEffect(() => {
    setErr(null);
    loadComments(0);
    loadReplies(0);
  }, [loadComments, loadReplies]);

  const rowStyle = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '9px 10px', borderRadius: 8,
    border: '1px solid var(--cl-border)', background: 'white',
    marginBottom: 6, cursor: 'pointer', fontFamily: 'inherit',
  };
  const chip = (label, tone) => (
    <span style={{
      fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: 6,
      marginLeft: 6, textTransform: 'uppercase', letterSpacing: '0.3px',
      background: tone === 'red' ? '#fdecec' : '#eef2f7',
      color: tone === 'red' ? '#b3261e' : 'var(--cl-text-light)',
    }}>
      {label}
    </span>
  );

  return (
    <div>
      {err && (
        <div style={{ fontSize: '0.76rem', color: '#b3261e', marginBottom: 8 }}>
          Couldn&rsquo;t load your activity archive. Pull to refresh or try again shortly.
        </div>
      )}

      <SectionShell
        title="Comments you’ve made"
        count={comments.length}
        open={commentsOpen}
        onToggle={() => setCommentsOpen((v) => !v)}
      >
        {comments.length === 0 && !commentsBusy ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', padding: '2px 2px 6px', lineHeight: 1.45 }}>
            No comments yet. Comments you leave on posts and polls will be
            archived here — even after they scroll out of a feed.
          </div>
        ) : (
          comments.map((c) => (
            <button
              key={`${c.source}-${c.id}`}
              type="button"
              style={rowStyle}
              onClick={() => deepLink(c.official_id, c.post_id)}
            >
              <div style={{ fontSize: '0.78rem', color: 'var(--cl-text)', lineHeight: 1.4 }}>
                “{c.body}”
                {c.is_reply && chip('reply')}
                {c.edited && chip('edited')}
                {c.deleted && chip('deleted', 'red')}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: 3 }}>
                {fmtDate(c.created_at)}
                {c.context ? <> · on “{c.context}”</> : null}
              </div>
            </button>
          ))
        )}
        {commentsMore && <LoadMore busy={commentsBusy} onClick={() => loadComments(comments.length)} />}
      </SectionShell>

      <SectionShell
        title="Replies you’ve received"
        count={replies.length}
        open={repliesOpen}
        onToggle={() => setRepliesOpen((v) => !v)}
      >
        {replies.length === 0 && !repliesBusy ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', padding: '2px 2px 6px', lineHeight: 1.45 }}>
            No replies yet. When someone replies to one of your comments,
            the full history lives here — even after you clear the bell.
          </div>
        ) : (
          replies.map((n) => {
            const p = n.payload || {};
            return (
              <button
                key={n.id}
                type="button"
                style={rowStyle}
                onClick={() => deepLink(p.official_id, p.post_id)}
              >
                <div style={{ fontSize: '0.78rem', color: 'var(--cl-text)', fontWeight: 600 }}>
                  <span style={{ fontWeight: 800 }}>{p.replier_name || 'Someone'}</span>
                  {' '}replied to your comment
                </div>
                {p.preview && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: 2, lineHeight: 1.35 }}>
                    “{p.preview}”
                  </div>
                )}
                <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: 3 }}>
                  {fmtDate(n.created_at)}
                </div>
              </button>
            );
          })
        )}
        {repliesMore && <LoadMore busy={repliesBusy} onClick={() => loadReplies(replies.length)} />}
      </SectionShell>
    </div>
  );
}
