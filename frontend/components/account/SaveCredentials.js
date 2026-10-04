'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * SaveCredentials: the generated sign-in email and password of a new
 * demo account, shown once, with ways to keep them (2026-10-03).
 *
 * Jeffrey: "When we create an account can you give another option for
 * people to save their generated email and password. I think we email
 * them that info if they add their email."
 *
 *   Copy        each value, or both at once
 *   Download    a small text file, on a button that says so (the
 *               product rule is that a download never starts by itself)
 *   Save to my password manager
 *               the Credential Management API where the browser has it
 *               (Chrome, Edge); elsewhere a real username/new-password
 *               form is submitted, which Safari and Firefox watch for.
 *               The copy says plainly when nothing may appear.
 *   Email       chosen on the sign-up form; this card reports whether it
 *               went out. The email carries the sign-in email and a
 *               link to choose a new password, never the password.
 *
 * The server keeps only the password's hash, so this screen is the
 * only place the password is ever shown.
 */

import { useRef, useState } from 'react';

import { Button } from '@/components/ui';
import { isNativeApp } from '@/lib/push';

import './SaveCredentials.css';

async function copyText(text, fallbackInput) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the selection copy */ }
  try {
    if (fallbackInput) {
      fallbackInput.focus();
      fallbackInput.select();
      return document.execCommand('copy');
    }
  } catch { /* nothing else to try */ }
  return false;
}

function fileText({ email, password, displayName }) {
  const created = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return [
    'CivicView demo account',
    '',
    displayName ? `Display name:  ${displayName}` : null,
    `Sign-in email: ${email}`,
    `Password:      ${password}`,
    `Created:       ${created}`,
    '',
    'Sign in at https://civicview.app with "Citizen sign in".',
    'Keep this file private: anyone who has it can sign in as you.',
    '',
  ].filter((l) => l !== null).join('\n');
}

export default function SaveCredentials({
  email, password, displayName, emailRequested = false, emailSent = false, contactEmail = '', onContinue,
}) {
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const formRef = useRef(null);
  const [copied, setCopied] = useState(null); // 'email' | 'password' | 'both'
  const [status, setStatus] = useState(null); // { text, warn }
  const native = isNativeApp();

  const copy = async (what) => {
    const text = what === 'email' ? email : what === 'password' ? password : `${email}\n${password}`;
    const input = what === 'password' ? passwordRef.current : emailRef.current;
    const ok = await copyText(text, what === 'both' ? null : input);
    if (ok) {
      setCopied(what);
      setStatus(null);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } else {
      setStatus({ text: 'Copying is blocked here. Select the text and copy it yourself.', warn: true });
    }
  };

  const download = () => {
    try {
      const blob = new Blob([fileText({ email, password, displayName })], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'civicview-sign-in.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus({ text: 'Saved as civicview-sign-in.txt in your downloads. Keep it somewhere private.' });
    } catch {
      setStatus({ text: 'The download did not start. Copy your details instead.', warn: true });
    }
  };

  const saveToManager = async () => {
    try {
      if (typeof window !== 'undefined' && window.PasswordCredential && navigator?.credentials?.store) {
        const cred = new window.PasswordCredential({ id: email, password, name: displayName || email });
        await navigator.credentials.store(cred);
        setStatus({ text: 'Your browser should offer to save it. If nothing appeared, use Copy or Download.' });
        return;
      }
    } catch { /* fall back to the form below */ }
    try {
      if (formRef.current?.requestSubmit) formRef.current.requestSubmit();
      else formRef.current?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    } catch { /* nothing else to try */ }
    setStatus({
      text: 'If your browser offers to save the password, accept it. Some browsers only offer when you sign in, so also use Copy or Download.',
    });
  };

  return (
    <div className="save-creds">
      <div className="save-creds__notice">
        <strong>You&rsquo;re signed in.</strong> This is the only time we can show
        your password, so keep these somewhere safe. You&rsquo;ll need them to
        sign in on another device or after signing out.
      </div>

      {/* A real form with username / new-password fields, so a browser
          password manager recognizes what it's looking at. Submitting it
          does nothing else. */}
      <form
        ref={formRef}
        className="save-creds__box"
        onSubmit={(e) => e.preventDefault()}
        autoComplete="on"
      >
        <div className="save-creds__row">
          <label htmlFor="save-creds-email" className="save-creds__label">Email</label>
          <input
            ref={emailRef}
            id="save-creds-email"
            name="username"
            type="email"
            autoComplete="username"
            className="save-creds__value"
            value={email}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className={`save-creds__copy${copied === 'email' ? ' is-done' : ''}`} onClick={() => copy('email')}>
            {copied === 'email' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="save-creds__row">
          <label htmlFor="save-creds-password" className="save-creds__label">Password</label>
          <input
            ref={passwordRef}
            id="save-creds-password"
            name="password"
            type="text"
            autoComplete="new-password"
            className="save-creds__value"
            value={password}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className={`save-creds__copy${copied === 'password' ? ' is-done' : ''}`} onClick={() => copy('password')}>
            {copied === 'password' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </form>

      <div className="save-creds__actions">
        <button type="button" className="save-creds__action" onClick={() => copy('both')}>
          {copied === 'both' ? 'Copied both' : 'Copy both'}
        </button>
        <button type="button" className="save-creds__action" onClick={saveToManager}>
          Save to my password manager
        </button>
        {!native && (
          <button type="button" className="save-creds__action" onClick={download}>
            Download as a text file
          </button>
        )}
      </div>

      {emailRequested && emailSent && (
        <p className="save-creds__status" role="status">
          We emailed your sign-in email and a link to choose a new password
          to {contactEmail}. The email doesn&rsquo;t include your password.
        </p>
      )}
      {emailRequested && !emailSent && (
        <p className="save-creds__status is-warn" role="status">
          We couldn&rsquo;t send the email just now. Save your details with
          one of the options above. Forgot password will still work with
          your email address later.
        </p>
      )}
      {status && (
        <p className={`save-creds__status${status.warn ? ' is-warn' : ''}`} role="status">{status.text}</p>
      )}

      <Button variant="primary" size="md" onClick={onContinue} style={{ width: '100%' }}>
        Continue
      </Button>
    </div>
  );
}
