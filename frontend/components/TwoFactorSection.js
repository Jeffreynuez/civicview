'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * TwoFactorSection — the self-contained 2FA management UI surface.
 *
 * Renders one of three states:
 *   • Not signed in     — placeholder + sign-in prompt
 *   • Disabled          — "Enable two-factor authentication" button
 *   • Enabled           — status badge, recovery-codes count, disable
 *                         + regenerate buttons
 *
 * All flows happen inline as expand-in-place panels rather than
 * popping modals — matches the existing CivicView UI convention
 * where moderation, appeals, and engagement actions all stay in
 * the same surface they were started from.
 *
 * Pure presentation + state — the API calls live in lib/twoFactorApi.
 * Reusable: mounted inline in ConstituentDashboard (right rail on
 * desktop, between greeting and rep-tracking on mobile). Drop into
 * any other identity-aware surface where an account-settings
 * affordance makes sense.
 *
 * Props:
 *   onClose() — optional; called when the user dismisses an inline
 *               panel (e.g. cancels enrollment). Used by the overlay
 *               wrapper to close itself when nothing else is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';

import {
  disableTwoFactor,
  fetchTwoFactorStatus,
  regenerateRecoveryCodes,
  startEnrollment,
  verifyEnrollment,
} from '../lib/twoFactorApi';

// Visual constants — keep aligned with the rest of the app's tokens.
const STYLES = {
  card: {
    background: 'white',
    border: '1px solid var(--cl-border)',
    borderRadius: 14,
    padding: 20,
  },
  eyebrow: {
    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.6px', color: 'var(--cl-text-light)',
    marginBottom: 6,
  },
  title: { fontSize: '1.15rem', fontWeight: 700, color: 'var(--cl-text)', margin: '0 0 4px' },
  subtitle: { fontSize: '0.88rem', color: 'var(--cl-text-light)', marginBottom: 14, lineHeight: 1.5 },
  badge: (color) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: 999,
    fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.3px',
    background: color === 'green' ? '#e6f4ea' : '#fdecea',
    color: color === 'green' ? '#1d5a2c' : '#a3261c',
  }),
  primaryBtn: {
    padding: '8px 16px', borderRadius: 8, border: 'none',
    background: 'var(--cl-accent)', color: 'white',
    fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '8px 16px', borderRadius: 8,
    background: 'white', color: 'var(--cl-text)',
    border: '1px solid var(--cl-border)',
    fontSize: '0.86rem', fontWeight: 600, cursor: 'pointer',
  },
  dangerBtn: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid #d9534f',
    background: 'white', color: '#a3261c',
    fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer',
  },
  input: {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--cl-border)', fontSize: '0.95rem',
    fontFamily: 'monospace', letterSpacing: '0.1em',
    boxSizing: 'border-box',
  },
  codeBlock: {
    background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
    borderRadius: 8, padding: '10px 14px',
    fontFamily: 'monospace', fontSize: '0.95rem',
    wordBreak: 'break-all',
  },
};

// View modes for the inline panels. Only one of these is "open" at a
// time; clicking a button replaces whatever was previously shown.
const MODE_IDLE = 'idle';
const MODE_ENROLLING = 'enrolling';
const MODE_VERIFYING_ENROLL = 'verifying-enroll';
const MODE_SHOWING_RECOVERY_CODES = 'showing-recovery-codes';
const MODE_DISABLING = 'disabling';
const MODE_REGENERATING = 'regenerating';

export default function TwoFactorSection({ onClose }) {
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(null);

  // Flow-local state. Cleared whenever mode flips back to IDLE.
  const [mode, setMode] = useState(MODE_IDLE);
  const [pendingSecret, setPendingSecret] = useState(null);     // base32 string
  const [pendingProvisioningUri, setPendingProvisioningUri] = useState(null);
  const [pendingToken, setPendingToken] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [flashError, setFlashError] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  const codeInputRef = useRef(null);

  const reload = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    const { data, error } = await fetchTwoFactorStatus();
    if (error) {
      setStatusError(error);
      setStatus(null);
    } else {
      setStatus(data);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Auto-focus the code input whenever a verify step appears.
  useEffect(() => {
    if (
      (mode === MODE_VERIFYING_ENROLL || mode === MODE_DISABLING || mode === MODE_REGENERATING)
      && codeInputRef.current
    ) {
      codeInputRef.current.focus();
    }
  }, [mode]);

  // Render the QR client-side from the otpauth:// URI whenever we
  // get a fresh provisioning URI. Run async; toDataURL returns a
  // PNG data: URL we drop straight into an <img>.
  useEffect(() => {
    if (!pendingProvisioningUri) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(pendingProvisioningUri, {
      width: 220, margin: 1,
      color: { dark: '#0e3460', light: '#ffffff' },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('QR generation failed', err);
        setQrDataUrl(null);
      });
    return () => { cancelled = true; };
  }, [pendingProvisioningUri]);

  function resetFlowState() {
    setPendingSecret(null);
    setPendingProvisioningUri(null);
    setPendingToken(null);
    setQrDataUrl(null);
    setCode('');
    setBusy(false);
    setFlashError(null);
    setRecoveryCodes(null);
  }

  function cancelFlow() {
    resetFlowState();
    setMode(MODE_IDLE);
    onClose?.();
  }

  async function handleStartEnrollment() {
    setBusy(true);
    setFlashError(null);
    const { data, error } = await startEnrollment();
    if (error) {
      setFlashError(error);
      setBusy(false);
      return;
    }
    setPendingSecret(data.secret);
    setPendingProvisioningUri(data.provisioning_uri);
    setPendingToken(data.pending_token);
    setBusy(false);
    setMode(MODE_ENROLLING);
  }

  async function handleVerifyEnrollment() {
    if (!code.trim()) {
      setFlashError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setFlashError(null);
    const { data, error } = await verifyEnrollment(pendingToken, code.trim());
    setBusy(false);
    if (error) {
      setFlashError(error);
      return;
    }
    setRecoveryCodes(data.recovery_codes || []);
    setMode(MODE_SHOWING_RECOVERY_CODES);
    setCode('');
    // Sensitive secret no longer needed; clear it.
    setPendingSecret(null);
    setPendingProvisioningUri(null);
    setPendingToken(null);
    setQrDataUrl(null);
    reload();
  }

  async function handleConfirmDisable() {
    if (!code.trim()) {
      setFlashError('Enter your current 6-digit code or a recovery code.');
      return;
    }
    setBusy(true);
    setFlashError(null);
    const { error } = await disableTwoFactor(code.trim());
    setBusy(false);
    if (error) {
      setFlashError(error);
      return;
    }
    resetFlowState();
    setMode(MODE_IDLE);
    reload();
  }

  async function handleConfirmRegenerate() {
    if (!code.trim()) {
      setFlashError('Enter your current 6-digit code or a recovery code.');
      return;
    }
    setBusy(true);
    setFlashError(null);
    const { data, error } = await regenerateRecoveryCodes(code.trim());
    setBusy(false);
    if (error) {
      setFlashError(error);
      return;
    }
    setRecoveryCodes(data.recovery_codes || []);
    setMode(MODE_SHOWING_RECOVERY_CODES);
    setCode('');
    reload();
  }

  function copyRecoveryCodesToClipboard() {
    if (!recoveryCodes?.length) return;
    const text = recoveryCodes.join('\n');
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function downloadRecoveryCodes() {
    if (!recoveryCodes?.length) return;
    const header = [
      'CivicView — Recovery Codes',
      'Save these somewhere durable (password manager, printed copy).',
      'Each code works exactly once. Lost both your authenticator app AND',
      "these codes? Contact civicview@civicview.app for admin reset.",
      '',
    ].join('\n');
    const blob = new Blob([header + recoveryCodes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `civicview-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  // ─── Render ────────────────────────────────────────────────────────
  if (statusLoading) {
    return (
      <div style={STYLES.card}>
        <div style={STYLES.eyebrow}>Account security</div>
        <div style={STYLES.title}>Two-factor authentication</div>
        <div style={{ ...STYLES.subtitle, marginBottom: 0 }}>Loading…</div>
      </div>
    );
  }

  // 401 from /api/2fa/status — user not signed in.
  if (statusError && /not signed in|401/i.test(statusError)) {
    return (
      <div style={STYLES.card}>
        <div style={STYLES.eyebrow}>Account security</div>
        <div style={STYLES.title}>Two-factor authentication</div>
        <div style={STYLES.subtitle}>
          Sign in to manage 2FA for your account.
        </div>
      </div>
    );
  }

  if (statusError) {
    return (
      <div style={STYLES.card}>
        <div style={STYLES.eyebrow}>Account security</div>
        <div style={STYLES.title}>Two-factor authentication</div>
        <div style={{ ...STYLES.subtitle, color: '#a3261c' }}>
          Couldn&rsquo;t load 2FA status: {statusError}
        </div>
        <button type="button" style={STYLES.secondaryBtn} onClick={reload}>Retry</button>
      </div>
    );
  }

  return (
    <div style={STYLES.card}>
      <div style={STYLES.eyebrow}>Account security</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ ...STYLES.title, margin: 0 }}>Two-factor authentication</h2>
        <span style={STYLES.badge(status?.enabled ? 'green' : 'red')}>
          {status?.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <p style={STYLES.subtitle}>
        Adds a 6-digit code from an authenticator app (Google Authenticator,
        Authy, 1Password, Microsoft Authenticator) on top of your password.
        Strongly recommended for representatives and candidates; optional but
        encouraged for citizens.
      </p>

      {/* Status panel + primary action */}
      {mode === MODE_IDLE && (
        <StatusPanel
          status={status}
          onEnable={handleStartEnrollment}
          onDisable={() => { resetFlowState(); setMode(MODE_DISABLING); }}
          onRegenerate={() => { resetFlowState(); setMode(MODE_REGENERATING); }}
          busy={busy}
          flashError={flashError}
        />
      )}

      {/* Enrollment step 1 — show QR + secret, prompt for code */}
      {mode === MODE_ENROLLING && (
        <EnrollPanel
          secret={pendingSecret}
          qrDataUrl={qrDataUrl}
          onContinue={() => { setFlashError(null); setMode(MODE_VERIFYING_ENROLL); }}
          onCancel={cancelFlow}
        />
      )}

      {/* Enrollment step 2 — verify the first code */}
      {mode === MODE_VERIFYING_ENROLL && (
        <CodeChallengePanel
          title="Enter the 6-digit code from your authenticator app"
          subtitle="Once we verify this code, 2FA will be active on your account."
          inputRef={codeInputRef}
          code={code}
          onCodeChange={setCode}
          onSubmit={handleVerifyEnrollment}
          onCancel={cancelFlow}
          submitLabel="Verify & enable"
          busy={busy}
          flashError={flashError}
        />
      )}

      {/* Disable confirmation */}
      {mode === MODE_DISABLING && (
        <CodeChallengePanel
          title="Confirm disabling 2FA"
          subtitle="Enter your current 6-digit code or a recovery code to turn off two-factor authentication on this account."
          inputRef={codeInputRef}
          code={code}
          onCodeChange={setCode}
          onSubmit={handleConfirmDisable}
          onCancel={cancelFlow}
          submitLabel="Disable 2FA"
          submitDanger
          busy={busy}
          flashError={flashError}
        />
      )}

      {/* Regenerate recovery codes — also a code-challenge */}
      {mode === MODE_REGENERATING && (
        <CodeChallengePanel
          title="Regenerate recovery codes"
          subtitle="Enter your current 6-digit code or a recovery code. The 10 existing codes (used or unused) will be invalidated and replaced with a fresh set."
          inputRef={codeInputRef}
          code={code}
          onCodeChange={setCode}
          onSubmit={handleConfirmRegenerate}
          onCancel={cancelFlow}
          submitLabel="Regenerate codes"
          busy={busy}
          flashError={flashError}
        />
      )}

      {/* Final step: show the new recovery codes */}
      {mode === MODE_SHOWING_RECOVERY_CODES && recoveryCodes && (
        <RecoveryCodesPanel
          codes={recoveryCodes}
          onCopy={copyRecoveryCodesToClipboard}
          onDownload={downloadRecoveryCodes}
          onDone={cancelFlow}
        />
      )}
    </div>
  );
}

// ─── Sub-panels ──────────────────────────────────────────────────────

function StatusPanel({ status, onEnable, onDisable, onRegenerate, busy, flashError }) {
  if (!status?.enabled) {
    return (
      <div>
        {flashError && <ErrorBox text={flashError} />}
        <button type="button" style={STYLES.primaryBtn} onClick={onEnable} disabled={busy}>
          {busy ? 'Starting…' : 'Enable two-factor authentication'}
        </button>
      </div>
    );
  }
  const remaining = status.recovery_codes_remaining ?? 0;
  return (
    <div>
      {flashError && <ErrorBox text={flashError} />}
      <div style={{
        background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
        borderRadius: 8, padding: '10px 14px', marginBottom: 14,
        fontSize: '0.85rem', color: 'var(--cl-text)',
      }}>
        <div><strong>Recovery codes remaining:</strong> {remaining} of 10</div>
        {remaining <= 2 && (
          <div style={{ color: '#a3261c', marginTop: 4 }}>
            Running low — regenerate before you can&rsquo;t recover from a lost device.
          </div>
        )}
        {status.enabled_at && (
          <div style={{ color: 'var(--cl-text-light)', marginTop: 4, fontSize: '0.78rem' }}>
            Enabled {formatDate(status.enabled_at)}.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={STYLES.secondaryBtn} onClick={onRegenerate} disabled={busy}>
          Regenerate recovery codes
        </button>
        <button type="button" style={STYLES.dangerBtn} onClick={onDisable} disabled={busy}>
          Disable 2FA
        </button>
      </div>
    </div>
  );
}

function EnrollPanel({ secret, qrDataUrl, onContinue, onCancel }) {
  return (
    <div>
      <p style={{ fontSize: '0.88rem', color: 'var(--cl-text)', marginBottom: 12 }}>
        <strong>Step 1.</strong> Scan this QR code with your authenticator app, or type the secret below into it manually.
      </p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{
          width: 220, height: 220, background: 'white',
          border: '1px solid var(--cl-border)', borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {qrDataUrl
            ? <img src={qrDataUrl} alt="2FA QR code" width={220} height={220} />
            : <div style={{ color: 'var(--cl-text-light)', fontSize: '0.85rem' }}>Generating QR…</div>}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginBottom: 6, fontWeight: 700 }}>
            Manual entry secret
          </div>
          <div style={STYLES.codeBlock}>{secret || '—'}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: 8, lineHeight: 1.5 }}>
            Use either the QR or the secret — not both. Some apps support
            time-based 30-second codes only; choose &ldquo;TOTP&rdquo; or
            &ldquo;Time-based&rdquo; if your app asks.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button type="button" style={STYLES.primaryBtn} onClick={onContinue}>
          I&rsquo;ve added it — continue
        </button>
        <button type="button" style={STYLES.secondaryBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CodeChallengePanel({
  title, subtitle, code, onCodeChange, onSubmit, onCancel,
  submitLabel, submitDanger, busy, flashError, inputRef,
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      <p style={{ fontSize: '0.88rem', color: 'var(--cl-text)', marginBottom: 4, fontWeight: 600 }}>
        {title}
      </p>
      {subtitle && (
        <p style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)', marginBottom: 12, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        onChange={(e) => onCodeChange(e.target.value)}
        style={STYLES.input}
        disabled={busy}
        // Tight max length covers both 6-digit TOTP and 11-char
        // (XXXXX-XXXXX) recovery codes — recovery codes are uppercase
        // alpha+digit so allow non-numeric too.
        maxLength={11}
      />
      {flashError && <ErrorBox text={flashError} />}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="submit"
          style={submitDanger ? STYLES.dangerBtn : STYLES.primaryBtn}
          disabled={busy}
        >
          {busy ? 'Working…' : submitLabel}
        </button>
        <button type="button" style={STYLES.secondaryBtn} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RecoveryCodesPanel({ codes, onCopy, onDownload, onDone }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div>
      <div style={{
        background: '#fff8e1', border: '1px solid #f4d27a', borderRadius: 8,
        padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem', color: '#7a5b00',
      }}>
        <strong>Save these recovery codes now.</strong> You won&rsquo;t see them again.
        Each code works exactly once. If you lose both your authenticator app AND your
        codes, only an admin can re-enable login on your account.
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 8, marginBottom: 14,
      }}>
        {codes.map((c) => (
          <div key={c} style={{
            ...STYLES.codeBlock,
            textAlign: 'center', padding: '8px 6px',
          }}>{c}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={STYLES.secondaryBtn} onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy all'}
        </button>
        <button type="button" style={STYLES.secondaryBtn} onClick={onDownload}>
          Download as .txt
        </button>
        <button type="button" style={STYLES.primaryBtn} onClick={onDone}>
          I&rsquo;ve saved them — done
        </button>
      </div>
    </div>
  );
}

function ErrorBox({ text }) {
  return (
    <div style={{
      background: '#fdecea', border: '1px solid #f6b4ad', color: '#a3261c',
      borderRadius: 8, padding: '8px 12px', marginTop: 10,
      fontSize: '0.82rem',
    }}>
      {text}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
