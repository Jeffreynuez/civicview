'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useState } from 'react';
import './TransitionsTab.css';
import { formatLongDate } from '@/components/LifecycleBanner';
import {
  adminApproveHandoff,
  adminDecideName,
  adminListTransitions,
  adminNameReviews,
  adminRunTransitions,
  adminSetTransition,
  adminTransitionDetail,
} from '@/lib/formerApi';

/**
 * Admin: former officials and candidates (2026-10-15, decision 8).
 * Jeffrey: "a way to set a person's left-office date or race result,
 * with a source, and to see the schedule of upcoming archives. Record
 * who set it and when. No delete buttons."
 *
 * Every entry is a POST that records who set it and when; a
 * correction is another POST, and the history keeps the values before
 * and after. There is no delete control anywhere on this tab.
 */

const STAGES = [
  ['', 'All stages'],
  ['farewell', 'Farewell window'],
  ['read_only', 'Read-only'],
  ['archived', 'Archived'],
  ['elect', 'Official-elect'],
  ['active', 'In office or running'],
];

const EVENTS = [
  ['left_office', 'Left office (official page)'],
  ['lost_primary', 'Lost the primary (campaign page)'],
  ['lost_general', 'Lost the general election (campaign page)'],
  ['withdrew', 'Withdrew (campaign page)'],
  ['not_on_ballot', 'Not on the November ballot, no reason given (campaign page)'],
  ['won', 'Won (campaign page)'],
];

const EMPTY_FORM = {
  page_id: '', event: 'left_office', event_on: '', source_url: '', source_note: '',
  incumbent: false, sworn_in_on: '', office_label: '', linked_page_id: '',
  successor_ids: '', display_name: '', state: '', served_from: '', served_to: '',
};

function stageLabel(stage) {
  return (STAGES.find(([k]) => k === stage) || [stage, stage])[1];
}

export default function TransitionsTab({ onCounts }) {
  const [items, setItems] = useState([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState(null);
  const [handoff, setHandoff] = useState({ campaignPageId: '', officialPageId: '', role: '' });
  const [reviews, setReviews] = useState([]);
  const [reviewSource, setReviewSource] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await adminListTransitions({ stage: stage || undefined, q: q || undefined, limit: 300 });
    setLoading(false);
    if (e) { setError(e); return; }
    setItems(data?.items || []);
    setToday(data?.today || '');
    onCounts?.(data?.counts || {});
    const r = await adminNameReviews();
    setReviews(r.data?.items || []);
  }, [stage, q, onCounts]);

  useEffect(() => { load(); }, [load]);

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })),
  });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const body = {
      page_id: form.page_id.trim(),
      page_kind: form.event === 'left_office' ? 'official' : 'candidate',
      event: form.event,
      event_on: form.event_on,
      source_url: form.source_url.trim(),
      source_note: form.source_note.trim() || undefined,
      incumbent: !!form.incumbent,
      sworn_in_on: form.sworn_in_on || undefined,
      office_label: form.office_label.trim() || undefined,
      linked_page_id: form.linked_page_id.trim() || undefined,
      successor_ids: form.successor_ids.trim()
        ? form.successor_ids.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      display_name: form.display_name.trim() || undefined,
      state: form.state.trim() || undefined,
      served_from: form.served_from.trim() || undefined,
      served_to: form.served_to.trim() || undefined,
    };
    const { data, error: err } = await adminSetTransition(body);
    if (err) { setError(err); return; }
    setNotice(`Saved: ${data?.title || body.page_id} (${stageLabel(data?.stage)}).`);
    setForm(EMPTY_FORM);
    load();
  };

  const openDetail = async (pageId) => {
    const { data, error: err } = await adminTransitionDetail(pageId);
    if (err) { setError(err); return; }
    setDetail(data);
  };

  const runNow = async () => {
    const { data, error: err } = await adminRunTransitions();
    if (err) { setError(err); return; }
    setNotice(`Daily job ran: ${data.person_notices} notices to people, ${data.tracker_notices} to trackers, `
      + `${data.followers_notices} Follow in office notices, tracking ended on ${data.tracking_ended} rows.`);
    load();
  };

  const approveHandoff = async (e) => {
    e.preventDefault();
    const { data, error: err } = await adminApproveHandoff(handoff);
    if (err) { setError(err); return; }
    setNotice(`Hand-off approved. Rep account ${data.rep_account_id}; ${data.followers_notified} followers notified.`);
    setHandoff({ campaignPageId: '', officialPageId: '', role: '' });
    load();
  };

  const decide = async (linkId, decision) => {
    const sourceUrl = (reviewSource[linkId] || '').trim();
    const { error: err } = await adminDecideName(linkId, { decision, sourceUrl });
    if (err) { setError(err); return; }
    setNotice(decision === 'approve' ? 'Name approved.' : 'Name refused.');
    load();
  };

  return (
    <section className="ad-tab-body tr-root">
      {error && (
        <div className="ad-banner" role="alert">
          <div className="ad-banner__icon">!</div>
          <div className="ad-banner__body"><div className="ad-banner__detail">{error}</div></div>
          <button className="ad-banner__close" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {notice && <p className="tr-notice" role="status">{notice}</p>}

      <details className="tr-card" open>
        <summary>Set a left-office date or a race result</summary>
        <form className="tr-form" onSubmit={submit}>
          <label>Page id<input required placeholder="fl-sen-39, B001234, fl-cand-..." {...field('page_id')} /></label>
          <label>What happened
            <select {...field('event')}>
              {EVENTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label>Date it happened (official source)<input required type="date" {...field('event_on')} /></label>
          <label>Official source (https)<input required type="url" placeholder="https://" {...field('source_url')} /></label>
          <label className="tr-wide">Note<input placeholder="Optional" {...field('source_note')} /></label>
          <label>Office (leave blank to use our data)<input placeholder="State Senator, Ohio District 1" {...field('office_label')} /></label>
          <label>Name (blank: from our data)<input {...field('display_name')} /></label>
          <label>State<input maxLength={2} placeholder="FL" {...field('state')} /></label>
          <label>Served from (year)<input maxLength={4} {...field('served_from')} /></label>
          <label>Served to (year)<input maxLength={4} {...field('served_to')} /></label>
          <label>Who holds the seat now (page ids, commas)<input {...field('successor_ids')} /></label>
          {form.event === 'won' && (
            <>
              <label className="tr-check"><input type="checkbox" checked={form.incumbent} onChange={field('incumbent').onChange} /> Re-elected incumbent</label>
              <label>Sworn in on<input type="date" {...field('sworn_in_on')} /></label>
              <label>Official page id (Follow in office)<input {...field('linked_page_id')} /></label>
            </>
          )}
          <div className="tr-actions"><button type="submit" className="ad-btn ad-btn--grant">Save</button></div>
        </form>
        <p className="tr-hint">
          Saving records who set it and when. To correct an entry, save it again; the history keeps both.
          Nothing here deletes anything.
        </p>
      </details>

      <details className="tr-card">
        <summary>Approve a winner&apos;s official page (after the swearing-in)</summary>
        <form className="tr-form" onSubmit={approveHandoff}>
          <label>Campaign page id<input required {...{ value: handoff.campaignPageId, onChange: (e) => setHandoff((h) => ({ ...h, campaignPageId: e.target.value })) }} /></label>
          <label>Official page id<input required {...{ value: handoff.officialPageId, onChange: (e) => setHandoff((h) => ({ ...h, officialPageId: e.target.value })) }} /></label>
          <label>Role (blank: from the office)<input {...{ value: handoff.role, onChange: (e) => setHandoff((h) => ({ ...h, role: e.target.value })) }} /></label>
          <div className="tr-actions"><button type="submit" className="ad-btn ad-btn--grant">Approve hand-off</button></div>
        </form>
      </details>

      {reviews.length > 0 && (
        <div className="tr-card">
          <h3 className="tr-h3">Name hand-offs waiting for a decision</h3>
          {reviews.map((r) => (
            <div key={r.link_id} className="tr-review">
              <div>
                <strong>{r.former_name}</strong> ({r.page_id}) asks to carry the name to citizen account {r.citizen_id}.
                ID.me legal name: <strong>{r.legal_name || 'unknown'}</strong>.
              </div>
              <input type="url" placeholder="Source (https)" value={reviewSource[r.link_id] || ''}
                onChange={(e) => setReviewSource((s) => ({ ...s, [r.link_id]: e.target.value }))} />
              <button type="button" className="ad-btn ad-btn--grant" onClick={() => decide(r.link_id, 'approve')}>Approve</button>
              <button type="button" className="ad-btn ad-btn--ghost" onClick={() => decide(r.link_id, 'refuse')}>Refuse</button>
            </div>
          ))}
        </div>
      )}

      <div className="ad-toolbar tr-toolbar">
        <input className="tr-search" placeholder="Search name or page id" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          {STAGES.map(([k, label]) => <option key={k || 'all'} value={k}>{label}</option>)}
        </select>
        <button type="button" className="ad-btn ad-btn--ghost" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        <button type="button" className="ad-btn ad-btn--ghost" onClick={runNow}>Run the daily job now</button>
        {today && <span className="tr-today">Today: {formatLongDate(today)}</span>}
      </div>

      {items.length === 0 ? (
        <div className="ad-empty">{loading ? 'Loading…' : 'Nothing on the clock.'}</div>
      ) : (
        <div className="ad-tablewrap">
          <table className="ad-table tr-table">
            <thead>
              <tr>
                <th>Person</th><th>Stage</th><th>Date</th><th>Farewell ends</th><th>Archived on</th><th>Set by</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.page_id} onClick={() => openDetail(it.page_id)} className="tr-row">
                  <td>
                    <div className="tr-name">{it.display_name || it.page_id}</div>
                    <div className="tr-sub">{it.title || it.office_label}</div>
                    <div className="tr-sub tr-mono">{it.page_id}</div>
                  </td>
                  <td>{stageLabel(it.stage)}</td>
                  <td>{it.date_line || ''}</td>
                  <td>{formatLongDate(it.farewell_ends_on)}</td>
                  <td>{formatLongDate(it.archive_on)}</td>
                  <td>
                    <div>{it.set_by || ''}</div>
                    {it.set_at && <div className="tr-sub">{it.set_at.slice(0, 10)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="tr-card">
          <div className="tr-detail-head">
            <h3 className="tr-h3">{detail.transition?.display_name || detail.page_id}</h3>
            <button type="button" className="ad-btn ad-btn--ghost" onClick={() => setDetail(null)}>Close</button>
          </div>
          {detail.transition && (
            <dl className="tr-dl">
              <dt>Title</dt><dd>{detail.transition.title || '(none)'}</dd>
              <dt>Stage</dt><dd>{stageLabel(detail.transition.stage)}</dd>
              <dt>Date</dt><dd>{detail.transition.date_line || ''}</dd>
              <dt>Source</dt><dd>{detail.transition.source_url ? <a href={detail.transition.source_url} target="_blank" rel="noopener noreferrer">{detail.transition.source_url}</a> : '(data file)'}</dd>
              <dt>Notices</dt><dd>{JSON.stringify(detail.transition.notices || {})}</dd>
            </dl>
          )}
          <h4 className="tr-h4">History</h4>
          {detail.history.length === 0 ? <p className="tr-sub">No changes by hand yet.</p> : (
            <ul className="tr-history">
              {detail.history.map((h, i) => (
                <li key={i}><strong>{h.action}</strong> by {h.actor || 'unknown'} on {h.at?.slice(0, 16).replace('T', ' ')}
                  <pre>{JSON.stringify({ before: h.before, after: h.after }, null, 1)}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
