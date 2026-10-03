'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * "Please open the citizen sign-in" from anywhere on a page.
 *
 * Deep components (a bill's like button inside a tracked-bills modal,
 * say) need the sign-in window when a signed-out visitor clicks, but
 * the modal is owned by whichever page is showing: the home page,
 * /polls, or PageChrome on /bills, /stats and the 404. Instead of
 * threading a callback through every layer, the component calls
 * requestCitizenLogin() and the page that owns the modal listens with
 * useCitizenLoginRequest(open).
 *
 * Deliberately separate from the guided tour's 'open-citizen-login'
 * action (lib/tutorial.js), so a page can answer one without the
 * other.
 */

import { useEffect, useRef } from 'react';

export const CITIZEN_LOGIN_REQUEST_EVENT = 'cv:citizen-login-request';

export function requestCitizenLogin() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CITIZEN_LOGIN_REQUEST_EVENT));
}

export function useCitizenLoginRequest(open) {
  const ref = useRef(open);
  useEffect(() => { ref.current = open; }, [open]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => { if (ref.current) ref.current(); };
    window.addEventListener(CITIZEN_LOGIN_REQUEST_EVENT, handler);
    return () => window.removeEventListener(CITIZEN_LOGIN_REQUEST_EVENT, handler);
  }, []);
}
