'use client';

import { isOfficialTracked, toggleOfficial, useTrackedOfficials } from '../lib/trackedOfficials';

/**
 * Small circular icon button that toggles an official's Follow state.
 *
 * Filled bookmark when followed (green accent), outline when not.
 * Stops click propagation so parent row/card handlers don't fire.
 *
 * Props:
 *   member  — the official/member dict. Must carry bioguide_id or id.
 *   size    — 'sm' (24px) | 'md' (28px, default)
 *   onNotify(msg) — optional toast hook
 */
export default function FollowButton({ member, size = 'md', onNotify }) {
  // Subscribe so every FollowButton re-renders when the store changes.
  useTrackedOfficials();
  if (!member) return null;
  const followed = isOfficialTracked(member);
  const dim = size === 'sm' ? 24 : 28;
  const icon = dim - 10;

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const nowTracked = toggleOfficial(member);
    if (onNotify) {
      onNotify(
        nowTracked
          ? `Now following ${member.name}. You'll see them in My Tracked.`
          : `Stopped following ${member.name}.`
      );
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={followed ? `Unfollow ${member.name}` : `Follow ${member.name}`}
      aria-label={followed ? `Unfollow ${member.name}` : `Follow ${member.name}`}
      aria-pressed={followed}
      style={{
        width: `${dim}px`, height: `${dim}px`, borderRadius: '50%',
        border: followed ? '1.5px solid var(--accent)' : '1px solid var(--border)',
        background: followed ? 'var(--accent)' : 'white',
        color: followed ? 'white' : 'var(--accent)',
        cursor: 'pointer', padding: 0, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseOver={(e) => {
        if (!followed) {
          e.currentTarget.style.background = 'var(--bg)';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }
      }}
      onMouseOut={(e) => {
        if (!followed) {
          e.currentTarget.style.background = 'white';
          e.currentTarget.style.borderColor = 'var(--border)';
        }
      }}
    >
      <svg
        width={icon} height={icon} viewBox="0 0 24 24"
        fill={followed ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
