// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Party labels as the official sources write them, for every surface
// that shows an official's party. The data stores a short code; each
// code maps to the exact word the legislature or office uses:
// "Nonpartisan" for Nebraska's officially nonpartisan Legislature,
// "Unaffiliated" where North Carolina uses that word, "Not Affiliated"
// in Alaska, "Unenrolled" in Massachusetts and Maine, "No Party
// Affiliation" in Florida, "Independent" only where the source says
// Independent. An official with no party (an appointed office whose
// sources give none) has no code and shows no party label at all; the
// selection badge says how they were chosen instead.
//
// Until 2026-10-15 an empty party displayed as "Independent"
// (member.party || 'I'), and every one of these statuses was stored as
// "I". Republican and Democrat keep their colors; every other label
// shares the neutral style Independent already used, so none reads as
// stronger than another.

import { PARTY_COLORS, PARTY_TEXT_COLORS } from './constants';

const PARTIES = {
  R: { label: 'Republican', short: 'R' },
  D: { label: 'Democrat', short: 'D' },
  I: { label: 'Independent', short: 'I' },
  NP: { label: 'Nonpartisan', short: 'Nonpartisan' },
  U: { label: 'Unaffiliated', short: 'Unaffiliated' },
  NA: { label: 'Not Affiliated', short: 'Not Affiliated' },
  NPA: { label: 'No Party Affiliation', short: 'NPA' },
  UNE: { label: 'Unenrolled', short: 'Unenrolled' },
  TM: { label: 'Tribal Member', short: 'Tribal Member' },
  F: { label: 'Forward', short: 'Forward' },
  L: { label: 'Libertarian', short: 'Libertarian' },
  G: { label: 'Green', short: 'Green' },
};

// Soft tints behind party text, one per major party plus the shared one.
const TINTS = { R: '#fde8e8', D: '#e3f0f7', other: '#f0eaff' };
const OTHER_FILL = '#6c3ec1';

// { code, label, short } for an official's party code, or null when
// there is none. An unknown code is shown as written, never guessed.
export function partyInfo(code) {
  const key = String(code ?? '').trim();
  if (!key) return null;
  const known = PARTIES[key] || PARTIES[key.toUpperCase()];
  if (known) return { code: PARTIES[key] ? key : key.toUpperCase(), ...known };
  return { code: key, label: key, short: key };
}

// Colors for a party code: { fill, text, tint }. R and D keep their own;
// every other label, and no party, share one neutral style.
export function partyStyle(code) {
  const key = String(code ?? '').trim().toUpperCase();
  if (key === 'R' || key === 'D') {
    return { fill: PARTY_COLORS[key], text: PARTY_TEXT_COLORS[key], tint: TINTS[key] };
  }
  return { fill: OTHER_FILL, text: PARTY_TEXT_COLORS.I, tint: TINTS.other };
}

// The codes present in a list of officials, in a stable order (R, D,
// then the rest as listed above), for building filters and counts.
export function partyCodesIn(people) {
  const seen = new Set((people || []).map((p) => partyInfo(p?.party)?.code).filter(Boolean));
  const order = Object.keys(PARTIES);
  return [...seen].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
  });
}
