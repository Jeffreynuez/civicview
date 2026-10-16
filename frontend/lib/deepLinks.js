// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * One deep link for a post (2026-10-16): '/?page=<official>#post-<id>'.
 * The push tap, the bell and the dashboard's activity archive all use
 * it. app/page.js opens ?page= on load, and PageView scrolls to and
 * pulses the #post- hash, also when only the hash changes on a page
 * that is already open. Until 2026-10-16 the bell and the archive
 * pushed ?open_page=, which nothing read.
 */
export function postDeepLink(officialId, postId) {
  if (!officialId) return null;
  let url = '/?page=' + encodeURIComponent(String(officialId));
  if (postId !== undefined && postId !== null && postId !== '') {
    url += '#post-' + encodeURIComponent(String(postId));
  }
  return url;
}

/**
 * Go there. Full navigation, like the push tap: on the same page only
 * the hash changes (no reload) and PageView reacts to it; anywhere else
 * the target page loads cleanly.
 */
export function openDeepLink(url) {
  if (!url || typeof window === 'undefined') return;
  try {
    const target = new URL(url, window.location.href);
    const here = window.location;
    if (target.pathname === here.pathname && target.search === here.search
        && target.hash && target.hash === here.hash) {
      // Same post again: the browser fires no hashchange, so nudge
      // PageView to scroll and pulse it once more.
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      return;
    }
    window.location.assign(target.href);
  } catch { /* ignore */ }
}
