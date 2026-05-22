'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Small pill indicating a sitting official is also a declared candidate in an
 * upcoming race. Driven by `member.active_candidacy` (emitted by the backend
 * via _merge_profile). Used next to the party badge on rep cards and on
 * ProfileView so users can spot "this person is running for something" without
 * opening the profile.
 *
 * Props:
 *   activeCandidacy: { candidate_id, seeking_office, cycle } | null
 *   size:            'sm' | 'md'   default: 'md'
 *   onClick:         optional — when present, renders as a button that
 *                    navigates to the candidate profile.
 */
export default function OnBallotBadge({ activeCandidacy, size = 'md', onClick }) {
  if (!activeCandidacy) return null;

  const seeking = activeCandidacy.seeking_office || '';
  const title = seeking ? `Running for ${seeking}` : 'On the ballot in an upcoming race';

  const dims = size === 'sm'
    ? { padding: '1px 6px', fontSize: '0.6rem', gap: '3px', icon: 10 }
    : { padding: '2px 8px', fontSize: '0.7rem', gap: '4px', icon: 12 };

  const style = {
    display: 'inline-flex', alignItems: 'center', gap: dims.gap,
    padding: dims.padding, borderRadius: '12px',
    fontSize: dims.fontSize, fontWeight: 700, letterSpacing: '0.03em',
    background: '#fff4e6', color: '#b85c00',
    border: '1px solid #ffd8a8',
    whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default',
    lineHeight: 1.2,
  };

  const content = (
    <>
      {/* Ballot-box glyph */}
      <svg width={dims.icon} height={dims.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="8" width="18" height="13" rx="2" />
        <path d="M8 8V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" />
        <path d="M8 14h8" />
      </svg>
      <span>On ballot</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={title}
        style={{ ...style, border: '1px solid #ffd8a8' }}
      >
        {content}
      </button>
    );
  }
  return (
    <span title={title} style={style}>
      {content}
    </span>
  );
}
