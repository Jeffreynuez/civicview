'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * LocationFields: state, congressional district and optional city for a
 * citizen account, with a "find my district from an address" helper
 * (2026-10-03).
 *
 * Jeffrey: "no one that creates a demo account should not have a state
 * and district. The only thing they can forgo is not having their city
 * or county." So the state has no default (the old form quietly picked
 * Florida), the district has no "none" option, and an at-large state
 * fills its one district by itself.
 *
 * Used by the demo sign-up form (CitizenLoginModal), the LocationPrompt
 * and the Location card in Account & settings.
 *
 * Props:
 *   value        { state, district, city }; district is the picker value
 *                ("17", or "AL" for at-large), as the backend accepts it
 *   onChange     (next) => void, called with the whole value
 *   lockedState  a verified account's state: shown, not editable
 *   disabled
 *   idPrefix     keeps label ids unique when two forms are on screen
 *   showCity     render the optional city field (default true)
 */

import { useState } from 'react';

import { lookupAddress } from '@/lib/api';
import {
  STATE_NAMES, US_STATES, districtFromLookup, districtOptions, formatDistrict, isAtLarge,
} from '@/lib/usStates';

import './LocationFields.css';

/** True when value has a state and a district that exists there. */
export function locationComplete(value) {
  const st = String(value?.state || '').toUpperCase();
  const d = String(value?.district || '');
  return !!st && districtOptions(st).some(([v]) => v === d);
}

export default function LocationFields({
  value, onChange, lockedState = null, disabled = false, idPrefix = 'loc', showCity = true,
}) {
  const state = lockedState || value?.state || '';
  const district = value?.district || '';
  const city = value?.city || '';
  const options = districtOptions(state);

  const [finderOpen, setFinderOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState(null);
  const [findErr, setFindErr] = useState(null);

  const set = (patch) => onChange({ state, district, city, ...patch });

  const pickState = (next) => {
    let nextDistrict = district;
    if (isAtLarge(next)) nextDistrict = 'AL';
    else if (!districtOptions(next).some(([v]) => v === district)) nextDistrict = '';
    set({ state: next, district: nextDistrict });
    setFound(null);
  };

  const find = async () => {
    const q = query.trim();
    if (!q || finding) return;
    setFinding(true);
    setFindErr(null);
    setFound(null);
    const res = await lookupAddress(q);
    setFinding(false);
    if (!res?.success) {
      setFindErr(res?.error || 'We could not find that address. Try a full street address.');
      return;
    }
    const st = String(res.stateCode || '').toUpperCase();
    if (!STATE_NAMES[st] || !districtOptions(st).length) {
      setFindErr('That address is not in a U.S. state or territory with a House seat.');
      return;
    }
    if (lockedState && st !== lockedState) {
      setFindErr(`That address is in ${STATE_NAMES[st]}. Your verified state is ${STATE_NAMES[lockedState] || lockedState}.`);
      return;
    }
    const d = districtFromLookup(st, res.district);
    const place = res.city || res.countyName || '';
    if (!d) {
      set({ state: st, district: isAtLarge(st) ? 'AL' : '', city: city || place });
      setFindErr(`That's in ${STATE_NAMES[st]}, but we couldn't tell the district. Try a full street address, or choose it below.`);
      return;
    }
    set({ state: st, district: d, city: city || place });
    setFound(`${formatDistrict(`${st}-${d}`)}${place ? ` (${place})` : ''}`);
  };

  return (
    <div className="loc-fields">
      <div className="loc-fields__row">
        <div className="loc-fields__col">
          <label htmlFor={`${idPrefix}-state`} className="loc-fields__label">State</label>
          <select
            id={`${idPrefix}-state`}
            className="loc-fields__input"
            value={state}
            onChange={(e) => pickState(e.target.value)}
            disabled={disabled || !!lockedState}
            required
          >
            <option value="" disabled>Choose your state</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>{code}: {name}</option>
            ))}
          </select>
        </div>
        <div className="loc-fields__col">
          <label htmlFor={`${idPrefix}-district`} className="loc-fields__label">Congressional district</label>
          <select
            id={`${idPrefix}-district`}
            className="loc-fields__input"
            value={district}
            onChange={(e) => { set({ district: e.target.value }); setFound(null); }}
            disabled={disabled || !state}
            required
          >
            <option value="" disabled>{state ? 'Choose your district' : 'Choose a state first'}</option>
            {options.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {lockedState && (
        <p className="loc-fields__hint">
          Your state comes from your identity verification.
        </p>
      )}

      {!finderOpen ? (
        <button
          type="button"
          className="loc-fields__link"
          onClick={() => setFinderOpen(true)}
          disabled={disabled}
        >
          Not sure of your district? Find it from your address
        </button>
      ) : (
        <div className="loc-fields__finder">
          <label htmlFor={`${idPrefix}-find`} className="loc-fields__label">Your address</label>
          <div className="loc-fields__find-row">
            <input
              id={`${idPrefix}-find`}
              type="text"
              className="loc-fields__input"
              value={query}
              onChange={(e) => setQuery(e.target.value.slice(0, 200))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } }}
              placeholder="123 Main St, Springfield, IL"
              autoComplete="street-address"
              disabled={disabled || finding}
            />
            <button
              type="button"
              className="loc-fields__find-btn"
              onClick={find}
              disabled={disabled || finding || !query.trim()}
            >
              {finding ? 'Finding...' : 'Find'}
            </button>
          </div>
          <p className="loc-fields__hint">
            A full street address is the most accurate; a ZIP code can cross
            district lines. The address is only used to look up your district
            and isn&rsquo;t saved.
          </p>
          {found && <p className="loc-fields__found" role="status">Found {found}. Check it above.</p>}
          {findErr && <p className="loc-fields__error" role="alert">{findErr}</p>}
        </div>
      )}

      {showCity && (
        <div>
          <label htmlFor={`${idPrefix}-city`} className="loc-fields__label">
            City <span className="loc-fields__optional">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-city`}
            type="text"
            className="loc-fields__input"
            value={city}
            onChange={(e) => set({ city: e.target.value.slice(0, 128) })}
            placeholder="Naples"
            autoComplete="address-level2"
            disabled={disabled}
            maxLength={128}
          />
        </div>
      )}
    </div>
  );
}
