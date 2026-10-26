'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useRef, useState } from 'react';
import './TransitionsTab.css';
import { formatLongDate } from '@/components/LifecycleBanner';
import {
  adminApproveHandoff,
  adminDecideName,
  adminListTransitions,
  adminNameReviews,
  adminPreviewHandoff,
  adminPreviewTransitionsRun,
  adminRunTransitions,
  adminSetTransition,
  adminTransitionDetail,
  adminWithdrawTransition,
} from '@/lib/formerApi';
import { serverDate } from '@/lib/serverTime';

/**
 * Admin: former officials and candidates (2026-10-15, decision 8).
 * Jeffrey: "a way to set a person's left-office date or race result,
 * with a source, and to see the schedule of upcoming archives. Record
 * who set it and when. No delete buttons."
 *
 * Every entry is a POST that records who set it and when; a
 * correction is another POST, and the history keeps the values before
 * and after. There is no delete control anywhere on this tab.
 *
 * Since 2026-10-26 (admin audit): Save, the hand-off and name decisions
 * show what they will do and ask to confirm first; an admin entry can be
 * withdrawn with a reason (back to the data files, nothing deleted); a
 * source that isn't .gov, .us or .mil needs "This is an official
 * source"; and the times read in local time.
 */

// Mirrors admin_transitions.is_official_looking on the server.
function isOfficialLooking(url) {
  try {
    const u = new URL(url);
    const tld = u.hostname.toLowerCase().replace(/\.$/, '').split('.').pop();
    return u.protocol === 'https:' && ['gov', 'us', 'mil'].includes(tld);
  } catch {
    return false;
  }
}

function localDateTime(iso) {
  const d = serverDate(iso);
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : '';
}

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

// Notice names in the run preview (2026-10-16).
const NOTICE_LABELS = {
  person_left: 'To the person: left office or campaign ended',
  person_pre_archive: 'To the person: 30 days before the archive',
  person_archived: 'To the person: archived',
  trackers: 'To everyone tracking the page',
  followers: 'Follow in office, to the campaign page followers',
};

function stageLabel(stage) {
  return (STAGES.find(([k]) => k === stage) || [stage, stage])[1];
}

export default function TransitionsTab({ onCounts }) {
  const [items, setItems] = useState([]);
  // How many match the filters; the list shows the first 300 (2026-10-26).
  const [total, setTotal] = useState(null);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [stage, setStage] = useState('');
  // Pages with no official date yet (2026-10-26, admin audit M12):
  // '' (all pages), 'official' or 'candidate', and the whole counts.
  const [needsDate, setNeedsDate] = useState('');
  const [needsCounts, setNeedsCounts] = useState({});
  const formCardRef = useRef(null);
  const dateInputRef = useRef(null);
  const [q, setQ] = useState('');
  // Search waits for a pause in typing (2026-10-26): it used to send two
  // admin requests per keystroke.
  const [qDebounced, setQDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState(null);
  const [handoff, setHandoff] = useState({ campaignPageId: '', officialPageId: '', role: '' });
  const [reviews, setReviews] = useState([]);
  const [reviewSource, setReviewSource] = useState({});
  const [reviewOfficialOk, setReviewOfficialOk] = useState({});
  const [reviewConfirm, setReviewConfirm] = useState(null);   // { linkId, decision }
  // Confirm steps (2026-10-26).
  const [sourceOk, setSourceOk] = useState(false);            // "This is an official source"
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(null);       // { body, result }
  const [handoffPreview, setHandoffPreview] = useState(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const detailRef = useRef(null);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    const { data, error: e } = await adminListTransitions({
      stage: stage || undefined, q: qDebounced || undefined, needsDate: needsDate || undefined, limit: 300,
    });
    if (seq !== loadSeq.current) return;   // a newer search is on its way
    setLoading(false);
    if (e) { setError(e); return; }
    setItems(data?.items || []);
    setTotal(typeof data?.count === 'number' ? data.count : null);
    setToday(data?.today || '');
    setNeedsCounts(data?.needs_date_counts || {});
    onCounts?.(data?.counts || {});
  }, [stage, qDebounced, needsDate, onCounts]);

  // From a page with no official date: fill the form with its id and
  // event, and take the admin there to add the date and source.
  const fillFormFor = (t) => {
    setForm({ ...EMPTY_FORM, page_id: t.page_id, event: t.event });
    setSourceOk(false);
    setPendingSave(null);
    if (formCardRef.current) {
      formCardRef.current.open = true;
      formCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setTimeout(() => dateInputRef.current?.focus(), 400);
  };

  // Name reviews don't depend on the search; load them on their own.
  const loadReviews = useCallback(async () => {
    const r = await adminNameReviews();
    setReviews(r.data?.items || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadReviews(); }, [loadReviews]);

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })),
  });

  const buildBody = () => {
    const won = form.event === 'won';
    return {
      page_id: form.page_id.trim(),
      page_kind: form.event === 'left_office' ? 'official' : 'candidate',
      event: form.event,
      event_on: form.event_on,
      source_url: form.source_url.trim(),
      source_note: form.source_note.trim() || undefined,
      // The winner-only fields go only with a win (2026-10-26): a hidden
      // field must not fail the save or land on a losing candidate.
      incumbent: won ? !!form.incumbent : false,
      sworn_in_on: won ? (form.sworn_in_on || undefined) : undefined,
      office_label: form.office_label.trim() || undefined,
      linked_page_id: won ? (form.linked_page_id.trim() || undefined) : undefined,
      successor_ids: form.successor_ids.trim()
        ? form.successor_ids.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
      display_name: form.display_name.trim() || undefined,
      state: form.state.trim() || undefined,
      served_from: form.served_from.trim() || undefined,
      served_to: form.served_to.trim() || undefined,
      source_confirmed: !!sourceOk,
    };
  };

  // Save shows what it will do first: a dry run, then a confirm card.
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    const body = buildBody();
    setSaving(true);
    const { data, error: err } = await adminSetTransition(body, { dryRun: true });
    setSaving(false);
    if (err) { setError(err); return; }
    setPendingSave({ body, result: data });
  };

  const confirmSave = async () => {
    if (!pendingSave || saving) return;
    setSaving(true);
    const { data, error: err } = await adminSetTransition(pendingSave.body);
    setSaving(false);
    if (err) { setError(err); return; }
    setPendingSave(null);
    setNotice(`Saved: ${data?.title || pendingSave.body.page_id} (${stageLabel(data?.stage)}).`);
    setForm(EMPTY_FORM);
    setSourceOk(false);
    load();
  };

  const openDetail = async (pageId) => {
    const { data, error: err } = await adminTransitionDetail(pageId);
    if (err) { setError(err); return; }
    setWithdrawReason('');
    setDetail(data);
  };

  // The detail opens below up to 300 rows; bring it into view.
  useEffect(() => {
    if (detail && detailRef.current) detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [detail]);

  const withdraw = async () => {
    if (!detail || withdrawBusy || withdrawReason.trim().length < 3) return;
    setWithdrawBusy(true);
    const { data, error: err } = await adminWithdrawTransition(detail.page_id, withdrawReason.trim());
    setWithdrawBusy(false);
    if (err) { setError(err); return; }
    setNotice(`Withdrawn: ${detail.page_id} is back to what the data files say (${stageLabel(data?.stage)}).`);
    setDetail(null);
    load();
  };

  // "Run the daily job now" shows what it would send first (2026-10-16);
  // nothing goes out until "Send" in the preview.
  const [runPreview, setRunPreview] = useState(null);
  const [running, setRunning] = useState(false);
  const runNow = async () => {
    setError(null);
    const { data, error: err } = await adminPreviewTransitionsRun();
    if (err) { setError(err); return; }
    setRunPreview(data);
  };
  const confirmRun = async () => {
    setRunning(true);
    const { data, error: err } = await adminRunTransitions();
    setRunning(false);
    setRunPreview(null);
    if (err) { setError(err); return; }
    setNotice(`Daily job ran: ${data.person_notices} notices to people, ${data.tracker_notices} to trackers, `
      + `${data.followers_notices} Follow in office notices, ${data.emails_sent} emails, `
      + `${data.skipped_accounts} closed or suspended accounts skipped, tracking ended on ${data.tracking_ended} rows.`
      + (data.work_left ? ' More is waiting: the job continues on its own in 15 minutes.' : ''));
    load();
  };

  // The hand-off can't be undone and notifies every follower, so it
  // shows a preview first (2026-10-26).
  const approveHandoff = async (e) => {
    e.preventDefault();
    if (handoffBusy) return;
    setError(null);
    setHandoffBusy(true);
    const { data, error: err } = await adminPreviewHandoff(handoff);
    setHandoffBusy(false);
    if (err) { setError(err); return; }
    setHandoffPreview(data);
  };

  const confirmHandoff = async () => {
    if (handoffBusy) return;
    setHandoffBusy(true);
    const { data, error: err } = await adminApproveHandoff(handoff);
    setHandoffBusy(false);
    setHandoffPreview(null);
    if (err) { setError(err); return; }
    setNotice(`Hand-off approved. Rep account ${data.rep_account_id}; ${data.followers_notified} followers notified.`);
    setHandoff({ campaignPageId: '', officialPageId: '', role: '' });
    load();
  };

  const decide = async (linkId, decision) => {
    if (reviewBusy) return;
    const sourceUrl = (reviewSource[linkId] || '').trim();
    setReviewBusy(true);
    const { error: err } = await adminDecideName(linkId, {
      decision, sourceUrl, sourceConfirmed: !!reviewOfficialOk[linkId],
    });
    setReviewBusy(false);
    setReviewConfirm(null);
    if (err) { setError(err); return; }
    setNotice(decision === 'approve' ? 'Name approved.' : 'Name refused.');
    loadReviews();
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

      {/* Both forms start folded (2026-10-26): the list is what most
          visits are for, and on a phone the open form filled two screens. */}
      <details className="tr-card tr-fold" ref={formCardRef}>
        <summary>Set a left-office date or a race result</summary>
        <form className="tr-form" onSubmit={submit}>
          <label>Page id<input required placeholder="fl-sen-39, B001234, fl-cand-..." {...field('page_id')} /></label>
          <label>What happened
            <select {...field('event')}>
              {EVENTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label>Date it happened (official source)<input required type="date" ref={dateInputRef} {...field('event_on')} /></label>
          <label>Official source (https)<input required type="url" placeholder="https://" {...field('source_url')} /></label>
          {form.source_url.startsWith('https://') && !isOfficialLooking(form.source_url) && (
            <label className="tr-check tr-wide">
              <input type="checkbox" checked={sourceOk} onChange={(e) => setSourceOk(e.target.checked)} />
              This is an official source (it isn&apos;t a .gov, .us or .mil site)
            </label>
          )}
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
          <div className="tr-actions">
            <button type="submit" className="ad-btn ad-btn--grant" disabled={saving || !!pendingSave}>
              {saving && !pendingSave ? 'Checking' : 'Save'}
            </button>
          </div>
        </form>
        {pendingSave && (
          <div className="tr-confirm" role="region" aria-label="Check before saving">
            <h3 className="tr-h3">Check before saving</h3>
            <p>
              <strong>{pendingSave.result?.item?.display_name || pendingSave.body.page_id}</strong>
              {pendingSave.result?.item?.title ? <> becomes &ldquo;{pendingSave.result.item.title}&rdquo;</> : null}.
              {' '}Stage after saving: <strong>{stageLabel(pendingSave.result?.item?.stage)}</strong>.
              {pendingSave.result?.item?.farewell_ends_on && <> Farewell ends {formatLongDate(pendingSave.result.item.farewell_ends_on)}.</>}
              {pendingSave.result?.item?.archive_on && <> Archived on {formatLongDate(pendingSave.result.item.archive_on)}.</>}
            </p>
            {pendingSave.result?.trackers > 0 && (
              <p>{pendingSave.result.trackers} people track this page. They hear about it on the next daily run, and that can&apos;t be recalled.</p>
            )}
            {pendingSave.result?.replaces_admin_entry && <p>This replaces the earlier admin entry; the history keeps both.</p>}
            {(pendingSave.result?.warnings || []).length > 0 && (
              <ul className="tr-warnings">
                {pendingSave.result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <div className="tr-actions">
              <button type="button" className="ad-btn ad-btn--grant" onClick={confirmSave} disabled={saving}>
                {saving ? 'Saving' : 'Confirm and save'}
              </button>
              <button type="button" className="ad-btn ad-btn--ghost" onClick={() => setPendingSave(null)} disabled={saving}>
                Back to the form
              </button>
            </div>
          </div>
        )}
        <p className="tr-hint">
          Saving records who set it and when. To correct an entry, save it again; the history keeps both.
          To take back an entry made by mistake, open the page below and withdraw it. Nothing here deletes anything.
        </p>
      </details>

      <details className="tr-card tr-fold">
        <summary>Approve a winner&apos;s official page (after the swearing-in)</summary>
        <form className="tr-form" onSubmit={approveHandoff}>
          <label>Campaign page id<input required {...{ value: handoff.campaignPageId, onChange: (e) => setHandoff((h) => ({ ...h, campaignPageId: e.target.value })) }} /></label>
          <label>Official page id<input required {...{ value: handoff.officialPageId, onChange: (e) => setHandoff((h) => ({ ...h, officialPageId: e.target.value })) }} /></label>
          <label>Role (blank: from the office)<input {...{ value: handoff.role, onChange: (e) => setHandoff((h) => ({ ...h, role: e.target.value })) }} /></label>
          <div className="tr-actions">
            <button type="submit" className="ad-btn ad-btn--grant" disabled={handoffBusy || !!handoffPreview}>
              {handoffBusy && !handoffPreview ? 'Checking' : 'Approve hand-off'}
            </button>
          </div>
        </form>
        {handoffPreview && (
          <div className="tr-confirm" role="region" aria-label="Check before the hand-off">
            <h3 className="tr-h3">Check before the hand-off</h3>
            <p>
              <strong>{handoffPreview.name}</strong> gets the official page{' '}
              <span className="tr-mono">{handoffPreview.official_page_id}</span> as <strong>{handoffPreview.role}</strong>,
              signing in with the campaign account&apos;s email and password.
              {' '}The campaign page <span className="tr-mono">{handoffPreview.campaign_page_id}</span> is archived today,
              and its {handoffPreview.followers} {handoffPreview.followers === 1 ? 'follower gets' : 'followers get'} a
              {' '}&ldquo;Follow in office&rdquo; notice.
            </p>
            <p><strong>This can&apos;t be undone.</strong></p>
            <div className="tr-actions">
              <button type="button" className="ad-btn ad-btn--grant" onClick={confirmHandoff} disabled={handoffBusy}>
                {handoffBusy ? 'Approving' : 'Confirm hand-off'}
              </button>
              <button type="button" className="ad-btn ad-btn--ghost" onClick={() => setHandoffPreview(null)} disabled={handoffBusy}>
                Cancel
              </button>
            </div>
          </div>
        )}
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
              {(reviewSource[r.link_id] || '').startsWith('https://') && !isOfficialLooking(reviewSource[r.link_id]) && (
                <label className="tr-check">
                  <input type="checkbox" checked={!!reviewOfficialOk[r.link_id]}
                    onChange={(e) => setReviewOfficialOk((o) => ({ ...o, [r.link_id]: e.target.checked }))} />
                  This is an official source
                </label>
              )}
              {reviewConfirm?.linkId === r.link_id ? (
                <>
                  <span className="tr-sub">
                    {reviewConfirm.decision === 'approve' ? 'Approve and carry the name over?' : 'Refuse the name?'} This is final.
                  </span>
                  <button type="button" className="ad-btn ad-btn--grant" disabled={reviewBusy}
                    onClick={() => decide(r.link_id, reviewConfirm.decision)}>
                    {reviewBusy ? 'Saving' : 'Confirm'}
                  </button>
                  <button type="button" className="ad-btn ad-btn--ghost" disabled={reviewBusy}
                    onClick={() => setReviewConfirm(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" className="ad-btn ad-btn--grant"
                    onClick={() => setReviewConfirm({ linkId: r.link_id, decision: 'approve' })}>Approve</button>
                  <button type="button" className="ad-btn ad-btn--ghost"
                    onClick={() => setReviewConfirm({ linkId: r.link_id, decision: 'refuse' })}>Refuse</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="ad-toolbar tr-toolbar">
        <input className="tr-search" placeholder="Search name or page id" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          {STAGES.map(([k, label]) => <option key={k || 'all'} value={k}>{label}</option>)}
        </select>
        <select value={needsDate} onChange={(e) => setNeedsDate(e.target.value)} aria-label="Official date">
          <option value="">Any date</option>
          <option value="official">Needs an official date: officials ({needsCounts.official ?? 0})</option>
          <option value="candidate">Needs an official date: campaign pages ({needsCounts.candidate ?? 0})</option>
        </select>
        <button type="button" className="ad-btn ad-btn--ghost" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        <button type="button" className="ad-btn ad-btn--ghost" onClick={runNow}>Run the daily job now</button>
        {today && <span className="tr-today">Today: {formatLongDate(today)}</span>}
      </div>

      {runPreview && (
        <div className="tr-card tr-preview" role="region" aria-label="What the daily job would send">
          <h3 className="tr-h3">What the daily job would send today</h3>
          <p className="tr-sub">
            {runPreview.totals.notices} notices to {runPreview.totals.recipients} people:{' '}
            {runPreview.totals.bell} in the bell, {runPreview.totals.emails} of them also by email.{' '}
            {runPreview.totals.accounts_skipped} closed, suspended or deleted accounts get nothing.{' '}
            Tracking ends on {runPreview.totals.tracking_ends_on_pages} archived pages.{' '}
            At most {runPreview.per_pass_limit} people per pass; the rest follow 15 minutes later.
          </p>
          {runPreview.items.length > 0 && (
            <div className="ad-tablewrap">
              <table className="ad-table tr-table">
                <thead>
                  <tr><th>Page</th><th>Notice</th><th>People</th><th>Email</th><th>Skipped</th><th>Subject and text</th></tr>
                </thead>
                <tbody>
                  {runPreview.items.map((it) => (
                    <tr key={`${it.page_id}-${it.notice}`}>
                      <td><div className="tr-name">{it.name || it.page_id}</div><div className="tr-mono">{it.page_id}</div></td>
                      <td>{NOTICE_LABELS[it.notice] || it.notice}</td>
                      <td>{it.recipients}{it.already_notified ? ` (${it.already_notified} done)` : ''}</td>
                      <td>{it.emails}</td>
                      <td>{it.accounts_skipped}</td>
                      <td>
                        <details>
                          <summary>{it.subject || '(no email subject)'}</summary>
                          <p className="tr-sub">{it.text}</p>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="tr-actions">
            <button type="button" className="ad-btn ad-btn--grant" onClick={confirmRun} disabled={running}>
              {running ? 'Sending…' : (runPreview.totals.recipients ? `Send ${runPreview.totals.recipients} notices` : 'Run it (nothing to send)')}
            </button>
            <button type="button" className="ad-btn ad-btn--ghost" onClick={() => setRunPreview(null)} disabled={running}>Cancel</button>
          </div>
        </div>
      )}

      {total != null && total > items.length && (
        <p className="tr-notice" role="status">
          Showing the first {items.length} of {total}. Search by name or page id to find the others.
        </p>
      )}
      {items.length === 0 ? (
        <div className="ad-empty">{loading ? 'Loading…' : 'Nothing on the clock.'}</div>
      ) : (
        <div className="ad-tablewrap">
          <table className="ad-table tr-table tr-list">
            <thead>
              <tr>
                <th>Person</th><th>Stage</th><th>Date</th><th>Farewell ends</th><th>Archived on</th><th>Set by</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.page_id}
                  onClick={() => openDetail(it.page_id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(it.page_id); } }}
                  tabIndex={0}
                  aria-label={`Open ${it.display_name || it.page_id}`}
                  className="tr-row"
                >
                  <td>
                    <div className="tr-name">{it.display_name || it.page_id}</div>
                    <div className="tr-sub">{it.title || it.office_label}</div>
                    <div className="tr-sub tr-mono">{it.page_id}</div>
                  </td>
                  <td data-label="Stage">{stageLabel(it.stage)}</td>
                  <td data-label="Date">
                    {it.date_line || ''}
                    {it.date_is_recorded && <div className="tr-tag">No official date yet</div>}
                  </td>
                  <td data-label="Farewell ends">{formatLongDate(it.farewell_ends_on)}</td>
                  <td data-label="Archived on">{formatLongDate(it.archive_on)}</td>
                  <td data-label="Set by">
                    <div>{it.set_by || ''}</div>
                    {it.set_at && <div className="tr-sub">{localDateTime(it.set_at)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="tr-card" ref={detailRef}>
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
          {detail.transition?.date_is_recorded && (
            <div className="tr-confirm" role="region" aria-label="Needs an official date">
              <h4 className="tr-h4">Needs an official date</h4>
              <p className="tr-sub">
                CivicView only knows the day its data noticed this ({formatLongDate(detail.transition.recorded_on)}),
                so the farewell and archive clocks may have started late. Find the real date on an official site
                (the legislature or the election office), then save it with that source.
              </p>
              {detail.transition.lead_url && (
                <p className="tr-sub">
                  A lead:{' '}
                  <a href={detail.transition.lead_url} target="_blank" rel="noopener noreferrer">
                    {detail.transition.lead_url.includes('github.com/openstates/') ? 'the Open States record' : 'the record our data cites for their years'}
                  </a>
                  {detail.transition.served_to ? <> (served until {detail.transition.served_to})</> : null}.
                  {detail.transition.lead_url.includes('github.com/openstates/')
                    ? ' Its role end date says where to look; Open States is not an official source.'
                    : ' Check the date there or on the office\u2019s own site.'}
                </p>
              )}
              <div className="tr-actions">
                <button type="button" className="ad-btn ad-btn--grant" onClick={() => fillFormFor(detail.transition)}>
                  Add the official date
                </button>
              </div>
            </div>
          )}
          {detail.transition?.origin === 'admin' && (
            <div className="tr-confirm" role="region" aria-label="Withdraw this entry">
              <h4 className="tr-h4">Withdraw this entry</h4>
              <p className="tr-sub">
                For an entry made by mistake. The page goes back to what the data files say (often: still in office or
                still running). Nothing is deleted and the history keeps it. Notices already sent can&apos;t be recalled,
                and tracking that already ended stays ended.
              </p>
              <label className="tr-wide">Your reason (required)
                <input value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="e.g. 'Wrong person: the source was about a namesake'" />
              </label>
              <div className="tr-actions">
                <button type="button" className="ad-btn ad-btn--ghost" onClick={withdraw}
                  disabled={withdrawBusy || withdrawReason.trim().length < 3}>
                  {withdrawBusy ? 'Withdrawing' : 'Withdraw this entry'}
                </button>
              </div>
            </div>
          )}
          <h4 className="tr-h4">History</h4>
          {detail.history.length === 0 ? <p className="tr-sub">No changes by hand yet.</p> : (
            <ul className="tr-history">
              {detail.history.map((h, i) => (
                <li key={i}><strong>{h.action}</strong> by {h.actor || 'unknown'} on {localDateTime(h.at)}
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
