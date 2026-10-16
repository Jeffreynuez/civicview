// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Checks for the notification helpers that run in the browser
// (2026-10-16). Pure modules only: esbuild bundles each one for Node,
// then node:assert runs the checks. Run: npm run test:notifications
//
//   1. Push timing: the default is "As they happen"; the old
//      digest_cadence 'daily' default becomes realtime, 'weekly' stays.
//   2. The tour's steps stay at 30 words or fewer.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = mkdtempSync(path.join(tmpdir(), 'cv-notif-test-'));

async function load(rel) {
  const file = path.join(out, rel.replace(/[\\/]/g, '_') + '.mjs');
  await build({
    entryPoints: [path.join(root, rel)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: file,
    alias: { '@': root },
    logLevel: 'silent',
  });
  return import(pathToFileURL(file).href);
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failures += 1;
    console.log('FAIL ' + name + '  [' + (e && e.message) + ']');
  }
}

const prefs = await load('lib/notificationPrefs.js');

await check('1 default push timing is as they happen', () => {
  assert.equal(prefs.defaultChannelPrefs().push_cadence, 'realtime');
  assert.ok(!('digest_cadence' in prefs.defaultChannelPrefs()));
});
await check('1 the old daily default becomes realtime', () => {
  const merged = prefs.mergeChannelPrefs({ digest_cadence: 'daily', quiet_hours: 'off' });
  assert.equal(merged.push_cadence, 'realtime');
  assert.equal(merged.quiet_hours, 'off');
  assert.ok(!('digest_cadence' in merged));
});
await check('1 weekly carries over', () => {
  assert.equal(prefs.mergeChannelPrefs({ digest_cadence: 'weekly' }).push_cadence, 'weekly');
});
await check('1 a new value wins over the old key', () => {
  assert.equal(prefs.mergeChannelPrefs({ digest_cadence: 'weekly', push_cadence: 'daily' }).push_cadence, 'daily');
});
await check('1 the setting reads as push alerts', () => {
  const s = prefs.CHANNEL_SCHEMA.sliders.find((x) => x.key === 'push_cadence');
  assert.equal(s.label, 'Push alerts');
  assert.deepEqual(s.choiceLabels, { realtime: 'As they happen', daily: 'Daily summary', weekly: 'Weekly summary' });
});

const tour = await load('lib/tutorialSegments.js');
const notifTopic = tour.getTrack('notifications');
await check('2 the Notifications topic steps are 30 words or fewer, no dashes', () => {
  assert.ok(notifTopic && notifTopic.steps.length > 0, 'no Notifications topic');
  for (const step of notifTopic.steps) {
    const body = String(step.body || '');
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 30, `${step.id}: ${words} words`);
    assert.ok(!/[\u2013\u2014]/.test(body + step.title), `${step.id} has a dash`);
  }
});
await check('2 the tour describes push summaries', () => {
  const all = notifTopic.steps.map((s) => s.body).join(' ');
  assert.match(all, /daily or weekly summary/);
});

const text = [JSON.stringify(prefs.CHANNEL_SCHEMA)].join('\n');
await check('copy has no em or en dashes', () => {
  assert.ok(!/[\u2013\u2014]/.test(text));
});

writeFileSync(path.join(out, 'done'), '');
if (failures) {
  console.log(`\nFAILED (${failures})`);
  process.exit(1);
}
console.log('\nALL PASSED');
