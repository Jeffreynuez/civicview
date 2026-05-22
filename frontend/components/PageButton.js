'use client';


import { FileText } from 'lucide-react';
// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Small pill-shaped "Page" button that opens a rep/candidate's page
 * view. Sits next to Follow + Compare on every card/profile header.
 *
 * Unlike FollowButton and CompareButton (both circular icon buttons),
 * we use a pill with the word "Page" because (a) this is a high-signal
 * new feature for the demo story and (b) Follow's icon already looks
 * like a bookmark — a second icon next to it would be confusing.
 *
 * Props:
 *   officialId — string; resolves to RepAccount.official_id on the
 *                backend (bioguide_id for federal congress, state seed
 *                ids, candidate ids).
 *   onOpen     — handler(officialId) invoked when clicked.
 *   size       — 'sm' | 'md' (default). Matches FollowButton/CompareButton heights.
 *   label      — optional override (default: 'Page').
 *   disabled   — renders greyed-out; click is a no-op.
 *   disabledReason — tooltip when disabled.
 */
export default function PageButton({
  officialId,
  onOpen,
  size = 'md',
  label = 'Page',
  disabled = false,
  disabledReason = 'No page available',
}) {
  if (!officialId) return null;
  const h = size === 'sm' ? 24 : 28;

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled || !onOpen) return;
    onOpen(officialId);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={disabled ? disabledReason : 'Open page'}
      aria-label={disabled ? disabledReason : 'Open page'}
      aria-disabled={disabled}
      disabled={disabled}
      style={{
        height: `${h}px`,
        padding: '0 10px',
        borderRadius: `${h / 2}px`,
        border: '1px solid var(--cl-accent)',
        background: disabled ? 'transparent' : 'white',
        color: 'var(--cl-accent)',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.2px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        flexShrink: 0,
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseOver={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--cl-accent)';
        e.currentTarget.style.color = 'white';
      }}
      onMouseOut={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'white';
        e.currentTarget.style.color = 'var(--cl-accent)';
      }}
    >
      {/* Document-with-corner icon — visually distinct from Follow's bookmark. */}
      <FileText size={14} strokeWidth={2} />
      {label}
    </button>
  );
}
