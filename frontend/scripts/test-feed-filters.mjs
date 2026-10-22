// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Checks for lib/feedFilters.js and lib/pollResults.js (2026-10-20):
//   - the States chip on /polls and /posts showed an empty grid and a
//     count of 0 whatever state was picked;
//   - the Congress / Executive / Judicial chips match posts by their
//     branch, the same as polls;
//   - the tone chips on the Posts tab ask about posts;
//   - the feed card shows results the way the poll's result setting
//     says (right away, behind Show results, or not until it closes).
// Run: npm run test:feed-filters

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = mkdtempSync(path.join(tmpdir(), 'cv-feed-filters-test-'));
const entry = path.join(out, 'entry.js');
writeFileSync(entry, [
  `export * from ${JSON.stringify(path.join(root, 'lib/feedFilters.js'))};`,
  `export * from ${JSON.stringify(path.join(root, 'lib/pollResults.js'))};`,
].join('\n'));
const file = path.join(out, 'bundle.mjs');
await build({
  entryPoints: [entry],
  bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'silent',
});
const {
  pollBranch, branchCounts, filterByBranches, aiPresetPrompt,
  pollResultsView, resultsHiddenUntil, RESULTS_HIDDEN_TITLE, RESULTS_HIDDEN_SHORT,
} = await import(pathToFileURL(file).href);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (e) {
    failures += 1;
    console.log('FAIL ' + name + '\n  ' + e.message);
  }
}

// What the feed sends after ?state=FL: only Florida items, none of
// which carries a branch called 'states'.
const flPolls = [
  { id: 1, kind: 'rep', branch: 'congress' },
  { id: 2, kind: 'rep', branch: 'executive' },
  { id: 3, kind: 'citizen' },
  { id: 4, kind: 'standalone' },
  { id: 5, kind: 'candidate' },
];
const ids = (list) => list.map((p) => p.id);

check('States with a state picked shows every item from that state', () => {
  assert.deepEqual(ids(filterByBranches(flPolls, ['states'], 'FL')), [1, 2, 3, 4, 5]);
});

check('States with no state picked yet does not empty the grid', () => {
  assert.deepEqual(ids(filterByBranches(flPolls, ['states'], null)), [1, 2, 3, 4, 5]);
});

check('States plus a branch chip shows that branch within the state', () => {
  assert.deepEqual(ids(filterByBranches(flPolls, ['states', 'congress'], 'FL')), [1]);
  assert.deepEqual(ids(filterByBranches(flPolls, ['congress', 'standalone'], null)), [1, 4]);
});

check('an item that names its state is narrowed on the client too', () => {
  const mixed = [{ id: 1, state: 'FL' }, { id: 2, state: 'TX' }, { id: 3 }];
  assert.deepEqual(ids(filterByBranches(mixed, ['states'], 'FL')), [1, 3]);
});

check('All shows everything', () => {
  assert.deepEqual(ids(filterByBranches(flPolls, ['all'], null)), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(filterByBranches(flPolls, [], null)), [1, 2, 3, 4, 5]);
});

check('the States count is the number of items from the picked state', () => {
  assert.equal(branchCounts(flPolls, 'FL').states, 5);
  assert.equal(branchCounts(flPolls, null).states, null, 'no number before a state is picked');
});

check('branch and author-kind counts', () => {
  const c = branchCounts(flPolls, null);
  assert.equal(c.all, 5);
  assert.equal(c.congress, 1);
  assert.equal(c.executive, 1);
  assert.equal(c.judicial, 0);
  assert.equal(c.standalone, 1);
  assert.equal(c.candidate, 1);
  assert.equal(c.rep, 2);
  assert.equal(c.citizen, 1);
});

check('posts are matched by the branch the feed now sends', () => {
  const posts = [
    { id: 10, kind: 'rep', branch: 'congress' },
    { id: 11, kind: 'rep', branch: 'judicial' },
    { id: 12, kind: 'candidate', branch: null },
  ];
  assert.deepEqual(ids(filterByBranches(posts, ['congress'], null)), [10]);
  assert.deepEqual(ids(filterByBranches(posts, ['judicial'], null)), [11]);
  assert.deepEqual(ids(filterByBranches(posts, ['candidate'], null)), [12]);
  assert.equal(pollBranch(posts[2]), 'candidate');
  assert.equal(branchCounts(posts, null).congress, 1);
});

check('tone chips ask about posts on the Posts tab', () => {
  assert.equal(aiPresetPrompt({ prompt: 'positive polls' }, 'posts'), 'positive posts');
  assert.equal(aiPresetPrompt({ prompt: 'skeptical polls questioning the data' }, 'posts'),
    'skeptical posts questioning the data');
  assert.equal(aiPresetPrompt({ prompt: 'positive polls' }, 'polls'), 'positive polls');
});

check('result settings', () => {
  assert.equal(pollResultsView({ presentation_mode: 'full' }), 'full');
  assert.equal(pollResultsView({}), 'full', 'older feed items without the field');
  assert.equal(pollResultsView({ presentation_mode: 'hidden' }), 'on_request');
  assert.equal(
    pollResultsView({ presentation_mode: 'reveal_after_close', counts_suppressed: true }), 'withheld');
  assert.equal(
    pollResultsView({ presentation_mode: 'reveal_after_close', counts_suppressed: false }), 'full',
    'after the close (or for the page owner) the counts show');
});

check('wording matches the page poll card', () => {
  assert.equal(RESULTS_HIDDEN_TITLE, 'Results hidden until the poll closes.');
  assert.equal(RESULTS_HIDDEN_SHORT, 'Results hidden until close');
  assert.equal(resultsHiddenUntil(null), '');
  assert.equal(resultsHiddenUntil('not a date'), '');
  assert.ok(resultsHiddenUntil('2026-11-03T12:00:00Z').startsWith("You'll see them after "));
});

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll feed filter checks passed.');
