// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Open the notification bell from anywhere (2026-10-16). Used by the
 * /?open=notifications deep link that a summary push opens. A request
 * made before the bell has mounted is kept until it does.
 */
let pending = false;

export function requestNotificationsOpen() {
  pending = true;
  try { window.dispatchEvent(new CustomEvent('cv:open-notifications')); } catch { /* SSR */ }
}

/** True once per request; the bell calls this on mount and on the event. */
export function takeNotificationsOpenRequest() {
  const was = pending;
  pending = false;
  return was;
}
