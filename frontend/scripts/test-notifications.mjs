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
//   3. Bell, archive and push tap share one deep link per kind.
//   4. The settings list (2026-10-17): its rows and choices match the
//      server, no per-item switch is left, and no copy promises state
//      bill alerts.
//   5. lib/push.js: one registration listener, untrack removals, unbind,
//      the app build and Android's notification state at register, the
//      channels, and the opt-in card's one second chance.

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
await check('2 the My Tracked topic explains Mute, 30 words or fewer, no dashes', () => {
  const topic = tour.getTrack('tracked');
  const mute = topic && topic.steps.find((st) => st.id === 'tracked-mute');
  assert.ok(mute, 'no Mute step');
  for (const step of topic.steps) {
    const body = typeof step.body === 'function' ? step.body({ compact: false }) : String(step.body || '');
    assert.ok(body.trim().split(/\s+/).length <= 30, `${step.id} is too long`);
    assert.ok(!/[\u2013\u2014]/.test(body + step.title), `${step.id} has a dash`);
  }
  assert.match(mute.body, /page change notices still come/);
});
await check('2 the tour names the new alerts and the phone', () => {
  const all = notifTopic.steps.map((st) => st.body).join(' ');
  assert.match(all, /bill updates, poll results/);
  assert.match(all, /Show details/);
});
await check('2 the tour describes push summaries', () => {
  const all = notifTopic.steps.map((s) => s.body).join(' ');
  assert.match(all, /daily or weekly summary/);
});
await check('2 the tour promises the unsubscribe link only on optional emails', () => {
  // An official's own notices about their page and security emails have none.
  const all = notifTopic.steps.map((s) => s.body).join(' ');
  assert.match(all, /Optional emails, like the weekly digest and election reminders, have a one-click unsubscribe link\./);
  assert.doesNotMatch(all, /Each notification email/);
});

await check('4 the settings list has the seven rows, in order', () => {
  // backend/app/services/alert_settings.py ROW_ORDER
  assert.deepEqual(prefs.ALERT_ROWS.map((r) => r.key),
    ['officials', 'events', 'replies', 'bills', 'poll_results', 'elections', 'page_changes']);
  for (const r of prefs.ALERT_ROWS) assert.ok(prefs.ALERT_DEFAULTS[r.key], r.key);
  assert.equal(prefs.ALERT_DEFAULTS.events, 'bell_push');
  assert.equal(prefs.ALERT_DEFAULTS.page_changes, 'bell_push_email');
});
await check('4 no per-item switch is left', () => {
  for (const t of Object.keys(prefs.PREF_SCHEMA)) assert.deepEqual(prefs.PREF_SCHEMA[t].options, [], t);
  assert.deepEqual(prefs.CHANNEL_SCHEMA.options, []);
  assert.equal(prefs.defaultChannelPrefs().lock_screen_details, false);
});
await check('4 the choices read as plain words', () => {
  assert.deepEqual(prefs.ALERT_CHOICE_LABELS, {
    bell_push_email: 'Bell, push and email', bell_push: 'Bell and push',
    bell_email: 'Bell and email', bell: 'Bell only', off: 'Off',
  });
  assert.ok(prefs.choiceHasEmail('bell_email') && !prefs.choiceHasEmail('bell_push'));
  assert.ok(prefs.choiceHasPush('bell_push_email') && !prefs.choiceHasPush('bell'));
});
await check('4 bill updates say federal, and nothing promises state bills', () => {
  const bills = prefs.ALERT_ROWS.find((r) => r.key === 'bills');
  assert.match(bills.hint, /Federal/);
  const copy = JSON.stringify(prefs.ALERT_ROWS) + JSON.stringify(prefs.CHANNEL_SCHEMA);
  assert.doesNotMatch(copy, /state bill/i);
});

const links = await load('lib/deepLinks.js');
await check('3 each kind opens the right place', () => {
  assert.equal(links.notificationLink('tracked_post', { official_id: 'X1', post_id: 9 }), '/?page=X1#post-9');
  assert.equal(links.notificationLink('tracked_event', { official_id: 'X1', event_id: 3 }), '/?page=X1');
  assert.equal(links.notificationLink('reply', { official_id: 'X1', post_id: 9 }), '/?page=X1#post-9');
  assert.equal(links.notificationLink('reply', { official_id: 'X1', poll_id: 4 }), '/?page=X1#poll-4');
  assert.equal(links.notificationLink('poll_results', { official_id: 'X1', poll_id: 4, post_id: 9 }), '/?page=X1#post-9');
  assert.equal(links.notificationLink('poll_results', { official_id: 'X1', poll_id: 4 }), '/?page=X1#poll-4');
  assert.equal(links.notificationLink('poll_results', { official_id: '', poll_id: 4 }), '/polls');
  assert.equal(links.notificationLink('bill_update', { bill_key: '119-hr-1' }), '/?open=tracked');
  assert.equal(links.notificationLink('page_change', { official_id: 'X1' }), '/?page=X1');
  assert.equal(links.notificationLink('page_changes', { count: 3 }), '/?open=notifications');
  assert.equal(links.notificationLink('tracked_summary', {}), '/?open=notifications');
  assert.equal(links.notificationLink('tracked_summary', { official_id: 'X1' }), '/?page=X1');
  assert.equal(links.notificationLink('election_reminder', { state: 'FL' }), '/?state=FL');
  assert.equal(links.notificationLink('test', {}), null);
});
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
let osEnabled = true;
let settingsOpened = 0;
const channelsMade = [];
globalThis.window = {
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: {
      App: { getInfo: async () => ({ build: '5', version: '1.2.0' }), addListener: () => {} },
      NotificationSettings: {
        getStatus: async () => ({ enabled: osEnabled, blockedChannels: osEnabled ? [] : ['bills'] }),
        openSettings: async () => { settingsOpened += 1; },
      },
      PushNotifications: {
        createChannel: async (c) => { channelsMade.push(c); },
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
await check('5 a register says the app build and that Android lets it notify', async () => {
  posts.length = 0;
  await push.enablePush();
  const reg = posts.filter((p) => p.url.endsWith('/api/push/register')).pop();
  assert.equal(reg.body.app_build, 5);
  assert.equal(reg.body.os_enabled, true);
});
await check('5 the channels match the app and the server, all private on the lock screen', () => {
  // android/.../NotificationChannels.java and backend push_service.CHANNELS
  assert.deepEqual(push.CHANNELS.map((c) => c.id),
    ['officials', 'events', 'replies', 'bills', 'poll_results', 'elections', 'page_changes', 'summaries']);
  assert.equal(channelsMade.length, push.CHANNELS.length);
  assert.ok(channelsMade.every((c) => c.visibility === 0));
  const byId = Object.fromEntries(push.CHANNELS.map((c) => [c.id, c.importance]));
  assert.equal(byId.replies, 4);
  assert.equal(byId.elections, 4);
  assert.equal(byId.page_changes, 2);
  assert.doesNotMatch(JSON.stringify(push.CHANNELS), /state bill/i);
});
await check('5 notifications off in Android settings: the server hears it on resume', async () => {
  posts.length = 0;
  await push.refreshOsStatus();
  osEnabled = false;
  const status = await push.refreshOsStatus();
  assert.equal(status.enabled, false);
  assert.deepEqual(status.blockedChannels, ['bills']);
  const reg = posts.filter((p) => p.url.endsWith('/api/push/register')).pop();
  assert.ok(reg, 'no register');
  assert.equal(reg.body.os_enabled, false);
  assert.equal(await push.openNotificationSettings(), true);
  assert.equal(settingsOpened, 1);
  osEnabled = true;
  await push.refreshOsStatus();
});
await check('5 the card: first offer anywhere, one more only on a track 30 days later', () => {
  store.delete('cv:push:choice');
  store.delete('cv:push:declined_at');
  store.delete('cv:push:declines');
  assert.equal(push.shouldOfferPush('signin'), true);
  const t0 = Date.UTC(2026, 9, 17);
  push.declinePushOffer(t0);
  const day = 24 * 3600 * 1000;
  assert.equal(push.shouldOfferPush('signin', t0 + 40 * day), false, 'never at launch or sign-in');
  assert.equal(push.shouldOfferPush('track', t0 + 29 * day), false, 'not before 30 days');
  assert.equal(push.shouldOfferPush('track', t0 + 30 * day), true);
  push.declinePushOffer(t0 + 30 * day);
  assert.equal(push.shouldOfferPush('track', t0 + 400 * day), false, 'a second Not now ends it');
});

const text = [JSON.stringify(prefs.CHANNEL_SCHEMA), JSON.stringify(prefs.ALERT_ROWS),
  JSON.stringify(prefs.ALERT_CHOICE_LABELS), JSON.stringify(prefs.DIGEST_ROW), JSON.stringify(push.CHANNELS)].join('\n');
await check('copy has no em or en dashes', () => {
  assert.ok(!/[\u2013\u2014]/.test(text));
});

writeFileSync(path.join(out, 'done'), '');
if (failures) {
  console.log(`\nFAILED (${failures})`);
  process.exit(1);
}
console.log('\nALL PASSED');
