'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * "Email me when a page I track changes" (2026-10-16). On by default:
 * it is one email per change (an official leaving office, a campaign
 * ending, a candidate taking office). Off stops only the email; the
 * notice in the bell always comes. Stored on the account, not in the
 * synced prefs blob, so the one-click unsubscribe link in those emails
 * cannot be undone by another device's sync. Used in the bell (citizens)
 * and in the rep and candidate notification settings (identity=...).
 */

import { useEffect, useState } from 'react';
import { request } from '@/lib/http';

export default function PageChangeEmailToggle({ identity, refreshKey, compact = true }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const qs = identity ? `?identity=${encodeURIComponent(identity)}` : '';

  useEffect(() => {
    let cancelled = false;
    request(`/api/email/page-changes${qs}`).then(({ data }) => {
      if (!cancelled && data) setSettings(data);
    });
    return () => { cancelled = true; };
  }, [qs, refreshKey]);

  if (!settings) return null;

  const onChange = async (enabled) => {
    setBusy(true);
    setNote('');
    const { data } = await request('/api/email/page-changes', {
      method: 'PUT', body: { enabled, identity: identity || undefined },
    });
    setBusy(false);
    if (data) setSettings(data);
    else setNote('Could not save. Please try again.');
  };

  const available = settings.email_available;
  return (
    <label
      data-testid="page-change-email-toggle"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: compact ? '6px 2px' : '8px 0',
        cursor: available ? (busy ? 'progress' : 'pointer') : 'not-allowed',
        opacity: available ? 1 : 0.6,
      }}
    >
      <input
        type="checkbox"
        checked={!!settings.enabled}
        disabled={busy || !available}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: '3px', accentColor: 'var(--cl-accent)', cursor: 'inherit' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? '0.8rem' : '0.88rem', fontWeight: 600 }}>
          Email me when a page I track changes
        </div>
        <div style={{ fontSize: compact ? '0.7rem' : '0.78rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
          {available
            ? 'One email when an official you track leaves office, a campaign ends or a candidate takes office. The notice in the bell always comes.'
            : 'Demo accounts use a placeholder address that receives no email.'}
        </div>
        {note && <div style={{ fontSize: '0.68rem', color: '#b3261e', marginTop: 2 }}>{note}</div>}
      </div>
    </label>
  );
}
