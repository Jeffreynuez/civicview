'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
import { completeLoginCitizen, loginCitizen, signupDemoCitizen } from '../lib/citizenAuth';
import LoginChallengeStep from './LoginChallengeStep';
import { submitSuspensionAppeal } from '../lib/pagesApi';
import CivicLensLogo from './brand/CivicLensLogo';
import { ModalShell, Button } from './ui';

// US states + DC + territories with congressional delegates. Same set
// the backend validates against — keep in sync.
const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'],
  ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'],
];

// Max House district number per state, based on the 119th Congress
// apportionment. States with a single at-large district are listed as
// 1 (we'll surface that as "At-large" in the UI). Drives the district
// dropdown so a user can't pick a number that doesn't exist.
const STATE_HOUSE_DISTRICTS = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28, GA: 14,
  HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6, ME: 2, MD: 8,
  MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12,
  NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5, OR: 6, PA: 17, RI: 2, SC: 7,
  SD: 1, TN: 9, TX: 38, UT: 4, VT: 1, VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
};

/**
 * Citizen login modal — parallel to RepLoginModal.
 *
 * Phase 1.5 demo: 60 seeded citizen accounts (50 FL + 10 out-of-state),
 * all sharing the same password. The demo-login panel is searchable
 * because scanning 60 rows visually is painful.
 *
 * Phase 3A: restyled to use the design system. The yellow "Demo preview"
 * notice is LOAD-BEARING per the design system spec (preserve list) and
 * stays exactly as authored.
 *
 * Props:
 *   open           — controls mount
 *   onClose()      — dismiss without signing in
 *   onSuccess(me)  — called after a successful login
 */
// Dead-code cleanup: the Phase 1.5 demo-citizen picker (a fixed list of
// 60 seeded accounts + a shared password) was retired when the self-serve
// demo-signup flow shipped. The constants stayed behind as dead references
// — removed entirely here before the repo went public so the names +
// addresses + password aren't visible at HEAD. Historical commits were
// scrubbed in the same pass — see SECURITY.md §1 for the git-filter-repo
// procedure used.

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

export default function CitizenLoginModal({ open, onClose, onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Self-serve demo signup form state. Replaces the old fixed
  // 60-account list — any visitor can mint their own demo citizen
  // with a name + state + (optional) district + city.
  const [showDemo, setShowDemo] = useState(false);
  const [demoDisplayName, setDemoDisplayName] = useState('');
  const [demoState, setDemoState] = useState('FL');
  const [demoDistrict, setDemoDistrict] = useState('');
  const [demoCity, setDemoCity] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState(null);
  // After a successful signup we surface the freshly-minted email +
  // password so the user can copy them — they're the user's keys to
  // sign back in from another device. The auto-login already
  // happened (cookies + token set) so the modal also closes shortly
  // after via onSuccess().
  const [issuedCreds, setIssuedCreds] = useState(null);

  // Suspended-user appeal flow state. MUST be declared above the
  // `if (!open) return null;` guard below — calling hooks
  // conditionally (or after a conditional return) breaks the
  // hook-count invariant React relies on, throwing #310 on the
  // open-transition. Render decided to learn that the hard way.
  // When the login endpoint returns 403 (account suspended), we
  // flip the modal into "you can appeal this" mode — pre-loaded
  // with the email + password the user just submitted so the
  // appeal endpoint can re-verify them without a second
  // credential entry.
  const [suspendedMessage, setSuspendedMessage] = useState(null);
  const [appealRationale, setAppealRationale] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealResult, setAppealResult] = useState(null);

  // 2FA challenge state (Task #62 Phase 3). When the backend returns
  // two_factor_required, we swap the modal body to LoginChallengeStep
  // until the code verifies.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);

  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setShowPw(false);
      setErr(null);
      setBusy(false);
      setShowDemo(false);
      setDemoDisplayName('');
      setDemoState('FL');
      setDemoDistrict('');
      setDemoCity('');
      setDemoBusy(false);
      setDemoErr(null);
      setIssuedCreds(null);
      // Reset the appeal flow state too so reopening the modal
      // doesn't surface a stale suspension message from a
      // previous attempt.
      setSuspendedMessage(null);
      setAppealRationale('');
      setAppealBusy(false);
      setAppealResult(null);
      setTwoFactorChallenge(null);
    }
  }, [open]);

  // Whenever the user changes states, clamp the district to whatever
  // that state actually supports. Avoids "FL-19" sticking around
  // after the user picks Vermont (which only has 1 at-large district).
  useEffect(() => {
    const max = STATE_HOUSE_DISTRICTS[demoState] || 0;
    if (demoDistrict && parseInt(demoDistrict, 10) > max) {
      setDemoDistrict('');
    }
  }, [demoState, demoDistrict]);

  // District options for the dropdown — empty (use State only) plus
  // 1..max. At-large states (max === 1) get an "At-large" label so
  // it's clear there's no choice to make.
  const districtOptions = useMemo(() => {
    const max = STATE_HOUSE_DISTRICTS[demoState] || 0;
    if (max <= 0) return [];
    if (max === 1) return [['1', 'At-large']];
    return Array.from({ length: max }, (_, i) => [String(i + 1), `District ${i + 1}`]);
  }, [demoState]);

  if (!open) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const result = await loginCitizen(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      if (onSuccess) onSuccess();
      return;
    }
    // 2FA gate (Task #62 Phase 3). Password verified — swap to the
    // code-challenge step.
    if (result.twoFactorRequired && result.challengeToken) {
      setTwoFactorChallenge(result.challengeToken);
      return;
    }
    // 403 = account exists, password matched, but the account is
    // suspended. Switch the modal into appeal mode so the user can
    // file recourse without bouncing through a separate flow.
    if (result.status === 403) {
      setSuspendedMessage(result.error || 'This account has been suspended.');
      return;
    }
    // Anything else is a generic auth failure — combined message so
    // we don't leak whether the email exists.
    setErr(result.error || "Email or password didn't match. Try again or reset it.");
  };

  const handleTwoFactorVerify = async (code) => {
    const result = await completeLoginCitizen(twoFactorChallenge, code);
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

  // Submit the self-serve demo signup form. Backend mints a fresh
  // CitizenAccount, returns the credentials, auto-logs the user in.
  // We auto-fill the login form fields so the user can SEE the
  // generated email + password (the user requested this — feels less
  // magic than "you're suddenly signed in with no idea how"), then
  // close the modal via onSuccess so they can start engaging.
  const submitDemoSignup = async () => {
    const name = demoDisplayName.trim();
    if (!name) {
      setDemoErr('Pick a display name.');
      return;
    }
    setDemoBusy(true);
    setDemoErr(null);
    const result = await signupDemoCitizen({
      displayName: name,
      state: demoState || null,
      congressionalDistrict: demoDistrict || null,
      city: demoCity.trim() || null,
    });
    setDemoBusy(false);
    if (!result.ok) {
      setDemoErr(result.error || 'Could not create demo account.');
      return;
    }
    // Stash the issued credentials so the user can see them; pre-fill
    // the login form so it's obvious they can sign back in with these
    // values from another device or after clearing cookies.
    setIssuedCreds({ email: result.email, password: result.password });
    setEmail(result.email);
    setPassword(result.password);
  };

  // Auto-fill the standard login fields from a previously-issued set
  // of demo credentials (used by the "Sign in with these" button on
  // the post-signup confirmation screen). The user is already logged
  // in via auto-login, but tapping this is reassurance — confirms
  // the creds actually work end-to-end.
  const proceedWithIssuedCreds = () => {
    if (onSuccess) onSuccess();
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      width={460}
      cardStyle={{ padding: '24px 24px 16px' }}
    >
      {/* Brand mark + heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <CivicLensLogo size={28} variant="color" />
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
        Citizen sign in
      </h2>
      <p
        className="cl-body-sm"
        style={{ color: 'var(--cl-text-light)', margin: 0, marginBottom: 14 }}
      >
        Verified US citizens can like, dislike, and vote on polls.
        Subscribed citizens can also comment and start polls on
        unclaimed rep pages. Engagement is scoped by state and
        district so reps can filter what their own constituents are
        saying.
      </p>

      {/* Load-bearing yellow notice — preserved per design system rules */}
      <div
        role="note"
        style={{
          marginBottom: 16,
          padding: '10px 12px',
          background: 'var(--cl-warning-soft)',
          color: 'var(--cl-warning-text)',
          border: '1px solid var(--cl-warning-border)',
          borderRadius: 'var(--cl-radius-md)',
          fontSize: 'var(--cl-text-2xs)',
          lineHeight: 1.5,
        }}
      >
        <strong>Demo preview.</strong> Real verified accounts ship
        once ID.me identity verification is funded — until then,
        create a demo account below with a name + state + district
        of your choice. Demo accounts get the full experience
        (vote, like, dislike, comment, start polls) as a preview.
        Identities are self-attested, so every engagement surface
        labels demo activity &ldquo;Unverified.&rdquo; When ID.me
        ships, demo users will be offered an opt-in path to keep
        their activity on a verified account.
      </div>

      {/* 2FA challenge step — replaces the email+password form once
          password has verified and the backend handed back a
          challenge token. Restart kicks us back to email+password. */}
      {twoFactorChallenge && (
        <LoginChallengeStep
          identityLabel="citizen"
          onVerify={handleTwoFactorVerify}
          onCancel={() => { setTwoFactorChallenge(null); setErr(null); }}
        />
      )}

      {!twoFactorChallenge && <>

      {/* Email */}
      <label htmlFor="citizen-login-email" style={FIELD_LABEL}>
        Email
      </label>
      <input
        id="citizen-login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
        placeholder="you@example.com"
        disabled={busy}
        style={{ ...FIELD_INPUT, marginBottom: 12 }}
      />

      {/* Password with show/hide */}
      <label htmlFor="citizen-login-password" style={FIELD_LABEL}>
        Password
      </label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input
          id="citizen-login-password"
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

      </>}

      {/* Suspension-appeal flow. Triggered by a 403 from /api/citizen-
          auth/login — meaning credentials matched but the account is
          suspended. We pre-loaded email + password from the form
          above; the user just needs to write a rationale. The
          mailto fallback is offered alongside in case they'd rather
          email the operator directly. */}
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
              href={`mailto:civicview@civicview.app?subject=${encodeURIComponent(`Suspension appeal: ${email.trim()}`)}&body=${encodeURIComponent('I am appealing my suspension for the following reasons:\n\n')}`}
              style={{ color: 'var(--cl-accent)', textDecoration: 'underline' }}
            >
              Email civicview@civicview.app
            </a>{' '}
            instead. (The in-app form above creates the appeal record directly; email goes to an admin&rsquo;s inbox.)
          </div>
        </div>
      )}

      {/* Confirmation state after appeal submit. Stays visible until
          the user dismisses the modal so they can take a screenshot
          if needed. */}
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

      {/* Hide the Sign-in CTA + demo-signup toggle when the appeal
          flow is active so the user isn't presented with competing
          actions ("am I supposed to sign in again or submit the
          appeal?"). The Back button inside the appeal block returns
          to the normal login UI. */}
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

      {/* Forgot password? — only during the email+password phase. Opens
          /password-reset?kind=citizen in a new tab so the user can
          recover without losing the half-typed login form. (Task #87) */}
      {!suspendedMessage && !appealResult && (
        <div style={{
          textAlign: 'center',
          marginTop: 4,
          marginBottom: 4,
          fontSize: 'var(--cl-text-xs)',
        }}>
          <a
            href="/password-reset?kind=citizen"
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

      {/* Self-serve demo signup — replaces the old fixed 60-account
          list. The user picks a display name + state + (optional)
          district + city; the backend mints a fresh CitizenAccount
          (verified=false), returns the synthetic email + password,
          and auto-signs them in. Hidden during the appeal flow for
          the same reason the Sign-in CTA is. */}
      {!suspendedMessage && !appealResult && (
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
          {showDemo ? '▾ Hide demo account form' : '▸ Create a demo account'}
        </button>
        {showDemo && !issuedCreds && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>
              Demo accounts let anyone try CivicView's engagement features.
              Identity is self-attested — every demo carries an
              &ldquo;Unverified&rdquo; label on the engagement surfaces.
            </div>

            <label htmlFor="demo-name" style={FIELD_LABEL}>
              Display name
            </label>
            <input
              id="demo-name"
              type="text"
              value={demoDisplayName}
              onChange={(e) => setDemoDisplayName(e.target.value.slice(0, 80))}
              placeholder="Pat Q. Citizen"
              disabled={demoBusy}
              maxLength={80}
              style={FIELD_INPUT}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="demo-state" style={FIELD_LABEL}>
                  State
                </label>
                <select
                  id="demo-state"
                  value={demoState}
                  onChange={(e) => setDemoState(e.target.value)}
                  disabled={demoBusy}
                  style={{ ...FIELD_INPUT, cursor: 'pointer' }}
                >
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} — {name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="demo-district" style={FIELD_LABEL}>
                  District
                </label>
                <select
                  id="demo-district"
                  value={demoDistrict}
                  onChange={(e) => setDemoDistrict(e.target.value)}
                  disabled={demoBusy || districtOptions.length === 0}
                  style={{ ...FIELD_INPUT, cursor: 'pointer' }}
                >
                  <option value="">— none —</option>
                  {districtOptions.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="demo-city" style={FIELD_LABEL}>
              City <span style={{ color: 'var(--cl-text-light)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="demo-city"
              type="text"
              value={demoCity}
              onChange={(e) => setDemoCity(e.target.value.slice(0, 128))}
              placeholder="Naples"
              disabled={demoBusy}
              maxLength={128}
              style={FIELD_INPUT}
            />

            {demoErr && (
              <div
                role="alert"
                style={{
                  padding: '8px 10px',
                  background: 'var(--cl-danger-soft)',
                  color: 'var(--cl-danger-text)',
                  borderRadius: 'var(--cl-radius-md)',
                  fontSize: 'var(--cl-text-xs)',
                  border: '1px solid var(--cl-danger-border)',
                }}
              >
                {demoErr}
              </div>
            )}

            <Button
              variant="primary"
              size="md"
              onClick={submitDemoSignup}
              loading={demoBusy}
              disabled={!demoDisplayName.trim() || demoBusy}
              style={{ width: '100%' }}
            >
              Create demo account &amp; sign in
            </Button>
          </div>
        )}

        {/* Post-signup credentials display. The user is already signed in
            via the auto-login on the demo-signup response; this screen
            shows them the email + password they can use to sign back in
            from another device or after clearing cookies. */}
        {showDemo && issuedCreds && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--cl-accent-soft)',
                border: '1px solid var(--cl-accent-soft)',
                borderRadius: 'var(--cl-radius-md)',
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text)',
                lineHeight: 1.4,
              }}
            >
              <strong>You&rsquo;re signed in.</strong> Save these credentials
              if you want to sign back in from another device. They&rsquo;re
              also pre-filled in the sign-in fields above.
            </div>
            <div
              style={{
                background: 'var(--cl-bg-soft)',
                borderRadius: 'var(--cl-radius-md)',
                padding: 10,
                fontFamily: 'var(--cl-font-mono)',
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text)',
                lineHeight: 1.6,
              }}
            >
              <div><strong>Email:</strong> {issuedCreds.email}</div>
              <div><strong>Password:</strong> {issuedCreds.password}</div>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={proceedWithIssuedCreds}
              style={{ width: '100%' }}
            >
              Continue
            </Button>
          </div>
        )}
      </div>
      )}
    </ModalShell>
  );
}
