// CivicView — guided-tour state + event bridge.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Storage model
// ─────────────
// localStorage  (durable, per-browser):
//   cv:tutorial:seen   '1' once the user has OPENED the tour at least
//                      once. Drives the "new here" pulse on the ☰
//                      hamburger + the Take-the-tour menu row.
//   cv:tutorial:coach  '1' once the one-time coach-mark tooltip has
//                      been dismissed (opening the tour also sets it).
//   cv:tutorial:done   JSON array of segment ids the user has finished
//                      — renders the ✓ in the segment list.
// sessionStorage (per-tab, survives full-page route navigations —
// the tour hops between '/', '/polls' and '/bills' via real page
// loads, matching how the navbar itself navigates):
//   cv:tutorial:pos    JSON { active: bool, segmentId, stepIndex }
//
// Event bridge
// ────────────
// The tour must open surfaces that live behind React state inside
// app/page.js (My Tracked window, Feedback, Help Build, the citizen
// login modal). Rather than threading handlers through the root
// layout, the overlay dispatches a DOM CustomEvent and page.js maps
// it onto its existing open/close handlers:
//   window event 'cv:tutorial:action'  detail: { action: string }
// Known actions (see TUTORIAL_SEGMENTS steps + the page.js listener):
//   open-citizen-login · close-citizen-login · open-tracked ·
//   close-tracked · open-feedback · close-feedback · open-help-build ·
//   close-help-build · close-overlays
// Unknown actions are ignored — a stale config entry can never throw.
//
// A second event, 'cv:tutorial:changed', fires after every storage
// mutation so hooks (navbar pulse, overlay) re-read synchronously.

'use client';

import { useEffect, useState, useCallback } from 'react';

const K_SEEN = 'cv:tutorial:seen';
const K_COACH = 'cv:tutorial:coach';
const K_DONE = 'cv:tutorial:done';
const K_POS = 'cv:tutorial:pos';

export const TUTORIAL_ACTION_EVENT = 'cv:tutorial:action';
export const TUTORIAL_CHANGED_EVENT = 'cv:tutorial:changed';

const isBrowser = () => typeof window !== 'undefined';

// ─── raw storage helpers (private-mode safe: every access is
//     try/caught; failures degrade to "tutorial acts unseen") ───────
function lsGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
}
function ssGet(key) {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function ssSet(key, value) {
  try { window.sessionStorage.setItem(key, value); } catch { /* private mode */ }
}
function ssRemove(key) {
  try { window.sessionStorage.removeItem(key); } catch { /* private mode */ }
}

function emitChanged() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(TUTORIAL_CHANGED_EVENT));
}

// ─── seen / coach-mark flags ───────────────────────────────────────
export function isTutorialSeen() {
  if (!isBrowser()) return true; // SSR: render without the pulse; client corrects post-mount
  return lsGet(K_SEEN) === '1';
}

export function isCoachDismissed() {
  if (!isBrowser()) return true;
  return lsGet(K_COACH) === '1';
}

export function dismissCoachMark() {
  lsSet(K_COACH, '1');
  emitChanged();
}

// ─── completed segments ────────────────────────────────────────────
export function getCompletedSegments() {
  if (!isBrowser()) return [];
  try {
    const raw = lsGet(K_DONE);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function markSegmentCompleted(segmentId) {
  if (!isBrowser() || !segmentId) return;
  const done = getCompletedSegments();
  if (!done.includes(segmentId)) {
    lsSet(K_DONE, JSON.stringify([...done, segmentId]));
    emitChanged();
  }
}

// ─── tour position (per-tab; survives route navigation) ────────────
export function getTutorialPos() {
  if (!isBrowser()) return null;
  try {
    const raw = ssGet(K_POS);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    return pos && typeof pos === 'object' ? pos : null;
  } catch { return null; }
}

export function setTutorialPos(pos) {
  if (!isBrowser()) return;
  if (!pos) {
    ssRemove(K_POS);
  } else {
    ssSet(K_POS, JSON.stringify(pos));
  }
  emitChanged();
}

// ─── open / close ──────────────────────────────────────────────────
// Opening marks seen + kills the coach mark (the pulse's job is done)
// and records an active position. `segmentId` optionally jumps
// straight to a segment (used by "resume where you left off").
export function openTutorial(segmentId, stepIndex) {
  if (!isBrowser()) return;
  lsSet(K_SEEN, '1');
  lsSet(K_COACH, '1');
  const prev = getTutorialPos();
  setTutorialPos({
    active: true,
    segmentId: segmentId || prev?.segmentId || null, // null → overlay starts at segment 0
    stepIndex: typeof stepIndex === 'number' ? stepIndex : (segmentId ? 0 : prev?.stepIndex || 0),
  });
}

export function closeTutorial() {
  if (!isBrowser()) return;
  const prev = getTutorialPos();
  // Keep the position but flip active off — reopening resumes in place.
  setTutorialPos(prev ? { ...prev, active: false } : null);
}

// ─── event bridge ──────────────────────────────────────────────────
export function emitTutorialAction(action) {
  if (!isBrowser() || !action) return;
  window.dispatchEvent(new CustomEvent(TUTORIAL_ACTION_EVENT, { detail: { action } }));
}

/**
 * Subscribe to tour actions. Used by app/page.js to map bridge
 * actions onto its overlay open/close handlers. Returns nothing;
 * cleans up on unmount.
 *
 *   useTutorialActions({ 'open-tracked': () => setTrackedOpen(true), … })
 *
 * The handler map can change between renders — the listener always
 * reads the latest via a ref-free closure re-bind (cheap: one
 * add/removeEventListener pair per render of the consumer, and the
 * consumer (page.js) memoizes the map).
 */
export function useTutorialActions(handlers) {
  useEffect(() => {
    if (!isBrowser() || !handlers) return undefined;
    const onAction = (e) => {
      const fn = handlers[e?.detail?.action];
      if (typeof fn === 'function') fn();
    };
    window.addEventListener(TUTORIAL_ACTION_EVENT, onAction);
    return () => window.removeEventListener(TUTORIAL_ACTION_EVENT, onAction);
  }, [handlers]);
}

/**
 * Reactive "has the user ever opened the tour" — drives the navbar
 * pulse + coach mark. SSR-safe: first render says seen (no pulse in
 * server HTML → no hydration mismatch), the mount effect corrects.
 */
export function useTutorialSeen() {
  const [seen, setSeen] = useState(true);
  const [coachDismissed, setCoachDismissed] = useState(true);
  useEffect(() => {
    const read = () => {
      setSeen(isTutorialSeen());
      setCoachDismissed(isCoachDismissed());
    };
    read();
    window.addEventListener(TUTORIAL_CHANGED_EVENT, read);
    return () => window.removeEventListener(TUTORIAL_CHANGED_EVENT, read);
  }, []);
  return { seen, coachDismissed };
}

/**
 * Reactive tour position — the overlay's backbone. Re-reads on every
 * 'cv:tutorial:changed'. Returns { pos, completed } plus stable
 * mutators.
 */
export function useTutorialState() {
  const [pos, setPos] = useState(null);
  const [completed, setCompleted] = useState([]);
  useEffect(() => {
    const read = () => {
      setPos(getTutorialPos());
      setCompleted(getCompletedSegments());
    };
    read();
    window.addEventListener(TUTORIAL_CHANGED_EVENT, read);
    return () => window.removeEventListener(TUTORIAL_CHANGED_EVENT, read);
  }, []);
  const update = useCallback((next) => setTutorialPos(next), []);
  return { pos, completed, update };
}
