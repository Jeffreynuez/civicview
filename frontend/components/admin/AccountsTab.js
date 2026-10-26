'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Admin Accounts tab (2026-10-26): look up the accounts with one email
 * address, see whether two-factor authentication is on, and reset it.
 *
 * Reset 2FA is the only way back in for someone who lost their phone and
 * their recovery codes, and before this tab it had no button (admin
 * audit L14 and L15). The reset needs a reason, is saved to the History,
 * signs the account out everywhere, and is refused for admin accounts
 * (remove them from ADMIN_EMAILS first).
 *
 * The lookup takes an exact address only, so this is not a way to
 * browse users.
 */

import { useState } from 'react';

import { adminLookupAccounts } from '@/lib/pagesApi';
import { serverDate } from '@/lib/serverTime';
import { adminResetTwoFactor } from '@/lib/twoFactorApi';
import { ReasonField, kindLabel, kindToken, useAdminDialog } from './adminUi';

// The server's minimum for a reset reason.
const RESET_REASON_MIN = 5;

function when(iso) {
  if (!iso) return 'Never';
  return serverDate(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function status(acc) {
  if (acc.deleted) return 'Deleted';
  if (acc.suspended) return 'Suspended';
  if (!acc.is_active) return 'Inactive';
  return 'Active';
}

// Why the Reset button is off for this account, or null if it's on.
function resetBlocked(acc) {
  if (acc.is_admin) return 'Admin account: remove it from ADMIN_EMAILS first.';
  if (acc.deleted) return 'This account was deleted.';
  if (!acc.twofa_enabled) return '2FA is already off.';
  return null;
}

export default function AccountsTab({ onCounts }) {
  const [email, setEmail] = useState('');
  const [items, setItems] = useState(null);
  const [searched, setSearched] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [resetting, setResetting] = useState(null);

  const lookup = async (address) => {
    const q = (address || '').trim();
    if (q.length < 3 || loading) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await adminLookupAccounts(q);
    setLoading(false);
    if (err || !data) {
      setError(err || 'Could not look that up.');
      return;
    }
    const rows = data.items || [];
    setItems(rows);
    setSearched(q);
    onCounts?.({
      found: rows.length,
      twofa: rows.filter((r) => r.twofa_enabled).length,
      suspended: rows.filter((r) => r.suspended).length,
    });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setNote(null);
    lookup(email);
  };

  const onResetDone = (acc, result) => {
    setResetting(null);
    setNote(
      `2FA reset for ${acc.display_name || acc.email} (${kindLabel(acc.kind).toLowerCase()}). `
      + `They were signed out everywhere${result?.recovery_codes_wiped ? ` and ${result.recovery_codes_wiped} recovery codes were removed` : ''}. `
      + 'It is in the History.',
    );
    lookup(searched);
  };

  return (
    <section className="ad-tab-body ad-accounts">
      <form className="ad-toolbar" onSubmit={onSubmit} role="search" aria-label="Look up an account">
        <label className="ad-search" htmlFor="ad-accounts-email">
          <span className="ad-accounts__label">Email</span>
          <input
            id="ad-accounts-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="The account's exact email address"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="ad-btn ad-btn--grant" disabled={loading || email.trim().length < 3}>
          {loading ? 'Looking up…' : 'Look up'}
        </button>
      </form>
      <p className="ad-accounts__help">
        Exact address only. One address can hold a citizen, a rep and a candidate account.
      </p>

      {error && <div className="ad-accounts__error" role="alert">{error}</div>}
      {note && <div className="ad-accounts__note" role="status">{note}</div>}

      {items === null ? null : items.length === 0 ? (
        <div className="ad-empty">No account uses {searched}.</div>
      ) : (
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Identity</th>
                <th>Name</th>
                <th>Email</th>
                <th>2FA</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((acc) => {
                const blocked = resetBlocked(acc);
                return (
                  <tr key={`${acc.kind}-${acc.id}`}>
                    <td>
                      <span className={`ad-kindpill ad-kindpill--${kindToken(acc.kind)}`}>{kindLabel(acc.kind)}</span>
                      {acc.is_admin && <span className="ad-accounts__tag">Admin</span>}
                      {acc.demo && <span className="ad-accounts__tag">Demo account</span>}
                    </td>
                    <td>
                      {acc.display_name}
                      {acc.page_id && <div className="ad-mono">{acc.page_id}</div>}
                    </td>
                    <td className="ad-mono">{acc.email}</td>
                    <td>{acc.twofa_enabled ? 'On' : 'Off'}</td>
                    <td>{status(acc)}</td>
                    <td>{when(acc.last_login_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="ad-btn ad-btn--danger"
                        disabled={Boolean(blocked)}
                        title={blocked || 'Turn off 2FA and sign this account out everywhere'}
                        onClick={() => { setNote(null); setResetting(acc); }}
                      >
                        Reset 2FA
                      </button>
                      {blocked && <div className="ad-accounts__why">{blocked}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {resetting && (
        <ResetModal
          acc={resetting}
          onCancel={() => setResetting(null)}
          onDone={(result) => onResetDone(resetting, result)}
        />
      )}
    </section>
  );
}

function ResetModal({ acc, onCancel, onDone }) {
  const { dialogRef, titleId } = useAdminDialog(onCancel);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ok = reason.trim().length >= RESET_REASON_MIN;

  const confirm = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await adminResetTwoFactor(acc.kind, acc.id, reason.trim());
    setBusy(false);
    if (err || !data) {
      setError(err || 'Could not reset 2FA.');
      return;
    }
    onDone(data);
  };

  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow">Account security</div>
          <h2 className="ad-modal__title" id={titleId}>Reset 2FA for {acc.display_name || acc.email}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            This turns off two-factor authentication on the {kindLabel(acc.kind).toLowerCase()} account{' '}
            <span className="ad-mono">{acc.email}</span>, removes its recovery codes and signs it out on
            every device. They sign in with their password and can set up 2FA again.
          </div>
          <div>
            Only do this after the person has shown it is their account, for example by writing from
            this email address.
          </div>
          <ReasonField
            value={reason}
            onChange={setReason}
            required
            autoFocus
            label="Your reason (required, saved to the admin History)"
            hint={`At least ${RESET_REASON_MIN} characters: how they showed it is their account.`}
            placeholder="Why is this reset needed, and how did they prove who they are?"
          />
          {error && <div className="ad-accounts__error" role="alert">{error}</div>}
        </div>
        <div className="ad-modal__footer">
          <button type="button" className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="ad-btn ad-btn--danger" onClick={confirm} disabled={!ok || busy}>
            {busy ? 'Resetting…' : 'Reset 2FA'}
          </button>
        </div>
      </div>
    </div>
  );
}
