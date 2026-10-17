// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Election reminders (2026-10-16). Client for "I already voted" and the
 * one-tap off on a reminder; the on/off and email choice live in the
 * notification settings list since 2026-10-17 (lib/alertSettings.js). Same { data, error } convention as
 * pagesApi.js. The reminders themselves arrive as bell rows of kind
 * 'election_reminder' (components/ElectionReminderNotice.js); the
 * backend writes every sentence (services/election_reminders.py), so
 * the bell, the push and the preview read the same for everyone.
 */
import { request } from './http';

/**
 * "I already voted": no more reminders for this reminder's election.
 * voted=false undoes it.
 */
export function markAlreadyVoted(reminderId, voted = true) {
  return request('/api/election-reminders/voted', {
    method: 'POST',
    body: { reminder_id: reminderId, voted: !!voted },
  });
}

export function turnOffElectionReminders() {
  return request('/api/election-reminders/off', { method: 'POST' });
}

// ── Admin preview ────────────────────────────────────────────────────
export function adminElectionReminderPreview() {
  return request('/api/admin/election-reminders');
}
