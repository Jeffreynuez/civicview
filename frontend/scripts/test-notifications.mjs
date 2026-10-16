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
//   3. Bell, archive and push tap share one post deep link.
//   4. Only the alert switches that work are shown.
//   5. lib/push.js: one registration listener, untrack removals, unbind.

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

await check('4 My Tracked shows only the switches that work', () => {
  const keys = (t) => prefs.enforcedOptions(t).map((o) => o.key);
  assert.deepEqual(keys('representative'), ['on_event']);
  assert.deepEqual(keys('candidate'), ['on_event']);
  assert.deepEqual(keys('bill'), []);
  assert.equal(prefs.hasEnforcedPrefs('bill'), false);
  // services/election_reminders.py _ELECTION_PREF_KEYS
  assert.deepEqual(keys('election').sort(),
    ['on_early_voting', 'on_election_day', 'on_mail_ballot_deadline', 'on_registration_deadline']);
});
await check('4 election switch descriptions say what is sent', () => {
  const d = Object.fromEntries(prefs.enforcedOptions('election').map((o) => [o.key, o.description]));
  assert.equal(d.on_election_day, 'A reminder the day before Election Day.');
  assert.ok(!/absentee|return deadline|Morning-of/i.test(Object.values(d).join(' ')));
});
await check('4 the in-app toasts switch is hidden', () => {
  const opt = prefs.CHANNEL_SCHEMA.options.find((o) => o.key === 'in_app');
  assert.equal(opt.hidden, true);
});

const links = await load('lib/deepLinks.js');
await check('3 a post link is the same one the push tap uses', () => {
  assert.equal(links.postDeepLink('FL-SEN-1', 42), '/?page=FL-SEN-1#post-42');
  assert.equal(links.postDeepLink('a b/c', '7'), '/?page=a%20b%2Fc#post-7');
});
await check('3 a page link without a post has no hash', () => {
  assert.equal(links.postDeepLink('S001217', null), '/?page=S001217');
  assert.equal(links.postDeepLink('S001217'), '/?page=S001217');
});
await check('3 no official, no link', () => {
  assert.equal(links.postDeepLink('', 5), null);
});

// ── 5. push.js in a fake Capacitor shell ───────────────────────────
const store = new Map();
const listeners = {};
const posts = [];
let registerCalls = 0;
globalThis.window = {
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: {
      PushNotifications: {
        checkPermissions: async () => ({ receive: 'granted' }),
        requestPermissions: async () => ({ receive: 'granted' }),
        addListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
        register: () => {
          registerCalls += 1;
          setTimeout(() => (listeners.registration || []).forEach((fn) => fn({ value: 'tok-test-device-1' })), 5);
        },
        removeAllDeliveredNotifications: async () => {},
      },
    },
  },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  location: { href: 'http://localhost/', assign: () => {} },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).endsWith('/api/csrf')) {
    return new Response(JSON.stringify({ csrf_token: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  posts.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const push = await load('lib/push.js');
await check('5 the registration listener is installed once', async () => {
  for (let i = 0; i < 3; i += 1) {
    const r = await push.enablePush();
    assert.equal(r.ok, true);
  }
  assert.equal(registerCalls, 3);
  assert.equal((listeners.registration || []).length, 1);
  assert.equal((listeners.registrationError || []).length, 1);
  const regs = posts.filter((p) => p.url.endsWith('/api/push/register'));
  assert.equal(regs.length, 3, 'one register per token event, not one per listener');
});
await check('5 an untrack sends tracked_remove for that key only', async () => {
  posts.length = 0;
  push.syncPushRegistration({ removed: 'S001217' });
  await new Promise((r) => setTimeout(r, 900));
  const last = posts.filter((p) => p.url.endsWith('/api/push/register')).pop();
  assert.ok(last, 'no register call');
  assert.deepEqual(last.body.tracked_remove, ['s001217']);
});
await check('5 sign-out unbinds with the saved token', async () => {
  posts.length = 0;
  assert.equal(await push.unbindPushDevice(), true);
  const call = posts.find((p) => p.url.endsWith('/api/push/unbind'));
  assert.deepEqual(call && call.body, { token: 'tok-test-device-1' });
});

const text = [JSON.stringify(prefs.CHANNEL_SCHEMA), JSON.stringify(prefs.PREF_SCHEMA.election)].join('\n');
await check('copy has no em or en dashes', () => {
  assert.ok(!/[\u2013\u2014]/.test(text));
});

writeFileSync(path.join(out, 'done'), '');
if (failures) {
  console.log(`\nFAILED (${failures})`);
  process.exit(1);
}
console.log('\nALL PASSED');
