'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useState } from 'react';
import './FormerAccountPanel.css';
import { formatLongDate } from './LifecycleBanner';
import {
  fetchFormerMe,
  linkCitizenAccount,
  setFormerOptins,
  unlinkCitizenAccount,
} from '@/lib/formerApi';

/**
 * The former official's or candidate's dashboard panel (2026-10-15,
 * Jeffrey's decision 4). Former officials "are considered just citizens
 * if they are not in office": this is where the person links their own
 * citizen account and chooses, one by one, what carries over:
 *   - their name (freed for that citizen account only, once ID.me
 *     verifies a matching legal name);
 *   - a copy of their tracked items, saved posts and notification
 *     settings;
 *   - an optional "Served as" line (former officials only), generated
 *     from our records, plain text, removable any time.
 * Not carried: followers, any title or badge, any shortcut past
 * verification.
 */

const NAME_STATUS = {
  waiting: 'Waiting for your citizen account to be verified through ID.me. Your name moves over when the legal name ID.me verifies matches this page.',
  approved: 'Your citizen account uses your name now.',
  review: 'Waiting for review. The first name ID.me verified differs from this page (a nickname, for example). CivicView decides with a source.',
  refused: 'Not carried. The legal name ID.me verified does not match this page.',
};

export default function FormerAccountPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error: e, status } = await fetchFormerMe();
    if (status === 404) { setData(null); return; }
    setError(e || null);
    setData(d || null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    const { data: d, error: e } = await fn();
    setBusy(false);
    if (e) { setError(e); return; }
    setError(null);
    if (d && d.lifecycle) setData((prev) => ({ ...d, signed_in_citizen: prev?.signed_in_citizen }));
    else load();
  };

  if (!data) return error ? <p className="former-panel__error" role="alert">{error}</p> : null;
  const lc = data.lifecycle || {};
  const link = data.link;
  const citizen = data.signed_in_citizen;
  const official = data.kind === 'rep';

  return (
    <section className="former-panel" aria-labelledby="former-panel-title">
      <h3 id="former-panel-title" className="former-panel__title">
        {official ? 'After office' : 'After the campaign'}
      </h3>
      <dl className="former-panel__dates">
        {lc.title && (<><dt>Your page reads</dt><dd>{lc.title}</dd></>)}
        {lc.farewell_ends_on && (<><dt>Farewell posts until</dt><dd>{formatLongDate(lc.farewell_ends_on)}</dd></>)}
        {lc.archive_on && (<><dt>Archived on</dt><dd>{formatLongDate(lc.archive_on)}</dd></>)}
      </dl>
      <p className="former-panel__text">
        To keep taking part, use a citizen account. Link yours here, then choose what to carry to it.
        Your followers, any title or badge, and verification do not carry over.
      </p>

      {!link && (
        <div className="former-panel__step">
          {citizen ? (
            <button type="button" className="former-panel__btn" disabled={busy}
              onClick={() => run(linkCitizenAccount)}>
              Link my citizen account ({citizen.display_name})
            </button>
          ) : (
            <p className="former-panel__text">
              Sign in to your citizen account in this browser (or create one), then come back here to link it.
              Being signed in to both shows that one person holds both.
            </p>
          )}
        </div>
      )}

      {link && (
        <div className="former-panel__step">
          <p className="former-panel__text">
            Linked to <strong>{link.citizen_name}</strong>.{' '}
            <button type="button" className="former-panel__link" disabled={busy}
              onClick={() => run(unlinkCitizenAccount)}>Unlink</button>
          </p>

          <label className="former-panel__choice">
            <input type="checkbox" checked={!!link.name?.on} disabled={busy}
              onChange={(e) => run(() => setFormerOptins({ name: e.target.checked }))} />
            <span>
              <strong>My name.</strong> Freed for this citizen account only, once ID.me verifies a matching legal name.
              Everyone else still cannot use it.
              {link.name?.on && link.name?.status && (
                <span className="former-panel__status">{NAME_STATUS[link.name.status] || ''}</span>
              )}
            </span>
          </label>

          <div className="former-panel__choice">
            <span>
              <strong>A copy of my tracked items, saved posts and notification settings.</strong>{' '}
              {link.copies?.done
                ? <span className="former-panel__status">Copied on {formatLongDate(link.copies.at)}.</span>
                : (
                  <button type="button" className="former-panel__btn former-panel__btn--small" disabled={busy}
                    onClick={() => run(() => setFormerOptins({ copies: true }))}>Copy now</button>
                )}
            </span>
          </div>

          {official && (
            <label className="former-panel__choice">
              <input type="checkbox" checked={!!link.served_as?.on} disabled={busy}
                onChange={(e) => run(() => setFormerOptins({ served_as: e.target.checked }))} />
              <span>
                <strong>A Served as line on my citizen card.</strong> Plain text from our records, removable any time:
                <span className="former-panel__preview">{data.served_as_preview}</span>
              </span>
            </label>
          )}
        </div>
      )}
      {error && <p className="former-panel__error" role="alert">{error}</p>}
    </section>
  );
}
