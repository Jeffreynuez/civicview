// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Shared helpers for the /bills surface (seat chart, mini-card, vote list).
// Kept framework-free so each consumer imports only what it needs.

export const POS_LABEL = { yea: 'Yea', nay: 'Nay', present: 'Present', nv: 'Did not vote' };

// Arc-ordering rank: Democrats left, Independents center, Republicans right.
export const PARTY_RANK = { D: 0, I: 1, R: 2 };

export function partyWord(p) {
  return p === 'R' ? 'Republican'
    : p === 'D' ? 'Democrat'
    : p === 'I' ? 'Independent'
    : 'Unknown';
}

export function partyHueVar(p) {
  return p === 'R' ? 'var(--cl-republican)'
    : p === 'D' ? 'var(--cl-democrat)'
    : p === 'I' ? 'var(--cl-independent)'
    : 'var(--cl-text-muted)';
}

export function partySoftVar(p) {
  return p === 'R' ? 'var(--cl-republican-soft)'
    : p === 'D' ? 'var(--cl-democrat-soft)'
    : p === 'I' ? 'var(--cl-independent-soft)'
    : 'var(--cl-bg-soft)';
}

// Backend member names arrive as "First Last" (official_full). Initials =
// first letter of first + first letter of last (Byron Donalds -> BD).
export function initials(name) {
  if (!name) return '–';
  const parts = name.replace(',', ' ').split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function displayName(seat, chamber) {
  return seat.name || ((chamber === 'House' ? 'Representative' : 'Senator') + ' · ' + seat.st);
}

// Map a backend vote_cast / position string to the chart's pos key.
export function positionToPos(p) {
  const k = (p || '').toLowerCase();
  if (k === 'yea') return 'yea';
  if (k === 'nay') return 'nay';
  if (k === 'present') return 'present';
  return 'nv';
}

// Normalize a backend result string to a StatusChip key.
export function normalizeResult(r) {
  const s = (r || '').toLowerCase();
  if (s.includes('confirm')) return 'Confirmed';
  if (s.includes('reject')) return 'Rejected';
  if (s.includes('fail')) return 'Failed';
  if (s.includes('pass') || s.includes('agreed') || s.includes('well taken')) return 'Passed';
  return 'Passed';
}
