'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Force2FAGate — root-level wrapper that mounts the Force2FAOverlay
 * whenever any signed-in identity carries `needs_2fa_enrollment=true`
 * (2FA Phase 4).
 *
 * Wraps {children} in app/layout.js so every route — home, /polls,
 * /admin, etc — gets the same enforcement gate without each page
 * having to mount the overlay separately. The children stay mounted
 * underneath; the overlay just visually + interactively blocks them
 * until enrollment completes.
 *
 * Enforcement priority (only one identity is enforced at a time even
 * when multiple are signed in):
 *   rep > candidate > admin
 *
 * Citizens are deliberately NOT in the enforced set — they remain
 * opt-in indefinitely. The backend's `needs_2fa_enrollment` flag
 * already encodes this priority (citizens always get False); this
 * file just consumes it.
 *
 * The "sign out" escape hatch in the overlay clears the identity
 * being enforced. Other active sessions (e.g. a co-signed-in citizen)
 * are preserved so the user isn't kicked out of unrelated state.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth, logoutRep } from '../lib/auth';
import { useCandidateAuth, logoutCandidate } from '../lib/candidateAuth';
import { useCitizenAuth, logoutCitizen } from '../lib/citizenAuth';
import { adminWhoami } from '../lib/pagesApi';
import Force2FAOverlay from './Force2FAOverlay';

export default function Force2FAGate({ children }) {
  const { me } = useAuth();                       // rep session
  const { candidate } = useCandidateAuth();
  const { citizen } = useCitizenAuth();

  // Admin enrollment status — comes from /api/admin/whoami, which
  // also tells us which kind of account carries the admin powers
  // (could be rep or citizen via ADMIN_EMAILS). We probe whenever
  // any auth state changes; cleared to null when all client-side
  // sessions go away.
  const [adminInfo, setAdminInfo] = useState(null);
  const clientSignedOut = !me && !citizen && !candidate;
  useEffect(() => {
    if (clientSignedOut) {
      setAdminInfo(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { data, status } = await adminWhoami();
      if (cancelled) return;
      if (status === 200 && data) {
        setAdminInfo(data);
      } else {
        setAdminInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [me, citizen, candidate, clientSignedOut]);

  // Priority: rep > candidate > admin. Citizens are never enforced
  // by design (needs_2fa_enrollment is always False on their /me).
  // Only ONE identity drives the overlay at a time even if multiple
  // happen to need enrollment — finishing one drops the flag and the
  // next render-pass picks up the next one.
  let enforcedKind = null;
  let enforcedName = '';
  let onSignOut = null;
  if (me?.needs_2fa_enrollment) {
    enforcedKind = 'rep';
    enforcedName = me.display_name;
    onSignOut = logoutRep;
  } else if (candidate?.needs_2fa_enrollment) {
    enforcedKind = 'candidate';
    enforcedName = candidate.display_name;
    onSignOut = logoutCandidate;
  } else if (adminInfo?.needs_2fa_enrollment) {
    enforcedKind = 'admin';
    enforcedName = adminInfo.email || 'Admin';
    // Admin status is granted to either a rep or citizen account via
    // ADMIN_EMAILS — sign out the underlying account that carries it.
    onSignOut = adminInfo.kind === 'rep' ? logoutRep : logoutCitizen;
  }

  // After enrollment completes, the TwoFactorSection inside the
  // overlay calls onClose. We use that as a signal to refetch /me +
  // /whoami so the needs_2fa_enrollment flag flips false on the
  // next render and the overlay drops.
  const handleComplete = useCallback(async () => {
    // Lazy imports — refresh* bypasses the `loaded` short-circuit in
    // the underlying hydrate cache so /me actually re-hits the
    // backend. Without the cache bust, hydrateAuth would return the
    // stale needs_2fa_enrollment=true value and the overlay would
    // never drop.
    const { refreshAuth } = await import('../lib/auth');
    const { refreshCandidateAuth } = await import('../lib/candidateAuth');
    await Promise.all([
      refreshAuth().catch(() => {}),
      refreshCandidateAuth().catch(() => {}),
    ]);
    // Re-probe admin whoami so the admin overlay closes too.
    try {
      const { data, status } = await adminWhoami();
      setAdminInfo(status === 200 ? data : null);
    } catch { /* swallow */ }
  }, []);

  return (
    <>
      {children}
      {enforcedKind && (
        <Force2FAOverlay
          identityKind={enforcedKind}
          identityName={enforcedName}
          onComplete={handleComplete}
          onSignOut={onSignOut}
        />
      )}
    </>
  );
}
