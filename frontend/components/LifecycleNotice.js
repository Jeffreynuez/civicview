'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useState } from 'react';
import { isOfficialTracked, toggleOfficial } from '@/lib/trackedOfficials';

/**
 * Notices about people leaving office or ending a campaign
 * (2026-10-15), shared by the bell and the dashboard archive. The
 * backend writes the sentence (services/page_lifecycle_job.py), so the
 * bell, the archive and the email read the same, for everyone.
 *
 * Kinds: office_ended, campaign_ended, page_archive_soon, page_archived
 * (to the person), tracked_left_office, tracked_campaign_ended (to each
 * tracker, with a Follow button for whoever holds the seat now) and
 * tracked_now_in_office (to a winner's campaign followers, with Follow
 * in office).
 */
export const LIFECYCLE_KINDS = new Set([
  'office_ended', 'campaign_ended', 'page_archive_soon', 'page_archived',
  'tracked_left_office', 'tracked_campaign_ended', 'tracked_now_in_office',
]);

const BIOGUIDE_RE = /^[A-Z]\d{6}$/;

function memberFor(id, name) {
  return BIOGUIDE_RE.test(id)
    ? { id, bioguide_id: id, name: name || 'Official' }
    : { id, name: name || 'Official' };
}

function FollowButton({ id, name, label }) {
  const member = memberFor(id, name);
  const [following, setFollowing] = useState(() => isOfficialTracked(member));
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!following) setFollowing(toggleOfficial(member));
      }}
      disabled={following}
      style={{
        padding: '4px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700,
        border: '1px solid var(--cl-accent)', fontFamily: 'inherit',
        background: following ? 'white' : 'var(--cl-accent)',
        color: following ? 'var(--cl-accent)' : 'white',
        cursor: following ? 'default' : 'pointer',
      }}
    >
      {following ? `Following ${name || ''}`.trim() : label}
    </button>
  );
}

export default function LifecycleNotice({ notification: n, onOpen }) {
  const p = n.payload || {};
  const isUnread = !n.read_at;
  const follows = [];
  for (const s of p.successors || []) {
    if (s?.id) follows.push({ id: s.id, name: s.name, label: s.name ? `Follow ${s.name}` : 'Follow who holds the seat now' });
  }
  if (p.follow?.id) follows.push({ id: p.follow.id, name: p.follow.name, label: p.follow.label || 'Follow in office' });
  return (
    <div
      style={{
        borderRadius: 8, border: '1px solid var(--cl-border)', marginBottom: 4,
        background: isUnread ? 'var(--cl-accent-soft, #e6f4ea)' : 'white',
      }}
    >
      <button
        type="button"
        onClick={() => onOpen?.(n)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', padding: '8px 8px',
          border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text)', fontWeight: isUnread ? 700 : 500, lineHeight: 1.4 }}>
          {p.text || p.title || 'A page you follow changed.'}
        </div>
      </button>
      {follows.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 8px 8px' }}>
          {follows.map((f) => <FollowButton key={f.id} {...f} />)}
        </div>
      )}
    </div>
  );
}
