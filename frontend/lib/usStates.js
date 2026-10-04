// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// US state/territory abbreviation → full name. Used by the /bills seat
// chart + vote list for state-name sorting and screen-reader labels, and
// by the state and district pickers (sign-up, location prompt, settings).
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

// Every state, then DC and the territories with a House delegate, in
// the order the state pickers list them. Same set the backend accepts
// (backend/app/services/citizen_geo.py).
const STATE_ORDER = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
];
export const US_STATES = STATE_ORDER.map((code) => [code, STATE_NAMES[code]]);

// House seats per state, 119th Congress apportionment. One seat means
// the whole state is one at-large district; DC and the territories each
// elect one delegate the same way. Keep in step with HOUSE_SEATS in
// backend/app/services/citizen_geo.py (change both after the 2030 census).
export const HOUSE_SEATS = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28, GA: 14,
  HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6, ME: 2, MD: 8,
  MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12,
  NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5, OR: 6, PA: 17, RI: 2, SC: 7,
  SD: 1, TN: 9, TX: 38, UT: 4, VT: 1, VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
  DC: 1, AS: 1, GU: 1, MP: 1, PR: 1, VI: 1,
};

/** True when the state's House seat is one at-large district. */
export function isAtLarge(state) {
  return HOUSE_SEATS[String(state || '').toUpperCase()] === 1;
}

/**
 * The district picker's options for a state: [value, label] pairs.
 * Values are what the backend accepts with the state: "17", or "AL" for
 * an at-large seat (stored as "FL-17" / "WY-AL").
 */
export function districtOptions(state) {
  const seats = HOUSE_SEATS[String(state || '').toUpperCase()] || 0;
  if (seats === 1) {
    const st = String(state).toUpperCase();
    const label = st === 'DC' || ['AS', 'GU', 'MP', 'PR', 'VI'].includes(st) ? 'At-large (delegate)' : 'At-large';
    return [['AL', label]];
  }
  return Array.from({ length: seats }, (_, i) => [String(i + 1), `District ${i + 1}`]);
}

/** The picker value for a stored district: "FL-17" -> "17", "WY-AL" -> "AL". */
export function districtPickerValue(state, stored) {
  const st = String(state || '').toUpperCase();
  const d = String(stored || '').toUpperCase();
  if (!st || !d.startsWith(`${st}-`)) return '';
  const rest = d.slice(st.length + 1);
  return districtOptions(st).some(([v]) => v === rest) ? rest : '';
}

/**
 * The picker value for an address-lookup result ({ stateCode, district }
 * where district is "17" or "At-Large"), or ''.
 */
export function districtFromLookup(state, district) {
  const st = String(state || '').toUpperCase();
  const d = String(district || '').trim();
  if (!st || !d) return '';
  if (isAtLarge(st)) return 'AL';
  const n = parseInt(d, 10);
  return Number.isInteger(n) && n >= 1 && n <= (HOUSE_SEATS[st] || 0) ? String(n) : '';
}

/** "FL-17" stays "FL-17"; "WY-AL" reads "WY at-large". */
export function formatDistrict(stored) {
  const d = String(stored || '').toUpperCase();
  return d.endsWith('-AL') ? `${d.slice(0, -3)} at-large` : d;
}

export default STATE_NAMES;
