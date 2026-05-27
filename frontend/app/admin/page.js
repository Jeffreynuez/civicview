'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /admin — moderation surface.
 *
 * Gated server-side by ADMIN_EMAILS env var. Three render modes:
 *   - probing      → spinner card
 *   - 401 / 403    → access-required card
 *   - 200          → the moderation surface — shared page-header band
 *                    (crumb + title + signed-in line + KPI strip) plus
 *                    a three-tab sub-nav that swaps the body between:
 *                      • Queue (?tab=queue, default) — reports list
 *                      • Appeals (?tab=appeals) — appeal cards
 *                      • Suspended users (?tab=suspended) — table
 *
 * Tab state lives in the URL query string so links / bookmarks /
 * back-button work normally. Switching tabs uses router.replace()
 * (no history entry per click).
 *
 * Per-tab API surface:
 *   Queue       → adminListReports, adminDismissReport, adminHideTarget,
 *                 adminUnhideTarget, adminSuspendUser
 *   Appeals     → adminListAppeals, adminGrantAppeal, adminDenyAppeal
 *   Suspended   → adminListSuspendedUsers, adminUnsuspendUser
 *
 * Modals replace the prior window.confirm chains: Hide, Suspend,
 * Appeal-decision (Grant/Deny with optional admin note), and
 * Unsuspend (with appeal-coupling notice when relevant).
 *
 * Class names match the Claude Design export under
 * /Design Exports/civicview-admin-moderation-page/. Styles live in
 * ./admin.css.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  adminWhoami,
  adminListReports,
  adminDismissReport,
  adminHideTarget,
  adminUnhideTarget,
  adminSuspendUser,
  adminListAppeals,
  adminGrantAppeal,
  adminDenyAppeal,
  adminListSuspendedUsers,
  adminUnsuspendUser,
  adminListLockouts,
  adminUnlockAccount,
} from '@/lib/pagesApi';
import './admin.css';

const VALID_TABS = new Set(['queue', 'appeals', 'suspended', 'lockouts']);

// Human-friendly type labels and icon classes — keep in sync with the
// backend ReportKind literal.
const TYPE_META = {
  post:         { label: 'Rep post',        iconClass: 'post',        Icon: TypePostIcon },
  post_comment: { label: 'Comment on post', iconClass: 'comment',     Icon: TypeCommentIcon },
  poll:         { label: 'Citizen poll',    iconClass: 'poll',        Icon: TypePollIcon },
  poll_comment: { label: 'Comment on poll', iconClass: 'pollcomment', Icon: TypePollCommentIcon },
};

// Appeal target_kind → label + classification. The kind is one of:
// post / post_comment / poll / poll_comment (content appeals) OR
// suspension_rep / suspension_citizen (account appeals).
const APPEAL_TARGET_META = {
  post:         { label: 'Hidden post',        type: 'content', iconClass: 'post',        Icon: TypePostIcon },
  post_comment: { label: 'Hidden comment',     type: 'content', iconClass: 'comment',     Icon: TypeCommentIcon },
  poll:         { label: 'Hidden poll',        type: 'content', iconClass: 'poll',        Icon: TypePollIcon },
  poll_comment: { label: 'Hidden poll comment',type: 'content', iconClass: 'pollcomment', Icon: TypePollCommentIcon },
  suspension_rep:     { label: 'Rep suspension',     type: 'suspension' },
  suspension_citizen: { label: 'Citizen suspension', type: 'suspension' },
};

// Reason → pill-tone mapping for the queue.
const REASON_PILL_KEY = {
  harassment: 'harass',
  hate: 'harass',
  misinformation: 'misinfo',
  spam: 'spam',
  off_topic: 'offtopic',
  off_topic_or_low_quality: 'offtopic',
};

function reasonPillKey(reason) {
  if (!reason) return 'default';
  return REASON_PILL_KEY[reason] || 'default';
}

function formatReason(reason) {
  if (!reason) return 'Unspecified';
  return reason.charAt(0).toUpperCase() + reason.slice(1).replace(/_/g, ' ');
}

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function absTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function reportStatus(r) {
  if (r.acted_at) return 'resolved';
  if (r.target_hidden) return 'hidden';
  return 'open';
}

function appealStatus(a) {
  if (!a.acted_at) return 'pending';
  return a.decision === 'granted' ? 'granted' : 'denied';
}

function initialsFromName(name) {
  if (!name) return '?';
  return name.split(/\s+/).map((s) => s[0] || '').slice(0, 2).join('').toUpperCase() || '?';
}

// Helpers for the three account kinds the admin surface handles —
// rep, citizen, and candidate. Centralized so adding kinds in the
// future doesn't require sweeping every conditional in the page.
function kindToken(kind) {
  if (kind === 'rep') return 'rep';
  if (kind === 'candidate') return 'candidate';
  return 'citizen';
}
function kindLabel(kind) {
  if (kind === 'rep') return 'Rep';
  if (kind === 'candidate') return 'Candidate';
  return 'Citizen';
}

// Next.js requires useSearchParams() to live under a <Suspense> boundary
// because it forces client-side rendering. The wrapper keeps the
// page-level prerender happy while the inner component runs its
// auth probe + tab routing as normal client-side work.
export default function AdminPage() {
  return (
    <Suspense fallback={
      <div className="ad-root">
        <div className="ad-access-wrap">
          <div className="ad-access">
            <div className="ad-access__art"><div className="ad-spinner" /></div>
            <h2 className="ad-access__title">Loading admin surface…</h2>
          </div>
        </div>
      </div>
    }>
      <AdminPageInner />
    </Suspense>
  );
}

function AdminPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab = VALID_TABS.has(rawTab) ? rawTab : 'queue';

  const [authState, setAuthState] = useState('probing');
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);

  // Per-tab data + load state. Kept top-level so tab switches don't
  // unmount the data; everything stays warm across navigation.
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [appeals, setAppeals] = useState([]);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [suspended, setSuspended] = useState([]);
  const [suspendedLoading, setSuspendedLoading] = useState(false);
  // Lockouts tab (Task #60) — currently-locked accounts across all
  // three identity tracks. Polled fresh on tab switch.
  const [lockouts, setLockouts] = useState([]);
  const [lockoutsLoading, setLockoutsLoading] = useState(false);

  // Filter state — separate per tab so toggling Queue's "include resolved"
  // doesn't affect Appeals's equivalent toggle.
  const [includeResolvedQueue, setIncludeResolvedQueue] = useState(false);
  const [kindChip, setKindChip] = useState('all');
  const [reporterChip, setReporterChip] = useState('any');
  const [autoOnly, setAutoOnly] = useState(false);

  const [includeResolvedAppeals, setIncludeResolvedAppeals] = useState(false);
  const [appealTypeChip, setAppealTypeChip] = useState('all'); // 'all' | 'content' | 'suspension'
  const [appellantChip, setAppellantChip] = useState('any');

  const [suspendedKindChip, setSuspendedKindChip] = useState('all');
  const [suspendedSort, setSuspendedSort] = useState('newest');

  // Mobile collapse — table → card list.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // Modal state.
  const [hideModal, setHideModal] = useState(null);
  const [suspendModal, setSuspendModal] = useState(null);
  const [appealDecisionModal, setAppealDecisionModal] = useState(null); // { appeal, decision }
  const [unsuspendModal, setUnsuspendModal] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Probe admin auth on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, status, error: err } = await adminWhoami();
      if (cancelled) return;
      if (status === 200 && data) {
        setMe(data);
        setAuthState('allowed');
      } else if (status === 403) {
        setAuthState('denied');
        setError(err || 'Admin access required.');
      } else if (status === 401) {
        setAuthState('unauthed');
      } else {
        setAuthState('denied');
        setError(err || 'Could not reach admin API.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Loaders — each tab refetches its own data when filters change.
  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    setError(null);
    const { data, error: err } = await adminListReports({ includeActed: includeResolvedQueue });
    setReportsLoading(false);
    if (err || !data) {
      setError(err || 'Could not load reports.');
      return;
    }
    setReports(data.items || []);
  }, [includeResolvedQueue]);

  const loadAppeals = useCallback(async () => {
    setAppealsLoading(true);
    setError(null);
    const { data, error: err } = await adminListAppeals({ includeActed: includeResolvedAppeals });
    setAppealsLoading(false);
    if (err || !data) {
      setError(err || 'Could not load appeals.');
      return;
    }
    setAppeals(data.items || []);
  }, [includeResolvedAppeals]);

  const loadSuspended = useCallback(async () => {
    setSuspendedLoading(true);
    setError(null);
    const { data, error: err } = await adminListSuspendedUsers();
    setSuspendedLoading(false);
    if (err || !data) {
      setError(err || 'Could not load suspended users.');
      return;
    }
    setSuspended(data.items || []);
  }, []);

  const loadLockouts = useCallback(async () => {
    setLockoutsLoading(true);
    const { data, error: err } = await adminListLockouts();
    setLockoutsLoading(false);
    if (err) {
      setError(err || 'Could not load lockouts.');
      return;
    }
    setLockouts(data?.items || []);
  }, []);

  useEffect(() => {
    if (activeTab === 'lockouts') loadLockouts();
  }, [activeTab, loadLockouts]);

  // Initial load — prime ALL three on mount so the sub-nav badges
  // are accurate immediately, regardless of which tab the URL points
  // at. Subsequent reloads are per-tab.
  useEffect(() => {
    if (authState !== 'allowed') return;
    loadReports();
    loadAppeals();
    loadSuspended();
    loadLockouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Re-fetch a tab when its filters change.
  useEffect(() => {
    if (authState === 'allowed') loadReports();
  }, [authState, loadReports]);
  useEffect(() => {
    if (authState === 'allowed') loadAppeals();
  }, [authState, loadAppeals]);

  const switchTab = (tab) => {
    const next = VALID_TABS.has(tab) ? tab : 'queue';
    const qs = next === 'queue' ? '' : `?tab=${next}`;
    router.replace(`/admin${qs}`, { scroll: false });
  };

  // Sub-nav badge counts — derived from loaded data.
  const subnavCounts = useMemo(() => ({
    queue:     reports.filter((r) => reportStatus(r) === 'open').length,
    appeals:   appeals.filter((a) => appealStatus(a) === 'pending').length,
    suspended: suspended.length,
    lockouts: lockouts.length,
  }), [reports, appeals, suspended, lockouts]);

  // Action handlers — Dismiss / Unhide stay one-click. Hide / Suspend /
  // Grant / Deny / Unsuspend route through real modals.
  const runAction = async (key, fn, reload) => {
    if (busyId) return;
    setBusyId(key);
    const { error: err } = await fn();
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    if (reload) await reload();
  };

  const handleHideConfirm = async () => {
    if (!hideModal) return;
    const r = hideModal;
    const key = `hide-${r.kind}-${r.id}`;
    setHideModal(null);
    await runAction(key, () => adminHideTarget(r.kind, r.id), loadReports);
  };

  const handleSuspendConfirm = async ({ reason, alsoHide }) => {
    if (!suspendModal) return;
    const r = suspendModal;
    const key = `suspend-${r.target_author_kind}-${r.target_author_id}`;
    setSuspendModal(null);
    await runAction(
      key,
      () => adminSuspendUser(r.target_author_kind, r.target_author_id, {
        reason: (reason || '').trim() || null,
        cascadeHide: !!alsoHide,
      }),
      async () => { await loadReports(); await loadSuspended(); },
    );
  };

  const handleAppealDecisionConfirm = async ({ decision, note }) => {
    if (!appealDecisionModal) return;
    const a = appealDecisionModal.appeal;
    const key = `appeal-${a.id}`;
    setAppealDecisionModal(null);
    const fn = decision === 'grant' ? adminGrantAppeal : adminDenyAppeal;
    await runAction(
      key,
      () => fn(a.id, { adminNote: (note || '').trim() || null }),
      async () => { await loadAppeals(); await loadSuspended(); await loadReports(); },
    );
  };

  const handleUnsuspendConfirm = async (user) => {
    if (!unsuspendModal) return;
    const u = user || unsuspendModal;
    const key = `unsuspend-${u.kind}-${u.id}`;
    setUnsuspendModal(null);
    await runAction(
      key,
      () => adminUnsuspendUser(u.kind, u.id),
      async () => { await loadSuspended(); await loadAppeals(); },
    );
  };

  // ── Access states ──────────────────────────────────────────────
  if (authState === 'probing') {
    return (
      <div className="ad-root">
        <div className="ad-access-wrap">
          <div className="ad-access">
            <div className="ad-access__art"><div className="ad-spinner" /></div>
            <h2 className="ad-access__title">Checking admin access…</h2>
            <p className="ad-access__body">
              Verifying your account against the ADMIN_EMAILS allowlist.
              This usually takes less than a second.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (authState === 'unauthed') {
    return (
      <div className="ad-root">
        <div className="ad-access-wrap">
          <div className="ad-access">
            <div className="ad-access__art">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="9" r="4" stroke="#1b263b" strokeWidth="1.8" fill="#e6f3ec" />
                <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#1b263b" strokeWidth="1.8" strokeLinecap="round" fill="#e6f3ec" />
              </svg>
            </div>
            <h2 className="ad-access__title">Sign in required</h2>
            <p className="ad-access__body">
              The moderation surface is restricted to accounts on the{' '}
              <strong>ADMIN_EMAILS</strong> allowlist.
            </p>
            <a className="ad-access__cta" href="/">Go to CivicView home</a>
          </div>
        </div>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className="ad-root">
        <div className="ad-access-wrap">
          <div className="ad-access">
            <div className="ad-access__art">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3Z" fill="#fde8e8" stroke="#b13b3b" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M9 9l6 6M15 9l-6 6" stroke="#b13b3b" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <h2 className="ad-access__title">Admin access required</h2>
            <p className="ad-access__body">
              {me?.email && <>You&rsquo;re signed in as <span className="ad-access__email">{me.email}</span>, which</>}
              {!me?.email && <>Your account</>}
              {' '}isn&rsquo;t on the moderator allowlist. Ask the deploy owner to add your
              email to <strong>ADMIN_EMAILS</strong> and redeploy.
            </p>
            <a className="ad-access__link" href="/">← Back to CivicView home</a>
          </div>
        </div>
      </div>
    );
  }

  // Per-tab page-head config.
  const tabConfig = {
    queue:     { crumb: 'Admin · Moderation',  title: 'Moderation queue' },
    appeals:   { crumb: 'Admin · Appeals',     title: 'Appeals queue' },
    suspended: { crumb: 'Admin · Suspended users', title: 'Suspended accounts' },
    lockouts: { crumb: 'Admin · Lockouts', title: 'Account lockouts' },
  }[activeTab];

  // Per-tab KPI strip.
  let kpis;
  if (activeTab === 'queue') {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    let open = 0, hidden = 0, resolvedWeek = 0;
    for (const r of reports) {
      const s = reportStatus(r);
      if (s === 'open') open += 1;
      else if (s === 'hidden') hidden += 1;
      if (r.acted_at && new Date(r.acted_at).getTime() >= weekAgo) resolvedWeek += 1;
    }
    kpis = [
      { label: 'Open reports', value: open, dot: 'open' },
      { label: 'Hidden content', value: hidden, dot: 'hidden' },
      { label: 'Resolved this week', value: resolvedWeek, dot: 'resolved' },
    ];
  } else if (activeTab === 'appeals') {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    let openA = 0, grantedWeek = 0, deniedWeek = 0;
    for (const a of appeals) {
      const s = appealStatus(a);
      if (s === 'pending') openA += 1;
      if (a.acted_at && new Date(a.acted_at).getTime() >= weekAgo) {
        if (s === 'granted') grantedWeek += 1;
        else if (s === 'denied') deniedWeek += 1;
      }
    }
    kpis = [
      { label: 'Open appeals', value: openA, dot: 'warning' },
      { label: 'Granted this week', value: grantedWeek, dot: 'success' },
      { label: 'Denied this week', value: deniedWeek, dot: 'danger' },
    ];
  } else {
    // Suspended — three lightweight tiles.
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const suspendedThisWeek = suspended.filter(
      (u) => u.suspended_at && new Date(u.suspended_at).getTime() >= weekAgo,
    ).length;
    kpis = [
      { label: 'Currently suspended', value: suspended.length, dot: 'warning' },
      { label: 'Suspended this week', value: suspendedThisWeek, dot: 'danger' },
      { label: 'Reps suspended', value: suspended.filter((u) => u.kind === 'rep').length, dot: 'hidden' },
    ];
  } else if (activeTab === 'lockouts') {
    // Lockouts — three tiles, parallel to Suspended.
    const repsLocked = lockouts.filter((l) => l.identity_kind === 'rep').length;
    const candidatesLocked = lockouts.filter((l) => l.identity_kind === 'candidate').length;
    const citizensLocked = lockouts.filter((l) => l.identity_kind === 'citizen').length;
    kpis = [
      { label: 'Currently locked', value: lockouts.length, dot: 'warning' },
      { label: 'Reps + candidates', value: repsLocked + candidatesLocked, dot: 'danger' },
      { label: 'Citizens', value: citizensLocked, dot: 'hidden' },
    ];
  }

  return (
    <div className="ad-root">
      <main className="ad-main">
        <div className="ad-pagehead">
          <div className="ad-pagehead__top">
            <div className="ad-pagehead__crumb">{tabConfig.crumb}</div>
            <h1 className="ad-pagehead__title">{tabConfig.title}</h1>
            <div className="ad-pagehead__subline">
              Signed in as{' '}
              <span className="ad-pagehead__subline-mono">{me?.email}</span>
              {' · '}{me?.kind === 'citizen' ? 'citizen' : 'rep'} account on ADMIN_EMAILS allowlist
            </div>
          </div>

          <div className="ad-subnav-row">
            <nav className="ad-subnav" aria-label="Admin sections">
              <SubNavTab id="queue" label="Queue" badge={subnavCounts.queue} active={activeTab} onClick={switchTab} />
              <SubNavTab id="appeals" label="Appeals" badge={subnavCounts.appeals} active={activeTab} onClick={switchTab} />
              <SubNavTab id="suspended" label="Suspended users" badge={subnavCounts.suspended} active={activeTab} onClick={switchTab} />
              <SubNavTab id="lockouts" label="Lockouts" badge={subnavCounts.lockouts} active={activeTab} onClick={switchTab} />
            </nav>
            <a className="ad-subnav__home" href="/">
              <span aria-hidden="true">←</span> CivicView home
            </a>
          </div>

          <div className="ad-kpis">
            {kpis.map((k) => (
              <KpiTile key={k.label} label={k.label} value={k.value} dotClass={k.dot} />
            ))}
          </div>
        </div>

        {error && (
          <div className="ad-banner" role="alert">
            <div className="ad-banner__icon">!</div>
            <div className="ad-banner__body">
              <div className="ad-banner__title">Couldn&rsquo;t complete that action</div>
              <div className="ad-banner__detail">{error}</div>
            </div>
            <button className="ad-banner__close" onClick={() => setError(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        {activeTab === 'queue' && (
          <QueueView
            reports={reports}
            loading={reportsLoading}
            mobile={mobile}
            busyId={busyId}
            includeResolved={includeResolvedQueue}
            onIncludeResolved={setIncludeResolvedQueue}
            kindChip={kindChip}
            onKindChip={setKindChip}
            reporterChip={reporterChip}
            onReporterChip={setReporterChip}
            autoOnly={autoOnly}
            onAutoOnly={setAutoOnly}
            onRefresh={loadReports}
            onView={openHostingPage}
            onDismiss={(r) => runAction(`dismiss-${r.kind}-${r.id}`, () => adminDismissReport(r.kind, r.id), loadReports)}
            onHide={(r) => setHideModal(r)}
            onUnhide={(r) => runAction(`unhide-${r.kind}-${r.id}`, () => adminUnhideTarget(r.kind, r.target_id), loadReports)}
            onSuspend={(r) => setSuspendModal(r)}
          />
        )}

        {activeTab === 'appeals' && (
          <AppealsView
            appeals={appeals}
            loading={appealsLoading}
            includeResolved={includeResolvedAppeals}
            onIncludeResolved={setIncludeResolvedAppeals}
            typeChip={appealTypeChip}
            onTypeChip={setAppealTypeChip}
            appellantChip={appellantChip}
            onAppellantChip={setAppellantChip}
            onRefresh={loadAppeals}
            onGrant={(a) => setAppealDecisionModal({ appeal: a, decision: 'grant' })}
            onDeny={(a) => setAppealDecisionModal({ appeal: a, decision: 'deny' })}
          />
        )}

        {activeTab === 'suspended' && (
          <SuspendedView
            users={suspended}
            appeals={appeals}
            loading={suspendedLoading}
            mobile={mobile}
            kindChip={suspendedKindChip}
            onKindChip={setSuspendedKindChip}
            sort={suspendedSort}
            onSort={setSuspendedSort}
            onRefresh={loadSuspended}
            onUnsuspend={(u) => setUnsuspendModal(u)}
            onViewAppeal={() => switchTab('appeals')}
          />
        )}

        {activeTab === 'lockouts' && (
          <section className="ad-tab-body">
            <div className="ad-toolbar" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="ad-btn"
                onClick={loadLockouts}
                disabled={lockoutsLoading}
              >
                {lockoutsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {lockoutsLoading && lockouts.length === 0 ? (
              <div className="ad-empty">Loading lockouts…</div>
            ) : lockouts.length === 0 ? (
              <div className="ad-empty">No accounts are currently locked out. ✓</div>
            ) : (
              <div className="ad-tablewrap">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Identity</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Locked until</th>
                      <th>Time left</th>
                      <th title="Consecutive lockouts without a successful sign-in in between">Consec.</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lockouts.map((row) => {
                      const lu = new Date(row.locked_until);
                      const ms = lu.getTime() - Date.now();
                      const mins = Math.max(0, Math.ceil(ms / 60000));
                      const timeLeft = mins <= 0 ? 'expiring…'
                        : mins >= 60 ? `~${Math.ceil(mins / 60)} hr`
                        : `${mins} min`;
                      const actionId = `unlock-${row.identity_kind}-${row.account_id}`;
                      return (
                        <tr key={actionId}>
                          <td><span className={`ad-pill ad-pill--${row.identity_kind}`}>{row.identity_kind}</span></td>
                          <td>{row.display_name}</td>
                          <td className="ad-mono">{row.email}</td>
                          <td>{lu.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td>{timeLeft}</td>
                          <td>{row.consecutive_lockout_count}</td>
                          <td>
                            <button
                              type="button"
                              className="ad-btn ad-btn--primary"
                              disabled={busyId === actionId}
                              onClick={() => runAction(
                                actionId,
                                () => adminUnlockAccount(row.identity_kind, row.account_id),
                                loadLockouts,
                              )}
                            >
                              {busyId === actionId ? 'Unlocking…' : 'Unlock'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {hideModal && (
        <HideModal
          row={hideModal}
          onCancel={() => setHideModal(null)}
          onConfirm={handleHideConfirm}
        />
      )}
      {suspendModal && (
        <SuspendModal
          row={suspendModal}
          onCancel={() => setSuspendModal(null)}
          onConfirm={handleSuspendConfirm}
        />
      )}
      {appealDecisionModal && (
        <AppealDecisionModal
          appeal={appealDecisionModal.appeal}
          decision={appealDecisionModal.decision}
          onCancel={() => setAppealDecisionModal(null)}
          onConfirm={handleAppealDecisionConfirm}
        />
      )}
      {unsuspendModal && (
        <UnsuspendModal
          user={unsuspendModal}
          hasAppeal={appeals.some((a) => appealStatus(a) === 'pending' && a.appellant_kind === unsuspendModal.kind && a.appellant_id === unsuspendModal.id && (a.target_kind === 'suspension_citizen' || a.target_kind === 'suspension_rep'))}
          onCancel={() => setUnsuspendModal(null)}
          onConfirm={handleUnsuspendConfirm}
        />
      )}
    </div>
  );
}

function openHostingPage(r) {
  if (!r.context_official_id) return;
  const url = `/?page=${encodeURIComponent(r.context_official_id)}`;
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
}

// ─────────────────────────────────────────────────────────────────────
// SUB-NAV TAB BUTTON
// ─────────────────────────────────────────────────────────────────────
function SubNavTab({ id, label, badge, active, onClick }) {
  return (
    <button
      type="button"
      className={`ad-subnav__item ${active === id ? 'ad-subnav__item--active' : ''}`}
      onClick={() => onClick(id)}
    >
      {label}
      {badge > 0 && <span className="ad-subnav__badge">{badge}</span>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KPI TILE
// ─────────────────────────────────────────────────────────────────────
function KpiTile({ label, value, dotClass }) {
  return (
    <div className="ad-kpi">
      <div className="ad-kpi__label">
        <span className={`ad-kpi__dot ad-kpi__dot--${dotClass}`} />
        {label}
      </div>
      <div className="ad-kpi__num cl-num">{value}</div>
      <div className="ad-kpi__delta ad-kpi__delta--flat">&mdash;</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// QUEUE VIEW (reports)
// ─────────────────────────────────────────────────────────────────────
function QueueView({
  reports, loading, mobile, busyId,
  includeResolved, onIncludeResolved,
  kindChip, onKindChip,
  reporterChip, onReporterChip,
  autoOnly, onAutoOnly,
  onRefresh, onView, onDismiss, onHide, onUnhide, onSuspend,
}) {
  const filtered = useMemo(() => {
    let list = reports;
    if (kindChip !== 'all') list = list.filter((r) => r.kind === kindChip);
    if (reporterChip !== 'any') list = list.filter((r) => r.reporter_kind === reporterChip);
    if (autoOnly) list = list.filter((r) => r.auto_flagged);
    return list;
  }, [reports, kindChip, reporterChip, autoOnly]);

  return (
    <>
      <QueueFilterRow
        includeResolved={includeResolved}
        onIncludeResolved={onIncludeResolved}
        kindChip={kindChip}
        onKindChip={onKindChip}
        reporterChip={reporterChip}
        onReporterChip={onReporterChip}
        autoOnly={autoOnly}
        onAutoOnly={onAutoOnly}
        onRefresh={onRefresh}
        loading={loading}
      />
      {!loading && filtered.length === 0 ? (
        includeResolved ? <EmptyAll /> : <EmptyOpen />
      ) : mobile ? (
        <CardList
          rows={filtered}
          busyId={busyId}
          onView={onView}
          onDismiss={onDismiss}
          onHide={onHide}
          onUnhide={onUnhide}
          onSuspend={onSuspend}
        />
      ) : (
        <QueueTable
          rows={filtered}
          busyId={busyId}
          onView={onView}
          onDismiss={onDismiss}
          onHide={onHide}
          onUnhide={onUnhide}
          onSuspend={onSuspend}
        />
      )}
    </>
  );
}

function QueueFilterRow({
  includeResolved, onIncludeResolved,
  kindChip, onKindChip,
  reporterChip, onReporterChip,
  autoOnly, onAutoOnly,
  onRefresh, loading,
}) {
  const kinds = [
    { id: 'all', label: 'All' },
    { id: 'post', label: 'Rep post' },
    { id: 'post_comment', label: 'Comment' },
    { id: 'poll', label: 'Poll' },
    { id: 'poll_comment', label: 'Poll comment' },
  ];
  const reporters = [
    { id: 'any', label: 'Any' },
    { id: 'citizen', label: 'Citizen' },
    { id: 'rep', label: 'Rep' },
  ];

  return (
    <div className="ad-filters">
      <label className="ad-toggle">
        <input
          type="checkbox"
          checked={includeResolved}
          onChange={(e) => onIncludeResolved(e.target.checked)}
        />
        <span className="ad-toggle__track" />
        Include resolved
      </label>

      <div className="ad-filters__divider" />
      <span className="ad-filters__label">Kind</span>
      <div className="ad-filters__chips">
        {kinds.map((k) => (
          <button key={k.id} type="button" className={`ad-chip ${kindChip === k.id ? 'ad-chip--active' : ''}`} onClick={() => onKindChip(k.id)}>
            {k.label}
          </button>
        ))}
      </div>

      <div className="ad-filters__divider" />
      <span className="ad-filters__label">Reporter</span>
      <div className="ad-filters__chips">
        {reporters.map((r) => (
          <button key={r.id} type="button" className={`ad-chip ${reporterChip === r.id ? 'ad-chip--active' : ''}`} onClick={() => onReporterChip(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      <label className="ad-toggle">
        <input
          type="checkbox"
          checked={autoOnly}
          onChange={(e) => onAutoOnly(e.target.checked)}
        />
        <span className="ad-toggle__track" />
        Auto-flagged only
      </label>

      <div style={{ flex: 1 }} />

      <div className="ad-search">
        <SearchIcon size={14} />
        <input placeholder="Search reports…" disabled />
        <span className="ad-search__stub" title="Backend doesn't index reports yet — shipping with v2">Stub</span>
      </div>

      <button type="button" className="ad-iconbtn" onClick={onRefresh} disabled={loading}>
        <RefreshIcon size={14} />
        <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
      </button>
    </div>
  );
}

function QueueTable({ rows, busyId, onView, onDismiss, onHide, onUnhide, onSuspend }) {
  const open = rows.filter((r) => reportStatus(r) === 'open').length;
  const hidden = rows.filter((r) => reportStatus(r) === 'hidden').length;
  return (
    <div className="ad-tablewrap">
      <div className="ad-tablewrap__count">
        <span>
          Showing <strong>{rows.length}</strong> {rows.length === 1 ? 'report' : 'reports'}
          {' · '}<strong>{open}</strong> open
          {' · '}<strong>{hidden}</strong> hidden
        </span>
        <span className="ad-tablewrap__count-actions">
          <button type="button" className="ad-linkbtn" disabled>
            Sort: Newest first ↓ <span className="ad-stub" style={{ marginLeft: 4 }}>Stub</span>
          </button>
          <button type="button" className="ad-linkbtn" disabled>
            Density: Compact <span className="ad-stub" style={{ marginLeft: 4 }}>Stub</span>
          </button>
        </span>
      </div>
      <div className="ad-tablewrap__scroll">
        <table className="ad-table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>Type</th>
              <th>Content preview</th>
              <th style={{ width: 170 }}>Reason</th>
              <th style={{ width: 130 }}>Reporter</th>
              <th style={{ width: 90 }}>When</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 290 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = reportStatus(r);
              const meta = TYPE_META[r.kind] || { label: r.kind, iconClass: '', Icon: TypeCommentIcon };
              return (
                <tr key={`${r.kind}-${r.id}`} className={status === 'hidden' ? 'is-hidden' : status === 'resolved' ? 'is-resolved' : ''}>
                  <td>
                    <div className="ad-cell-type">
                      <div className="ad-cell-type__main">
                        <span className={`ad-cell-type__icon ad-cell-type__icon--${meta.iconClass}`}>
                          <meta.Icon size={14} />
                        </span>
                        {meta.label}
                      </div>
                      <span className="ad-cell-type__id">id={r.target_id}</span>
                    </div>
                  </td>
                  <td>
                    <div className="ad-cell-preview" title={r.target_preview || ''}>
                      {r.target_preview || <em style={{ color: 'var(--cl-text-muted)' }}>(empty)</em>}
                    </div>
                  </td>
                  <td>
                    <div className="ad-cell-reason">
                      <span className={`ad-cell-reason__pill ad-cell-reason__pill--${reasonPillKey(r.reason)}`}>
                        {formatReason(r.reason)}
                      </span>
                      {r.detail && <div className="ad-cell-reason-text">&ldquo;{r.detail}&rdquo;</div>}
                    </div>
                  </td>
                  <td>
                    <div className="ad-cell-reporter">
                      <span className="ad-cell-reporter__name">{r.reporter_name || '—'}</span>
                      <span className={`ad-cell-reporter__kind ad-cell-reporter__kind--${r.reporter_kind || 'citizen'}`}>
                        {r.reporter_kind === 'rep' ? 'Rep' : 'Citizen'}
                      </span>
                      {r.auto_flagged && <span className="ad-cell-reporter__autoflag">Auto-flag</span>}
                    </div>
                  </td>
                  <td>
                    <div className="ad-cell-when">
                      <span className="ad-cell-when__rel">{relTime(r.created_at)}</span>
                      <span>{absTime(r.created_at)}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={status} />
                  </td>
                  <td>
                    <RowActions
                      r={r}
                      busyId={busyId}
                      onView={() => onView(r)}
                      onDismiss={() => onDismiss(r)}
                      onHide={() => onHide(r)}
                      onUnhide={() => onUnhide(r)}
                      onSuspend={() => onSuspend(r)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CardList({ rows, busyId, onView, onDismiss, onHide, onUnhide, onSuspend }) {
  return (
    <div className="ad-cardlist">
      {rows.map((r) => {
        const status = reportStatus(r);
        const meta = TYPE_META[r.kind] || { label: r.kind, iconClass: '', Icon: TypeCommentIcon };
        return (
          <div key={`${r.kind}-${r.id}`} className={`ad-card ${status === 'hidden' ? 'is-hidden' : status === 'resolved' ? 'is-resolved' : ''}`}>
            <div className="ad-card__hdr">
              <div className="ad-card__type">
                <span className={`ad-cell-type__icon ad-cell-type__icon--${meta.iconClass}`}>
                  <meta.Icon size={14} />
                </span>
                <div className="ad-card__type-text">
                  <div className="ad-card__type-main">{meta.label}</div>
                  <div className="ad-card__type-id">id={r.target_id}</div>
                </div>
              </div>
              <StatusPill status={status} />
            </div>
            <div className="ad-card__preview">{r.target_preview || '(empty)'}</div>
            <div className="ad-card__meta">
              <div>
                <span className="ad-card__metalabel">Reason</span>
                <span
                  className={`ad-cell-reason__pill ad-cell-reason__pill--${reasonPillKey(r.reason)}`}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {formatReason(r.reason)}
                </span>
                {r.detail && (
                  <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)', lineHeight: 1.35, marginTop: 4 }}>
                    &ldquo;{r.detail}&rdquo;
                  </div>
                )}
              </div>
              <div>
                <span className="ad-card__metalabel">Reporter · When</span>
                <div style={{ fontSize: 'var(--cl-text-sm)', fontWeight: 600 }}>{r.reporter_name || '—'}</div>
                <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>
                  {r.reporter_kind === 'rep' ? 'Rep' : 'Citizen'} · {relTime(r.created_at)}
                </div>
                {r.auto_flagged && (
                  <div className="ad-cell-reporter__autoflag" style={{ marginTop: 3 }}>Auto-flag</div>
                )}
              </div>
            </div>
            <div className="ad-card__actions">
              <RowActions
                r={r}
                busyId={busyId}
                onView={() => onView(r)}
                onDismiss={() => onDismiss(r)}
                onHide={() => onHide(r)}
                onUnhide={() => onUnhide(r)}
                onSuspend={() => onSuspend(r)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RowActions({ r, busyId, onView, onDismiss, onHide, onUnhide, onSuspend }) {
  const status = reportStatus(r);
  const isResolved = status === 'resolved';
  const isHidden = status === 'hidden';
  const dismissBusy = busyId === `dismiss-${r.kind}-${r.id}`;
  const hideBusy = busyId === `hide-${r.kind}-${r.id}`;
  const unhideBusy = busyId === `unhide-${r.kind}-${r.id}`;
  const suspendBusy = busyId === `suspend-${r.target_author_kind}-${r.target_author_id}`;
  const authorIsRep = r.target_author_kind === 'rep';

  return (
    <div className="ad-actions">
      {r.context_official_id && (
        <button
          type="button"
          className="ad-actbtn"
          onClick={onView}
          title="Open hosting page in new tab"
          aria-label="View hosting page"
        >
          <ExternalIcon size={11} />
        </button>
      )}
      {!isResolved && (
        <>
          <span className="ad-act-sep" />
          <button type="button" className="ad-actbtn" onClick={onDismiss} disabled={dismissBusy}>
            <DismissIcon size={12} />
            <span>Dismiss</span>
          </button>
          {isHidden ? (
            <button type="button" className="ad-actbtn" onClick={onUnhide} disabled={unhideBusy}>
              <UnhideIcon size={12} />
              <span>Unhide</span>
            </button>
          ) : (
            <button type="button" className="ad-actbtn ad-actbtn--danger" onClick={onHide} disabled={hideBusy}>
              <HideIcon size={12} />
              <span>Hide</span>
            </button>
          )}
          {r.target_author_id && r.target_author_kind && (
            <button
              type="button"
              className="ad-actbtn ad-actbtn--danger-solid"
              onClick={onSuspend}
              disabled={suspendBusy}
              title={`Suspend ${authorIsRep ? 'rep' : 'citizen'} ${r.target_author_name || ''}`}
            >
              <SuspendIcon size={12} />
              <span>Suspend</span>
            </button>
          )}
        </>
      )}
      {isResolved && (
        <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-muted)', fontStyle: 'italic', marginLeft: 6 }}>
          Resolved {relTime(r.acted_at)}
        </span>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const label = status === 'hidden' ? 'Hidden' : status === 'resolved' ? 'Resolved' : 'Open';
  return (
    <span className={`ad-status ad-status--${status}`}>
      <span className="ad-status__dot" />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// APPEALS VIEW
// ─────────────────────────────────────────────────────────────────────
function AppealsView({
  appeals, loading,
  includeResolved, onIncludeResolved,
  typeChip, onTypeChip,
  appellantChip, onAppellantChip,
  onRefresh, onGrant, onDeny,
}) {
  const filtered = useMemo(() => {
    let list = appeals;
    if (typeChip !== 'all') {
      const isSuspension = typeChip === 'suspension';
      list = list.filter((a) => {
        const t = APPEAL_TARGET_META[a.target_kind]?.type || 'content';
        return isSuspension ? t === 'suspension' : t === 'content';
      });
    }
    if (appellantChip !== 'any') list = list.filter((a) => a.appellant_kind === appellantChip);
    return list;
  }, [appeals, typeChip, appellantChip]);

  return (
    <>
      <AppealsFilterRow
        includeResolved={includeResolved}
        onIncludeResolved={onIncludeResolved}
        typeChip={typeChip}
        onTypeChip={onTypeChip}
        appellantChip={appellantChip}
        onAppellantChip={onAppellantChip}
        onRefresh={onRefresh}
        loading={loading}
      />
      {!loading && filtered.length === 0 ? (
        <AppealsEmpty includeResolved={includeResolved} />
      ) : (
        <div className="ad-appeals-list">
          <div className="ad-appeals-list__count">
            <span>
              Showing <strong>{filtered.length}</strong> {filtered.length === 1 ? 'appeal' : 'appeals'}
              {' · '}<strong>{filtered.filter((a) => appealStatus(a) === 'pending').length}</strong> pending
            </span>
            <span className="ad-tablewrap__count-actions">
              <button type="button" className="ad-linkbtn" disabled>
                Sort: Newest first ↓ <span className="ad-stub" style={{ marginLeft: 4 }}>Stub</span>
              </button>
            </span>
          </div>
          {filtered.map((a) => (
            <AppealCard key={a.id} appeal={a} onGrant={onGrant} onDeny={onDeny} />
          ))}
        </div>
      )}
    </>
  );
}

function AppealsFilterRow({
  includeResolved, onIncludeResolved,
  typeChip, onTypeChip,
  appellantChip, onAppellantChip,
  onRefresh, loading,
}) {
  const types = [
    { id: 'all',         label: 'All' },
    { id: 'content',     label: 'Content' },
    { id: 'suspension',  label: 'Account suspension' },
  ];
  const kinds = [
    { id: 'any',     label: 'Any' },
    { id: 'citizen', label: 'Citizen' },
    { id: 'rep',     label: 'Rep' },
  ];
  return (
    <div className="ad-filters">
      <label className="ad-toggle">
        <input
          type="checkbox"
          checked={includeResolved}
          onChange={(e) => onIncludeResolved(e.target.checked)}
        />
        <span className="ad-toggle__track" />
        Include resolved
      </label>

      <div className="ad-filters__divider" />
      <span className="ad-filters__label">Type</span>
      <div className="ad-filters__chips">
        {types.map((t) => (
          <button key={t.id} type="button" className={`ad-chip ${typeChip === t.id ? 'ad-chip--active' : ''}`} onClick={() => onTypeChip(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="ad-filters__divider" />
      <span className="ad-filters__label">Appellant</span>
      <div className="ad-filters__chips">
        {kinds.map((k) => (
          <button key={k.id} type="button" className={`ad-chip ${appellantChip === k.id ? 'ad-chip--active' : ''}`} onClick={() => onAppellantChip(k.id)}>
            {k.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <div className="ad-search">
        <SearchIcon size={14} />
        <input placeholder="Search appeals…" disabled />
        <span className="ad-search__stub" title="Backend doesn't index appeals yet">Stub</span>
      </div>

      <button type="button" className="ad-iconbtn" onClick={onRefresh} disabled={loading}>
        <RefreshIcon size={14} />
        <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
      </button>
    </div>
  );
}

function AppealCard({ appeal, onGrant, onDeny }) {
  const status = appealStatus(appeal);
  const meta = APPEAL_TARGET_META[appeal.target_kind] || { label: appeal.target_kind, type: 'content' };
  const isSuspension = meta.type === 'suspension';
  const stateCls = status === 'granted' ? 'is-granted' : status === 'denied' ? 'is-denied' : '';
  return (
    <article className={`ad-appeal ${stateCls}`}>
      <header className="ad-appeal__strip">
        <div className="ad-appeal__strip-left">
          <span className={`ad-typechip ${isSuspension ? 'ad-typechip--suspension' : 'ad-typechip--content'}`}>
            {isSuspension ? 'Account suspension' : 'Content appeal'}
          </span>
          <span className="ad-appeal__id">id={appeal.id}</span>
        </div>
        <div className="ad-appeal__strip-right">
          <span className="ad-appeal__filed">Filed {relTime(appeal.created_at)}</span>
          <span className="ad-appeal__filed-abs">{absTime(appeal.created_at)}</span>
        </div>
      </header>

      <div className="ad-appeal__appellant">
        <div className={`ad-appeal__avatar ad-appeal__avatar--${kindToken(appeal.appellant_kind)}`}>
          {initialsFromName(appeal.appellant_name)}
        </div>
        <div className="ad-appeal__appellant-meta">
          <div className="ad-appeal__appellant-name">
            {appeal.appellant_name || 'Anonymous appellant'}
            <span className={`ad-kindpill ad-kindpill--${kindToken(appeal.appellant_kind)}`}>
              {kindLabel(appeal.appellant_kind)}
            </span>
          </div>
          {appeal.appellant_email && (
            <div className="ad-appeal__appellant-email">{appeal.appellant_email}</div>
          )}
        </div>
      </div>

      <div className="ad-appeal__details">
        <div className="ad-appeal__details-label">
          What was {isSuspension ? 'suspended' : 'hidden'}
        </div>
        <div className="ad-appeal__details-meta">
          {!isSuspension && meta.Icon && (
            <>
              <span className={`ad-cell-type__icon ad-cell-type__icon--${meta.iconClass}`} style={{ width: 22, height: 22 }}>
                <meta.Icon size={12} />
              </span>
              <span className="ad-appeal__details-target">{meta.label}</span>
              <span className="ad-appeal__details-sep">·</span>
              <span className="ad-appeal__details-id">id={appeal.target_id}</span>
            </>
          )}
          {isSuspension && (
            <>
              <span className="ad-typechip ad-typechip--suspension">Account</span>
              <span className="ad-appeal__details-id">id={appeal.target_id}</span>
            </>
          )}
        </div>
        {appeal.target_preview && (
          <div className="ad-appeal__details-preview">&ldquo;{appeal.target_preview}&rdquo;</div>
        )}
        {appeal.target_hidden_at && (
          <div className="ad-appeal__details-action">
            <strong>{isSuspension ? 'Suspended' : 'Hidden'}</strong>
            <span className="ad-appeal__details-sep">·</span>
            <span style={{ color: 'var(--cl-text-muted)' }}>{relTime(appeal.target_hidden_at)}</span>
          </div>
        )}
      </div>

      <div className="ad-appeal__rationale">
        <div className="ad-appeal__rationale-label">Appellant rationale</div>
        <div className="ad-appeal__rationale-body">{appeal.rationale}</div>
      </div>

      {status === 'pending' ? (
        <footer className="ad-appeal__footer">
          <button type="button" className="ad-btn ad-btn--ghost-danger" onClick={() => onDeny(appeal)}>Deny</button>
          <button type="button" className="ad-btn ad-btn--grant" onClick={() => onGrant(appeal)}>Grant</button>
        </footer>
      ) : (
        <footer className="ad-appeal__resolved">
          <span className={`ad-appeal__resolved-badge ad-appeal__resolved-badge--${status}`}>
            {status === 'granted' ? '✓ Granted' : '✕ Denied'}
          </span>
          <span>{relTime(appeal.acted_at)}</span>
          {appeal.admin_note && (
            <span className="ad-appeal__resolved-note">— &ldquo;{appeal.admin_note}&rdquo;</span>
          )}
        </footer>
      )}
    </article>
  );
}

function AppealsEmpty({ includeResolved }) {
  return (
    <div className="ad-empty">
      <svg className="ad-empty__art" viewBox="0 0 180 96" aria-hidden="true">
        <rect x="34" y="22" width="80" height="58" rx="8" fill="#ffffff" stroke="#dee2e6" strokeWidth="1.5" />
        <path d="M48 36h54M48 46h44M48 56h36M48 66h24" stroke="#dee2e6" strokeWidth="2" strokeLinecap="round" />
        <g transform="translate(118, 30) rotate(-25)">
          <rect x="0" y="8" width="32" height="10" rx="2" fill="#1b263b" />
          <rect x="10" y="0" width="12" height="6" rx="1.5" fill="#1b263b" />
          <rect x="10" y="20" width="12" height="6" rx="1.5" fill="#1b263b" />
          <rect x="32" y="11" width="22" height="4" rx="1" fill="#1b263b" />
        </g>
        <circle cx="158" cy="74" r="6" fill="#e6f3ec" stroke="#27ae60" strokeWidth="1.5" />
        <path d="M155 74 l2.5 2.5 l5 -5" stroke="#1e8048" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <h2 className="ad-empty__title">
        {includeResolved ? 'No appeals on file yet.' : 'No appeals waiting.'}
      </h2>
      <p className="ad-empty__body">
        Citizens and reps can appeal hidden content or account suspensions; nothing pending right now.
        New appeals show up here within a minute of being filed.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SUSPENDED VIEW
// ─────────────────────────────────────────────────────────────────────
function SuspendedView({
  users, appeals, loading, mobile,
  kindChip, onKindChip, sort, onSort,
  onRefresh, onUnsuspend, onViewAppeal,
}) {
  const filtered = useMemo(() => {
    let list = users;
    if (kindChip !== 'all') list = list.filter((u) => u.kind === kindChip);
    if (sort === 'oldest') list = [...list].sort((a, b) => new Date(a.suspended_at) - new Date(b.suspended_at));
    else list = [...list].sort((a, b) => new Date(b.suspended_at) - new Date(a.suspended_at));
    return list;
  }, [users, kindChip, sort]);

  // Augment each user with hasAppeal flag derived from the loaded
  // appeals list — saves a per-row API call.
  const augmented = useMemo(() => filtered.map((u) => {
    const pending = appeals.some((a) =>
      appealStatus(a) === 'pending'
      && a.appellant_kind === u.kind
      && a.appellant_id === u.id
      && (a.target_kind === 'suspension_citizen' || a.target_kind === 'suspension_rep')
    );
    return { ...u, hasAppeal: pending };
  }), [filtered, appeals]);

  return (
    <>
      <SuspendedFilterRow
        kindChip={kindChip}
        onKindChip={onKindChip}
        sort={sort}
        onSort={onSort}
        onRefresh={onRefresh}
        loading={loading}
      />
      {!loading && augmented.length === 0 ? (
        <SuspendedEmpty />
      ) : mobile ? (
        <SuspendedCardList rows={augmented} onUnsuspend={onUnsuspend} onViewAppeal={onViewAppeal} />
      ) : (
        <SuspendedTable rows={augmented} onUnsuspend={onUnsuspend} onViewAppeal={onViewAppeal} />
      )}
    </>
  );
}

function SuspendedFilterRow({ kindChip, onKindChip, sort, onSort, onRefresh, loading }) {
  const kinds = [
    { id: 'all',     label: 'All' },
    { id: 'citizen',label: 'Citizen' },
    { id: 'rep',     label: 'Rep' },
  ];
  return (
    <div className="ad-filters">
      <span className="ad-filters__label">Kind</span>
      <div className="ad-filters__chips">
        {kinds.map((k) => (
          <button key={k.id} type="button" className={`ad-chip ${kindChip === k.id ? 'ad-chip--active' : ''}`} onClick={() => onKindChip(k.id)}>
            {k.label}
          </button>
        ))}
      </div>

      <div className="ad-filters__divider" />

      <div className="ad-sortselect">
        <span className="ad-filters__label" style={{ marginRight: 6 }}>Sort</span>
        <select className="ad-select" value={sort} onChange={(e) => onSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      <div style={{ flex: 1 }} />

      <div className="ad-search">
        <SearchIcon size={14} />
        <input placeholder="Search by name or email…" disabled />
        <span className="ad-search__stub" title="Backend doesn't index user records yet">Stub</span>
      </div>

      <button type="button" className="ad-iconbtn" onClick={onRefresh} disabled={loading}>
        <RefreshIcon size={14} />
        <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
      </button>
    </div>
  );
}

function SuspendedTable({ rows, onUnsuspend, onViewAppeal }) {
  return (
    <div className="ad-tablewrap">
      <div className="ad-tablewrap__count">
        <span>
          Showing <strong>{rows.length}</strong> {rows.length === 1 ? 'account' : 'accounts'}
        </span>
      </div>
      <div className="ad-tablewrap__scroll">
        <table className="ad-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Kind</th>
              <th style={{ width: 220 }}>Display name</th>
              <th style={{ width: 220 }}>Email</th>
              <th style={{ width: 130 }}>Suspended</th>
              <th>Reason</th>
              <th style={{ width: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={`${u.kind}-${u.id}`} className={u.hasAppeal ? 'is-appeal' : ''}>
                <td>
                  <span className={`ad-kindpill ad-kindpill--${kindToken(u.kind)}`}>
                    {kindLabel(u.kind)}
                  </span>
                </td>
                <td>
                  <div className="ad-cell-account">
                    <div className={`ad-account-avatar ad-account-avatar--${kindToken(u.kind)}`} style={{ width: 32, height: 32, fontSize: '0.78rem' }}>
                      {initialsFromName(u.display_name)}
                    </div>
                    <div>
                      <div className="ad-cell-account__name">{u.display_name || '—'}</div>
                      <div className="ad-cell-account__id">id={u.id}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="ad-cell-email" title={u.email}>{u.email || '—'}</div>
                </td>
                <td>
                  <div className="ad-cell-when">
                    <span className="ad-cell-when__rel">{relTime(u.suspended_at)}</span>
                    <span>{absTime(u.suspended_at)}</span>
                  </div>
                </td>
                <td>
                  <div className="ad-cell-reason">
                    <div className="ad-cell-reason-text" title={u.suspended_reason} style={{ maxWidth: 340 }}>
                      {u.suspended_reason || <em style={{ color: 'var(--cl-text-muted)' }}>(no reason given)</em>}
                    </div>
                    {u.hasAppeal && (
                      <a
                        className="ad-appeal-link"
                        href="/admin?tab=appeals"
                        onClick={(e) => { e.preventDefault(); onViewAppeal(); }}
                        title="Open Appeals tab"
                        style={{ marginTop: 4, alignSelf: 'flex-start' }}
                      >
                        <span className="ad-appeal-link__dot" /> Appeal pending →
                      </a>
                    )}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="ad-actions">
                    <button
                      type="button"
                      className="ad-actbtn ad-actbtn--grant-solid"
                      onClick={() => onUnsuspend(u)}
                    >
                      <UnhideIcon size={12} />
                      <span>Unsuspend</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SuspendedCardList({ rows, onUnsuspend, onViewAppeal }) {
  return (
    <div className="ad-cardlist">
      {rows.map((u) => (
        <div key={`${u.kind}-${u.id}`} className={`ad-card ${u.hasAppeal ? 'is-appeal' : ''}`}>
          <div className="ad-card__hdr">
            <div className="ad-card__type" style={{ gap: 10 }}>
              <div className={`ad-account-avatar ad-account-avatar--${kindToken(u.kind)}`} style={{ width: 36, height: 36, fontSize: '0.86rem' }}>
                {initialsFromName(u.display_name)}
              </div>
              <div className="ad-card__type-text">
                <div className="ad-card__type-main">{u.display_name || '—'}</div>
                <div className="ad-card__type-id" style={{ fontFamily: 'inherit', fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>{u.email}</div>
              </div>
            </div>
            <span className={`ad-kindpill ad-kindpill--${u.kind === 'rep' ? 'rep' : 'citizen'}`}>
              {u.kind === 'rep' ? 'Rep' : 'Citizen'}
            </span>
          </div>

          {u.hasAppeal && (
            <a
              className="ad-appeal-link"
              href="/admin?tab=appeals"
              onClick={(e) => { e.preventDefault(); onViewAppeal(); }}
              style={{ alignSelf: 'flex-start' }}
            >
              <span className="ad-appeal-link__dot" /> Appeal pending →
            </a>
          )}

          <div className="ad-card__meta">
            <div>
              <span className="ad-card__metalabel">Suspended</span>
              <div style={{ fontSize: 'var(--cl-text-sm)', fontWeight: 600 }}>{relTime(u.suspended_at)}</div>
              <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>{absTime(u.suspended_at)}</div>
            </div>
            <div>
              <span className="ad-card__metalabel">Reason</span>
              <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text)', lineHeight: 1.45 }}>
                {u.suspended_reason || '(no reason given)'}
              </div>
            </div>
          </div>

          <div className="ad-card__actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <button type="button" className="ad-btn ad-btn--grant" onClick={() => onUnsuspend(u)} style={{ width: '100%' }}>
              <UnhideIcon size={13} /> Unsuspend
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SuspendedEmpty() {
  return (
    <div className="ad-empty">
      <svg className="ad-empty__art" viewBox="0 0 180 96" aria-hidden="true">
        <circle cx="90" cy="48" r="34" fill="none" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="3 5" />
        <circle cx="90" cy="40" r="14" fill="#e6f3ec" stroke="#27ae60" strokeWidth="1.8" />
        <path d="M82 40l6 6 10-12" stroke="#1e8048" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="68" y="60" width="44" height="14" rx="7" fill="#ffffff" stroke="#dee2e6" strokeWidth="1.5" />
        <path d="M76 67h28" stroke="#dee2e6" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <h2 className="ad-empty__title">No suspended accounts.</h2>
      <p className="ad-empty__body">
        Nobody is suspended right now. When you suspend a citizen or rep from the moderation queue,
        they show up here with the suspension reason and a one-click unsuspend.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EMPTY STATES (Queue)
// ─────────────────────────────────────────────────────────────────────
function EmptyOpen() {
  return (
    <div className="ad-empty">
      <svg className="ad-empty__art" viewBox="0 0 180 96" aria-hidden="true">
        <rect x="46" y="22" width="84" height="58" rx="8" fill="#ffffff" stroke="#dee2e6" strokeWidth="1.5" />
        <rect x="38" y="14" width="84" height="58" rx="8" fill="#ffffff" stroke="#dee2e6" strokeWidth="1.5" />
        <path d="M52 30h62M52 38h54M52 46h44M52 54h32" stroke="#dee2e6" strokeWidth="2" strokeLinecap="round" />
        <circle cx="135" cy="62" r="22" fill="#e6f3ec" stroke="#27ae60" strokeWidth="2" />
        <path d="M125 62 l7 7 l13 -14" stroke="#1e8048" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <text x="135" y="42" fontSize="6" fontWeight="800" textAnchor="middle" fill="#1e8048" letterSpacing="0.5">CLEARED</text>
      </svg>
      <h2 className="ad-empty__title">No open reports right now.</h2>
      <p className="ad-empty__body">
        The queue is clear. New reports from citizens, reps, or auto-detection will surface
        here automatically. Toggle <em>&ldquo;Include resolved&rdquo;</em> above to review the
        last week of decisions.
      </p>
    </div>
  );
}

function EmptyAll() {
  return (
    <div className="ad-empty">
      <svg className="ad-empty__art" viewBox="0 0 180 96" aria-hidden="true">
        <rect x="48" y="22" width="84" height="58" rx="8" fill="#ffffff" stroke="#dee2e6" strokeWidth="1.5" />
        <path d="M62 38h56M62 48h42M62 58h28" stroke="#dee2e6" strokeWidth="2" strokeLinecap="round" />
        <circle cx="90" cy="51" r="44" fill="none" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="3 5" />
      </svg>
      <h2 className="ad-empty__title">No reports in the system yet.</h2>
      <p className="ad-empty__body">
        Nothing&rsquo;s been flagged since CivicView launched. When a citizen or rep files
        a report, or auto-detection flags content, it&rsquo;ll appear here for triage.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────────────────────
function HideModal({ row, onCancel, onConfirm }) {
  const meta = TYPE_META[row.kind] || { label: row.kind };
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow">Destructive action</div>
          <h2 className="ad-modal__title">Hide this {meta.label.toLowerCase()}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            The content will be hidden from public view immediately. The author can see it&rsquo;s
            been moderated, and a hide event is logged against report <strong>#{row.id}</strong>.
          </div>
          <div className="ad-modal__contentblock">
            <div className="ad-modal__contentmeta">
              <span>{meta.label}</span>
              <span>·</span>
              <span style={{ fontFamily: 'var(--cl-font-mono)', textTransform: 'none', letterSpacing: 0 }}>
                id={row.target_id}
              </span>
              <span>·</span>
              <span>Reported for: {formatReason(row.reason)}</span>
            </div>
            <div className="ad-modal__contentbody">&ldquo;{row.target_preview || '(empty)'}&rdquo;</div>
            {row.target_author_name && (
              <div className="ad-modal__contentauthor">
                — {row.target_author_name}{row.target_author_kind ? ` (${row.target_author_kind})` : ''}
              </div>
            )}
          </div>
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="ad-btn ad-btn--danger" onClick={onConfirm} autoFocus>
            Hide content
          </button>
        </div>
      </div>
    </div>
  );
}

function SuspendModal({ row, onCancel, onConfirm }) {
  const [reason, setReason] = useState(row?.detail || formatReason(row?.reason) || '');
  const [alsoHide, setAlsoHide] = useState(false);
  const authorKind = row.target_author_kind === 'rep' ? 'rep' : 'citizen';
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal ad-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow">Destructive action</div>
          <h2 className="ad-modal__title">Suspend {row.target_author_name || 'this user'}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            The {authorKind} account will be unable to post, comment, or vote. They&rsquo;ll see
            a &ldquo;Suspended&rdquo; banner on next visit. Suspension is reversible from the{' '}
            <strong>Suspended users</strong> tab.
          </div>

          <div className="ad-modal__row">
            <span className="ad-modal__label">Reason on record (visible to other admins)</span>
            <textarea
              className="ad-modal__textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you suspending this account?"
            />
          </div>

          <div className="ad-modal__hr" />

          <div className="ad-modal__checkrow">
            <button
              type="button"
              className={`ad-modal__check ${alsoHide ? 'checked' : ''}`}
              onClick={() => setAlsoHide((v) => !v)}
              aria-pressed={alsoHide}
              aria-label={`Also hide all of ${row.target_author_name || 'this user'}'s existing content`}
            />
            <div className="ad-modal__checktext">
              <strong>Also hide all of {row.target_author_name || 'this user'}&rsquo;s existing content</strong>
              <div style={{ marginTop: 2 }}>
                Hides every post and comment on the account in addition to the suspension.
                Default off — usually we leave history visible.
              </div>
            </div>
          </div>
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="ad-btn ad-btn--danger"
            onClick={() => onConfirm({ reason, alsoHide })}
          >
            Suspend {authorKind}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppealDecisionModal({ appeal, decision, onCancel, onConfirm }) {
  const [note, setNote] = useState('');
  const isGrant = decision === 'grant';
  const meta = APPEAL_TARGET_META[appeal.target_kind] || { label: appeal.target_kind, type: 'content' };
  const isSuspension = meta.type === 'suspension';
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className={`ad-modal__eyebrow ${isGrant ? 'ad-modal__eyebrow--success' : ''}`}>
            {isGrant ? 'Reversible action' : 'Destructive action'}
          </div>
          <h2 className="ad-modal__title">
            {isGrant
              ? `Grant appeal from ${appeal.appellant_name || 'this appellant'}?`
              : `Deny appeal from ${appeal.appellant_name || 'this appellant'}?`}
          </h2>
        </div>
        <div className="ad-modal__body">
          <div>
            {isGrant
              ? isSuspension
                ? <>The account <strong>{appeal.appellant_email}</strong> will be unsuspended and can post, comment, and vote again immediately.</>
                : <>The <strong>{meta.label.toLowerCase()}</strong> will be reinstated to public view. The original report against it is closed as resolved.</>
              : <>The moderation action stays in place. The appellant sees a &ldquo;Denied&rdquo; status and can read the admin note below.</>}
          </div>
          <div className="ad-modal__row">
            <span className="ad-modal__label">Admin note on record (optional, visible to appellant)</span>
            <textarea
              className="ad-modal__textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isGrant
                ? "Why are you granting this? e.g. 'Reporter retracted', 'Content was within bounds'"
                : "Why are you denying this? e.g. 'Pattern of escalation', 'Auto-detect signals confirmed'"
              }
            />
            <span className="ad-modal__hint">
              Encouraged — the appellant sees this and the audit log preserves it.
            </span>
          </div>
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          {isGrant ? (
            <button type="button" className="ad-btn ad-btn--grant" onClick={() => onConfirm({ decision: 'grant', note })}>
              Grant appeal
            </button>
          ) : (
            <button type="button" className="ad-btn ad-btn--danger" onClick={() => onConfirm({ decision: 'deny', note })}>
              Deny appeal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UnsuspendModal({ user, hasAppeal, onCancel, onConfirm }) {
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow ad-modal__eyebrow--success">Reversible action</div>
          <h2 className="ad-modal__title">Unsuspend {user.display_name || 'this user'}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            They&rsquo;ll regain the ability to post, comment, and vote immediately.
            The suspension record stays on the audit log; you can re-suspend at any time.
          </div>
          <div className="ad-modal__contentblock" style={{ borderLeftColor: 'var(--cl-success)' }}>
            <div className="ad-modal__contentmeta">
              <span className={`ad-kindpill ad-kindpill--${kindToken(user.kind)}`}>
                {kindLabel(user.kind)}
              </span>
              <span>·</span>
              <span style={{ fontFamily: 'var(--cl-font-mono)', textTransform: 'none', letterSpacing: 0 }}>{user.email}</span>
            </div>
            {user.suspended_at && (
              <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>
                Suspended <strong>{relTime(user.suspended_at)}</strong>
              </div>
            )}
            {user.suspended_reason && (
              <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text)' }}>
                &ldquo;{user.suspended_reason}&rdquo;
              </div>
            )}
          </div>
          {hasAppeal && (
            <div style={{
              fontSize: 'var(--cl-text-xs)',
              padding: '10px 12px',
              background: 'var(--cl-warning-soft)',
              color: 'var(--cl-warning-text)',
              border: '1px solid var(--cl-warning-border)',
              borderRadius: 'var(--cl-radius-md)',
              lineHeight: 1.5,
            }}>
              <strong>Note:</strong> this account has an open appeal. Resolve it from the
              Appeals tab if you want the audit log to reflect a deliberate decision; an
              unsuspend here doesn&rsquo;t auto-resolve the appeal.
            </div>
          )}
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="ad-btn ad-btn--grant" onClick={() => onConfirm(user)} autoFocus>
            <UnhideIcon size={13} /> Unsuspend
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// GLYPHS — lifted from the Claude Design export.
// ─────────────────────────────────────────────────────────────────────
function TypePostIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" fill="rgba(45,106,79,0.18)" />
      <path d="M7 9h10M7 13h10M7 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function TypeCommentIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M4 5h16v11H9l-4 4V5Z" fill="rgba(69,123,157,0.22)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function TypePollIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="3" y="5" width="18" height="3.5" rx="1.5" fill="rgba(255,186,8,0.45)" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="10.5" width="13" height="3.5" rx="1.5" fill="rgba(255,186,8,0.3)" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="16" width="8" height="3.5" rx="1.5" fill="rgba(255,186,8,0.2)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function TypePollCommentIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="3" y="3" width="9" height="3" rx="1.5" fill="rgba(108,62,193,0.3)" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3" y="7.5" width="6" height="3" rx="1.5" fill="rgba(108,62,193,0.18)" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 14h11v6h-7l-4 3v-9Z" fill="rgba(108,62,193,0.18)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function RefreshIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M20 4v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function SearchIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function ExternalIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M14 4h6v6M20 4l-8 8M11 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function HideIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M3 12s3.5-6 9-6c2 0 3.7.7 5.1 1.7M21 12s-3.5 6-9 6c-2 0-3.7-.7-5.1-1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
    </svg>
  );
}
function UnhideIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="rgba(45,106,79,0.18)" />
    </svg>
  );
}
function DismissIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SuspendIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path d="M5.5 5.5l13 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
