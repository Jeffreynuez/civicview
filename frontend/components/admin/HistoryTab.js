'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Admin History tab (2026-10-26): every recorded admin action, newest
 * first, from GET /api/admin/actions. Who did it, what, to which item or
 * account, why, and when. Read only; nothing here changes anything.
 *
 * Before this tab the only trace of most admin actions was a server log
 * line (admin audit 2026-10-25, finding M5).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { adminListActions } from '@/lib/pagesApi';
import { serverDate, serverMs } from '@/lib/serverTime';

const PAGE = 100;

// action -> [label, group]. Groups drive the filter chips.
const ACTIONS = {
  report_dismiss: ['Dismissed a report', 'content'],
  content_hide: ['Hid content', 'content'],
  content_keep_hidden: ['Kept content hidden', 'content'],
  content_unhide: ['Unhid content', 'content'],
  user_suspend: ['Suspended an account', 'accounts'],
  user_unsuspend: ['Unsuspended an account', 'accounts'],
  lockout_unlock: ['Unlocked an account', 'accounts'],
  twofa_reset: ['Reset 2FA', 'accounts'],
  appeal_grant: ['Granted an appeal', 'appeals'],
  appeal_deny: ['Denied an appeal', 'appeals'],
  transition_set: ['Set a page transition', 'transitions'],
  transition_handoff: ['Approved a hand-off', 'transitions'],
  name_review: ['Decided a name review', 'transitions'],
  lifecycle_run: ['Ran the daily transitions job', 'jobs'],
  election_reminders_run: ['Ran election reminders', 'jobs'],
  bill_updates_run: ['Ran bill updates', 'jobs'],
};

const GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'content', label: 'Content' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'appeals', label: 'Appeals' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'jobs', label: 'Jobs' },
];

const TARGET_LABEL = {
  post: 'Post',
  post_comment: 'Comment',
  poll: 'Poll',
  poll_comment: 'Poll comment',
  rep: 'Rep',
  citizen: 'Citizen',
  candidate: 'Candidate',
  page: 'Page',
  suspension_rep: 'Rep suspension',
  suspension_citizen: 'Citizen suspension',
};

function when(iso) {
  const d = serverDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function detailText(details) {
  if (!details) return '';
  const parts = [];
  if (details.report_id) parts.push(`report #${details.report_id}`);
  if (typeof details.reports_closed === 'number') parts.push(`${details.reports_closed} report(s) closed`);
  if (details.appeal_id) parts.push(`appeal #${details.appeal_id}`);
  if (details.suspended_reason) parts.push(`was suspended for: "${details.suspended_reason}"`);
  if (details.event) parts.push(`${details.event}${details.event_on ? ` on ${details.event_on}` : ''}`);
  if (details.official_page_id) parts.push(`to ${details.official_page_id}`);
  if (details.decision) parts.push(details.decision);
  return parts.join(' · ');
}

export default function HistoryTab({ onCounts }) {
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [group, setGroup] = useState('all');

  const load = useCallback(async (beforeId) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await adminListActions({ limit: PAGE, beforeId });
    setLoading(false);
    if (err || !data) {
      setError(err || 'Could not load the history.');
      return;
    }
    setItems((prev) => (beforeId ? [...prev, ...(data.items || [])] : (data.items || [])));
    setHasMore(!!data.has_more);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const week = items.filter((i) => serverMs(i.at) >= weekAgo);
    onCounts?.({
      week: week.length,
      takedowns: week.filter((i) => ['content_hide', 'user_suspend'].includes(i.action)).length,
      restores: week.filter((i) => ['content_unhide', 'user_unsuspend', 'appeal_grant'].includes(i.action)).length,
    });
  }, [items, onCounts]);

  const shown = useMemo(
    () => (group === 'all' ? items : items.filter((i) => (ACTIONS[i.action] || [])[1] === group)),
    [items, group],
  );

  return (
    <section className="ad-history">
      <div className="ad-filters">
        <span className="ad-filters__label">Show</span>
        <div className="ad-filters__chips">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`ad-chip ${group === g.id ? 'ad-chip--active' : ''}`}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <button type="button" className="ad-btn ad-btn--ghost" onClick={() => load()} disabled={loading}>
          {loading ? 'Loading' : 'Refresh'}
        </button>
      </div>

      {error && <p className="ad-history__error" role="alert">{error}</p>}

      {!loading && shown.length === 0 ? (
        <div className="ad-empty">
          <h2 className="ad-empty__title">No admin actions here yet.</h2>
          <p className="ad-empty__body">Hides, suspensions, appeal decisions and the rest show up here as they happen.</p>
        </div>
      ) : (
        <div className="ad-tablewrap">
          <div className="ad-tablewrap__scroll">
            <table className="ad-table ad-history__table">
              <thead>
                <tr>
                  <th style={{ width: 170 }}>When</th>
                  <th style={{ width: 190 }}>Admin</th>
                  <th style={{ width: 210 }}>Action</th>
                  <th>Item or account</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td data-label="When">{when(i.at)}</td>
                    <td data-label="Admin" className="ad-history__mono">{i.actor_email}</td>
                    <td data-label="Action" className="ad-history__kind">{(ACTIONS[i.action] || [i.action])[0]}</td>
                    <td data-label="Item">
                      {i.target_kind && (
                        <span className="ad-history__kind">
                          {TARGET_LABEL[i.target_kind] || i.target_kind}
                          {i.target_id ? ` ${i.target_id}` : ''}
                        </span>
                      )}
                      {i.target_label && <div className="ad-history__label">{i.target_label}</div>}
                      {detailText(i.details) && <div className="ad-history__detail">{detailText(i.details)}</div>}
                    </td>
                    <td data-label="Reason">{i.reason || <span className="ad-history__none">No reason given</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasMore && (
        <div className="ad-history__more">
          <button
            type="button"
            className="ad-btn ad-btn--ghost"
            disabled={loading}
            onClick={() => load(items[items.length - 1]?.id)}
          >
            {loading ? 'Loading' : 'Show older actions'}
          </button>
        </div>
      )}
    </section>
  );
}
