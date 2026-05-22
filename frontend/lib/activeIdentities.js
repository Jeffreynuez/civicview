'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * useActiveIdentities — returns the list of currently-signed-in
 * identity sessions in a normalized shape for the IdentityPicker /
 * PostingAsPicker UIs.
 *
 * Shape:
 *   [
 *     { kind: 'citizen', label: 'Pat Back', sublabel: 'LA-4' },
 *     { kind: 'rep',     label: 'CivicView Test Rep' },
 *     { kind: 'candidate', label: 'Jane Doe (Candidate)' },
 *   ]
 *
 * Order: citizen → rep → candidate (alphabetical by kind is fine
 * since order is mostly for stable rendering; the picker UI doesn't
 * imply priority).
 *
 * Page-owner constraint: the rep + candidate identity entries are
 * only included when the viewer is on a page they own — i.e. the
 * caller passes `isOwner=true`. On a page the viewer doesn't own,
 * their rep / candidate session is a "spectator" identity and
 * shouldn't be offered as an engagement target (the backend would
 * 401 / 403 anyway since rep + candidate self-engagement is
 * scoped to their own page).
 */
import { useMemo } from 'react';
import { useAuth } from './auth';
import { useCitizenAuth } from './citizenAuth';
import { useCandidateAuth } from './candidateAuth';

export function useActiveIdentities({ isOwner = false } = {}) {
  const { me } = useAuth();
  const { citizen } = useCitizenAuth();
  const { candidate } = useCandidateAuth();

  return useMemo(() => {
    const out = [];
    if (citizen) {
      const district = citizen.congressional_district || citizen.state || '';
      out.push({
        kind: 'citizen',
        label: citizen.display_name,
        sublabel: district,
      });
    }
    if (me && isOwner) {
      out.push({
        kind: 'rep',
        label: me.display_name || 'Page owner',
        sublabel: me.role ? me.role : '',
      });
    }
    if (candidate && isOwner) {
      out.push({
        kind: 'candidate',
        label: candidate.display_name || 'Candidate',
        sublabel: 'Candidate',
      });
    }
    return out;
  }, [me, citizen, candidate, isOwner]);
}

/**
 * Helper — decide whether to show the IdentityPicker.
 *
 * Returns one of:
 *   { single: <kind> }              — only one identity is signed in;
 *                                     no picker needed ever, fire as
 *                                     that one.
 *   { showPicker: [...identities] } — 2+ identities are signed in;
 *                                     ALWAYS pop the picker so the
 *                                     user explicitly picks. Even
 *                                     when an identity has already
 *                                     acted, it stays in the list so
 *                                     the user can click to toggle
 *                                     off — the backend's react
 *                                     endpoint already handles toggle
 *                                     semantics for "second click of
 *                                     the same kind", so the frontend
 *                                     doesn't need a separate mode.
 *   { none: true }                  — no identities signed in.
 *
 * The picker entries the caller renders should additionally carry
 * `currentState` (set by the caller via the alreadyActed map) so
 * the UI can stamp a ✓ on identities that have already acted with
 * this picker's specific kind / option.
 */
export function pickEngagementIdentity({ identities } = {}) {
  if (!identities || identities.length === 0) return { none: true };
  if (identities.length === 1) return { single: identities[0].kind };
  // Multi-identity: always show the picker. Easier to reason about
  // ("if I'm signed in to multiple, I always pick"), and removes
  // the auto-fire-when-only-one-remaining shortcut that was making
  // testing confusing.
  return { showPicker: identities };
}
