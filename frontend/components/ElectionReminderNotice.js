'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { externalLinkProps, hostLabel } from '@/lib/externalLink';
import {
  fetchElectionReminderSettings,
  markAlreadyVoted,
  setElectionReminderEmail,
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
 * settings (ElectionRemindersToggle below). "I already voted" stops the
 * rest of this election's reminders only, and can be undone right here.
 */
export default function ElectionReminderNotice({ notification: n, onOpen }) {
  const p = n.payload || {};
  const isUnread = !n.read_at;
  const [off, setOff] = useState(false);
  const [voted, setVoted] = useState(false);
  const [busy, setBusy] = useState(false);

  const vote = async (e, next) => {
    e.stopPropagation();
    if (!p.reminder_id) return;
    setBusy(true);
    const { error } = await markAlreadyVoted(p.reminder_id, next);
    setBusy(false);
    if (!error) setVoted(next);
  };

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
        {voted && (
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', lineHeight: 1.35 }}>
            Got it. No more reminders for this election.{' '}
            <button
              type="button"
              onClick={(e) => vote(e, false)}
              disabled={busy}
              style={{ ...smallButton, padding: '0 4px', border: 'none', textDecoration: 'underline' }}
            >
              Undo
            </button>
          </div>
        )}
        {off ? (
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', lineHeight: 1.35 }}>
            Election reminders are off. You can turn them back on in notification settings below.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {!voted && p.reminder_id && (
              <button type="button" onClick={(e) => vote(e, true)} disabled={busy} style={smallButton}>
                I already voted
              </button>
            )}
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
 * The switches in notification settings (the bell) and in the
 * dashboard's Account & settings: reminders on or off, and the opt-in
 * email copy. Signed-in citizens only; the caller decides when to
 * render it. `refreshKey` lets the bell re-read the settings each time
 * it opens (a reminder's one-tap off may have changed them).
 */
export function ElectionRemindersToggle({ refreshKey }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

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
    setNote('');
    const { data } = await setElectionRemindersEnabled(v);
    setBusy(false);
    if (data) setSettings(data);
  };

  const onEmail = async (v) => {
    setBusy(true);
    setNote('');
    const { data, error } = await setElectionReminderEmail(v);
    setBusy(false);
    if (data) setSettings(data);
    else if (error) setNote('Could not save. Please try again.');
  };

  return (
    <>
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
    {settings.enabled && (
      <label
        style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          padding: '2px 2px 6px 26px',
          cursor: settings.email_available ? (busy ? 'progress' : 'pointer') : 'not-allowed',
          opacity: settings.email_available ? 1 : 0.6,
        }}
      >
        <input
          type="checkbox"
          checked={!!settings.email}
          disabled={busy || !settings.email_available}
          onChange={(e) => onEmail(e.target.checked)}
          style={{ marginTop: '3px', accentColor: 'var(--cl-accent)', cursor: 'inherit' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 600 }}>Also email me election reminders</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
            {settings.email_available
              ? 'Off unless you turn it on. Each email has a link to turn it off.'
              : 'Demo accounts use a placeholder address that receives no email.'}
          </div>
        </div>
      </label>
    )}
    {note && <div role="status" style={{ fontSize: '0.7rem', color: 'var(--cl-danger, #dc2626)', padding: '0 2px 6px' }}>{note}</div>}
    </>
  );
}
