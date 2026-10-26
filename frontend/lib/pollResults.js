// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * How a poll's results are shown, from the author's result setting
 * (2026-10-20). Used by the feed card (components/polls/FeedCard.js)
 * and the Explore results window (components/polls/PollResultsModal.js)
 * so they behave like the page's PollCard. Tested by
 * scripts/test-feed-filters.mjs.
 *
 *   'withheld'   the poll shows results only after it closes and it is
 *                still open: the server sent no counts
 *                (counts_suppressed), so there is nothing to show.
 *   'on_request' the author chose "hidden": the counts are behind the
 *                same "Show results" control the page uses.
 *   'full'       results show right away.
 */
import { serverDate } from './serverTime';

export function pollResultsView(poll) {
  if (!poll) return 'full';
  if (poll.counts_suppressed) return 'withheld';
  if ((poll.presentation_mode || 'full') === 'hidden') return 'on_request';
  return 'full';
}

// The wording PollCard uses while results are held until the poll closes.
export const RESULTS_HIDDEN_TITLE = 'Results hidden until the poll closes.';
export const RESULTS_HIDDEN_SHORT = 'Results hidden until close';

export function resultsHiddenUntil(closesAt) {
  if (!closesAt) return '';
  const d = serverDate(closesAt);
  if (Number.isNaN(d.getTime())) return '';
  return `You'll see them after ${d.toLocaleString()}.`;
}
