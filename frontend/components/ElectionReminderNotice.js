'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { externalLinkProps, hostLabel } from '@/lib/externalLink';
import {
  fetchElectionReminderSettings,
  setElectionRemindersEnabled,
  turnOffElectionReminders,
} from '@/lib/electionReminders';

/**
 * One election reminder in the bell (2026-10-16). The backend writes
 * the title and sentence (services/election_reminders.py): the same
 * words for every voter in the state, a date, what to do and a link to
 * the state's own election site. Never a candidate, a party or a
 * measure. The source line names the official page the date came from.
 *
 * "Turn off election reminders" is one tap, here and in notification
 * settings (ElectionRemindersToggle below).
 */
export default function ElectionReminderNotice({ notification: n, onOpen }) {
  const p = n.payload || {};
  const isUnread = !n.read_at;
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const turnOff = async (e) => {
    e.stopPropagation();
    setBusy(true);
    const { error } = await turnOffElectionReminders();
    setBusy(false);
    if (!error) setOff(true);
  };

  const smallButton = {
    padding: '4px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700,
    border: '1px solid var(--cl-border)', fontFamily: 'inherit',
    background: 'white', color: 'var(--cl-text)', cursor: 'pointer',
  };

  return (
    <div
      style={{
        borderRadius: 8, border: '1px solid var(--cl-border)', marginBottom: 4,
        background: isUnread ? 'var(--cl-accent-soft, #e6f4ea)' : 'white',
      }}
    >
      <button
        type="button"
        onClick={() => onOpen?.(n)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', padding: '8px 8px 4px',
          border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text)', fontWeight: isUnread ? 800 : 700, lineHeight: 1.35 }}>
          {p.title || 'Election reminder'}
        </div>
        {p.body && (
          <div style={{ fontSize: '0.74rem', color: 'var(--cl-text)', marginTop: 3, lineHeight: 1.4, fontWeight: 400 }}>
            {p.body}
          </div>
        )}
      </button>
      <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {p.link_url && (
          <a
            {...externalLinkProps(p.link_url)}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--cl-accent)' }}
          >
            {(p.link_label || 'Official site')} on {hostLabel(p.link_url)}
          </a>
        )}
        {p.source_url && (
          <div style={{ fontSize: '0.66rem', color: 'var(--cl-text-light)' }}>
            Date source:{' '}
            <a {...externalLinkProps(p.source_url)} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit' }}>
              {hostLabel(p.source_url)}
            </a>
          </div>
        )}
        {off ? (
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', lineHeight: 1.35 }}>
            Election reminders are off. You can turn them back on in notification settings below.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button type="button" onClick={turnOff} disabled={busy} style={smallButton}>
              Turn off election reminders
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The switch in notification settings. Signed-in citizens only; the
 * caller decides when to render it. `refreshKey` lets the bell re-read
 * the setting each time it opens (a reminder's one-tap off may have
 * changed it).
 */
export function ElectionRemindersToggle({ refreshKey }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchElectionReminderSettings().then(({ data }) => {
      if (!cancelled && data) setSettings(data);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!settings) return null;

  const onChange = async (v) => {
    setBusy(true);
    const { data } = await setElectionRemindersEnabled(v);
    setBusy(false);
    if (data) setSettings(data);
  };

  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '6px 2px', cursor: busy ? 'progress' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={!!settings.enabled}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: '3px', accentColor: 'var(--cl-accent)', cursor: 'pointer' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Election reminders</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
          Voting deadlines and Election Day, from official state sources, for elections you track and
          for your state if it is Florida, California, New York, Pennsylvania or Texas.
        </div>
      </div>
    </label>
  );
}
