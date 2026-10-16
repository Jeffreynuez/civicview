// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Election reminders (2026-10-16). Client for the citizen's on/off
 * switch and the admin preview. Same { data, error } convention as
 * pagesApi.js. The reminders themselves arrive as bell rows of kind
 * 'election_reminder' (components/ElectionReminderNotice.js); the
 * backend writes every sentence (services/election_reminders.py), so
 * the bell, the push and the preview read the same for everyone.
 */
import { request } from './http';

export function fetchElectionReminderSettings() {
  return request('/api/election-reminders/settings');
}

export function setElectionRemindersEnabled(enabled) {
  return request('/api/election-reminders/settings', { method: 'PUT', body: { enabled: !!enabled } });
}

/** Opt in or out of the email copy of each reminder. 409 for a demo address. */
export function setElectionReminderEmail(email) {
  return request('/api/election-reminders/settings', { method: 'PUT', body: { email: !!email } });
}

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
