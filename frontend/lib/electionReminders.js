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

// Same order and names as the backend's REMINDER_STATES.
export const ELECTION_REMINDER_STATES = ['FL', 'CA', 'NY', 'PA', 'TX'];

export function fetchElectionReminderSettings() {
  return request('/api/election-reminders/settings');
}

export function setElectionRemindersEnabled(enabled) {
  return request('/api/election-reminders/settings', { method: 'PUT', body: { enabled: !!enabled } });
}

export function turnOffElectionReminders() {
  return request('/api/election-reminders/off', { method: 'POST' });
}

// ── Admin preview ────────────────────────────────────────────────────
export function adminElectionReminderPreview() {
  return request('/api/admin/election-reminders');
}
