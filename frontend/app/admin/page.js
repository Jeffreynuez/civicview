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
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
  adminLoadDashboard,
} from '@/lib/pagesApi';
import './admin.css';
import HScroll from '@/components/HScroll';
import TransitionsTab from '@/components/admin/TransitionsTab';
import ElectionRemindersTab from '@/components/admin/ElectionRemindersTab';
import AdminShell from '@/components/admin/AdminShell';
import HistoryTab from '@/components/admin/HistoryTab';
import AccountsTab from '@/components/admin/AccountsTab';
import { serverDate, serverMs } from '@/lib/serverTime';
import { ReasonField, kindLabel, kindToken, reasonOk, useAdminDialog } from '@/components/admin/adminUi';

const VALID_TABS = new Set(['queue', 'appeals', 'suspended', 'lockouts', 'accounts', 'transitions', 'reminders', 'history']);

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
// suspension_rep / suspension_citizen / suspension_candidate (account appeals).
const APPEAL_TARGET_META = {
  post:         { label: 'Hidden post',        type: 'content', iconClass: 'post',        Icon: TypePostIcon },
  post_comment: { label: 'Hidden comment',     type: 'content', iconClass: 'comment',     Icon: TypeCommentIcon },
  poll:         { label: 'Hidden poll',        type: 'content', iconClass: 'poll',        Icon: TypePollIcon },
  poll_comment: { label: 'Hidden poll comment',type: 'content', iconClass: 'pollcomment', Icon: TypePollCommentIcon },
  suspension_rep:     { label: 'Rep suspension',     type: 'suspension' },
  suspension_citizen: { label: 'Citizen suspension', type: 'suspension' },
  suspension_candidate: { label: 'Candidate suspension', type: 'suspension' },
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
  const then = serverDate(iso);
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function absTime(iso) {
  if (!iso) return '';
  const d = serverDate(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

// Why reported content is or is not public (ReportRow.target_state,
// 2026-10-26). Only these three are moderation takedowns, so only
// these can be unhidden. Content its author deleted or closed must
// never be put back by an admin.
const MODERATION_HIDDEN = new Set(['admin_hidden', 'auto_hidden', 'threat_hidden']);
const REMOVED_LABEL = {
  author_deleted: 'Deleted by its author',
  author_closed: 'Closed by its author',
  closed: 'Closed',
  missing: 'No longer exists',
};

function targetState(r) {
  // Older API responses have no target_state; read them as before.
  return r.target_state || (r.target_hidden ? 'admin_hidden' : 'visible');
}

function isModerationHidden(r) {
  return MODERATION_HIDDEN.has(targetState(r));
}

function reportStatus(r) {
  if (r.acted_at) return 'resolved';
  const state = targetState(r);
  if (MODERATION_HIDDEN.has(state)) return 'hidden';
  if (state !== 'visible') return 'removed';
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
const SUSPENSION_APPEAL_KINDS = new Set(['suspension_rep', 'suspension_citizen', 'suspension_candidate']);

// "Rep post" or "Candidate post" by who wrote it (2026-10-26); every
// post used to read "Rep post".
function typeLabel(r) {
  if (r.kind === 'post' && r.target_author_kind === 'candidate') return 'Candidate post';
  return (TYPE_META[r.kind] || { label: r.kind }).label;
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
  // List caps (2026-10-26, admin audit L3): the lists load the newest 200
  // unless "Show all" asks for up to 1000; total says how many match.
  const [reportsLimit, setReportsLimit] = useState(200);
  const [reportsTotal, setReportsTotal] = useState(null);
  const [appealsLimit, setAppealsLimit] = useState(200);
  const [appealsTotal, setAppealsTotal] = useState(null);
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
  // Whole-queue numbers from the API (2026-10-26), so the tiles don't
  // depend on the 200-row cap or on Include resolved.
  const [reportCounts, setReportCounts] = useState(null);
  const [appealCounts, setAppealCounts] = useState(null);

  const [includeResolvedAppeals, setIncludeResolvedAppeals] = useState(false);
  const [appealTypeChip, setAppealTypeChip] = useState('all'); // 'all' | 'content' | 'suspension'
  const [appellantChip, setAppellantChip] = useState('any');

  const [suspendedKindChip, setSuspendedKindChip] = useState('all');
  const [suspendedSort, setSuspendedSort] = useState('newest');

  // Cards instead of tables below 1366px (2026-10-26): beside the
  // sidebar, the seven-column queue table needs a wide laptop screen;
  // narrower, it scrolled sideways and hid Hide and Suspend.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 1365px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // Modal state.
  const [hideModal, setHideModal] = useState(null);
  const [unhideModal, setUnhideModal] = useState(null);
  const [unlockModal, setUnlockModal] = useState(null);
  const [suspendModal, setSuspendModal] = useState(null);
  const [appealDecisionModal, setAppealDecisionModal] = useState(null); // { appeal, decision }
  const [unsuspendModal, setUnsuspendModal] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Probe admin auth on first mount. `probeTick` re-runs it from the
  // "set up 2FA" card once enrollment is done.
  const [probeTick, setProbeTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, status, error: err } = await adminWhoami();
      if (cancelled) return;
      if (status === 200 && data?.needs_2fa_enrollment) {
        // Admin needs 2FA on this account before any admin endpoint
        // answers (2026-10-26). The enrollment overlay covers the
        // page; don't load lists that would only come back 403.
        setMe(data);
        setAuthState('needs2fa');
      } else if (status === 200 && data) {
        setMe(data);
        setAuthState('allowed');
      } else if (status === 403) {
        setAuthState('denied');
        setError(err || 'Admin access required.');
      } else if (status === 401) {
        setAuthState('unauthed');
      } else {
        // A timeout, a cold start or a server error is not "you're not
        // on the allowlist" (2026-10-26): say what happened, offer Retry.
        setAuthState('unreachable');
        setError(err || 'Could not reach CivicView.');
      }
    })();
    return () => { cancelled = true; };
  }, [probeTick]);

  // Loaders — each tab refetches its own data when filters change.
  // Each list load gets a number; a response that isn't the latest is
  // dropped, so a slow answer can't overwrite a newer one (2026-10-26).
  const reportsSeq = useRef(0);
  const appealsSeq = useRef(0);

  const loadReports = useCallback(async () => {
    const seq = ++reportsSeq.current;
    setReportsLoading(true);
    setError(null);
    const { data, error: err } = await adminListReports({ includeActed: includeResolvedQueue, limit: reportsLimit });
    if (seq !== reportsSeq.current) return;
    setReportsLoading(false);
    if (err || !data) {
      setError(err || 'Could not load reports.');
      return;
    }
    setReports(data.items || []);
    setReportsTotal(typeof data.total === 'number' ? data.total : null);
    if (data.counts) setReportCounts(data.counts);
  }, [includeResolvedQueue, reportsLimit]);

  const loadAppeals = useCallback(async () => {
    const seq = ++appealsSeq.current;
    setAppealsLoading(true);
    setError(null);
    const { data, error: err } = await adminListAppeals({ includeActed: includeResolvedAppeals, limit: appealsLimit });
    if (seq !== appealsSeq.current) return;
    setAppealsLoading(false);
    if (err || !data) {
      setError(err || 'Could not load appeals.');
      return;
    }
    setAppeals(data.items || []);
    setAppealsTotal(typeof data.total === 'number' ? data.total : null);
    if (data.counts) setAppealCounts(data.counts);
  }, [includeResolvedAppeals, appealsLimit]);

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

  // Initial load — single consolidated call (Task #63). Returns all
  // four datasets in one round-trip via /api/admin/dashboard. This
  // replaced the prior pattern of firing 4 parallel calls (which
  // tripped Cloudflare's WAF burst limit per Task #62) AND the
  // intermediate sequential-await pattern (which worked but cost
  // ~300ms of serialized round-trip latency).
  //
  // Per-tab refresh after a user action still uses the individual
  // loaders (loadReports / loadAppeals / loadSuspended / loadLockouts)
  // so action-driven reloads stay focused on the relevant dataset.
  useEffect(() => {
    if (authState !== 'allowed') return;
    (async () => {
      const reportsAt = reportsSeq.current;
      const appealsAt = appealsSeq.current;
      const { data, error: err } = await adminLoadDashboard();
      if (err) {
        setError(err || 'Could not load admin dashboard.');
        return;
      }
      // A filter change while this was loading started a newer list
      // load; keep that one instead of these default lists.
      if (reportsSeq.current === reportsAt) {
        setReports(data?.reports?.items || []);
        setReportsTotal(typeof data?.reports?.total === 'number' ? data.reports.total : null);
        if (data?.reports?.counts) setReportCounts(data.reports.counts);
      }
      if (appealsSeq.current === appealsAt) {
        setAppeals(data?.appeals?.items || []);
        setAppealsTotal(typeof data?.appeals?.total === 'number' ? data.appeals.total : null);
        if (data?.appeals?.counts) setAppealCounts(data.appeals.counts);
      }
      setSuspended(data?.suspended?.items || []);
      setLockouts(data?.lockouts?.items || []);
    })();
  }, [authState]);

  // Re-fetch a tab when its filters change. Not on the first run: the
  // dashboard call above already loaded both, and firing these too sent
  // three or four admin requests at once on every visit (2026-10-26).
  const filtersLoadedOnce = useRef({ reports: false, appeals: false });
  useEffect(() => {
    if (authState !== 'allowed') return;
    if (!filtersLoadedOnce.current.reports) { filtersLoadedOnce.current.reports = true; return; }
    loadReports();
  }, [authState, loadReports]);
  useEffect(() => {
    if (authState !== 'allowed') return;
    if (!filtersLoadedOnce.current.appeals) { filtersLoadedOnce.current.appeals = true; return; }
    loadAppeals();
  }, [authState, loadAppeals]);

  // Former officials and candidates (2026-10-15): stage counts for the
  // Transitions tab's KPI tiles, reported by the tab itself.
  const [transitionCounts, setTransitionCounts] = useState({});
  // Election reminders tab's KPI tiles, reported by the tab itself.
  const [reminderCounts, setReminderCounts] = useState({});
  // History tab's KPI tiles, reported by the tab itself (2026-10-26).
  const [historyCounts, setHistoryCounts] = useState({});
  const [accountCounts, setAccountCounts] = useState({});

  const switchTab = (tab) => {
    const next = VALID_TABS.has(tab) ? tab : 'queue';
    const qs = next === 'queue' ? '' : `?tab=${next}`;
    router.replace(`/admin${qs}`, { scroll: false });
  };

  // Sub-nav badge counts — derived from loaded data.
  const subnavCounts = useMemo(() => ({
    // Everything waiting on a decision, hidden-but-unresolved included,
    // the same number the navbar badge shows.
    queue:     reportCounts ? reportCounts.unresolved : reports.filter((r) => !r.acted_at).length,
    appeals:   appealCounts ? appealCounts.pending : appeals.filter((a) => appealStatus(a) === 'pending').length,
    suspended: suspended.length,
    lockouts: lockouts.length,
  }), [reports, appeals, suspended, lockouts, reportCounts, appealCounts]);

  // Action handlers — Dismiss / Unhide stay one-click. Hide / Suspend /
  // Grant / Deny / Unsuspend route through real modals.
  const runAction = async (key, fn, reload) => {
    if (busyId) {
      // Say so instead of closing the modal and doing nothing (2026-10-26).
      setError('Another action is still running. Try again in a moment.');
      return;
    }
    setBusyId(key);
    const { error: err } = await fn();
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    if (reload) await reload();
  };

  // Hide and Keep hidden both need a reason; it goes into the admin
  // History (2026-10-26). Unhide, Unsuspend and Dismiss take one if given.
  const handleHideConfirm = async ({ reason }) => {
    if (!hideModal) return;
    const r = hideModal;
    const key = `hide-${r.kind}-${r.id}`;
    setHideModal(null);
    await runAction(key, () => adminHideTarget(r.kind, r.id, { reason: reason.trim() }), loadReports);
  };

  const handleUnhideConfirm = async ({ reason } = {}) => {
    if (!unhideModal) return;
    const r = unhideModal;
    const key = `unhide-${r.kind}-${r.id}`;
    setUnhideModal(null);
    await runAction(key, () => adminUnhideTarget(r.kind, r.target_id, { reason: (reason || '').trim() }), loadReports);
  };

  const handleUnlockConfirm = async ({ reason }) => {
    if (!unlockModal) return;
    const row = unlockModal;
    const key = `unlock-${row.identity_kind}-${row.account_id}`;
    setUnlockModal(null);
    await runAction(
      key,
      () => adminUnlockAccount(row.identity_kind, row.account_id, { reason: reason.trim() }),
      loadLockouts,
    );
  };

  const handleSuspendConfirm = async ({ reason }) => {
    if (!suspendModal) return;
    const r = suspendModal;
    const key = `suspend-${r.target_author_kind}-${r.target_author_id}`;
    setSuspendModal(null);
    await runAction(
      key,
      () => adminSuspendUser(r.target_author_kind, r.target_author_id, {
        reason: (reason || '').trim() || null,
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

  const handleUnsuspendConfirm = async ({ reason } = {}) => {
    if (!unsuspendModal) return;
    const u = unsuspendModal;
    const key = `unsuspend-${u.kind}-${u.id}`;
    setUnsuspendModal(null);
    await runAction(
      key,
      () => adminUnsuspendUser(u.kind, u.id, { reason: (reason || '').trim() }),
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
            <Link className="ad-access__cta" href="/">Go to CivicView home</Link>
          </div>
        </div>
      </div>
    );
  }

  if (authState === 'needs2fa') {
    return (
      <div className="ad-root">
        <div className="ad-access-wrap">
          <div className="ad-access">
            <h2 className="ad-access__title">Set up two-factor authentication</h2>
            <p className="ad-access__body">
              Admin needs two-factor authentication on{' '}
              {me?.email ? <span className="ad-access__email">{me.email}</span> : 'this account'}.
              Finish the setup, then continue.
            </p>
            <button type="button" className="ad-access__cta" onClick={() => setProbeTick((n) => n + 1)}>
              Continue to admin
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (authState === 'unreachable') {
    return (
      <div className="ad-root">
        <div className="ad-access-wrap">
          <div className="ad-access">
            <h2 className="ad-access__title">Couldn&rsquo;t reach CivicView</h2>
            <p className="ad-access__body">{error || 'The admin API did not answer.'} This is not an access problem.</p>
            <button type="button" className="ad-access__cta" onClick={() => { setError(null); setAuthState('probing'); setProbeTick((n) => n + 1); }}>
              Retry
            </button>
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
            {error && error !== 'Admin access required.' && (
              <p className="ad-access__body"><strong>The server said:</strong> {error}</p>
            )}
            <Link className="ad-access__link" href="/">← Back to CivicView home</Link>
          </div>
        </div>
      </div>
    );
  }

  // The counts on the line under each section title (2026-10-26:
  // these were three large tiles).
  let kpis = [];
  if (activeTab === 'queue') {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    let open = 0, hidden = 0, resolvedWeek = 0;
    for (const r of reports) {
      const s = reportStatus(r);
      if (s === 'open') open += 1;
      else if (s === 'hidden') hidden += 1;
      if (r.acted_at && serverMs(r.acted_at) >= weekAgo) resolvedWeek += 1;
    }
    // Whole-queue numbers from the API when present; the loaded rows
    // are only the newest 200 and, by default, only unresolved ones.
    kpis = [
      { label: 'waiting', value: reportCounts ? reportCounts.unresolved : open + hidden, tone: 'open' },
      { label: 'hidden now', value: reportCounts ? reportCounts.hidden_items : hidden, tone: 'hidden' },
      { label: 'resolved this week', value: reportCounts ? reportCounts.resolved_week : resolvedWeek, tone: 'resolved' },
    ];
  } else if (activeTab === 'appeals') {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    let openA = 0, grantedWeek = 0, deniedWeek = 0;
    for (const a of appeals) {
      const s = appealStatus(a);
      if (s === 'pending') openA += 1;
      if (a.acted_at && serverMs(a.acted_at) >= weekAgo) {
        if (s === 'granted') grantedWeek += 1;
        else if (s === 'denied') deniedWeek += 1;
      }
    }
    kpis = [
      { label: 'pending', value: appealCounts ? appealCounts.pending : openA, tone: 'warning' },
      { label: 'granted this week', value: appealCounts ? appealCounts.granted_week : grantedWeek, tone: 'success' },
      { label: 'denied this week', value: appealCounts ? appealCounts.denied_week : deniedWeek, tone: 'danger' },
    ];
  } else if (activeTab === 'suspended') {
    // Suspended — three lightweight tiles.
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const suspendedThisWeek = suspended.filter(
      (u) => u.suspended_at && serverMs(u.suspended_at) >= weekAgo,
    ).length;
    kpis = [
      { label: 'suspended now', value: suspended.length, tone: 'warning' },
      { label: 'this week', value: suspendedThisWeek, tone: 'danger' },
      { label: 'reps', value: suspended.filter((u) => u.kind === 'rep').length, tone: 'muted' },
    ];
  } else if (activeTab === 'transitions') {
    kpis = [
      { label: 'in farewell window', value: transitionCounts.farewell || 0, tone: 'warning' },
      { label: 'read-only', value: transitionCounts.read_only || 0, tone: 'muted' },
      { label: 'archived', value: transitionCounts.archived || 0, tone: 'resolved' },
    ];
  } else if (activeTab === 'reminders') {
    kpis = [
      { label: 'sending today', value: reminderCounts.sending || 0, tone: 'warning' },
      { label: 'scheduled', value: reminderCounts.scheduled || 0, tone: 'success' },
      { label: 'passed', value: reminderCounts.passed || 0, tone: 'muted' },
    ];
  } else if (activeTab === 'accounts') {
    // Nothing to count until a lookup has run.
    kpis = accountCounts.found === undefined ? [] : [
      { label: accountCounts.found === 1 ? 'account found' : 'accounts found', value: accountCounts.found || 0, tone: 'open' },
      { label: 'with 2FA on', value: accountCounts.twofa || 0, tone: 'success' },
      { label: 'suspended', value: accountCounts.suspended || 0, tone: 'warning' },
    ];
  } else if (activeTab === 'history') {
    kpis = [
      { label: 'actions this week', value: historyCounts.week || 0, tone: 'open' },
      { label: 'hides and suspensions', value: historyCounts.takedowns || 0, tone: 'danger' },
      { label: 'restores', value: historyCounts.restores || 0, tone: 'success' },
    ];
  } else if (activeTab === 'lockouts') {
    // Lockouts — three tiles, parallel to Suspended.
    const repsLocked = lockouts.filter((l) => l.identity_kind === 'rep').length;
    const candidatesLocked = lockouts.filter((l) => l.identity_kind === 'candidate').length;
    const citizensLocked = lockouts.filter((l) => l.identity_kind === 'citizen').length;
    kpis = [
      { label: 'locked now', value: lockouts.length, tone: 'warning' },
      { label: 'reps and candidates', value: repsLocked + candidatesLocked, tone: 'danger' },
      { label: 'citizens', value: citizensLocked, tone: 'muted' },
    ];
  }

  const banner = error ? (
    <div className="ad-banner" role="alert">
      <div className="ad-banner__icon">!</div>
      <div className="ad-banner__body">
        <div className="ad-banner__title">Couldn&rsquo;t complete that action</div>
        <div className="ad-banner__detail">{error}</div>
      </div>
      <button className="ad-banner__close" onClick={() => setError(null)} aria-label="Dismiss">×</button>
    </div>
  ) : null;

  return (
    <AdminShell
      active={activeTab}
      counts={subnavCounts}
      me={me}
      onSelect={switchTab}
      stats={kpis}
      banner={banner}
    >
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
            counts={reportCounts}
            total={reportsTotal}
            onShowAll={() => setReportsLimit(1000)}
            onRefresh={loadReports}
            onView={openHostingPage}
            onDismiss={(r) => runAction(`dismiss-${r.kind}-${r.id}`, () => adminDismissReport(r.kind, r.id), loadReports)}
            onHide={(r) => setHideModal(r)}
            onKeepHidden={(r) => setHideModal({ ...r, keep: true })}
            onUnhide={(r) => setUnhideModal(r)}
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
            total={appealsTotal}
            onShowAll={() => setAppealsLimit(1000)}
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

        {activeTab === 'transitions' && <TransitionsTab onCounts={setTransitionCounts} />}

        {activeTab === 'reminders' && <ElectionRemindersTab onCounts={setReminderCounts} />}

        {activeTab === 'history' && <HistoryTab onCounts={setHistoryCounts} />}

        {activeTab === 'accounts' && <AccountsTab onCounts={setAccountCounts} />}

        {activeTab === 'lockouts' && (
          <section className="ad-tab-body ad-lockouts">
            <div className="ad-toolbar" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="ad-btn ad-btn--ghost"
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
                          <td><span className={`ad-kindpill ad-kindpill--${kindToken(row.identity_kind)}`}>{kindLabel(row.identity_kind)}</span></td>
                          <td>{row.display_name}</td>
                          <td className="ad-mono">{row.email}</td>
                          <td>{lu.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td>{timeLeft}</td>
                          <td>{row.consecutive_lockout_count}</td>
                          <td>
                            <button
                              type="button"
                              className="ad-btn ad-btn--grant"
                              disabled={busyId === actionId}
                              onClick={() => setUnlockModal(row)}
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

      {hideModal && (
        <HideModal
          row={hideModal}
          onCancel={() => setHideModal(null)}
          onConfirm={handleHideConfirm}
        />
      )}
      {unlockModal && (
        <UnlockModal
          row={unlockModal}
          onCancel={() => setUnlockModal(null)}
          onConfirm={handleUnlockConfirm}
        />
      )}
      {unhideModal && (
        <UnhideModal
          row={unhideModal}
          onCancel={() => setUnhideModal(null)}
          onConfirm={handleUnhideConfirm}
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
          hasAppeal={appeals.some((a) => appealStatus(a) === 'pending' && a.appellant_kind === unsuspendModal.kind && a.appellant_id === unsuspendModal.id && SUSPENSION_APPEAL_KINDS.has(a.target_kind))}
          onCancel={() => setUnsuspendModal(null)}
          onConfirm={handleUnsuspendConfirm}
        />
      )}
    </AdminShell>
  );
}

function openHostingPage(r) {
  if (!r.context_official_id) return;
  const url = `/?page=${encodeURIComponent(r.context_official_id)}`;
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
}

// ─────────────────────────────────────────────────────────────────────
// QUEUE VIEW (reports)
// ─────────────────────────────────────────────────────────────────────
function QueueView({
  reports, loading, mobile, busyId,
  includeResolved, onIncludeResolved,
  kindChip, onKindChip,
  reporterChip, onReporterChip,
  counts, total, onShowAll,
  onRefresh, onView, onDismiss, onHide, onKeepHidden, onUnhide, onSuspend,
}) {
  const filtered = useMemo(() => {
    let list = reports;
    if (kindChip !== 'all') list = list.filter((r) => r.kind === kindChip);
    if (reporterChip !== 'any') list = list.filter((r) => r.reporter_kind === reporterChip);
    return list;
  }, [reports, kindChip, reporterChip]);
  const filtersOn = kindChip !== 'all' || reporterChip !== 'any';

  return (
    <>
      <QueueFilterRow
        includeResolved={includeResolved}
        onIncludeResolved={onIncludeResolved}
        kindChip={kindChip}
        onKindChip={onKindChip}
        reporterChip={reporterChip}
        onReporterChip={onReporterChip}
        onRefresh={onRefresh}
        loading={loading}
      />
      <CapNote shown={reports.length} total={total} onShowAll={onShowAll} />
      {!loading && filtered.length === 0 ? (
        filtersOn ? <EmptyFiltered /> : includeResolved ? <EmptyAll /> : <EmptyOpen />
      ) : mobile ? (
        <CardList
          rows={filtered}
          busyId={busyId}
          onView={onView}
          onDismiss={onDismiss}
          onHide={onHide}
          onKeepHidden={onKeepHidden}
          onUnhide={onUnhide}
          onSuspend={onSuspend}
        />
      ) : (
        <QueueTable
          rows={filtered}
          counts={counts}
          busyId={busyId}
          onView={onView}
          onDismiss={onDismiss}
          onHide={onHide}
          onKeepHidden={onKeepHidden}
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
      <label className="ad-toggle ad-filters__toggle">
        <input
          type="checkbox"
          checked={includeResolved}
          onChange={(e) => onIncludeResolved(e.target.checked)}
        />
        <span className="ad-toggle__track" />
        Include resolved
      </label>

      <div className="ad-filters__divider" />
      <div className="ad-filters__group" role="group" aria-label="Kind">
        <span className="ad-filters__label">Kind</span>
        <div className="ad-filters__chips">
          {kinds.map((k) => (
            <button key={k.id} type="button" className={`ad-chip ${kindChip === k.id ? 'ad-chip--active' : ''}`} onClick={() => onKindChip(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ad-filters__divider" />
      <div className="ad-filters__group" role="group" aria-label="Reporter">
        <span className="ad-filters__label">Reporter</span>
        <div className="ad-filters__chips">
          {reporters.map((r) => (
            <button key={r.id} type="button" className={`ad-chip ${reporterChip === r.id ? 'ad-chip--active' : ''}`} onClick={() => onReporterChip(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="ad-iconbtn ad-filters__refresh" onClick={onRefresh} disabled={loading}>
        <RefreshIcon size={14} />
        <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
      </button>
    </div>
  );
}

function QueueTable({ rows, counts, busyId, onView, onDismiss, onHide, onKeepHidden, onUnhide, onSuspend }) {
  const open = rows.filter((r) => reportStatus(r) === 'open').length;
  const hidden = rows.filter((r) => reportStatus(r) === 'hidden').length;
  // A cut-short list is said once, above, by CapNote with Show all.
  return (
    <div className="ad-tablewrap">
      <div className="ad-tablewrap__count">
        <span>
          Showing <strong>{rows.length}</strong> {rows.length === 1 ? 'report' : 'reports'}
          {' · '}<strong>{open}</strong> open
          {' · '}<strong>{hidden}</strong> hidden
        </span>
        <span className="ad-tablewrap__count-actions">Newest first</span>
      </div>
      <HScroll scrollerClassName="ad-tablewrap__scroll" itemCount={rows.length}>
        <table className="ad-table">
          <thead>
            <tr>
              <th style={{ width: 132 }}>Type</th>
              <th>Content preview</th>
              <th style={{ width: 120 }}>Reason</th>
              <th style={{ width: 130 }}>Reporter</th>
              <th style={{ width: 100 }}>When</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 210 }}>Actions</th>
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
                        {typeLabel(r)}
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
                      <ReporterTrust r={r} />
                    </div>
                  </td>
                  <td>
                    <div className="ad-cell-when">
                      <span className="ad-cell-when__rel">{relTime(r.created_at)}</span>
                      <span>{absTime(r.created_at)}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={status} r={r} />
                    <TrustedCount r={r} counts={counts} />
                  </td>
                  <td>
                    <RowActions
                      r={r}
                      busyId={busyId}
                      onView={() => onView(r)}
                      onDismiss={() => onDismiss(r)}
                      onHide={() => onHide(r)}
                      onKeepHidden={() => onKeepHidden(r)}
                      onUnhide={() => onUnhide(r)}
                      onSuspend={() => onSuspend(r)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </HScroll>
    </div>
  );
}

function CardList({ rows, busyId, onView, onDismiss, onHide, onKeepHidden, onUnhide, onSuspend }) {
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
                  <div className="ad-card__type-main">{typeLabel(r)}</div>
                  <div className="ad-card__type-id">id={r.target_id}</div>
                </div>
              </div>
              <StatusPill status={status} r={r} />
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
                <ReporterTrust r={r} />
              </div>
            </div>
            <div className="ad-card__actions">
              <RowActions
                r={r}
                busyId={busyId}
                onView={() => onView(r)}
                onDismiss={() => onDismiss(r)}
                onHide={() => onHide(r)}
                onKeepHidden={() => onKeepHidden(r)}
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

function RowActions({ r, busyId, onView, onDismiss, onHide, onKeepHidden, onUnhide, onSuspend }) {
  const status = reportStatus(r);
  const isResolved = status === 'resolved';
  // Hidden by moderation, whether or not the report is resolved: Unhide
  // stays available after a Hide resolves the report (2026-10-26).
  const modHidden = isModerationHidden(r);
  const removed = status === 'removed';
  const dismissBusy = busyId === `dismiss-${r.kind}-${r.id}`;
  const hideBusy = busyId === `hide-${r.kind}-${r.id}`;
  const unhideBusy = busyId === `unhide-${r.kind}-${r.id}`;
  const suspendBusy = busyId === `suspend-${r.target_author_kind}-${r.target_author_id}`;

  const unhideButton = (
    <button
      type="button"
      className="ad-actbtn"
      onClick={onUnhide}
      disabled={unhideBusy}
      title="Put it back on the public page and close its reports"
    >
      <UnhideIcon size={12} />
      <span>Unhide</span>
    </button>
  );

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
          {modHidden ? (
            <>
              {/* Hidden content gets a real decision, not a Dismiss that
                  closed the report and left the content hidden. */}
              <button
                type="button"
                className="ad-actbtn"
                onClick={onKeepHidden}
                disabled={hideBusy}
                title="Keep it hidden and close its reports"
              >
                <HideIcon size={12} />
                <span>Keep hidden</span>
              </button>
              {unhideButton}
            </>
          ) : (
            <>
              <button type="button" className="ad-actbtn" onClick={onDismiss} disabled={dismissBusy}>
                <DismissIcon size={12} />
                <span>Dismiss</span>
              </button>
              {!removed && (
                <button type="button" className="ad-actbtn ad-actbtn--danger" onClick={onHide} disabled={hideBusy}>
                  <HideIcon size={12} />
                  <span>Hide</span>
                </button>
              )}
            </>
          )}
          {r.target_author_id && r.target_author_kind && (
            <button
              type="button"
              className="ad-actbtn ad-actbtn--danger-solid"
              onClick={onSuspend}
              disabled={suspendBusy}
              title={`Suspend ${kindLabel(r.target_author_kind).toLowerCase()} ${r.target_author_name || ''}`}
            >
              <SuspendIcon size={12} />
              <span>Suspend</span>
            </button>
          )}
        </>
      )}
      {isResolved && modHidden && (
        <>
          <span className="ad-act-sep" />
          {unhideButton}
        </>
      )}
      {isResolved && (
        <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-muted)', fontStyle: 'italic', marginLeft: 6 }}>
          Resolved {relTime(r.acted_at)}
        </span>
      )}
      {removed && (
        <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-muted)', fontStyle: 'italic', marginLeft: 6 }}>
          {REMOVED_LABEL[targetState(r)] || 'Not public'}
        </span>
      )}
    </div>
  );
}

// Who the reporter is, as far as moderation is concerned (2026-10-26):
// demo accounts are always labeled as demo accounts, and a report from
// an unverified account goes to the queue but never counts toward
// auto-hide.
function ReporterTrust({ r }) {
  if (r.reporter_is_demo) {
    return <span className="ad-cell-reporter__demo" title="Demo account: its reports don't count toward auto-hide">Demo account</span>;
  }
  if (r.reporter_trusted === false) {
    return <span className="ad-cell-reporter__unverified" title="Not verified: its reports don't count toward auto-hide">Not verified</span>;
  }
  return null;
}

// Open trusted reports against the auto-hide threshold, for items that
// are still waiting on a decision.
function TrustedCount({ r, counts }) {
  if (r.acted_at || typeof r.target_trusted_reports !== 'number' || !counts?.auto_hide_threshold) return null;
  const state = targetState(r);
  if (state !== 'visible' && state !== 'auto_hidden') return null;
  return (
    <div className="ad-cell-trusted" title="Open reports from reps and verified citizens; this many hides it automatically">
      {r.target_trusted_reports} of {counts.auto_hide_threshold} trusted
    </div>
  );
}

function StatusPill({ status, r }) {
  const label = status === 'hidden' ? (r && targetState(r) === 'auto_hidden' ? 'Auto-hidden' : 'Hidden')
    : status === 'resolved' ? 'Resolved'
    : status === 'removed' ? 'Not public'
    : 'Open';
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
  total, onShowAll,
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
      <CapNote shown={appeals.length} total={total} onShowAll={onShowAll} />
      {!loading && filtered.length === 0 ? (
        <AppealsEmpty includeResolved={includeResolved} />
      ) : (
        <div className="ad-appeals-list">
          <div className="ad-appeals-list__count">
            <span>
              Showing <strong>{filtered.length}</strong> {filtered.length === 1 ? 'appeal' : 'appeals'}
              {' · '}<strong>{filtered.filter((a) => appealStatus(a) === 'pending').length}</strong> pending
            </span>
            <span className="ad-tablewrap__count-actions">Pending first, longest wait on top</span>
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
    { id: 'candidate', label: 'Candidate' },
  ];
  return (
    <div className="ad-filters">
      <label className="ad-toggle ad-filters__toggle">
        <input
          type="checkbox"
          checked={includeResolved}
          onChange={(e) => onIncludeResolved(e.target.checked)}
        />
        <span className="ad-toggle__track" />
        Include resolved
      </label>

      <div className="ad-filters__divider" />
      <div className="ad-filters__group" role="group" aria-label="Type">
        <span className="ad-filters__label">Type</span>
        <div className="ad-filters__chips">
          {types.map((t) => (
            <button key={t.id} type="button" className={`ad-chip ${typeChip === t.id ? 'ad-chip--active' : ''}`} onClick={() => onTypeChip(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ad-filters__divider" />
      <div className="ad-filters__group" role="group" aria-label="Appellant">
        <span className="ad-filters__label">Appellant</span>
        <div className="ad-filters__chips">
          {kinds.map((k) => (
            <button key={k.id} type="button" className={`ad-chip ${appellantChip === k.id ? 'ad-chip--active' : ''}`} onClick={() => onAppellantChip(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="ad-iconbtn ad-filters__refresh" onClick={onRefresh} disabled={loading}>
        <RefreshIcon size={14} />
        <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
      </button>
    </div>
  );
}

// An appeal waiting longer than this is flagged (2026-10-26, admin audit
// L16: one had waited 163 days without anything saying so).
const APPEAL_STALE_DAYS = 7;

function waitedDays(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - serverMs(iso)) / 86400000);
}

// "Showing the newest 200 of 340" with a way to load the rest, so a
// list cap is never silent (2026-10-26, admin audit L3).
function CapNote({ shown, total, onShowAll }) {
  if (typeof total !== 'number' || total <= shown) return null;
  return (
    <p className="ad-capnote" role="status">
      Showing {shown} of {total}.{' '}
      {shown < 1000 ? (
        <button type="button" className="ad-capnote__btn" onClick={onShowAll}>
          Show {total > 1000 ? 'the first 1000' : 'all'}
        </button>
      ) : 'Narrow the filters to see the rest.'}
    </p>
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
          {status === 'pending' && waitedDays(appeal.created_at) > APPEAL_STALE_DAYS && (
            <span className="ad-appeal__stale">Waiting {waitedDays(appeal.created_at)} days</span>
          )}
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
              <span className="ad-appeal__details-id">id={appeal.appellant_id}</span>
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
          {appeal.admin_email && <span>by {appeal.admin_email}</span>}
          {appeal.admin_note && (
            <span className="ad-appeal__resolved-note">&ldquo;{appeal.admin_note}&rdquo;</span>
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
      && SUSPENSION_APPEAL_KINDS.has(a.target_kind)
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
    { id: 'citizen', label: 'Citizen' },
    { id: 'rep',     label: 'Rep' },
    { id: 'candidate', label: 'Candidate' },
  ];
  return (
    <div className="ad-filters">
      <div className="ad-filters__group" role="group" aria-label="Kind">
        <span className="ad-filters__label">Kind</span>
        <div className="ad-filters__chips">
          {kinds.map((k) => (
            <button key={k.id} type="button" className={`ad-chip ${kindChip === k.id ? 'ad-chip--active' : ''}`} onClick={() => onKindChip(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ad-filters__divider" />

      <div className="ad-sortselect ad-filters__group">
        <span className="ad-filters__label" style={{ marginRight: 6 }}>Sort</span>
        <select className="ad-select" value={sort} onChange={(e) => onSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      <button type="button" className="ad-iconbtn ad-filters__refresh" onClick={onRefresh} disabled={loading}>
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
      <HScroll scrollerClassName="ad-tablewrap__scroll" itemCount={rows.length}>
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
      </HScroll>
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
            <span className={`ad-kindpill ad-kindpill--${kindToken(u.kind)}`}>
              {kindLabel(u.kind)}
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

function EmptyFiltered() {
  return (
    <div className="ad-empty">
      <h2 className="ad-empty__title">No reports match these filters.</h2>
      <p className="ad-empty__body">Set Kind and Reporter back to All and Any to see the whole queue.</p>
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
// MODALS (dialog behavior and the reason box: components/admin/adminUi.js)
// ─────────────────────────────────────────────────────────────────────
function HideModal({ row, onCancel, onConfirm }) {
  const { dialogRef, titleId } = useAdminDialog(onCancel);
  const meta = TYPE_META[row.kind] || { label: row.kind };
  const keep = !!row.keep;
  const [reason, setReason] = useState('');
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow">Reversible action</div>
          <h2 className="ad-modal__title" id={titleId}>
            {keep ? `Keep this ${meta.label.toLowerCase()} hidden?` : `Hide this ${meta.label.toLowerCase()}?`}
          </h2>
        </div>
        <div className="ad-modal__body">
          <div>
            {keep
              ? <>It stays off the public page and its open reports are closed. The author can still appeal for 30 days.</>
              : <>It comes off the public page now, and its open reports are closed. The author gets a notice and can appeal for 30 days. You can Unhide it later.</>}
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
                By {row.target_author_name}{row.target_author_kind ? ` (${row.target_author_kind})` : ''}
              </div>
            )}
          </div>
          <ReasonField
            value={reason}
            onChange={setReason}
            required
            autoFocus
            label="Your reason (required, saved to the admin History)"
            hint="At least 3 characters. The author doesn't see this."
            placeholder="What rule does it break? e.g. 'Threat against a named person'"
          />
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="ad-btn ad-btn--danger"
            onClick={() => onConfirm({ reason })}
            disabled={!reasonOk(reason)}
          >
            {keep ? 'Keep hidden' : 'Hide content'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnhideModal({ row, onCancel, onConfirm }) {
  const { dialogRef, titleId } = useAdminDialog(onCancel);
  const meta = TYPE_META[row.kind] || { label: row.kind };
  const label = meta.label.toLowerCase();
  const [reason, setReason] = useState('');
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow ad-modal__eyebrow--success">Reversible action</div>
          <h2 className="ad-modal__title" id={titleId}>Unhide this {label}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            It goes back on the public page, and every open report on it is closed. Closed
            reports stop counting toward auto-hide, so it stays up unless enough new reports
            come in.
          </div>
          <div className="ad-modal__contentblock" style={{ borderLeftColor: 'var(--cl-success)' }}>
            <div className="ad-modal__contentmeta">
              <span>{meta.label}</span>
              <span>·</span>
              <span style={{ fontFamily: 'var(--cl-font-mono)', textTransform: 'none', letterSpacing: 0 }}>
                id={row.target_id}
              </span>
              <span>·</span>
              <span>{targetState(row) === 'auto_hidden' ? 'Hidden by auto-hide' : 'Hidden by an admin'}</span>
            </div>
            <div className="ad-modal__contentbody">&ldquo;{row.target_preview || '(empty)'}&rdquo;</div>
          </div>
          <ReasonField
            value={reason}
            onChange={setReason}
            label="Your reason (optional, saved to the admin History)"
            hint="e.g. 'Reports were a pile-on; the post is within the rules'"
          />
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="ad-btn ad-btn--grant" onClick={() => onConfirm({ reason })}>
            Unhide
          </button>
        </div>
      </div>
    </div>
  );
}

function SuspendModal({ row, onCancel, onConfirm }) {
  const { dialogRef, titleId } = useAdminDialog(onCancel);
  // Starts empty: the reason on record is the admin's, not the
  // reporter's words (2026-10-26). The report is shown for context.
  const [reason, setReason] = useState('');
  const authorKind = kindLabel(row.target_author_kind).toLowerCase();
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal ad-modal--wide" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow">Destructive action</div>
          <h2 className="ad-modal__title" id={titleId}>Suspend {row.target_author_name || 'this user'}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            The {authorKind} account will be unable to sign in, post, comment, or vote. We email
            them your reason and how to appeal (once, within 30 days). Suspension is reversible
            from the <strong>Suspended users</strong> tab.
          </div>

          <div className="ad-modal__contentblock">
            <div className="ad-modal__contentmeta">
              <span>The report</span>
              <span>·</span>
              <span>{formatReason(row.reason)}</span>
            </div>
            {row.detail && <div className="ad-modal__contentbody">&ldquo;{row.detail}&rdquo;</div>}
          </div>

          <ReasonField
            value={reason}
            onChange={setReason}
            required
            autoFocus
            label="Your reason (required, emailed to them and saved to the admin History)"
            hint="At least 3 characters, in your own words. They read this, so say what they did."
            placeholder="Why are you suspending this account?"
          />

          <div>
            Their existing posts and comments stay up. Suspending never takes content down;
            hide reported items one at a time from the queue.
          </div>
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="ad-btn ad-btn--danger"
            onClick={() => onConfirm({ reason })}
            disabled={!reasonOk(reason)}
          >
            Suspend {authorKind}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppealDecisionModal({ appeal, decision, onCancel, onConfirm }) {
  const { dialogRef, titleId } = useAdminDialog(onCancel);
  const [note, setNote] = useState('');
  const isGrant = decision === 'grant';
  const meta = APPEAL_TARGET_META[appeal.target_kind] || { label: appeal.target_kind, type: 'content' };
  const isSuspension = meta.type === 'suspension';
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className={`ad-modal__eyebrow ${isGrant ? 'ad-modal__eyebrow--success' : ''}`}>
            {isGrant ? 'Reversible action' : 'Final decision'}
          </div>
          <h2 className="ad-modal__title" id={titleId}>
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
                : <>The <strong>{meta.label.toLowerCase()}</strong> goes back on the public page, and its open reports are closed.</>
              : <>The moderation action stays in place. The appellant sees &ldquo;Denied&rdquo; and reads your note below. They can&rsquo;t appeal this again.</>}
          </div>
          <ReasonField
            value={note}
            onChange={setNote}
            required={!isGrant}
            label={isGrant
              ? 'Note to the appellant (optional, saved to the admin History)'
              : 'Note to the appellant (required, saved to the admin History)'}
            hint={isGrant
              ? 'The appellant sees this.'
              : 'At least 3 characters. The appellant sees this, so explain the rule it breaks.'}
            placeholder={isGrant
              ? "e.g. 'Reporter retracted', 'Content was within the rules'"
              : "e.g. 'The comment threatens a named person'"}
          />
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          {isGrant ? (
            <button type="button" className="ad-btn ad-btn--grant" onClick={() => onConfirm({ decision: 'grant', note })}>
              Grant appeal
            </button>
          ) : (
            <button
              type="button"
              className="ad-btn ad-btn--danger"
              onClick={() => onConfirm({ decision: 'deny', note })}
              disabled={!reasonOk(note)}
            >
              Deny appeal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UnsuspendModal({ user, hasAppeal, onCancel, onConfirm }) {
  const { dialogRef, titleId } = useAdminDialog(onCancel);
  const [reason, setReason] = useState('');
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow ad-modal__eyebrow--success">Reversible action</div>
          <h2 className="ad-modal__title" id={titleId}>Unsuspend {user.display_name || 'this user'}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            They&rsquo;ll regain the ability to post, comment, and vote immediately.
            The suspension and this unsuspend stay in the admin History; you can re-suspend at any time.
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
              <strong>Note:</strong> this account has an open appeal. An unsuspend here
              doesn&rsquo;t resolve it; decide it from the Appeals tab so the appellant hears back.
            </div>
          )}
          <ReasonField
            value={reason}
            onChange={setReason}
            label="Your reason (optional, saved to the admin History)"
            hint="e.g. 'Spoke with them; agreed to the rules'"
          />
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="ad-btn ad-btn--grant" onClick={() => onConfirm({ reason })}>
            <UnhideIcon size={13} /> Unsuspend
          </button>
        </div>
      </div>
    </div>
  );
}

function UnlockModal({ row, onCancel, onConfirm }) {
  const { dialogRef, titleId } = useAdminDialog(onCancel);
  const [reason, setReason] = useState('');
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow ad-modal__eyebrow--success">Reversible action</div>
          <h2 className="ad-modal__title" id={titleId}>Unlock {row.display_name || 'this account'}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            They can try signing in again right away, and their failed-attempt count starts over.
            Only unlock someone you&rsquo;ve confirmed is the account owner.
          </div>
          <ReasonField
            value={reason}
            onChange={setReason}
            required
            autoFocus
            label="Your reason (required, saved to the admin History)"
            hint="At least 3 characters, e.g. how the owner proved who they are."
            placeholder="e.g. 'Owner called from the phone number on file'"
          />
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="ad-btn ad-btn--grant"
            onClick={() => onConfirm({ reason })}
            disabled={!reasonOk(reason)}
          >
            Unlock
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
