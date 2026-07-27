'use client';

// CivicView — rep/candidate notification settings (Task #23, 2026-07-26).
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Reps and candidates get a small, deliberately un-cluttered settings
// surface — decided with Jeffrey: they're dashboard-first and get NO
// push (a busy official would drown in reply pushes). Two switches:
//   • reply_alerts   — create reply notifications for this identity
//                      at all (default ON). Off = a high-traffic
//                      official silences the reply firehose entirely.
//   • show_in_bell   — 'auto' (default): this identity's rows reach
//                      the navbar bell only when no citizen session is
//                      active, so a 3-identity browser keeps a clean
//                      citizen bell. 'always' / 'never' override.
//
// Mounted inside the page Dashboard (rep + candidate) next to the
// activity archive. identity is 'rep' | 'candidate'.

import { useEffect, useState } from 'react';
import {
  fetchIdentityNotificationPrefs,
  saveIdentityNotificationPrefs,
} from '@/lib/pagesApi';

// show_in_bell tri-state <-> the stored value: absent = auto,
// true = always, false = never.
function bellModeFromPrefs(prefs) {
  if (!prefs || !('show_in_bell' in prefs)) return 'auto';
  return prefs.show_in_bell ? 'always' : 'never';
}
function prefsFromBellMode(mode) {
  if (mode === 'always') return { show_in_bell: true };
  if (mode === 'never') return { show_in_bell: false };
  return {}; // auto — omit the key
}

function Toggle({ checked, onChange, disabled, label, help }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'default' : 'pointer',
      padding: '8px 0',
    }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--cl-accent)' }}
      />
      <span>
        <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--cl-text)' }}>{label}</span>
        {help && (
          <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--cl-text-light)', marginTop: 2, lineHeight: 1.4 }}>
            {help}
          </span>
        )}
      </span>
    </label>
  );
}

export default function IdentityNotificationSettings({ identity }) {
  const [replyAlerts, setReplyAlerts] = useState(true);
  const [bellMode, setBellMode] = useState('auto');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchIdentityNotificationPrefs(identity).then(({ data }) => {
      if (cancelled) return;
      const prefs = (data && data.prefs) || {};
      setReplyAlerts(prefs.reply_alerts !== false);
      setBellMode(bellModeFromPrefs(prefs));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [identity]);

  const persist = async (next) => {
    setSaving(true);
    setSavedNote('');
    // Full prefs object each save (tiny, no patch semantics) —
    // reply_alerts always present; show_in_bell present only when
    // overriding auto.
    const prefs = {
      reply_alerts: next.replyAlerts,
      ...prefsFromBellMode(next.bellMode),
    };
    const { error } = await saveIdentityNotificationPrefs(identity, prefs);
    setSaving(false);
    setSavedNote(error ? 'Couldn’t save — try again.' : 'Saved');
    if (!error) setTimeout(() => setSavedNote(''), 1800);
  };

  const onReplyToggle = (v) => {
    setReplyAlerts(v);
    persist({ replyAlerts: v, bellMode });
  };
  const onBellMode = (mode) => {
    setBellMode(mode);
    persist({ replyAlerts, bellMode: mode });
  };

  if (!loaded) {
    return (
      <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', padding: '4px 2px' }}>
        Loading notification settings…
      </div>
    );
  }

  const kindWord = identity === 'candidate' ? 'candidate' : 'representative';

  return (
    <div>
      <Toggle
        checked={replyAlerts}
        onChange={onReplyToggle}
        disabled={saving}
        label="Reply notifications"
        help={`Get a notification when someone replies to a comment you made as a ${kindWord}. Turn this off if replies are too frequent — your dashboard archive still keeps every reply.`}
      />

      <div style={{ padding: '8px 0 2px' }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--cl-text)' }}>
          Show in the notification bell
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', margin: '2px 0 8px', lineHeight: 1.4 }}>
          These notifications always live in your dashboard. This controls whether
          they also appear in the top navbar bell.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            ['auto', 'Auto', 'Only when you’re not also signed in as a citizen'],
            ['always', 'Always'],
            ['never', 'Never'],
          ].map(([mode, label, title]) => (
            <button
              key={mode}
              type="button"
              title={title || ''}
              onClick={() => onBellMode(mode)}
              disabled={saving}
              aria-pressed={bellMode === mode}
              style={{
                padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: '0.78rem', fontWeight: 700, fontFamily: 'inherit',
                border: '1px solid ' + (bellMode === mode ? 'var(--cl-accent)' : 'var(--cl-border)'),
                background: bellMode === mode ? 'var(--cl-accent-soft, #e6f4ea)' : 'white',
                color: bellMode === mode ? 'var(--cl-accent)' : 'var(--cl-text)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: 8, minHeight: 16 }}>
        {saving ? 'Saving…' : savedNote}
      </div>
    </div>
  );
}
