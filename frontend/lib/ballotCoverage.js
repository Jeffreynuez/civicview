// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * What an election's list doesn't cover yet (2026-10-24).
 *
 * The Elections tab used to say races "aren't listed yet" only when a
 * state had none at all. A Florida voter saw the statewide and
 * congressional races and read them as the whole ballot, with their state
 * House race, the court retention votes, the county races and the school
 * board question missing.
 *
 * The backend says, per state, which parts of the ballot its data lists
 * (ElectionsService._coverage): "listed", "some" or "none", read from the
 * whole state file. This turns that into the same sentences for every
 * state. Anything the data lists is left out of the sentences, so the
 * line shrinks as coverage grows, and it never claims more than the data
 * has.
 */

const RACE_PARTS = [
  ['state_legislative', 'state legislative races'],
  ['judicial', 'judicial races and retention votes'],
  ['county_local', 'county and city races'],
];

function joinList(items, word) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${word} ${items[items.length - 1]}`;
}

/**
 * The sentences for one state's coverage, or null when there is nothing
 * to say (or no coverage in the payload).
 *   coverageSentences({ state_legislative: 'some', judicial: 'none', ... })
 *   -> "CivicView doesn't list judicial races and retention votes, ...
 *       yet. Only some state legislative races are listed."
 */
export function coverageSentences(coverage) {
  if (!coverage || typeof coverage !== 'object') return null;
  const missing = [];
  const some = [];
  for (const [key, label] of RACE_PARTS) {
    if (coverage[key] === 'none') missing.push(label);
    else if (coverage[key] === 'some') some.push(label);
  }
  const statewide = coverage.statewide_measures;
  const local = coverage.local_measures;
  if (statewide === 'none' && local === 'none') {
    missing.push('ballot measures');
  } else {
    if (statewide === 'none') missing.push('statewide ballot measures');
    else if (statewide === 'some') some.push('statewide ballot measures');
    if (local === 'none') missing.push('local ballot measures');
    else if (local === 'some') some.push('local ballot measures');
  }
  const out = [];
  if (missing.length) out.push(`CivicView doesn't list ${joinList(missing, 'or')} yet.`);
  if (some.length) out.push(`Only some ${joinList(some, 'and')} are listed.`);
  return out.length ? out.join(' ') : null;
}

export const COVERAGE_TITLE = "This isn't your whole ballot yet.";
