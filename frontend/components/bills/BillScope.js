'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * State and district counts for bill likes (2026-10-03).
 *
 * Whose geography (Jeffrey's call): on a rep's profile, the rep's state
 * and district, so the counts show what that rep's constituents think
 * of the rep's bills (the same rule polls on a rep's page follow).
 * Everywhere else (Bills & Votes, tracked bills, the dashboard), the
 * viewer's own state and congressional district.
 *
 *   BillScopeProvider  wraps a list of bills: one "Likes from" switch
 *                      above it, and every BillReactions inside shows
 *                      the chosen counts.
 *   BillScopeSwitch    the chip row itself: Everyone · FL · FL-17.
 *   useViewerGeo       the signed-in citizen's state and district (a
 *                      candidate's page geography when no citizen is
 *                      signed in), or null.
 *
 * Counts by state and district come only from citizens: reps' and
 * candidates' likes have no geography and count under Everyone.
 */

import { createContext, useContext, useMemo, useState } from 'react';

import { normalizeGeo } from '@/lib/billReactions';
import { useCandidateAuth } from '@/lib/candidateAuth';
import { useCitizenAuth } from '@/lib/citizenAuth';
import { STATE_NAMES } from '@/lib/usStates';

import './BillReactions.css';

export const BillScopeContext = createContext(null);

export function useBillScope() {
  return useContext(BillScopeContext);
}

export function useViewerGeo() {
  const { citizen } = useCitizenAuth();
  const { candidate } = useCandidateAuth();
  return useMemo(() => {
    if (citizen) return normalizeGeo({ state: citizen.state, district: citizen.congressional_district });
    if (candidate) return normalizeGeo({ state: candidate.owner_state, district: candidate.owner_district });
    return null;
  }, [citizen, candidate]);
}

export function BillScopeSwitch({ geo, value, onChange, label = 'Likes from', compact = false }) {
  if (!geo) return null;
  const options = [
    { id: 'all', text: 'Everyone', title: 'Likes and dislikes from everyone on CivicView' },
    { id: 'state', text: geo.state, title: `From citizens in ${STATE_NAMES[geo.state] || geo.state}` },
  ];
  if (geo.district) {
    options.push({ id: 'district', text: geo.district, title: `From citizens in ${geo.district}` });
  }
  return (
    <div className={`bill-scope${compact ? ' bill-scope--compact' : ''}`} role="group" aria-label={label}>
      {label && <span className="bill-scope__label">{label}</span>}
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`bill-scope__chip${value === o.id ? ' is-on' : ''}`}
          aria-pressed={value === o.id}
          title={o.title}
          onClick={(e) => { e.stopPropagation(); onChange(o.id); }}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/**
 * One switch for a list of bills. Renders nothing extra when there is
 * no geography (a signed-out viewer, a profile with no state).
 */
export function BillScopeProvider({ geo, label = 'Likes from', children }) {
  const g = normalizeGeo(geo);
  const [scope, setScope] = useState('all');
  const effective = g ? (scope === 'district' && !g.district ? 'all' : scope) : 'all';
  const value = useMemo(() => ({ geo: g, scope: effective }), [g?.state, g?.district, effective]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <BillScopeContext.Provider value={value}>
      {g && (
        <div className="bill-scope-bar">
          <BillScopeSwitch geo={g} value={effective} onChange={setScope} label={label} />
        </div>
      )}
      {children}
    </BillScopeContext.Provider>
  );
}
