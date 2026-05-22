'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { completeLoginRep, loginRep } from '../lib/auth';
import LoginChallengeStep from './LoginChallengeStep';
import { submitSuspensionAppeal } from '../lib/pagesApi';
import CivicViewLogo from './brand/CivicViewLogo';
import { ModalShell, Button } from './ui';

/**
 * Rep / candidate login modal.
 *
 * Current state (pre-ID.me): there are no rep accounts to sign into.
 * The modal renders a contact-us panel pointing real reps at the
 * civicview@civicview.app mailbox; we onboard them manually until
 * the verified rep flow ships. The legacy credentials form is kept in
 * the file (gated by REP_LOGIN_LIVE) so it can be re-enabled in one
 * flag flip when verified rep auth lands.
 *
 * Why not just keep the demo form alive? Anyone with the seeded
 * credentials could post as Byron Donalds, Rick Scott, etc. — and
 * those posts were publicly visible to citizens. That's
 * impersonation of real politicians (legal exposure: defamation,
 * false light, no §230 shield because we'd be the publisher). The
 * safer path until we can verify rep identity for real: no rep
 * posting, only citizen-led polls on unclaimed pages.
 *
 * Props:
 *   open            — controls mount
 *   onClose()       — dismiss without signing in
 *   onSuccess(me)   — called after a successful login (login form only)
 *   initialEmail    — optional pre-fill for the login form
 */

// Flip to true when verified rep accounts ship. Re-enables the
// email + password form below the brand mark.
//
// Currently TRUE so the internal test-rep account (provisioned via
// DEMO_ACCOUNTS_JSON env var on Render) can sign in to exercise the
// rep-posting + AI-comment-filter UI before real-rep onboarding
// ships. The wider impersonation-risk reasoning still applies — no
// rep accounts are seeded in the committed seed file; only the env-
// var-supplied test account exists. Flip back to false (or rotate
// the test rep's password) before opening the app to broader testers.
const REP_LOGIN_LIVE = true;
// Mailbox surfaced in the placeholder panel + the unclaimed-page
// banner. Update this in one place to propagate.
const REP_CONTACT_EMAIL = 'civicview@civicview.app';
// Inert placeholders for the legacy demo-accounts UI inside the
// REP_LOGIN_LIVE branch. The seed list and shared password were
// retired when we removed demo rep accounts (see DEPLOY.md fresh-
// start migration). Repopulate these once verified rep auth lands;
// the existing legacy UI will then render against the live data.
const DEMO_ACCOUNTS = [];
const DEMO_PASSWORD = '';

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

export default function RepLoginModal({
  open, onClose, onSuccess, initialEmail = '',
  // Phase 3 candidate-auth integration. When provided, the modal
  // surfaces a small "I'm a candidate" footer link that closes this
  // modal and opens the candidate sign-in instead. Optional — when
  // omitted, the link is hidden so call sites that don't have the
  // candidate path wired (e.g. an older rep-only context) don't
  // render a dead button.
  onSignInAsCandidate,
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showDemo, setShowDemo] = useState(false);

  // Suspension-appeal flow state — see CitizenLoginModal.js for the
  // full reasoning, and why these MUST be declared above the
  // `if (!open) return null;` guard below (calling hooks
  // conditionally throws React #310 on open-transition).
  const [suspendedMessage, setSuspendedMessage] = useState(null);
  const [appealRationale, setAppealRationale] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealResult, setAppealResult] = useState(null);

  // 2FA challenge state (Task #62 Phase 3). When the backend returns
  // two_factor_required, we stash the challenge token here and swap
  // the modal body to LoginChallengeStep until the code verifies.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail || '');
      setPassword('');
      setShowPw(false);
      setErr(null);
      setBusy(false);
      setShowDemo(false);
      // Reset appeal flow too so a reopened modal doesn't surface
      // stale state from a previous suspended-login attempt.
      setSuspendedMessage(null);
      setAppealRationale('');
      setAppealBusy(false);
      setAppealResult(null);
      setTwoFactorChallenge(null);
    }
  }, [open, initialEmail]);

  if (!open) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const result = await loginRep(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      if (onSuccess) onSuccess();
      return;
    }
    // 2FA gate (Task #62 Phase 3). Password verified but the account
    // has 2FA enrolled — swap to the code-challenge step. Don't show
    // an error; the LoginChallengeStep banner explains what's
    // happening.
    if (result.twoFactorRequired && result.challengeToken) {
      setTwoFactorChallenge(result.challengeToken);
      return;
    }
    if (result.status === 403) {
      // 403 = creds matched, account is suspended. Switch into the
      // appeal flow so the rep can file recourse without bouncing
      // through a separate page.
      setSuspendedMessage(result.error || 'This account has been suspended.');
      return;
    }
    // Security note: do NOT reveal whether the email exists.
    // Combined message keeps enumeration attacks at bay.
    setErr(result.error || "Email or password didn't match. Try again or reset it.");
  };

  // Code-verify handler passed to LoginChallengeStep. Returns the
  // {ok, error} shape that LoginChallengeStep surfaces inline.
  const handleTwoFactorVerify = async (code) => {
    const result = await completeLoginRep(twoFactorChallenge, code);
    if (result.ok) {
      if (onSuccess) onSuccess();
    }
    return result;
  };

  const submitAppeal = async () => {
    const trimmed = appealRationale.trim();
    if (trimmed.length < 50 || appealBusy) return;
    setAppealBusy(true);
    const { data, error } = await submitSuspensionAppeal({
      email: email.trim(),
      password,
      rationale: trimmed,
    });
    setAppealBusy(false);
    if (error || !data) {
      setAppealResult({ ok: false, message: error || 'Could not file appeal.' });
      return;
    }
    setAppealResult({ ok: true, message: data.message });
  };

  const cancelAppealFlow = () => {
    setSuspendedMessage(null);
    setAppealRationale('');
    setAppealBusy(false);
    setAppealResult(null);
  };

  const fillDemo = (account) => {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setErr(null);
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      width={440}
      cardStyle={{ padding: '24px 24px 16px' }}
    >
      {/* Brand mark + heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <CivicViewLogo size={28} variant="color" />
        <span
          style={{
            fontFamily: 'var(--cl-font-display)',
            fontWeight: 700,
            fontSize: 'var(--cl-text-md)',
            color: 'var(--cl-text)',
          }}
        >
          CivicView
        </span>
      </div>

      <h2 className="cl-h1" style={{ margin: 0, marginBottom: 6 }}>
        {REP_LOGIN_LIVE ? 'Sign in to your page' : 'Rep login coming soon'}
      </h2>
      <p
        className="cl-body-sm"
        style={{ color: 'var(--cl-text-light)', margin: 0, marginBottom: 18 }}
      >
        Verified representatives and candidates can post updates, attach polls,
        and publish events.
      </p>

      {!REP_LOGIN_LIVE && (
        <>
          <div
            role="note"
            style={{
              marginBottom: 16,
              padding: '14px 14px',
              background: 'var(--cl-accent-soft)',
              border: '1px solid var(--cl-accent-soft)',
              borderRadius: 'var(--cl-radius-md)',
              fontSize: 'var(--cl-text-sm)',
              lineHeight: 1.55,
              color: 'var(--cl-text)',
            }}
          >
            We&rsquo;re building the verified-rep login on top of ID.me
            identity verification. That work is blocked on funding —
            see the &ldquo;Help build this&rdquo; tab for the cost
            breakdown.
            <br /><br />
            <strong>If you&rsquo;re a U.S. representative or
            candidate</strong> (or a staffer / comms director acting
            on their behalf) and you&rsquo;d like to claim your
            CivicView page, email us at:
            <div
              style={{
                marginTop: 10,
                padding: '8px 10px',
                background: 'var(--cl-card)',
                border: '1px solid var(--cl-border)',
                borderRadius: 'var(--cl-radius-sm)',
                fontFamily: 'var(--cl-font-mono)',
                fontSize: 'var(--cl-text-sm)',
                fontWeight: 700,
                textAlign: 'center',
                color: 'var(--cl-text)',
              }}
            >
              <a
                href={`mailto:${REP_CONTACT_EMAIL}?subject=Claim%20my%20CivicView%20page`}
                style={{ color: 'var(--cl-accent)', textDecoration: 'none' }}
              >
                {REP_CONTACT_EMAIL}
              </a>
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text-light)',
              }}
            >
              We&rsquo;ll walk you through claiming the page over a
              quick call and grant posting access manually until the
              automated verification flow is live.
            </div>
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={onClose}
            style={{ width: '100%' }}
          >
            Got it
          </Button>
        </>
      )}

      {/* 2FA challenge step — replaces the email+password form once
          the user's password verified and the backend returned a
          challenge token. Restart kicks us back to email+password. */}
      {REP_LOGIN_LIVE && twoFactorChallenge && (
        <LoginChallengeStep
          identityLabel="rep"
          onVerify={handleTwoFactorVerify}
          onCancel={() => { setTwoFactorChallenge(null); setErr(null); }}
        />
      )}

      {REP_LOGIN_LIVE && !twoFactorChallenge && (<>

      {/* Email */}
      <label htmlFor="rep-login-email" style={FIELD_LABEL}>
        Email
      </label>
      <input
        id="rep-login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
        placeholder="you@example.gov"
        disabled={busy}
        style={{ ...FIELD_INPUT, marginBottom: 12 }}
      />

      {/* Password with show/hide */}
      <label htmlFor="rep-login-password" style={FIELD_LABEL}>
        Password
      </label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input
          id="rep-login-password"
          type={showPw ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="••••••••"
          disabled={busy}
          style={{ ...FIELD_INPUT, paddingRight: 56 }}
        />
        <button
          type="button"
          onClick={() => setShowPw((s) => !s)}
          tabIndex={-1}
          aria-label={showPw ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute',
            right: 10,
            top: 0,
            bottom: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--cl-text-light)',
            fontSize: 'var(--cl-text-xs)',
            cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {showPw ? 'Hide' : 'Show'}
        </button>
      </div>

      {err && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: '8px 10px',
            background: 'var(--cl-danger-soft)',
            color: 'var(--cl-danger-text)',
            borderRadius: 'var(--cl-radius-md)',
            fontSize: 'var(--cl-text-xs)',
            border: '1px solid var(--cl-danger-border)',
          }}
        >
          {err}
        </div>
      )}

      {/* Suspension-appeal flow — same UX pattern as the citizen
          login. Triggered by 403 from /api/auth/login meaning creds
          matched but the rep account is suspended. */}
      {suspendedMessage && !appealResult && (
        <div
          role="region"
          aria-label="Suspension appeal"
          style={{
            marginBottom: 12,
            padding: '14px',
            background: 'var(--cl-danger-soft)',
            border: '1px solid var(--cl-danger-border)',
            borderRadius: 'var(--cl-radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-danger-text)', lineHeight: 1.5 }}>
            {suspendedMessage}
          </div>
          <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text)', lineHeight: 1.5 }}>
            Think this was wrong? Write a brief rationale (50–1000 chars) and we&rsquo;ll review.
            You only get one appeal per suspension; an admin will email you the outcome.
          </div>
          <textarea
            value={appealRationale}
            onChange={(e) => setAppealRationale(e.target.value.slice(0, 1000))}
            placeholder="Why should this suspension be reconsidered?"
            rows={5}
            disabled={appealBusy}
            style={{
              padding: '8px 10px',
              border: '1px solid var(--cl-border)',
              borderRadius: 'var(--cl-radius-md)',
              fontSize: 'var(--cl-text-sm)',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: 'var(--cl-text-2xs)',
                color: appealRationale.length < 50 ? 'var(--cl-text-light)' : 'var(--cl-accent)',
              }}
            >
              {appealRationale.length}/1000
              {appealRationale.length < 50 && ` — at least ${50 - appealRationale.length} more characters`}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={cancelAppealFlow}
                style={{
                  padding: '6px 12px',
                  background: 'white',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 'var(--cl-radius-md)',
                  fontSize: 'var(--cl-text-xs)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Back
              </button>
              <Button
                variant="primary"
                onClick={submitAppeal}
                loading={appealBusy}
                disabled={appealRationale.trim().length < 50 || appealBusy}
              >
                Submit appeal
              </Button>
            </div>
          </div>
          <div style={{ fontSize: 'var(--cl-text-2xs)', color: 'var(--cl-text-light)', borderTop: '1px solid var(--cl-border)', paddingTop: 8 }}>
            Prefer email?{' '}
            <a
              href={`mailto:civicview@civicview.app?subject=${encodeURIComponent(`Suspension appeal: ${email.trim()}`)}&body=${encodeURIComponent('I am appealing my rep account suspension for the following reasons:\n\n')}`}
              style={{ color: 'var(--cl-accent)', textDecoration: 'underline' }}
            >
              Email civicview@civicview.app
            </a>{' '}
            instead.
          </div>
        </div>
      )}

      {appealResult && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: '12px',
            background: appealResult.ok ? 'var(--cl-up-soft)' : 'var(--cl-danger-soft)',
            color: appealResult.ok ? 'var(--cl-text)' : 'var(--cl-danger-text)',
            border: `1px solid ${appealResult.ok ? 'var(--cl-up)' : 'var(--cl-danger-border)'}`,
            borderRadius: 'var(--cl-radius-md)',
            fontSize: 'var(--cl-text-sm)',
            lineHeight: 1.5,
          }}
        >
          {appealResult.message}
        </div>
      )}

      {/* Actions — Sign in CTA hidden during appeal flow so the user
          isn't presented with competing actions. */}
      {!suspendedMessage && !appealResult && (
        <Button
          variant="primary"
          size="lg"
          onClick={submit}
          loading={busy}
          disabled={!canSubmit}
          style={{ width: '100%', marginBottom: 8 }}
        >
          Sign in
        </Button>
      )}

      {/* Forgot password? — only shown during the email+password phase
          (not during 2FA challenge or appeal flow). The link opens
          /password-reset?kind=rep in a new tab so the user can recover
          without losing the half-typed login form. (Task #87) */}
      {!suspendedMessage && !appealResult && (
        <div style={{
          textAlign: 'center',
          marginTop: 4,
          marginBottom: 4,
          fontSize: 'var(--cl-text-xs)',
        }}>
          <a
            href="/password-reset?kind=rep"
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
      )}

      {/* Demo accounts — collapsed by default */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px dashed var(--cl-border)',
        }}
      >
        <button
          type="button"
          onClick={() => setShowDemo((s) => !s)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--cl-accent)',
            fontSize: 'var(--cl-text-xs)',
            fontWeight: 600,
            padding: 0,
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {showDemo ? '▾ Hide demo logins' : '▸ Show demo logins (preview only)'}
        </button>
        {showDemo && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => fillDemo(a)}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 'var(--cl-radius-sm)',
                  background: 'var(--cl-bg)',
                  color: 'var(--cl-text)',
                  fontSize: 'var(--cl-text-xs)',
                  cursor: 'pointer',
                  fontFamily: 'var(--cl-font-sans)',
                  transition: 'border-color var(--cl-duration-fast) var(--cl-ease-standard)',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cl-accent)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cl-border)';
                }}
              >
                <div style={{ fontWeight: 700 }}>{a.label}</div>
                <div
                  style={{
                    color: 'var(--cl-text-light)',
                    fontSize: 'var(--cl-text-2xs)',
                    fontFamily: 'var(--cl-font-mono)',
                  }}
                >
                  {a.email}
                </div>
              </button>
            ))}
            <div
              style={{
                color: 'var(--cl-text-muted)',
                fontSize: 'var(--cl-text-2xs)',
                marginTop: 4,
                fontStyle: 'italic',
              }}
            >
              Shared demo password:{' '}
              <code
                style={{
                  fontSize: 'var(--cl-text-2xs)',
                  fontFamily: 'var(--cl-font-mono)',
                  background: 'var(--cl-bg-soft)',
                  padding: '1px 5px',
                  borderRadius: 'var(--cl-radius-xs)',
                }}
              >
                {DEMO_PASSWORD}
              </code>
            </div>
          </div>
        )}
        {/* Phase 3 candidate-auth handoff. Renders only when the
            caller passed onSignInAsCandidate (page.js does; older
            call sites that don't wire the candidate flow don't see
            a dead link). One-click switch — closes this modal and
            opens the candidate login. */}
        {typeof onSignInAsCandidate === 'function' && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid var(--cl-border)',
              fontSize: 'var(--cl-text-xs)',
              color: 'var(--cl-text-light)',
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            Running for office?{' '}
            <button
              type="button"
              onClick={() => {
                if (onClose) onClose();
                onSignInAsCandidate();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--cl-accent)',
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
                fontSize: 'inherit',
                fontFamily: 'inherit',
              }}
            >
              Sign in as a candidate instead →
            </button>
          </div>
        )}
      </div>
      </>)}
    </ModalShell>
  );
}
