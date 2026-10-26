'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Hidden by moderation: one identity's posts, comments and polls that
 * moderation took down in the last 30 days, each with its appeal state
 * or an Appeal button.
 *
 * Shared since 2026-10-26: the citizen dashboard had the only copy, so a
 * rep or candidate whose post or comment was hidden had no list and no
 * way to appeal it. Their page dashboard now shows the same list.
 *
 * Renders nothing while loading or when nothing is hidden (an empty
 * card would only be noise), unless the host passes `empty`: the
 * citizen dashboard's Settings has a Moderation group (2026-10-26) and
 * shows a line there instead. The `frame` prop wraps the list in the
 * host dashboard's own card.
 *
 * The bell's "was hidden" notice links here with #moderation; the list
 * scrolls itself into view when it renders under that hash.
 *
 * Props:
 *   asKind  'citizen' | 'rep' | 'candidate': whose items, among the
 *           identities signed in on this browser
 *   frame   (children) => element, the card around the list
 *   empty   optional element shown (inside frame) when nothing is hidden
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMyHiddenContent } from '../lib/pagesApi';
import { serverDate } from '../lib/serverTime';
import AppealModal from './AppealModal';

export const MODERATION_ANCHOR = 'moderation';

const KIND_LABEL = {
  post: 'Post',
  post_comment: 'Comment',
  poll: 'Poll',
  poll_comment: 'Poll comment',
};

const REASON_LABEL = {
  auto_hidden: 'community reports',
  admin_hidden: 'admin action',
  threat_hidden: 'safety screen',
};

function timeAgo(iso) {
  if (!iso) return '';
  const then = serverDate(iso);
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function HiddenByModeration({ asKind, frame, empty }) {
  const [items, setItems] = useState(null);
  const [appealTarget, setAppealTarget] = useState(null);
  const anchorRef = useRef(null);
  // Read the hash when the list mounts: the app may rewrite the URL
  // before the items arrive.
  const scrollWanted = useRef(
    typeof window !== 'undefined' && window.location.hash === `#${MODERATION_ANCHOR}`,
  );

  const load = useCallback(async () => {
    const { data } = await fetchMyHiddenContent({ as: asKind });
    setItems(data?.items || []);
  }, [asKind]);
  useEffect(() => { load(); }, [load]);

  const hasItems = Boolean(items && items.length);
  const showEmpty = Boolean(items && !items.length && empty);
  useEffect(() => {
    if (!(hasItems || showEmpty) || !scrollWanted.current) return;
    scrollWanted.current = false;
    anchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hasItems, showEmpty]);

  // The host can move the scroll stop below its own pinned header with
  // --cv-scroll-margin.
  const anchorStyle = { scrollMarginTop: 'var(--cv-scroll-margin, 80px)' };

  if (showEmpty) {
    const none = <div id={MODERATION_ANCHOR} ref={anchorRef} style={anchorStyle}>{empty}</div>;
    return frame ? frame(none) : none;
  }
  if (!hasItems) return null;

  const onAppealSuccess = (appeal) => {
    setAppealTarget(null);
    // Patch the row in place (now pending) without a refetch.
    setItems((prev) =>
      (prev || []).map((row) =>
        row.target_kind === appeal.target_kind && row.target_id === appeal.target_id
          ? { ...row, appeal_status: 'pending', appealable: false }
          : row,
      ),
    );
  };

  const list = (
    <div id={MODERATION_ANCHOR} ref={anchorRef} style={anchorStyle}>
      <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--cl-text-light)', lineHeight: 1.5 }}>
        Content of yours that admins or the community-reports
        threshold removed. You can appeal each item once, within
        30 days of when it was hidden.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((row) => (
          <HiddenContentRow
            key={`${row.target_kind}-${row.target_id}`}
            row={row}
            onAppeal={() => setAppealTarget({
              kind: row.target_kind,
              id: row.target_id,
              preview: row.preview,
              hide_reason: row.hide_reason,
              hidden_at: row.hidden_at,
            })}
          />
        ))}
      </div>
      <AppealModal
        open={!!appealTarget}
        target={appealTarget}
        onClose={() => setAppealTarget(null)}
        onSuccess={onAppealSuccess}
      />
    </div>
  );
  return frame ? frame(list) : list;
}

function HiddenContentRow({ row, onAppeal }) {
  const status = row.appeal_status; // null | 'pending' | 'granted' | 'denied'
  const statusChip =
    status === 'pending'
      ? { label: 'Appeal pending', bg: 'var(--cl-accent-soft)', color: 'var(--cl-accent)' }
      : status === 'granted'
      ? { label: 'Appeal granted ✓', bg: 'var(--cl-up-soft)', color: 'var(--cl-up)' }
      : status === 'denied'
      ? { label: 'Appeal denied', bg: 'var(--cl-danger-soft)', color: 'var(--cl-danger-text)' }
      : null;

  return (
    <div
      style={{
        background: 'white',
        border: '1px solid var(--cl-border)',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {KIND_LABEL[row.target_kind] || row.target_kind}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
          Hidden {timeAgo(row.hidden_at)} · {REASON_LABEL[row.hide_reason] || 'moderation'}
        </div>
      </div>
      <div
        style={{
          fontSize: '0.88rem',
          color: 'var(--cl-text)',
          maxHeight: 80,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          background: 'var(--cl-bg-soft)',
          padding: '6px 8px',
          borderRadius: 6,
        }}
      >
        {row.preview || <em style={{ color: 'var(--cl-text-muted)' }}>(empty)</em>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {statusChip ? (
          <span
            style={{
              padding: '3px 10px',
              background: statusChip.bg,
              color: statusChip.color,
              borderRadius: 999,
              fontSize: '0.74rem',
              fontWeight: 700,
            }}
          >
            {statusChip.label}
          </span>
        ) : <span />}
        {row.appealable && (
          <button
            type="button"
            onClick={onAppeal}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--cl-accent)',
              background: 'var(--cl-accent)',
              color: 'white',
              borderRadius: 8,
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Appeal
          </button>
        )}
      </div>
      {status && row.appeal_admin_note && (
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontStyle: 'italic', borderTop: '1px solid var(--cl-border)', paddingTop: 6 }}>
          Admin note: {row.appeal_admin_note}
        </div>
      )}
    </div>
  );
}
