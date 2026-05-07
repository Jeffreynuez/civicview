// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Browser notification permission helper.
 *
 * Rule: NEVER request browser notification permission on page load
 * or as a side effect of any background flow. Always request as a
 * direct response to a user-intent action — clicking "Follow rep",
 * "Track election", etc. The first request is the only one the
 * browser will honor; if we burn it on a vague on-load ask, the
 * user has to dig into site settings to undo it. Browsers also
 * actively penalize sites that prompt without intent.
 *
 * Usage in an intent handler:
 *
 *   import { requestNotificationPermissionFromIntent } from '@/lib/notificationPermission';
 *
 *   const handleFollow = async () => {
 *     // …toggle the follow store as usual…
 *     // Only ASK if the user hasn't decided yet — never re-prompt
 *     // people who've explicitly allowed or denied.
 *     const perm = await requestNotificationPermissionFromIntent({
 *       reason: 'follow-rep',
 *     });
 *     if (perm === 'granted') {
 *       // wire push subscription
 *     }
 *   };
 *
 * Returns:
 *   'granted' | 'denied' | 'default' | 'unsupported'
 *   - granted/denied: the user's persistent choice
 *   - default:        user dismissed the prompt — try again next intent
 *   - unsupported:    server-render or browsers without the API
 */
export async function requestNotificationPermissionFromIntent({ reason } = {}) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  // Permission is 'default' — the user hasn't chosen yet. We're inside
  // an intent handler, so this prompt is appropriate. We ignore the
  // legacy callback signature and use the Promise API.
  try {
    const result = await Notification.requestPermission();
    if (typeof console !== 'undefined' && reason) {
      // Diagnostic: leaves a breadcrumb so we can correlate prompt
      // outcomes with the intent that triggered them. Reason should
      // be a short slug like 'follow-rep' or 'track-election'.
      console.info(`[notif-permission] ${reason}: ${result}`);
    }
    return result;
  } catch {
    return 'unsupported';
  }
}

/**
 * Pure read of the current permission — does NOT trigger a prompt.
 * Safe to call from any render path. Use this to decide whether to
 * show "browser notifications enabled" badges, prompt strategy
 * banners, etc.
 */
export function getNotificationPermission() {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission; // 'granted' | 'denied' | 'default'
}
