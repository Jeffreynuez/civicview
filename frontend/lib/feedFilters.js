// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * Chip filtering for the /polls and /posts feeds (app/polls/page.js),
 * kept here so it can be tested on its own (scripts/test-feed-filters.mjs).
 *
 * Two kinds of chips share one row:
 *   - Branch chips ('congress', 'executive', 'judicial', 'standalone',
 *     'candidate') match an item's branch. Several together show the
 *     union.
 *   - 'states' is not a branch. It narrows the list to the state picked
 *     in its dropdown (the server already narrows the feed with
 *     ?state=). Until 2026-10-20 it was matched like a branch, which no
 *     item ever has, so "States" alone always showed an empty grid and
 *     a count of 0.
 */

// The chip an item belongs to, or null for items only "All" covers.
export function pollBranch(item) {
  if (!item) return null;
  if (item.kind === 'standalone') return 'standalone';
  if (item.kind === 'candidate') return 'candidate';
  // The feed sends `branch` ('congress' | 'executive' | 'judicial') on
  // officials' polls and posts.
  if (item.branch) return item.branch;
  return null;
}

// Items in the picked state. The server already narrows by state; items
// that say which state they are from are checked again here.
function inState(items, stateFilter) {
  if (!stateFilter) return items;
  return items.filter((p) => (p && p.state ? p.state === stateFilter : true));
}

// Per-chip counts over the loaded items, plus the author-kind tallies the
// hero stats read (rep, citizen). `states` is the number of items from
// the picked state, or null while no state is picked (the chip then
// shows no number).
export function branchCounts(items, stateFilter) {
  const list = items || [];
  const counts = {
    all: list.length,
    states: stateFilter ? inState(list, stateFilter).length : null,
    congress: 0, executive: 0, judicial: 0,
    standalone: 0, candidate: 0,
    rep: 0, citizen: 0,
  };
  for (const p of list) {
    const b = pollBranch(p);
    if (b && typeof counts[b] === 'number' && b !== 'states') counts[b] += 1;
    const k = p && p.kind;
    if (k === 'rep' || k === 'citizen') counts[k] += 1;
  }
  return counts;
}

// The items the active chips show. 'all' (or nothing) shows everything;
// 'states' only narrows to the picked state, so "States" on its own
// shows every item from that state, and "States" with "Congress" shows
// that state's Congress items. With "States" on and no state picked yet
// (its dropdown is open asking for one) nothing is narrowed.
export function filterByBranches(items, branches, stateFilter) {
  const pool = inState(items || [], stateFilter);
  const active = (branches || []).filter((b) => b !== 'all' && b !== 'states');
  if ((branches || []).includes('all') || active.length === 0) return pool;
  const wanted = new Set(active);
  return pool.filter((p) => wanted.has(pollBranch(p)));
}

// The prompt a tone chip sends. The chips are worded for polls; on the
// Posts tab they ask about posts.
export function aiPresetPrompt(preset, tab) {
  const prompt = (preset && preset.prompt) || '';
  return tab === 'posts' ? prompt.replace(/\bpolls\b/g, 'posts') : prompt;
}
