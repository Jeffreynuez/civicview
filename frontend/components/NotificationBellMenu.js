'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '@/lib/useViewport';
import {
  enableChannelPrefsServerSync,
  disableChannelPrefsServerSync,
} from '@/lib/channelPrefs';
import { clearDeliveredNotifications } from '@/lib/push';
import { setAppBadgeCount } from '@/lib/webPush';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
} from '@/lib/pagesApi';
// Subscribe to the three identity hooks so the bell can re-fetch the
// notification inbox the moment the active identity changes — without
// this, the badge can show the prior user's unread count for up to
// 60s after login / logout (a real UX bug and an App Store red flag).
import { useAuth } from '@/lib/auth';
import { useCitizenAuth } from '@/lib/citizenAuth';
import { useCandidateAuth } from '@/lib/candidateAuth';
import { takeNotificationsOpenRequest } from '@/lib/notificationsOpen';
import { notificationLink, openDeepLink } from '@/lib/deepLinks';
import LifecycleNotice, { LIFECYCLE_KINDS } from './LifecycleNotice';
import ElectionReminderNotice from './ElectionReminderNotice';
// The settings list (2026-10-17): one dropdown per kind of alert, then
// timing. Shown in place of the inbox when the gear is tapped.
import NotificationSettings, { usePhonePush } from './NotificationSettings';

// Phase 5 MVP: poll the notification inbox at this cadence. 60s is
// frequent enough for "rep replied to my comment" to feel responsive
// without hammering the backend. Web-push is the real fix later.
// Bell v3 categories (2026-07-26). Notifications group into
// collapsible sections by kind, and tracked-activity sections
// sub-group by the official/candidate they came from — "there is a
// lot to follow in this app" (Jeffrey). Unknown future kinds fall
// into 'other' so a new backend kind can never render a blank bell.
const NOTIF_CATEGORIES = [
  // Election reminders (2026-10-16): voting deadlines and Election Day
  // from official state sources. First, because they are time-critical.
  { key: 'election_reminder', label: 'Election reminders', byOfficial: false },
  // Something of yours was hidden by moderation (2026-10-26), with a
  // way to appeal: time-limited (30 days), so near the top.
  { key: 'moderation_hidden', label: 'Moderation', byOfficial: false },
  { key: 'reply', label: 'Replies', byOfficial: false },
  { key: 'tracked_post', label: 'Posts & polls', byOfficial: true },
  { key: 'tracked_event', label: 'Events', byOfficial: true },
  // 2026-10-17: the daily Congress.gov pass, and polls you voted in.
  { key: 'bill_update', label: 'Bill updates', byOfficial: false },
  { key: 'poll_results', label: 'Poll results', byOfficial: false },
  // Former officials and candidates (2026-10-15): leaving office,
  // campaigns ending, archives, and Follow in office.
  { key: 'lifecycle', label: 'Changes in office', byOfficial: false },
  { key: 'other', label: 'Other', byOfficial: false },
];

const NOTIF_POLL_MS = 60000;

// What was hidden, for the moderation notice (2026-10-26).
const MODERATION_KIND_LABEL = {
  post: 'post',
  post_comment: 'comment',
  poll: 'poll',
  poll_comment: 'poll comment',
};

/**
 * Navbar bell: the notification inbox, and behind its gear the
 * notification settings list (components/NotificationSettings.js,
 * 2026-10-17), so the inbox stays short.
 */
export default function NotificationBellMenu() {
  // Push on this phone (native app only), for the yellow dot.
  const phone = usePhonePush();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('inbox'); // 'inbox' | 'settings'
  useEffect(() => { if (!open) setView('inbox'); }, [open]);
  const isMobile = useIsMobile();
  const containerRef = useRef(null);

  // Phase 5 MVP — in-app notification inbox. We fetch on mount + on
  // each open + on a 60s polling interval. Items mark read on click
  // OR on "Mark all read" action. unreadCount drives the badge dot.
  const [notifItems, setNotifItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  // The installed web app's icon badge (Badging API, 2026-10-18): the
  // same unread count, cleared at 0. The Windows app, a desktop install
  // and the iPhone Home Screen app show it; a tab and the Android app
  // skip it (lib/webPush.js).
  useEffect(() => { setAppBadgeCount(unreadCount); }, [unreadCount]);

  // Per-section expand/collapse. Untouched sections default open when
  // they hold something unread, collapsed otherwise; a user toggle
  // overrides the default until the popover's items change identity.
  const [sectionToggles, setSectionToggles] = useState({});
  const notifGroups = useMemo(() => {
    const byKey = new Map();
    for (const n of notifItems) {
      const catKey = LIFECYCLE_KINDS.has(n.kind) ? 'lifecycle' : n.kind;
      const cat = NOTIF_CATEGORIES.find((c) => c.key === catKey) ||
        NOTIF_CATEGORIES.find((c) => c.key === 'other');
      if (!byKey.has(cat.key)) byKey.set(cat.key, { ...cat, items: [], unread: 0 });
      const g = byKey.get(cat.key);
      g.items.push(n);
      if (!n.read_at) g.unread += 1;
    }
    // Category order is the declaration order; officials inside a
    // category order by their most recent notification (items arrive
    // newest-first from the API, so first-seen preserves that).
    return NOTIF_CATEGORIES
      .filter((c) => byKey.has(c.key))
      .map((c) => {
        const g = byKey.get(c.key);
        if (!c.byOfficial) return g;
        const subs = new Map();
        for (const n of g.items) {
          const name = (n.payload && n.payload.official_name) || 'Officials you track';
          if (!subs.has(name)) subs.set(name, []);
          subs.get(name).push(n);
        }
        return { ...g, byOfficial: [...subs.entries()].map(([name, items]) => ({ name, items })) };
      });
  }, [notifItems]);

  const refreshNotifs = async () => {
    setNotifLoading(true);
    const { data } = await fetchNotifications({ limit: 50 });
    setNotifLoading(false);
    if (data) {
      setNotifItems(data.items || []);
      setUnreadCount(data.unread_count || 0);
    }
  };

  useEffect(() => {
    refreshNotifs();
    const t = setInterval(refreshNotifs, NOTIF_POLL_MS);
    // A push arriving while the app is open refreshes at once
    // (lib/push.js, pushNotificationReceived; 2026-10-16).
    const onPush = () => refreshNotifs();
    window.addEventListener('cv:notifications-refresh', onPush);
    return () => {
      clearInterval(t);
      window.removeEventListener('cv:notifications-refresh', onPush);
    };
  }, []);

  // Refresh on open so the dropdown shows the freshest inbox.
  useEffect(() => {
    if (open) refreshNotifs();
  }, [open]);

  // /?open=notifications (a summary push, 2026-10-16) opens the bell.
  useEffect(() => {
    if (takeNotificationsOpenRequest()) setOpen(true);
    const onOpen = () => { if (takeNotificationsOpenRequest()) setOpen(true); };
    window.addEventListener('cv:open-notifications', onOpen);
    return () => window.removeEventListener('cv:open-notifications', onOpen);
  }, []);

  // Refresh immediately when the active identity changes (login,
  // logout, identity-switch). Each hook publishes the current user
  // record (or null when signed out); watching the .id keys means
  // the effect only fires on actual identity transitions, not on
  // every component re-render. Also clears stale local state on
  // logout so the badge drops to zero instantly instead of after
  // the next 60s poll.
  const { me: repMe } = useAuth();
  const { citizen } = useCitizenAuth();
  const { candidate } = useCandidateAuth();
  useEffect(() => {
    // If no identity is signed in, zero out the local view so the
    // badge doesn't display a previous user's count. The refresh
    // call still happens — /api/notifications returns empty when
    // anonymous — but the optimistic clear avoids the in-between
    // frame.
    if (!repMe && !citizen && !candidate) {
      setNotifItems([]);
      setUnreadCount(0);
    }
    refreshNotifs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repMe?.id, citizen?.id, candidate?.id]);

  // Account-synced channel prefs (Notifications v2 part 2). While a
  // citizen is signed in, the account is the source of truth for the
  // panel below — server prefs are pulled in and every change is
  // pushed back up. Anonymous / rep-only / candidate-only sessions
  // stay localStorage-only (delivery prefs are a citizen feature).
  useEffect(() => {
    if (citizen?.id) enableChannelPrefsServerSync();
    else disableChannelPrefsServerSync();
  }, [citizen?.id]);

  const onClickNotif = async (n) => {
    if (!n.read_at) {
      await markNotificationRead(n.id);
      setNotifItems((prev) => prev.map((it) =>
        it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it,
      ));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    // Open it with the same link a push tap uses (lib/deepLinks.js
    // notificationLink): the post, the poll, the page, or My Tracked
    // for a bill. An election reminder carries its own official link.
    setOpen(false);
    if (n.kind === 'election_reminder') return;
    const url = notificationLink(n.kind, n.payload || {});
    if (url) openDeepLink(url);
  };

  // Bell v3.1 two-stage action (Jeffrey, 2026-07-26): while anything
  // is unread the button reads "Mark as read" — marks the inbox read
  // AND clears the Android tray so the launcher icon badge drops.
  // Once everything is read it becomes "Clear" — soft-clears the
  // inbox server-side (rows keep living for the dashboard archive)
  // and empties the popover list. Individual clicks still mark
  // single rows read.
  // Both act on the rows the bell is showing only (2026-10-16): the ids
  // go with the request, and anything it does not show stays as it is.
  const onMarkAllRead = async () => {
    const shownUnread = notifItems.filter((it) => !it.read_at).map((it) => it.id);
    await markAllNotificationsRead(notifItems.map((it) => it.id));
    setNotifItems((prev) => prev.map((it) =>
      it.read_at ? it : { ...it, read_at: new Date().toISOString() },
    ));
    setUnreadCount((c) => Math.max(0, c - shownUnread.length));
    clearDeliveredNotifications(); // native tray + icon badge; no-op on web
    refreshNotifs();
  };
  const onClearAll = async () => {
    const shown = notifItems.map((it) => it.id);
    await clearAllNotifications(shown);
    setNotifItems([]);
    clearDeliveredNotifications();
    refreshNotifs();
  };

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The yellow dot: push is on for this phone.
  const enabledCount = phone.on ? 1 : 0;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notification preferences"
        aria-expanded={open}
        className="p-2 text-white hover:bg-white hover:bg-opacity-10 rounded-lg transition"
        style={{ position: 'relative' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {/* Two distinct dots:
            • Yellow = at least one delivery-channel preference is enabled
              (legacy indicator, kept for visual continuity).
            • Red (priority) = at least one unread notification in the
              inbox. Overlays the yellow when both apply since unread
              is the more actionable signal. */}
        {unreadCount > 0 ? (
          <span style={{
            position: 'absolute', top: '2px', right: '2px',
            minWidth: '16px', height: '16px', padding: '0 4px',
            borderRadius: '8px',
            background: '#e63946', color: 'white',
            fontSize: '0.6rem', fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--cl-primary)',
            boxSizing: 'border-box',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : enabledCount > 0 ? (
          <span style={{
            position: 'absolute', top: '4px', right: '4px',
            width: '8px', height: '8px', borderRadius: '50%',
            background: '#ffba08', border: '2px solid var(--cl-primary)',
          }} />
        ) : null}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: isMobile ? 'fixed' : 'absolute',
            overflowY: 'auto',
            background: 'white', color: 'var(--cl-text)',
            border: '1px solid var(--cl-border)', borderRadius: '12px',
            boxShadow: '0 12px 28px rgba(0,0,0,0.22)',
            zIndex: 200, padding: '10px 12px',
            ...(isMobile
              ? { top: 60, left: 12, right: 12, maxHeight: 'calc(100vh - 76px)' }
              : { top: 'calc(100% + 8px)', right: 0, width: '320px', maxHeight: '70vh' }),
          }}
        >
          <div style={{
            fontSize: '0.82rem', fontWeight: 800, color: 'var(--cl-primary)',
            textTransform: 'uppercase', letterSpacing: '0.4px',
            padding: '4px 2px 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            {view === 'settings' ? (
              <button
                type="button"
                onClick={() => setView('inbox')}
                style={headerLinkStyle}
                aria-label="Back to notifications"
              >
                {'\u2190 Notifications'}
              </button>
            ) : (
              <span>Notifications</span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {view === 'inbox' && notifItems.length > 0 && (
                <button
                  type="button"
                  onClick={unreadCount > 0 ? onMarkAllRead : onClearAll}
                  style={headerLinkStyle}
                >
                  {unreadCount > 0 ? 'Mark as read' : 'Clear'}
                </button>
              )}
              {view === 'inbox' ? (
                <button
                  type="button"
                  onClick={() => setView('settings')}
                  aria-label="Notification settings"
                  title="Notification settings"
                  data-testid="bell-settings-button"
                  style={{ ...headerLinkStyle, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </button>
              ) : (
                <span style={{ fontSize: '0.66rem', textTransform: 'none', letterSpacing: 0 }}>Settings</span>
              )}
            </span>
          </div>

          {view === 'settings' ? <NotificationSettings variant="bell" /> : (
          <>

          {/* Bell v3 inbox — grouped into collapsible category
              sections; tracked categories sub-group per official so a
              heavy follower can scan by person, not by timestamp. */}
          <div style={{ marginBottom: 10 }}>
            {notifLoading && notifItems.length === 0 ? (
              <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', padding: '6px 2px' }}>
                Loading…
              </div>
            ) : notifItems.length === 0 ? (
              <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', padding: '6px 2px', lineHeight: 1.4 }}>
                Nothing new. Replies to your comments, election reminders, bill
                updates, poll results, and posts, polls and events from
                officials you track will show up here.
              </div>
            ) : (
              notifGroups.map((g) => {
                const isOpen = g.key in sectionToggles ? sectionToggles[g.key] : g.unread > 0;
                const renderNotif = (n) => {
                  if (LIFECYCLE_KINDS.has(n.kind)) {
                    return <LifecycleNotice key={n.id} notification={n} onOpen={onClickNotif} />;
                  }
                  if (n.kind === 'election_reminder') {
                    return <ElectionReminderNotice key={n.id} notification={n} onOpen={onClickNotif} />;
                  }
                  const p = n.payload || {};
                  const isUnread = !n.read_at;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onClickNotif(n)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 8px', borderRadius: 8,
                        border: '1px solid var(--cl-border)',
                        background: isUnread ? 'var(--cl-accent-soft, #e6f4ea)' : 'white',
                        marginBottom: 4, cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ fontSize: '0.78rem', color: 'var(--cl-text)', fontWeight: isUnread ? 700 : 500 }}>
                        {n.kind === 'moderation_hidden' ? (
                          <>
                            <span style={{ fontWeight: 800 }}>
                              Your {MODERATION_KIND_LABEL[p.target_kind] || 'content'} was hidden
                            </span>
                            {p.hide_reason === 'auto_hidden' ? ' after community reports.' : ' by a moderator.'}
                            {' '}You can appeal within 30 days.
                          </>
                        ) : n.kind === 'tracked_post' ? (
                          <>
                            <span style={{ fontWeight: 800 }}>{p.official_name || 'An official you track'}</span>
                            {p.has_poll ? ' posted a new update with a poll' : ' posted a new update'}
                          </>
                        ) : n.kind === 'tracked_event' ? (
                          <>
                            <span style={{ fontWeight: 800 }}>{p.official_name || 'An official you track'}</span>
                            {' '}scheduled an upcoming event
                          </>
                        ) : n.kind === 'bill_update' ? (
                          <>
                            <span style={{ fontWeight: 800 }}>{p.citation || 'A bill you track'}</span>
                            {p.change_kind === 'status' ? ' had a status change'
                              : p.change_kind === 'vote' ? ' had a recorded vote' : ' has a new action'}
                          </>
                        ) : n.kind === 'poll_results' ? (
                          <>
                            <span style={{ fontWeight: 800 }}>Results are in</span>
                            {' '}for a poll you voted in
                          </>
                        ) : (
                          <>
                            <span style={{ fontWeight: 800 }}>{p.replier_name || 'Someone'}</span>
                            {' '}replied to your comment
                          </>
                        )}
                      </div>
                      {(p.preview || p.question || p.action) && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: 2, lineHeight: 1.35 }}>
                          {n.kind === 'bill_update'
                            ? `${p.action_date ? p.action_date + ': ' : ''}${p.action}${p.more ? ` (and ${p.more} more)` : ''}`
                            : `\u201c${p.preview || p.question}\u201d`}
                        </div>
                      )}
                    </button>
                  );
                };
                return (
                  <div key={g.key} style={{ marginBottom: 6 }}>
                    <button
                      type="button"
                      onClick={() => setSectionToggles((t) => ({ ...t, [g.key]: !isOpen }))}
                      aria-expanded={isOpen}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: '6px 8px', borderRadius: 8,
                        border: '1px solid var(--cl-border)',
                        background: 'var(--cl-bg, #f7f8f9)', cursor: 'pointer',
                        fontFamily: 'inherit', marginBottom: 4,
                      }}
                    >
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 800, color: 'var(--cl-primary)',
                        textTransform: 'uppercase', letterSpacing: '0.4px',
                      }}>
                        {g.label}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {g.unread > 0 && (
                          <span style={{
                            minWidth: 16, height: 16, padding: '0 5px', borderRadius: 8,
                            background: '#e63946', color: 'white',
                            fontSize: '0.6rem', fontWeight: 800,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {g.unread}
                          </span>
                        )}
                        <span style={{ fontSize: '0.64rem', color: 'var(--cl-text-light)', fontWeight: 700 }}>
                          {g.items.length}
                        </span>
                        <span aria-hidden="true" style={{
                          fontSize: '0.6rem', color: 'var(--cl-text-light)',
                          transform: isOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 120ms',
                        }}>
                          ▶
                        </span>
                      </span>
                    </button>
                    {isOpen && (
                      Array.isArray(g.byOfficial) ? (
                        g.byOfficial.map((sub) => (
                          <div key={sub.name} style={{ marginBottom: 4 }}>
                            <div style={{
                              fontSize: '0.66rem', fontWeight: 800,
                              color: 'var(--cl-text-light)', padding: '2px 4px 4px',
                            }}>
                              {sub.name}
                            </div>
                            {sub.items.map(renderNotif)}
                          </div>
                        ))
                      ) : (
                        g.items.map(renderNotif)
                      )
                    )}
                  </div>
                );
              })
            )}
          </div>

          </>
          )}
        </div>
      )}
    </div>
  );
}

const headerLinkStyle = {
  background: 'transparent', border: 'none',
  color: 'var(--cl-accent)', cursor: 'pointer',
  fontSize: '0.66rem', fontWeight: 700,
  textTransform: 'none', letterSpacing: 0,
  fontFamily: 'inherit', padding: 0,
};
