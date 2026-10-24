// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Checks for lib/ballotCoverage.js (2026-10-24): the line on an election
// that has some races listed, saying what the list doesn't cover yet.
// A Florida voter read the partial list as their whole ballot because
// the tab only said so when a state had no races at all.
// Run: npm run test:ballot-coverage

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = mkdtempSync(path.join(tmpdir(), 'cv-ballot-coverage-test-'));
const file = path.join(out, 'bundle.mjs');
await build({
  entryPoints: [path.join(root, 'lib/ballotCoverage.js')],
  bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'silent',
});
const { coverageSentences, COVERAGE_TITLE } = await import(pathToFileURL(file).href);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}

const FL = {
  state_legislative: 'some',
  judicial: 'none',
  county_local: 'none',
  statewide_measures: 'listed',
  local_measures: 'none',
};

check('Florida: what is missing, then what is partial', () => {
  assert.equal(
    coverageSentences(FL),
    "CivicView doesn't list judicial races and retention votes, county and city races, or local ballot measures yet. "
      + 'Only some state legislative races are listed.',
  );
});

check('a state with only federal and statewide races', () => {
  assert.equal(
    coverageSentences({
      state_legislative: 'none', judicial: 'none', county_local: 'none',
      statewide_measures: 'none', local_measures: 'none',
    }),
    "CivicView doesn't list state legislative races, judicial races and retention votes, county and city races, "
      + 'or ballot measures yet.',
  );
});

check('statewide measures missing but local ones listed', () => {
  assert.equal(
    coverageSentences({
      state_legislative: 'listed', judicial: 'listed', county_local: 'listed',
      statewide_measures: 'none', local_measures: 'listed',
    }),
    "CivicView doesn't list statewide ballot measures yet.",
  );
});

check('two partial parts join with "and"', () => {
  assert.equal(
    coverageSentences({
      state_legislative: 'some', judicial: 'listed', county_local: 'some',
      statewide_measures: 'listed', local_measures: 'listed',
    }),
    'Only some state legislative races and county and city races are listed.',
  );
});

check('everything listed: nothing to say', () => {
  assert.equal(coverageSentences({
    state_legislative: 'listed', judicial: 'listed', county_local: 'listed',
    statewide_measures: 'listed', local_measures: 'listed',
  }), null);
});

check('no coverage in the payload: no line', () => {
  assert.equal(coverageSentences(null), null);
  assert.equal(coverageSentences(undefined), null);
  assert.equal(coverageSentences('none'), null);
});

check('no dashes in anything shown', () => {
  const all = [COVERAGE_TITLE, coverageSentences(FL)].join(' ');
  assert.ok(!/[\u2013\u2014]/.test(all));
});

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll ballot coverage checks passed.');
