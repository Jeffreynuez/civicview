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
 * A poll (2026-10-17): a post's poll opens its post; a citizen poll
 * opens its page at '#poll-<id>' (PageView scrolls to and pulses the
 * card); a standalone poll, which has no page, opens the Polls feed.
 */
export function pollDeepLink(officialId, pollId, postId) {
  if (postId !== undefined && postId !== null && postId !== '') return postDeepLink(officialId, postId);
  if (!officialId) return '/polls';
  return '/?page=' + encodeURIComponent(String(officialId))
    + (pollId ? '#poll-' + encodeURIComponent(String(pollId)) : '');
}

/**
 * Where a notification opens, by kind (2026-10-17). The bell, the
 * activity archive and the push tap all use this, so they agree.
 * payload: the bell row's payload, or a push's data.
 */
export function notificationLink(kind, payload) {
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
    case 'moderation_hidden':
      // The list of hidden items with Appeal (2026-10-26): a rep's or
      // candidate's page Dashboard, or the citizen dashboard's Account
      // & settings tab, where the citizen list lives.
      return p.page_id
        ? '/?page=' + encodeURIComponent(String(p.page_id)) + '#moderation'
        : '/?open=settings#moderation';
    default:
      return postDeepLink(p.official_id, kind === 'tracked_post' ? p.post_id : null);
  }
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
