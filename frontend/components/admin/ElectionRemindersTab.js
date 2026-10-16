'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useMemo, useState } from 'react';
import './ElectionRemindersTab.css';
import { formatLongDate } from '@/components/LifecycleBanner';
import { externalLinkProps } from '@/lib/externalLink';
import { adminElectionReminderPreview } from '@/lib/electionReminders';

/**
 * Admin: election reminders preview (2026-10-16). Every reminder for
 * the elections ahead in FL, CA, NY, PA and TX: the day it goes out
 * (10 a.m. in each recipient's local time), the state, the kind, the
 * exact wording, the official link, the source of the date and how
 * many people it is for. Nothing sends until ELECTION_REMINDERS_ENABLED
 * is set on the server; this tab reads the same schedule either way.
 * Read-only: there is nothing to edit or delete here.
 */

const STATUS_LABEL = { sending: 'Sending today', scheduled: 'Scheduled', passed: 'Passed' };

export default function ElectionRemindersTab({ onCounts }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState('');
  const [showPassed, setShowPassed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: d, error: err } = await adminElectionReminderPreview();
    setLoading(false);
    if (err) {
      setError(typeof err === 'string' ? err : 'Could not load the preview.');
      return;
    }
    setError('');
    setData(d);
    const counts = { scheduled: 0, sending: 0, passed: 0 };
    for (const r of d?.reminders || []) counts[r.status] = (counts[r.status] || 0) + 1;
    onCounts?.(counts);
  }, [onCounts]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => (data?.reminders || []).filter((r) =>
    (!state || r.state === state) && (showPassed || r.status !== 'passed')), [data, state, showPassed]);
  const skipped = useMemo(() => (data?.skipped || []).filter((s) => !state || s.state === state), [data, state]);

  return (
    <section className="ad-tab-body er-root">
      {data && (
        <div className={`er-banner ${data.enabled ? 'er-banner--on' : 'er-banner--off'}`}>
          {data.enabled
            ? 'Sending is ON (ELECTION_REMINDERS_ENABLED is set). Reminders go out at about 10 a.m. in each recipient’s local time, Eastern when unknown.'
            : 'Sending is OFF. Nothing is sent until ELECTION_REMINDERS_ENABLED=true is set on Render. Check the wording, dates and sources below first.'}
          {' '}Today (Eastern): {formatLongDate(data.today_et)}.
        </div>
      )}
      <div className="er-filters">
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
          <option value="">All states</option>
          {(data?.states || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ fontSize: '0.82rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showPassed} onChange={(e) => setShowPassed(e.target.checked)} />
          Show passed
        </label>
        <button type="button" className="ad-btn" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="er-banner er-banner--off">{error}</div>}

      {items.map((r) => (
        <article key={r.id} className={`er-item${r.status === 'passed' ? ' er-item--passed' : ''}`}>
          <div className="er-meta">
            <span className={`er-pill er-pill--${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
            <span><strong>{r.state}</strong> {r.kind_label}</span>
            <span>
              Sends <strong>{formatLongDate(r.send_on)}</strong>
              {r.last_send_on !== r.send_on && <> (or {formatLongDate(r.last_send_on)} if missed)</>}
            </span>
            <span>Deadline {formatLongDate(r.event_date)}</span>
            <span>
              Recipients <strong>{r.recipient_count == null ? 'n/a' : r.recipient_count}</strong>
              {' '}&middot; delivered <strong>{r.delivered_count}</strong>
            </span>
          </div>
          <div className="er-title">{r.title}</div>
          <div className="er-body">{r.body}</div>
          <div className="er-links">
            <span>Link: <a {...externalLinkProps(r.link_url)}>{r.link_url}</a></span>
            <span>Date source: <a {...externalLinkProps(r.source_url)}>{r.source_url}</a></span>
            {r.hours_source_url && (
              <span>Poll hours source: <a {...externalLinkProps(r.hours_source_url)}>{r.hours_source_url}</a></span>
            )}
            <span className="tr-mono">{r.id}</span>
          </div>
        </article>
      ))}
      {data && items.length === 0 && <div className="er-skipped">No reminders to show.</div>}

      {skipped.length > 0 && (
        <>
          <h3 style={{ margin: '8px 0 0', fontSize: '0.95rem' }}>Not sent, and why</h3>
          {skipped.map((s) => (
            <div key={`${s.state}-${s.election_key}-${s.kind}`} className="er-skipped">
              <strong>{s.state}</strong> {s.kind.replace(/_/g, ' ')} ({s.election_date}): {s.reason}
              {s.source_url && (
                <> Source: <a {...externalLinkProps(s.source_url)}>{s.source_url}</a></>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
