// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Checks for lib/serverTime.js (2026-10-25): the server's timestamps are
// UTC without a zone, and the cards read them as local time, so in
// Florida a new comment said "just now" for 4 hours and a poll's
// countdown ran 4 hours late. Runs in Florida's time zone so the old
// reading would fail.
// Run: npm run test:server-time

process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = mkdtempSync(path.join(tmpdir(), 'cv-server-time-test-'));
const file = path.join(out, 'bundle.mjs');
await build({
  entryPoints: [path.join(root, 'lib/serverTime.js')],
  bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'silent',
});
const { asUtc, serverDate, serverMs } = await import(pathToFileURL(file).href);

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

const NAIVE = '2026-10-26T00:47:30.761928';   // what the API sends (Python isoformat, UTC)

check('the old reading is 4 hours off in Florida (the bug this guards)', () => {
  assert.equal(new Date(NAIVE).toISOString(), '2026-10-26T04:47:30.761Z');
});
check('a zoneless date and time is read as UTC', () => {
  assert.equal(serverDate(NAIVE).toISOString(), '2026-10-26T00:47:30.761Z');
  assert.equal(serverDate('2026-10-26T00:47:30').toISOString(), '2026-10-26T00:47:30.000Z');
  assert.equal(serverDate('2026-10-26T00:47').toISOString(), '2026-10-26T00:47:00.000Z');
});
check('a space instead of the T is read as UTC too', () => {
  assert.equal(serverDate('2026-10-26 00:47:30').toISOString(), '2026-10-26T00:47:30.000Z');
});
check('a time that already has a zone is left alone', () => {
  assert.equal(serverDate('2026-10-26T00:47:30Z').toISOString(), '2026-10-26T00:47:30.000Z');
  assert.equal(serverDate('2026-10-26T00:47:30+00:00').toISOString(), '2026-10-26T00:47:30.000Z');
  assert.equal(serverDate('2026-11-14T10:00:00-05:00').toISOString(), '2026-11-14T15:00:00.000Z');
  assert.equal(asUtc('2026-10-26T00:47:30Z'), '2026-10-26T00:47:30Z');
});
check('a plain date is left alone', () => {
  assert.equal(asUtc('2026-11-03'), '2026-11-03');
  assert.equal(serverDate('2026-11-03').toISOString(), new Date('2026-11-03').toISOString());
});
check('nothing in, nothing out', () => {
  assert.equal(serverDate(null), null);
  assert.equal(serverDate(undefined), null);
  assert.equal(serverDate(''), null);
  assert.ok(Number.isNaN(serverMs(null)));
  assert.equal(asUtc(null), null);
});
check('a Date or a number passes through', () => {
  const d = new Date('2026-10-26T00:47:30Z');
  assert.equal(serverDate(d), d);
  assert.equal(serverMs(d.getTime()), d.getTime());
});
check('serverMs matches serverDate', () => {
  assert.equal(serverMs(NAIVE), Date.parse('2026-10-26T00:47:30.761Z'));
});
check('a comment made 5 minutes ago reads as 5 minutes old, not in the future', () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString().replace('Z', '');
  const age = Date.now() - serverMs(fiveMinAgo);
  assert.ok(age > 4.9 * 60000 && age < 5.1 * 60000, `age was ${age} ms`);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
