'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * BillReactions: like / dislike pills for one bill, used on every
 * surface that shows a bill (the /bills vote card, the Bills tab on
 * federal and state profiles, tracked bills and the dashboard's
 * followed-bill spotlight). Jeffrey, 2026-10-03: "Likes and dislikes
 * should be added to all bills. Even on the reps profile sections."
 *
 * Engagement follows the app's "Act as" pattern (CLAUDE.md):
 *   - nobody signed in: onLoginRequired, or requestCitizenLogin(), which
 *     the page that owns the sign-in window answers (home, /polls, and
 *     PageChrome on /bills and /stats);
 *   - one identity: the click fires as that identity;
 *   - two or more: the IdentityPicker asks which one, with a check on
 *     the identities that already reacted this way.
 * A bill has no page owner, so reps and candidates react as themselves
 * everywhere (useActiveIdentities with isOwner: true).
 *
 * Whether a click adds or undoes a reaction is decided from THAT
 * identity's slot in my_reactions, never from the row-level
 * my_reaction (the bug fixed in CommentsThread the same day).
 *
 * Props:
 *   billKey          canonical key (lib/billReactions normalizeBillKey);
 *                    renders nothing when it is not a bill
 *   onLoginRequired  optional; defaults to opening the citizen sign-in
 *   size             'sm' (lists) or 'md' (the /bills vote card)
 */

import { useMemo, useState } from 'react';

import IdentityPicker from '@/components/IdentityPicker';
import { ThumbsDown, ThumbsUp } from '@/components/ui';
import { useActiveIdentities, pickEngagementIdentity } from '@/lib/activeIdentities';
import {
  clearBillReaction, normalizeBillKey, reactToBill, useBillReaction,
} from '@/lib/billReactions';
import { requestCitizenLogin } from '@/lib/loginRequest';

import './BillReactions.css';

function alreadyReacted(summary, asIdentity, kind) {
  const map = summary?.my_reactions;
  if (map && typeof map === 'object' && Object.keys(map).length > 0) {
    return map[asIdentity] === kind;
  }
  return summary?.my_reaction === kind;
}

export default function BillReactions({ billKey, onLoginRequired, size = 'sm' }) {
  const key = normalizeBillKey(billKey);
  const identities = useActiveIdentities({ isOwner: true });
  const sig = useMemo(
    () => identities.map((i) => `${i.kind}:${i.label}`).join('|'),
    [identities],
  );
  const summary = useBillReaction(key, sig);
  const [picker, setPicker] = useState(null); // { kind, identities }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!key) return null;

  const mine = Object.values(summary?.my_reactions || {});
  const upActive = mine.includes('up') || summary?.my_reaction === 'up';
  const downActive = mine.includes('down') || summary?.my_reaction === 'down';

  const fire = async (kind, asIdentity) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const undo = alreadyReacted(summary, asIdentity, kind);
    const res = undo
      ? await clearBillReaction(key, asIdentity)
      : await reactToBill(key, kind, asIdentity);
    setBusy(false);
    if (res.error) setError(typeof res.error === 'string' ? res.error : 'Could not save that.');
  };

  const handle = (kind) => {
    const decision = pickEngagementIdentity({ identities });
    if (decision.none) {
      if (onLoginRequired) onLoginRequired();
      else requestCitizenLogin();
      return;
    }
    if (decision.single) {
      fire(kind, decision.single);
      return;
    }
    setPicker({
      kind,
      identities: decision.showPicker.map((id) => ({
        ...id,
        currentState: summary?.my_reactions?.[id.kind] === kind ? kind : null,
      })),
    });
  };

  const onPick = (asIdentity) => {
    const pending = picker;
    setPicker(null);
    if (pending) fire(pending.kind, asIdentity);
  };

  const up = summary ? summary.up_count : null;
  const down = summary ? summary.down_count : null;

  return (
    <div className={`bill-rx bill-rx--${size}`} role="group" aria-label="Like or dislike this bill">
      <span className="bill-rx__slot">
        <button
          type="button"
          className={`bill-rx__btn${upActive ? ' is-up' : ''}`}
          onClick={(e) => { e.stopPropagation(); handle('up'); }}
          aria-pressed={upActive}
          aria-label={`Like${up != null ? ` (${up})` : ''}`}
          title="Like this bill"
          disabled={busy}
        >
          <ThumbsUp size={size === 'md' ? 15 : 13} active={upActive} color="up" />
          {up != null && <span className="bill-rx__n">{up}</span>}
        </button>
        <IdentityPicker
          open={picker?.kind === 'up'}
          identities={picker?.kind === 'up' ? picker.identities : []}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      </span>
      <span className="bill-rx__slot">
        <button
          type="button"
          className={`bill-rx__btn${downActive ? ' is-down' : ''}`}
          onClick={(e) => { e.stopPropagation(); handle('down'); }}
          aria-pressed={downActive}
          aria-label={`Dislike${down != null ? ` (${down})` : ''}`}
          title="Dislike this bill"
          disabled={busy}
        >
          <ThumbsDown size={size === 'md' ? 15 : 13} active={downActive} color="down" />
          {down != null && <span className="bill-rx__n">{down}</span>}
        </button>
        <IdentityPicker
          open={picker?.kind === 'down'}
          identities={picker?.kind === 'down' ? picker.identities : []}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      </span>
      {error && <span className="bill-rx__err" role="status">{error}</span>}
    </div>
  );
}
