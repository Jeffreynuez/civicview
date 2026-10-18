// CivicView — service worker.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Deliberately MINIMAL: desktop-PWA installability and, since
// 2026-10-18, web push. There is NO fetch handler on purpose:
// intercepting requests means owning a cache-invalidation strategy for
// a Next.js app whose hashed chunks change every deploy: a stale-cache
// bug factory with near-zero payoff while the app is online-first.
//
// Web push (browsers, the iPhone Home Screen app, the Windows app; the
// Android app has FCM and never registers this worker):
//   push               shows the notification the server built
//                      (backend services/web_push.py payload_for): the
//                      same title and body as the phone, which by
//                      default is only the general line ("New update
//                      from an official you track"), the CivicView
//                      icon, and the link the tap opens. EVERY push
//                      shows a notification, even one that can't be
//                      read: iOS revokes the permission of a site that
//                      receives a push and shows nothing. A newer push
//                      with the same tag replaces the older one; once 3
//                      or more from one channel are on screen they
//                      become one count notification ("3 updates from
//                      officials you track"), like the app's groups.
//                      The installed app's badge shows the unread count.
//   notificationclick  focuses an open CivicView window and hands it
//                      the link (lib/push.js marks the bell row read and
//                      navigates), or opens one.

self.addEventListener('install', () => {
  // Activate updated workers immediately — with no fetch handler there
  // is no cached state to migrate, so skipping the wait is safe.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Where a tap opens ────────────────────────────────────────────────
// A copy of lib/deepLinks.js (notificationLink, postDeepLink,
// pollDeepLink), which this worker can't import. scripts/
// test-notifications.mjs checks the two give the same link for every
// kind.

function postDeepLink(officialId, postId) {
  if (!officialId) return null;
  let url = '/?page=' + encodeURIComponent(String(officialId));
  if (postId !== undefined && postId !== null && postId !== '') {
    url += '#post-' + encodeURIComponent(String(postId));
  }
  return url;
}

function pollDeepLink(officialId, pollId, postId) {
  if (postId !== undefined && postId !== null && postId !== '') return postDeepLink(officialId, postId);
  if (!officialId) return '/polls';
  return '/?page=' + encodeURIComponent(String(officialId))
    + (pollId ? '#poll-' + encodeURIComponent(String(pollId)) : '');
}

function notificationLink(kind, payload) {
  const p = payload || {};
  switch (kind) {
    case 'reply':
      return p.poll_id ? pollDeepLink(p.official_id, p.poll_id) : postDeepLink(p.official_id, p.post_id);
    case 'poll_results':
      return pollDeepLink(p.official_id, p.poll_id, p.post_id);
    case 'bill_update':
      return '/?open=tracked';
    case 'page_changes':
    case 'tracked_summary':
      return p.official_id ? postDeepLink(p.official_id) : '/?open=notifications';
    case 'election_reminder':
      return /^[A-Z]{2}$/.test(String(p.state || '')) ? '/?state=' + encodeURIComponent(String(p.state)) : null;
    default:
      return postDeepLink(p.official_id, kind === 'tracked_post' ? p.post_id : null);
  }
}

// ── Showing a push ───────────────────────────────────────────────────

const ICON = '/logo/pwa-icon-192.png';
const FALLBACK_TITLE = 'New updates in CivicView';
const GROUP_AT = 3;

function readPayload(event) {
  try {
    const p = event.data ? event.data.json() : null;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function notificationFor(p) {
  const data = p.data && typeof p.data === 'object' ? p.data : {};
  const channel = typeof p.channel === 'string' ? p.channel : 'officials';
  const options = {
    body: typeof p.body === 'string' ? p.body : '',
    icon: ICON,
    data: {
      channel,
      group: typeof p.group === 'string' ? p.group : '',
      details: !!p.details,
      notification_id: data.notification_id || null,
      url: notificationLink(data.kind, data) || '/',
    },
  };
  if (typeof p.tag === 'string' && p.tag) {
    options.tag = p.tag;
    options.renotify = true; // a replacement still alerts
  }
  const title = typeof p.title === 'string' && p.title ? p.title : FALLBACK_TITLE;
  return { title, options };
}

/**
 * After showing one: when 3 or more of its channel are on screen, fold
 * them into one count notification that opens the bell. Its line names
 * nobody; with details shown, its body lists the latest titles.
 */
async function groupChannel(reg, channel) {
  const shown = await reg.getNotifications();
  const same = shown.filter((n) => n.data && n.data.channel === channel && !n.data.isGroup);
  const group = shown.find((n) => n.data && n.data.isGroup && n.data.channel === channel);
  const before = group ? group.data.count || 0 : 0;
  if (!same.length || (!group && same.length < GROUP_AT)) return;
  const count = before + same.length;
  const line = (same[0].data.group || '{n} new updates').replace('{n}', String(count));
  const details = same.some((n) => n.data.details);
  await reg.showNotification(line, {
    body: details ? same.map((n) => n.title).slice(-3).reverse().join('\n') : '',
    icon: ICON,
    tag: 'group-' + channel,
    renotify: true,
    data: { channel, isGroup: true, count, url: '/?open=notifications', notification_id: null },
  });
  same.forEach((n) => n.close());
}

async function onPush(event) {
  const p = readPayload(event);
  const { title, options } = notificationFor(p);
  const reg = self.registration;
  // Shown first, whatever happens next.
  await reg.showNotification(title, options);
  try { await groupChannel(reg, options.data.channel); } catch { /* the single one stays */ }
  try {
    if (Number.isInteger(p.badge) && self.navigator && typeof self.navigator.setAppBadge === 'function') {
      await (p.badge > 0 ? self.navigator.setAppBadge(p.badge) : self.navigator.clearAppBadge());
    }
  } catch { /* no badge support */ }
  try {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((w) => w.postMessage({ type: 'cv:push-received' }));
  } catch { /* nobody to tell */ }
}

// One push at a time: several arriving together (a run of posts, a
// summary) would otherwise each count the same notifications and fold
// them twice. Each still shows its notification before its turn ends.
let queue = Promise.resolve();
function inTurn(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

self.addEventListener('push', (event) => {
  event.waitUntil(inTurn(() => onPush(event))
    .catch(() => self.registration.showNotification(FALLBACK_TITLE, { icon: ICON })));
});

// ── The tap ──────────────────────────────────────────────────────────

async function onClick(notification) {
  const d = notification.data || {};
  const url = typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/';
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const mine = windows.filter((w) => new URL(w.url).origin === self.location.origin);
  const target = mine.find((w) => w.focused) || mine.find((w) => w.visibilityState === 'visible') || mine[0];
  if (target) {
    // The link first: a browser that refuses focus() still opens it.
    target.postMessage({ type: 'cv:push-tap', url, notification_id: d.notification_id || null });
    try { await target.focus(); } catch { /* it opens in the background */ }
    return;
  }
  const open = new URL(url, self.location.origin);
  if (d.notification_id) open.searchParams.set('cv_read', String(d.notification_id));
  await self.clients.openWindow(open.pathname + open.search + open.hash);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(onClick(event.notification));
});

// A push service that rotates a subscription: make the new one now; the
// page registers it with the server the next time CivicView opens
// (lib/webPush.js refreshWebPush), and the old endpoint is removed when
// its push service answers 410. A worker has no session to register it
// itself, so until then this browser gets no pushes (the runbook's Web
// push, Known gap).
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (!options) return;
  event.waitUntil(self.registration.pushManager.subscribe(options).catch(() => {}));
});
