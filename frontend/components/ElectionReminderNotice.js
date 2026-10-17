'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useState } from 'react';
import { externalLinkProps, hostLabel } from '@/lib/externalLink';
import {
  markAlreadyVoted,
  turnOffElectionReminders,
} from '@/lib/electionReminders';

/**
 * One election reminder in the bell (2026-10-16). The backend writes
 * the title and sentence (services/election_reminders.py): the same
 * words for every voter in the state, a date, what to do and a link to
 * the state's own election site. Never a candidate, a party or a
 * measure. The source line names the official page the date came from.
 *
 * "Turn off election reminders" is one tap here; the Election reminders
 * row of the notification settings list (NotificationSettings.js,
 * 2026-10-17) turns them back on. "I already voted" stops the rest of
 * this election's reminders only, and can be undone right here.
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
