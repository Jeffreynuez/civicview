// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Which Congress is sitting, from the date. Mirrors
// backend/app/services/congress_calendar.py: a Congress is seated at
// noon Eastern on January 3 of an odd year (the 120th on January 3,
// 2027), and noon Eastern in January is always 17:00 UTC. Everything
// that names "the current Congress" reads it from here, so the switch
// needs no one to change a number by hand.

const FIRST_CONGRESS_YEAR = 1789;
const SWEARING_IN_HOUR_UTC = 17;

function sessionYear(now) {
  const d = now instanceof Date ? now : new Date();
  const year = d.getUTCFullYear();
  const opened =
    d.getUTCMonth() > 0 ||
    d.getUTCDate() > 3 ||
    (d.getUTCDate() === 3 && d.getUTCHours() >= SWEARING_IN_HOUR_UTC);
  return opened ? year : year - 1;
}

// The number of the Congress sitting at `now` (default: this moment).
export function currentCongress(now) {
  return Math.floor((sessionYear(now) - FIRST_CONGRESS_YEAR) / 2) + 1;
}

// 119 -> "119th", 121 -> "121st", as the Census layer names spell it.
export function ordinal(n) {
  const v = Number(n);
  const mod100 = v % 100;
  if (mod100 >= 10 && mod100 <= 20) return `${v}th`;
  return `${v}${{ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`;
}
