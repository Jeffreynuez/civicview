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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
await check('5 the channels match the app and the server', () => {
  // android/.../NotificationChannels.java and backend push_service.CHANNELS
  assert.deepEqual(push.CHANNELS.map((c) => c.id),
    ['officials', 'events', 'replies', 'bills', 'poll_results', 'elections', 'page_changes', 'summaries']);
  assert.equal(channelsMade.length, push.CHANNELS.length);
  // Android ignores an app's own lock-screen visibility; the server
  // keeps the text neutral instead (push_service.shown).
  assert.ok(channelsMade.every((c) => c.visibility === undefined));
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
await check('5 the Android app never offers the card at launch, as before web push', () => {
  // A first launch, signed out: no choice stored yet.
  store.delete('cv:push:choice');
  store.delete('cv:push:declined_at');
  store.delete('cv:push:declines');
  assert.equal(push.shouldOfferPush('launch'), false, 'no card at launch in the app');
  assert.equal(push.shouldOfferPush('signin'), true, 'sign-in still offers it');
  assert.equal(push.shouldOfferPush('track'), true, 'a track still offers it');
  push.declinePushOffer(Date.UTC(2026, 9, 17));
  assert.equal(push.shouldOfferPush('launch', Date.UTC(2027, 0, 1)), false);
  store.delete('cv:push:choice');
  store.delete('cv:push:declined_at');
  store.delete('cv:push:declines');
});

// ── 6. Web push (2026-10-18): public/sw.js and lib/webPush.js ────────
const swSource = readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
function loadWorker() {
  const handlers = {};
  const shown = [];
  const badges = [];
  const windows = [];
  const opened = [];
  const note = (title, options) => {
    const n = { title, ...options, data: options.data || {}, closed: false };
    n.close = () => { n.closed = true; };
    return n;
  };
  const fakeSelf = {
    addEventListener: (name, fn) => { handlers[name] = fn; },
    skipWaiting() {},
    location: { origin: 'https://civicview.app' },
    navigator: {
      setAppBadge: async (n) => { badges.push(n); },
      clearAppBadge: async () => { badges.push(0); },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); },
    },
    registration: {
      showNotification: async (title, options = {}) => {
        if (options.tag) shown.filter((n) => n.tag === options.tag).forEach((n) => n.close());
        shown.push(note(title, options));
      },
      getNotifications: async () => shown.filter((n) => !n.closed),
    },
  };
  const exports = new Function('self', swSource + '\nreturn { notificationLink };')(fakeSelf);
  async function fire(name, event) {
    const waits = [];
    handlers[name]({ ...event, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }
  const push = (payload) => fire('push', {
    data: { json: () => { if (payload === undefined) throw new Error('not JSON'); return payload; } },
  });
  return { exports, shown, badges, windows, opened, fire, push };
}

await check('6 the worker opens the same link as the bell for every kind', () => {
  const sw = loadWorker().exports;
  const cases = [
    ['tracked_post', { official_id: 'X1', post_id: 9 }],
    ['tracked_event', { official_id: 'X1', event_id: 3 }],
    ['reply', { official_id: 'X1', post_id: 9 }],
    ['reply', { official_id: 'X1', poll_id: 4 }],
    ['poll_results', { official_id: 'X1', poll_id: 4, post_id: 9 }],
    ['poll_results', { official_id: 'X1', poll_id: 4 }],
    ['poll_results', { official_id: '', poll_id: 4 }],
    ['bill_update', { bill_key: '119-hr-1' }],
    ['page_change', { official_id: 'X1' }],
    ['page_changes', { count: 3 }],
    ['tracked_summary', {}],
    ['tracked_summary', { official_id: 'X1' }],
    ['election_reminder', { state: 'FL' }],
    ['election_reminder', { state: 'florida' }],
    ['test', {}],
    ['tracked_post', { official_id: 'a b/c', post_id: '7' }],
  ];
  for (const [kind, p] of cases) {
    assert.equal(sw.notificationLink(kind, p), links.notificationLink(kind, p), `${kind} ${JSON.stringify(p)}`);
  }
});
await check('6 every push shows a notification, even one that cannot be read', async () => {
  const w = loadWorker();
  await w.push(undefined);
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0].title, 'New updates in CivicView');
});
await check('6 a push shows the server text, the icon, the link and the badge', async () => {
  const w = loadWorker();
  w.windows.push({ url: 'https://civicview.app/', postMessage: (m) => { w.windows.msgs = (w.windows.msgs || []).concat(m); } });
  await w.push({
    v: 1, title: 'New update from an official you track', body: '', channel: 'officials',
    group: '{n} updates from officials you track', details: false, badge: 3,
    data: { kind: 'tracked_post', official_id: 'X1', post_id: 9, notification_id: 7 },
  });
  const n = w.shown[0];
  assert.equal(n.title, 'New update from an official you track');
  assert.equal(n.body, '');
  assert.equal(n.icon, '/logo/pwa-icon-192.png');
  assert.equal(n.data.url, '/?page=X1#post-9');
  assert.equal(n.data.notification_id, 7);
  assert.deepEqual(w.badges, [3]);
  assert.deepEqual(w.windows.msgs, [{ type: 'cv:push-received' }], 'an open window refreshes its bell');
});
await check('6 a tag replaces the older one; 3 of a channel become one count line', async () => {
  const w = loadWorker();
  const ev = { title: 'New event from an official you track', channel: 'events',
    group: '{n} events from officials you track', tag: 'event-5', data: { kind: 'tracked_event', official_id: 'X1' } };
  await w.push(ev);
  await w.push(ev);
  assert.equal(w.shown.filter((n) => !n.closed).length, 1, 'the same tag replaced');
  const post = (i) => ({ title: 'New update from an official you track', channel: 'officials',
    group: '{n} updates from officials you track', data: { kind: 'tracked_post', official_id: 'X1', post_id: i } });
  await w.push(post(1));
  await w.push(post(2));
  let open = w.shown.filter((n) => !n.closed && n.data.channel === 'officials');
  assert.equal(open.length, 2, 'two stay separate');
  await w.push(post(3));
  open = w.shown.filter((n) => !n.closed && n.data.channel === 'officials');
  assert.equal(open.length, 1);
  assert.equal(open[0].title, '3 updates from officials you track');
  assert.equal(open[0].body, '', 'details hidden: names nobody');
  assert.equal(open[0].data.url, '/?open=notifications');
  await w.push(post(4));
  open = w.shown.filter((n) => !n.closed && n.data.channel === 'officials');
  assert.equal(open.length, 1);
  assert.equal(open[0].title, '4 updates from officials you track');
});
await check('6 a tap focuses an open window and hands it the link, or opens one', async () => {
  const w = loadWorker();
  const msgs = [];
  let focused = 0;
  const target = { url: 'https://civicview.app/bills', focused: false, visibilityState: 'visible',
    focus: async () => { focused += 1; }, postMessage: (m) => msgs.push(m) };
  w.windows.push(target);
  const n = { data: { url: '/?page=X1#post-9', notification_id: 7 }, close() { this.closed = true; } };
  await w.fire('notificationclick', { notification: n });
  assert.ok(n.closed);
  assert.equal(focused, 1);
  assert.deepEqual(msgs, [{ type: 'cv:push-tap', url: '/?page=X1#post-9', notification_id: 7 }]);
  w.windows.length = 0;
  await w.fire('notificationclick', { notification: { ...n, close() {} } });
  assert.deepEqual(w.opened, ['/?page=X1&cv_read=7#post-9']);
});

// lib/webPush.js and lib/push.js in a browser (no Capacitor).
const nav = { userAgent: '', maxTouchPoints: 0, serviceWorker: {}, standalone: undefined };
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
let displayStandalone = false;
globalThis.window = {
  localStorage: globalThis.window.localStorage,
  PushManager: function PushManager() {},
  matchMedia: () => ({ matches: displayStandalone }),
  navigator: nav,
  location: { href: 'https://civicview.app/', assign: () => {} },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.Notification = { permission: 'default' };
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const IPHONE = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`;
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const webOff = await load('lib/webPush.js');
await check('6 web push stays off until the public key is set', () => {
  nav.userAgent = DESKTOP;
  assert.equal(webOff.webPushStatus(), 'unconfigured');
});
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'BPublicKeyForTheTestOnlyNotARealKey000000000000000000000000000000000000000000000000000';
const webOn = await import(pathToFileURL(await (async () => {
  const file = path.join(out, 'webPush-on.mjs');
  await build({ entryPoints: [path.join(root, 'lib/webPush.js')], bundle: true, format: 'esm', platform: 'node',
    outfile: file, alias: { '@': root }, logLevel: 'silent' });
  return file;
})()).href);
await check('6 desktop browsers are ready; iPhone needs the Home Screen; old iOS is told so', () => {
  nav.userAgent = DESKTOP;
  assert.equal(webOn.webPushStatus(), 'ready');
  nav.userAgent = IPHONE('17_2');
  assert.equal(webOn.isIos(), true);
  assert.equal(webOn.webPushStatus(), 'ios_home_screen');
  nav.userAgent = IPHONE('16_3');
  assert.equal(webOn.webPushStatus(), 'ios_old');
  nav.userAgent = IPHONE('16_4');
  displayStandalone = true;
  assert.equal(webOn.webPushStatus(), 'ready', 'the Home Screen app on 16.4');
  displayStandalone = false;
  nav.userAgent = IPAD_DESKTOP;
  nav.maxTouchPoints = 5;
  assert.equal(webOn.isIos(), true, 'an iPad asking for the desktop site');
  assert.equal(webOn.webPushStatus(), 'ios_home_screen');
  nav.maxTouchPoints = 0;
  assert.equal(webOn.isIos(), false, 'a Mac');
  assert.equal(webOn.webPushStatus(), 'ready');
});
await check('6 the app badge is set only in an installed app', () => {
  const calls = [];
  nav.setAppBadge = async (n) => { calls.push(n); };
  nav.clearAppBadge = async () => { calls.push(0); };
  displayStandalone = false;
  webOn.setAppBadgeCount(4);
  assert.deepEqual(calls, [], 'a tab: no badge');
  displayStandalone = true;
  webOn.setAppBadgeCount(4);
  webOn.setAppBadgeCount(0);
  assert.deepEqual(calls, [4, 0]);
  displayStandalone = false;
});
await check('6 the card in a browser: after a track only, never at sign-in, never when blocked', () => {
  store.delete('cv:push:choice');
  store.delete('cv:push:declines');
  store.delete('cv:push:declined_at');
  nav.userAgent = DESKTOP;
  assert.equal(push.isNativeApp(), false);
  // The push.js bundle was built before the key was set: it reads the
  // status through its own copy of webPush.js, which is 'unconfigured'.
  assert.equal(push.shouldOfferPush('track'), false, 'web push off: no card');
});
const pushWeb = await import(pathToFileURL(await (async () => {
  const file = path.join(out, 'push-web.mjs');
  await build({ entryPoints: [path.join(root, 'lib/push.js')], bundle: true, format: 'esm', platform: 'node',
    outfile: file, alias: { '@': root }, logLevel: 'silent' });
  return file;
})()).href);
await check('6 the card in a browser, web push on', () => {
  store.delete('cv:push:choice');
  nav.userAgent = DESKTOP;
  globalThis.Notification.permission = 'default';
  assert.equal(pushWeb.shouldOfferPush('signin'), false, 'never at sign-in in a browser');
  assert.equal(pushWeb.shouldOfferPush('launch'), false, 'never at launch on a desktop');
  assert.equal(pushWeb.shouldOfferPush('track'), true, 'after a track');
  globalThis.Notification.permission = 'denied';
  assert.equal(pushWeb.shouldOfferPush('track'), false, 'blocked: no card');
  globalThis.Notification.permission = 'default';
  nav.userAgent = IPHONE('17_2');
  assert.equal(pushWeb.shouldOfferPush('track'), true, 'Safari on iPhone: the card, whose Enable shows the guide');
  displayStandalone = true;
  assert.equal(pushWeb.shouldOfferPush('launch'), true, 'the Home Screen app, opened with no choice yet');
  store.set('cv:push:choice', 'declined');
  assert.equal(pushWeb.shouldOfferPush('launch'), false);
  displayStandalone = false;
  store.delete('cv:push:choice');
});
await check('6 Turn on in Safari on iPhone asks for nothing and says to add it to the Home Screen', async () => {
  nav.userAgent = IPHONE('17_2');
  let asked = 0;
  globalThis.Notification.requestPermission = async () => { asked += 1; return 'granted'; };
  const r = await pushWeb.enablePush();
  assert.deepEqual(r, { ok: false, reason: 'ios_home_screen' });
  assert.equal(asked, 0);
  nav.userAgent = DESKTOP;
});
await check('6 Turn off while the launch refresh is still registering: the unregister comes last', async () => {
  nav.userAgent = DESKTOP;
  globalThis.Notification.permission = 'granted';
  store.set('cv:push:choice', 'enabled');
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/race',
    toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => { current = null; return true; },
  };
  let current = sub;
  const reg = { pushManager: { getSubscription: async () => current, subscribe: async () => (current = sub) } };
  nav.serviceWorker = { register: async () => reg, ready: Promise.resolve(reg) };
  const order = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/api/csrf')) return realFetch(url, opts);
    // The server takes its time over the register, as on a slow network.
    if (u.endsWith('/api/push/web/register')) await new Promise((r) => setTimeout(r, 50));
    order.push(u.split('/api/push/web/')[1]);
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const refreshing = webOn.refreshWebPush();
    const off = webOn.disableWebPush();
    await Promise.all([refreshing, off]);
    assert.deepEqual(order, ['register', 'unregister']);
    assert.equal(webOn.savedWebPushEndpoint(), null, 'nothing left registered here');
    assert.equal(store.get('cv:push:choice'), 'declined');
  } finally {
    globalThis.fetch = realFetch;
    store.delete('cv:push:choice');
    globalThis.Notification.permission = 'default';
    nav.serviceWorker = {};
  }
});
await check('6 the guide and the tour say what the browser does, in 30 words, no dashes', async () => {
  const g = webOn;
  const all = [g.HOME_SCREEN_GUIDE.title, g.HOME_SCREEN_GUIDE.intro, ...g.HOME_SCREEN_GUIDE.steps, g.HOME_SCREEN_GUIDE.tooOld];
  assert.ok(!/[–—]/.test(all.join(' ')));
  assert.equal(g.HOME_SCREEN_GUIDE.title, 'Add CivicView to your Home Screen to get alerts');
  const step = notifTopic.steps.find((s) => s.id === 'notifications-phone');
  assert.match(step.body, /Android app/);
  assert.match(step.body, /iPhone \(from the Home Screen\)/);
  assert.match(step.body, /desktop browsers/);
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
