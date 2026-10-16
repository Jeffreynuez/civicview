'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Admin: "Send me a test push" (2026-10-16). Sends one push to the
 * admin's own devices (those bound to their citizen account) and to this
 * device when the admin page is open in the app, then says what
 * happened. The server logs the same counts.
 */

import { useState } from 'react';
import { request } from '@/lib/http';

export default function AdminTestPush() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const send = async () => {
    setBusy(true);
    setNote('');
    let token = null;
    try { token = window.localStorage.getItem('cv:push:token'); } catch { /* private mode */ }
    const { data, error } = await request('/api/admin/push/test', { method: 'POST', body: { token } });
    setBusy(false);
    if (error || !data) { setNote(`Could not send: ${error || 'no answer'}`); return; }
    if (!data.devices) {
      setNote('No device registered for you. Sign in as your citizen account in the app and turn push on, or open this page in the app.');
      return;
    }
    const where = data.service === 'dev' ? ' (push is not configured on this server: nothing really went out)' : '';
    setNote(`Sent to ${data.sent} of ${data.devices} device(s), ${data.failed} failed, ${data.pruned} removed as dead${where}.`);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
      <button type="button" className="ad-btn ad-btn--ghost" onClick={send} disabled={busy} data-testid="admin-test-push">
        {busy ? 'Sending…' : 'Send me a test push'}
      </button>
      {note && <span style={{ fontSize: '0.8rem' }} role="status">{note}</span>}
    </div>
  );
}
