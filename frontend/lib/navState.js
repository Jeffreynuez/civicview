// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * navState.js — persists the page-level "where am I?" state to
 * localStorage so a browser reload returns the user to the same view
 * they had before, instead of always landing on the home (NOP)
 * surface.
 *
 * Shape (all keys optional):
 *   {
 *     selectedState:           string | null   // e.g. "FL"
 *     stateName:               string | null   // e.g. "Florida"
 *     sidePanelTab:            string          // 'congress' | 'state' | …
 *     selectedMember:          object | null   // full member object so
 *                                              //   restoration is sync
 *     selectedCandidate:       object | null
 *     activeDistrict:          object | null   // address-lookup blob
 *     selectedPageOfficialId:  string | null
 *     pageMeta:                object | null
 *     panelWidth:              number          // px, desktop-only
 *     mapHeightPx:             number          // px, mobile-portrait only
 *   }
 *
 * Versioned: bumps to v2 / v3 / … if the schema changes incompatibly,
 * so old stored payloads can be ignored without crashing the page.
 */

const NAV_STATE_KEY = 'civiclens:nav-state:v1';

export function loadNavState() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(NAV_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveNavState(state) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NAV_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or private-mode Safari — ignore.
  }
}

export function clearNavState() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(NAV_STATE_KEY);
  } catch { /* ignore */ }
}
