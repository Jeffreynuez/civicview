// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Reading the server's timestamps (2026-10-25).
 *
 * The backend stores times in UTC without a zone (datetime.utcnow() into
 * plain DateTime columns), so created_at, closes_at, edited_at and the
 * like arrive as "2026-10-26T00:47:30.123456", with no Z. JavaScript reads
 * a date and time with no zone as the viewer's local time, so in Florida
 * every one of them landed 4 hours in the future: a new comment said
 * "just now" for 4 hours, a poll's countdown ran 4 hours late (a closed
 * poll still said "Closes in 3h"), and the feeds' "new items" pill never
 * counted anything for 4 hours.
 *
 * serverDate() reads a zoneless date and time as UTC. Anything that
 * already carries a zone (Z or +hh:mm, such as an event's start_at) and a
 * plain date ("2026-11-03", which JavaScript already reads as UTC) pass
 * through unchanged, so it is safe on any field.
 */

// A date and time with no zone: 2026-10-26T00:47:30, with optional
// seconds and fraction, and a space instead of the T as some rows have.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** The same string with Z added when it is a zoneless date and time. */
export function asUtc(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  return NAIVE_DATETIME.test(s) ? `${s.replace(' ', 'T')}Z` : value;
}

/** A Date for a server timestamp, or null when there is none. */
export function serverDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(asUtc(value));
}

/** Milliseconds since 1970 for a server timestamp; NaN when there is none. */
export function serverMs(value) {
  const d = serverDate(value);
  return d ? d.getTime() : NaN;
}
