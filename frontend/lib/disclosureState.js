// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useState } from 'react';

/**
 * disclosureState.js — remembers which dropdowns, sections and cards the
 * user has opened or closed, so returning to a surface restores the
 * shape they left it in.
 *
 * WHY THIS EXISTS
 * navState.js already persists page-level "where am I" (selected state,
 * tab, member). It does NOT cover disclosure state, so every collapsible
 * in the app initialized with `useState(defaultOpen)` — which re-runs on
 * every remount. Close the primary-election dropdown, navigate away,
 * come back, and it is open again. The app was overriding a choice the
 * user had explicitly made, every single time.
 *
 * WE STORE CHOICES, NOT STATES — THE IMPORTANT DECISION
 * Only keys the user has actually toggled are written. A section they
 * have never touched stores nothing and follows whatever default the
 * code specifies.
 *
 * The alternative — snapshotting every section's open/closed value —
 * looks equivalent and is not. It freezes today's defaults into every
 * user's browser permanently: change `defaultOpen` next year and nobody
 * who ever visited sees the change, because their storage says
 * otherwise. Storing only deviations means a default stays a default,
 * a choice stays a choice, and the two never get confused.
 *
 * KEYS
 * Callers pass a stable key describing the thing, not its position:
 * `election:fl-2026-primary`, `race:fl-2026-gov`, `results:fl-2026-gov`.
 * Never an array index — inserting a race above would silently transfer
 * one section's remembered state to a different section.
 */

const KEY = 'civicview:disclosure:v1';

// Hard cap so a user who browses all 50 states for years cannot grow
// this without bound. Evicts oldest-written first; the cost of eviction
// is one section reverting to its default, which is invisible.
const MAX_ENTRIES = 400;

function read() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Private-mode Safari, disabled storage, corrupt JSON — every one of
    // these means "no remembered choices", which is a perfectly good
    // state. Never let it break a render.
    return {};
  }
}

function write(map) {
  if (typeof window === 'undefined') return;
  try {
    let next = map;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      // Entries carry a write counter; drop the oldest.
      const sorted = keys
        .map((k) => [k, map[k]])
        .sort((a, b) => (a[1]?.t || 0) - (b[1]?.t || 0))
        .slice(keys.length - MAX_ENTRIES);
      next = Object.fromEntries(sorted);
    }
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable — the UI still works, it just forgets.
  }
}

let seq = 0;

/**
 * The user's explicit choice for `key`, or undefined if they have never
 * toggled it. Undefined is meaningfully different from false.
 */
export function getDisclosure(key) {
  if (!key) return undefined;
  const entry = read()[key];
  return entry && typeof entry.open === 'boolean' ? entry.open : undefined;
}

/** Record an explicit open/close. */
export function setDisclosure(key, open) {
  if (!key) return;
  const map = read();
  seq += 1;
  map[key] = { open: Boolean(open), t: Date.now() + seq };
  write(map);
}

/** Forget one choice, so the section returns to following its default. */
export function clearDisclosure(key) {
  if (!key) return;
  const map = read();
  if (key in map) {
    delete map[key];
    write(map);
  }
}

/** Forget everything. Exposed for a future "reset layout" affordance. */
export function clearAllDisclosures() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

/**
 * Resolve the open state for a section: the user's choice if they made
 * one, otherwise the supplied default.
 *
 * Pure and synchronous so it can seed useState directly. Note the
 * caller must guard against SSR/hydration mismatch — see useDisclosure.
 */
export function resolveDisclosure(key, defaultOpen) {
  const choice = getDisclosure(key);
  return choice === undefined ? Boolean(defaultOpen) : choice;
}

// ─── React binding ────────────────────────────────────────────────────

/**
 * `const [open, setOpen] = useDisclosure(key, defaultOpen)`
 *
 * Drop-in replacement for `useState(defaultOpen)` in a collapsible.
 * Passing a null/undefined key disables persistence, so a component can
 * adopt this without every call site having to invent a key at once.
 *
 * HYDRATION: the first render deliberately uses the DEFAULT, then an
 * effect applies the stored choice. Reading localStorage inside the
 * useState initializer would produce server HTML that disagrees with the
 * client and React would throw a hydration mismatch — these components
 * are 'use client' but Next still prerenders them. The cost is one frame
 * where an explicitly-closed section is briefly open; the alternative is
 * a console full of hydration errors and, in the worst case, React
 * discarding the tree.
 */
export function useDisclosure(key, defaultOpen) {
  const [open, setOpenState] = useState(Boolean(defaultOpen));

  useEffect(() => {
    if (!key) return;
    const choice = getDisclosure(key);
    if (choice !== undefined) setOpenState(choice);
    // Re-running when `key` changes matters: a race card that is reused
    // for a different race (React reconciling by position) must pick up
    // the new key's remembered state rather than keep the old one.
  }, [key]);

  const setOpen = useCallback((next) => {
    setOpenState((prev) => {
      const value = typeof next === 'function' ? next(prev) : Boolean(next);
      // Persist only on an actual user toggle — this setter is never
      // called during restoration, so everything written here is a real
      // choice. That is what keeps defaults changeable later.
      if (key) setDisclosure(key, value);
      return value;
    });
  }, [key]);

  return [open, setOpen];
}
