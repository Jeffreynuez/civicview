'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { completeLoginCandidate, loginCandidate } from '../lib/candidateAuth';
import LoginChallengeStep from './LoginChallengeStep';
import CivicViewLogo from './brand/CivicViewLogo';
import { ModalShell, Button } from './ui';

/**
 * Candidate login modal — minimal Phase 3 surface.
 *
 * Intentionally narrow scope: just email + password sign-in. There's
 * no demo-signup (candidates are provisioned manually by admins after
 * verifying nomination paperwork), no suspension-appeal flow (the
 * candidate pool is small enough that the email-to-civicview path is
 * fine for now — Phase 5 may add the inline appeal form).
 *
 * The backend distinguishes three failure modes and we surface each
 * verbatim:
 *   • 401 — generic "Invalid email or password" (defeats enumeration)
 *   • 403 — suspended account (clear message + contact mailbox)
 *   • 403 — pending claim approval (admin hasn't activated yet)
 *
 * Props:
 *   open           — controls mount
 *   onClose()      — dismiss without signing in
 *   onSuccess(me)  — called after a successful login
 *   initialEmail   — optional pre-fill (e.g. opening from a waitlist
 *                    confirmation that included the candidate's email)
 */

const CONTACT_EMAIL = 'civicview@civicview.app';

const FIELD_LABEL = {
  display: 'block',
  fontSize: 'var(--cl-text-xs)',
  fontWeight: 600,
  color: 'var(--cl-text)',
  marginBottom: 4,
};

const FIELD_INPUT = {
  width: '100%',
  height: 38,
  padding: '0 12px',
  borderRadius: 'var(--cl-radius-md)',
  border: '1px solid var(--cl-border)',
  fontSize: 'var(--cl-text-sm)',
  fontFamily: 'var(--cl-font-sans)',
  color: 'var(--cl-text)',
  background: 'var(--cl-card)',
  boxSizing: 'border-box',
  outline: 'none',
};

export default function CandidateLoginModal({
  open, onClose, onSuccess, initialEmail = '',
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // 2FA challenge state (Task #62 Phase 3). See RepLoginModal for the
  // matching state on the rep side.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);

  // Reset every field on open so a reopened modal doesn't carry
  // stale state from a previous attempt (especially the error message
  // — nothing more confusing than an error that doesn't match what
  // you just typed).
  useEffect(() => {
    if (open) {
      setEmail(initialEmail || '');
      setPassword('');
      setShowPw(false);
      setErr(null);
      setBusy(false);
      setTwoFactorChallenge(null);
    }
  }, [open, initialEmail]);

  if (!open) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const result = await loginCandidate(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      if (onSuccess) onSuccess();
      else if (onClose) onClose();
      return;
    }
    // 2FA gate (Task #62 Phase 3). Password verified — swap to the
    // code-challenge step.
    if (result.twoFactorRequired && result.challengeToken) {
      setTwoFactorChallenge(result.challengeToken);
      return;
    }
    // The backend already formats user-friendly messages for the 403
    // paths (suspended + pending-approval). Render them verbatim.
    setErr(result.error || 'Sign-in failed. Try again.');
  };

  const handleTwoFactorVerify = async (code) => {
    const result = await completeLoginCandidate(twoFactorChallenge, code);
    if (result.ok) {
      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    }
    return result;
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && canSubmit) submit();
  };

  return (
    <ModalShell open={open} onClose={onClose} width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <CivicViewLogo height={28} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 'var(--cl-text-lg)',
            fontWeight: 700,
            color: 'var(--cl-text)',
            marginBottom: 4,
          }}>
            Candidate sign-in
          </div>
          <div style={{
            fontSize: 'var(--cl-text-sm)',
            color: 'var(--cl-text-light)',
            lineHeight: 1.4,
          }}>
            Manage your candidate page — post updates, run polls, host
            events. New candidates must be approved before signing in;
            see <a
              href={`mailto:${CONTACT_EMAIL}`}
              style={{ color: 'var(--cl-accent)', textDecoration: 'none' }}
            >{CONTACT_EMAIL}</a> for help.
          </div>
        </div>

        {/* 2FA challenge step — replaces the email+password form once
            password has verified and the backend handed back a
            challenge token. Restart kicks us back to email+password. */}
        {twoFactorChallenge && (
          <LoginChallengeStep
            identityLabel="candidate"
            onVerify={handleTwoFactorVerify}
            onCancel={() => { setTwoFactorChallenge(null); setErr(null); }}
          />
        )}

        {!twoFactorChallenge && (<>
        <div>
          <label htmlFor="cand-email" style={FIELD_LABEL}>Email</label>
          <input
            id="cand-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder="you@campaign.example"
            style={FIELD_INPUT}
          />
        </div>

        <div>
          <label htmlFor="cand-pw" style={FIELD_LABEL}>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              id="cand-pw"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              style={{ ...FIELD_INPUT, paddingRight: 64 }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              tabIndex={-1}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'var(--cl-text-light)',
                fontSize: 'var(--cl-text-xs)',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                padding: '4px 6px',
              }}
            >
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {err && (
          <div
            role="alert"
            style={{
              fontSize: 'var(--cl-text-sm)',
              color: 'var(--cl-danger-text, #b00020)',
              background: 'var(--cl-danger-soft, #fdecea)',
              border: '1px solid var(--cl-danger-border, #f5c6c6)',
              padding: '8px 10px',
              borderRadius: 'var(--cl-radius-md)',
              lineHeight: 1.4,
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={!canSubmit}
            fullWidth
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            fullWidth
          >
            Cancel
          </Button>
        </div>

        {/* Forgot password? — opens /password-reset?kind=candidate in
            a new tab so the half-typed login form stays around.
            (Task #87) */}
        <div style={{
          textAlign: 'center',
          fontSize: 'var(--cl-text-xs)',
        }}>
          <a
            href="/password-reset?kind=candidate"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--cl-accent)',
              fontWeight: 600,
              textDecoration: 'none',
              fontFamily: 'var(--cl-font-sans)',
            }}
          >
            Forgot password?
          </a>
        </div>

        <div style={{
          fontSize: 'var(--cl-text-xs)',
          color: 'var(--cl-text-muted)',
          textAlign: 'center',
          lineHeight: 1.4,
        }}>
          Not a candidate? Use the rep or citizen sign-in instead — same
          browser can hold all three sessions but only one is active at
          a time.
        </div>
        </>)}
      </div>
    </ModalShell>
  );
}
