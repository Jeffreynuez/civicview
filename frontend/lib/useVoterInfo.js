'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';
import { fetchVoterInfo } from './api';

/**
 * React hook wrapping Google Civic voterInfoQuery.
 *
 * Usage:
 *   const { data, loading, disabled, error, refresh } =
 *     useVoterInfo(address, { electionId, officialOnly, debounceMs });
 *
 *   - `data` is the normalized voter-info payload from the backend
 *     (election, polling_locations, early_vote_sites, drop_off_locations,
 *     contests) or null while loading / when no address is supplied.
 *   - `disabled=true` means the server has no GOOGLE_CIVIC_API_KEY set;
 *     the UI should offer a "connect Google Civic" affordance rather
 *     than rendering an error.
 *   - `error` is populated only on network/parse failures (not on the
 *     normal "no election matching this address" case, which comes back
 *     as `data` with empty arrays).
 *
 * The hook debounces address changes by default (350ms) so typing into
 * an address bar doesn't fire a request per keystroke. A stale-response
 * guard via a request-id ref ensures late responses for an old address
 * can't overwrite fresh data for a newer one.
 */
export default function useVoterInfo(address, opts = {}) {
  const { electionId = null, officialOnly = false, debounceMs = 350 } = opts;

  const [state, setState] = useState({
    data: null,
    loading: false,
    disabled: false,
    error: null,
  });

  // Request-id guard — each fetch increments this, and responses check
  // that they're still the newest before committing their result.
  const requestIdRef = useRef(0);
  // Manual refresh trigger.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!address || !address.trim()) {
      setState({ data: null, loading: false, disabled: false, error: null });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));
    const myId = ++requestIdRef.current;

    const t = setTimeout(async () => {
      const result = await fetchVoterInfo(address, { electionId, officialOnly });
      if (myId !== requestIdRef.current) return; // stale, ignore
      setState({
        data: result.data,
        loading: false,
        disabled: !!result.disabled,
        error: result.error || null,
      });
    }, debounceMs);

    return () => clearTimeout(t);
  }, [address, electionId, officialOnly, debounceMs, tick]);

  const refresh = () => setTick((t) => t + 1);

  return { ...state, refresh };
}
