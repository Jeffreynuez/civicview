'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';
import { useChannelPrefs, setChannelPrefs } from '@/lib/channelPrefs';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/pagesApi';

// Phase 5 MVP: poll the notification inbox at this cadence. 60s is
// frequent enough for "rep replied to my comment" to feel responsive
// without hammering the backend. Web-push is the real fix later.
const NOTIF_POLL_MS = 60000;

/**
 * Navbar bell button that opens a dropdown of global delivery channel
 * preferences (in-app toasts, desktop push, email, SMS, mobile push) plus
 * quiet-hours and digest cadence sliders.
 *
 * Channels marked `available: false` in CHANNEL_SCHEMA render as disabled
 * "coming soon" toggles so users can see what's on the roadmap.
 */
export default function NotificationBellMenu() {
  const { prefs, schema } = useChannelPrefs();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Phase 5 MVP — in-app notification inbox. We fetch on mount + on
  // each open + on a 60s polling interval. Items mark read on click
  // OR on "Mark all read" action. unreadCount drives the badge dot.
  const [notifItems, setNotifItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);

  const refreshNotifs = async () => {
    setNotifLoading(true);
    const { data } = await fetchNotifications({ limit: 20 });
    setNotifLoading(false);
    if (data) {
      setNotifItems(data.items || []);
      setUnreadCount(data.unread_count || 0);
    }
  };

  useEffect(() => {
    refreshNotifs();
    const t = setInterval(refreshNotifs, NOTIF_POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Refresh on open so the dropdown shows the freshest inbox.
  useEffect(() => {
    if (open) refreshNotifs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onClickNotif = async (n) => {
    if (!n.read_at) {
      await markNotificationRead(n.id);
      setNotifItems((prev) => prev.map((it) =>
        it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it,
      ));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    // Deep-link to the post + comment when payload carries the
    // anchor. Falls back to no-op when payload is missing fields.
    const p = n.payload || {};
    if (p.official_id) {
      // The simplest deep-link the existing app supports: jump to
      // the page anchor (#post-<id>). PageView's selection model
      // doesn't accept URLs directly today; using location.hash is
      // a non-disruptive nudge — the user lands on the page and
      // can scroll to the post. Improving this is a follow-up.
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('open_page', p.official_id);
        if (p.post_id) u.hash = `#post-${p.post_id}`;
        window.history.pushState({}, '', u.toString());
      } catch { /* ignore */ }
    }
    setOpen(false);
  };

  const onMarkAllRead = async () => {
    await markAllNotificationsRead();
    setNotifItems((prev) => prev.map((it) =>
      it.read_at ? it : { ...it, read_at: new Date().toISOString() },
    ));
    setUnreadCount(0);
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

  const enabledCount = schema.options.filter((o) => o.available && prefs[o.key]).length;

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
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '320px', maxHeight: '70vh', overflowY: 'auto',
            background: 'white', color: 'var(--cl-text)',
            border: '1px solid var(--cl-border)', borderRadius: '12px',
            boxShadow: '0 12px 28px rgba(0,0,0,0.22)',
            zIndex: 200, padding: '10px 12px',
          }}
        >
          <div style={{
            fontSize: '0.82rem', fontWeight: 800, color: 'var(--cl-primary)',
            textTransform: 'uppercase', letterSpacing: '0.4px',
            padding: '4px 2px 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--cl-accent)', cursor: 'pointer',
                  fontSize: '0.66rem', fontWeight: 700,
                  textTransform: 'none', letterSpacing: 0,
                  fontFamily: 'inherit', padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Phase 5 MVP inbox — replies only for now. Empty state
              tells the user the bell is working; loading state
              shows the spinner-equivalent text. */}
          <div style={{ marginBottom: 10 }}>
            {notifLoading && notifItems.length === 0 ? (
              <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', padding: '6px 2px' }}>
                Loading…
              </div>
            ) : notifItems.length === 0 ? (
              <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', padding: '6px 2px', lineHeight: 1.4 }}>
                Nothing new. Replies to your comments will show up here.
              </div>
            ) : (
              notifItems.map((n) => {
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
                      <span style={{ fontWeight: 800 }}>{p.replier_name || 'Someone'}</span>
                      {' '}replied to your comment
                    </div>
                    {p.preview && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: 2, lineHeight: 1.35 }}>
                        “{p.preview}”
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div style={{
            fontSize: '0.68rem', fontWeight: 800, color: 'var(--cl-text-light)',
            textTransform: 'uppercase', letterSpacing: '0.5px', margin: '4px 2px',
          }}>
            Delivery channels
          </div>
          {schema.options.map((opt) => (
            <ChannelToggle
              key={opt.key}
              label={opt.label}
              description={opt.description}
              checked={Boolean(prefs[opt.key])}
              disabled={!opt.available}
              onChange={(v) => setChannelPrefs({ [opt.key]: v })}
            />
          ))}

          <div style={{
            fontSize: '0.68rem', fontWeight: 800, color: 'var(--cl-text-light)',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            margin: '10px 2px 4px',
          }}>
            Cadence
          </div>
          {schema.sliders.map((s) => (
            <Slider
              key={s.key}
              label={s.label}
              description={s.description}
              choices={s.choices}
              value={prefs[s.key] || s.default}
              onChange={(v) => setChannelPrefs({ [s.key]: v })}
            />
          ))}

          <div style={{
            fontSize: '0.68rem', color: 'var(--cl-text-light)',
            padding: '8px 2px 2px', lineHeight: 1.4, borderTop: '1px solid var(--cl-border)',
            marginTop: '6px',
          }}>
            In-app toasts are live today. Desktop, email, SMS, and mobile push
            are on the roadmap — toggle them now to opt-in when they ship.
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelToggle({ label, description, checked, disabled, onChange }) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '6px 2px', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          marginTop: '3px', accentColor: 'var(--cl-accent)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {label}
          {disabled && (
            <span style={{
              fontSize: '0.58rem', fontWeight: 800, padding: '1px 6px',
              borderRadius: '8px', background: 'var(--cl-bg)',
              color: 'var(--cl-text-light)', border: '1px solid var(--cl-border)',
              letterSpacing: '0.4px',
            }}>
              SOON
            </span>
          )}
        </div>
        {description && (
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
            {description}
          </div>
        )}
      </div>
    </label>
  );
}

function Slider({ label, description, choices, value, onChange }) {
  const idx = Math.max(0, choices.indexOf(value));
  return (
    <div style={{ padding: '6px 2px' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>
        {label}: <span style={{ color: 'var(--cl-accent)', textTransform: 'capitalize' }}>
          {String(value).replace(/_/g, ' ')}
        </span>
      </div>
      {description && (
        <div style={{ fontSize: '0.68rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
          {description}
        </div>
      )}
      <input
        type="range"
        min={0}
        max={choices.length - 1}
        step={1}
        value={idx}
        onChange={(e) => onChange(choices[Number(e.target.value)])}
        style={{ width: '100%', marginTop: '4px', accentColor: 'var(--cl-accent)', cursor: 'pointer' }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.62rem', color: 'var(--cl-text-light)',
        textTransform: 'capitalize', marginTop: '2px', fontWeight: 600,
      }}>
        {choices.map((c) => <span key={c}>{String(c).replace(/_/g, ' ')}</span>)}
      </div>
    </div>
  );
}
