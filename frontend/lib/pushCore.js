'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// What the app's push (lib/push.js, FCM) and the browser's (lib/webPush.js,
// 2026-10-18) share: whether this is the Android app, and the push choice
// saved in this browser or app. Its own module so the two can both use it
// without importing each other. lib/push.js re-exports all of it, so
// existing imports from './push' keep working.

const CHOICE_KEY = 'cv:push:choice'; // 'enabled' | 'declined' | 'denied'
// "Not now" on the opt-in card (2026-10-17): when, and how many times.
// The card comes back once, in context (the next track), at least
// REOFFER_DAYS later, never at launch; a second "Not now" ends it.
const DECLINED_AT_KEY = 'cv:push:declined_at';
const DECLINES_KEY = 'cv:push:declines';
export const REOFFER_DAYS = 30;

export function isNativeApp() {
  try {
    return !!(typeof window !== 'undefined'
      && window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  } catch { return false; }
}

export function getPushChoice() {
  try { return window.localStorage.getItem(CHOICE_KEY); } catch { return null; }
}

export function setPushChoice(value) {
  try {
    if (value === null) window.localStorage.removeItem(CHOICE_KEY);
    else window.localStorage.setItem(CHOICE_KEY, value);
  } catch { /* private mode */ }
}

export function readNumber(key) {
  try { return Number(window.localStorage.getItem(key) || 0) || 0; } catch { return 0; }
}

/** "Not now" on the card: record when, and that it was said once more. */
export function declinePushOffer(now = Date.now()) {
  setPushChoice('declined');
  try {
    window.localStorage.setItem(DECLINED_AT_KEY, String(now));
    window.localStorage.setItem(DECLINES_KEY, String(readNumber(DECLINES_KEY) + 1));
  } catch { /* private mode */ }
}

/**
 * The offer rule both use once a first offer has been made: after one
 * "Not now", only a track at least REOFFER_DAYS later brings the card
 * back, once; after a second "Not now", or once push is on or the
 * permission was refused, never.
 */
export function reofferAllowed(context, now = Date.now()) {
  const choice = getPushChoice();
  if (!choice) return true;
  if (choice !== 'declined' || context !== 'track') return false;
  if (readNumber(DECLINES_KEY) >= 2) return false;
  const at = readNumber(DECLINED_AT_KEY);
  return !!at && now - at >= REOFFER_DAYS * 24 * 3600 * 1000;
}
