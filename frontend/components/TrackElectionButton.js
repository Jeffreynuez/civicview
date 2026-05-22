'use client';


import { Bell } from 'lucide-react';
// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import {
  isElectionTracked,
  toggleElection,
  useTrackedElections,
} from '../lib/trackedElections';

/**
 * Small circular icon button that toggles an election's Track state.
 *
 * Uses a bell icon (filled when tracked, outline otherwise) to telegraph
 * that tracking an election is about receiving reminders — election day,
 * registration deadline, early voting window, etc.
 *
 * Stops click propagation so parent card handlers don't fire.
 *
 * Props:
 *   election — the election dict. Must have an id (or state/office/date).
 *   size     — 'sm' (24px) | 'md' (28px, default)
 *   onNotify(msg) — optional toast hook
 */
export default function TrackElectionButton({ election, size = 'md', onNotify }) {
  useTrackedElections();
  if (!election) return null;
  const tracked = isElectionTracked(election);
  const dim = size === 'sm' ? 24 : 28;
  const icon = dim - 10;

  const label =
    election.name ||
    election.office ||
    [election.state, election.type].filter(Boolean).join(' ') ||
    'election';

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const nowTracked = toggleElection(election);
    if (onNotify) {
      onNotify(
        nowTracked
          ? `Tracking ${label}. You'll get reminders for registration, early voting, and election day.`
          : `Stopped tracking ${label}.`
      );
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={tracked ? `Stop tracking ${label}` : `Track ${label}`}
      aria-label={tracked ? `Stop tracking ${label}` : `Track ${label}`}
      aria-pressed={tracked}
      style={{
        width: `${dim}px`, height: `${dim}px`, borderRadius: '50%',
        border: tracked ? '1.5px solid var(--cl-accent)' : '1px solid var(--cl-border)',
        background: tracked ? 'var(--cl-accent)' : 'white',
        color: tracked ? 'white' : 'var(--cl-accent)',
        cursor: 'pointer', padding: 0, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseOver={(e) => {
        if (!tracked) {
          e.currentTarget.style.background = 'var(--cl-bg)';
          e.currentTarget.style.borderColor = 'var(--cl-accent)';
        }
      }}
      onMouseOut={(e) => {
        if (!tracked) {
          e.currentTarget.style.background = 'white';
          e.currentTarget.style.borderColor = 'var(--cl-border)';
        }
      }}
    >
      {/* Bell icon — filled when tracked, outline otherwise */}
      <Bell size={14} strokeWidth={2} />
    </button>
  );
}
