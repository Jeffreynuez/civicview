// CivicView — service worker.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Deliberately MINIMAL (desktop-PWA installability + future Web Push
// foundation). There is NO fetch handler on purpose: intercepting
// requests means owning a cache-invalidation strategy for a Next.js
// app whose hashed chunks change every deploy — a stale-cache bug
// factory with near-zero payoff while the app is online-first.
// When browser push ships (the bell panel's "Desktop notifications —
// Planned" row), its push/notificationclick handlers land here.

self.addEventListener('install', () => {
  // Activate updated workers immediately — with no fetch handler there
  // is no cached state to migrate, so skipping the wait is safe.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
