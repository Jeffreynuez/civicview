// CivicView — guided-tour state + event bridge.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Storage model
// ─────────────
// localStorage  (durable, per-browser):
//   cv:tutorial:seen     '1' once the user has OPENED the tour at least
//                        once. Drives the "new here" pulse on the menu
//                        button + the Take-the-tour menu row.
//   cv:tutorial:coach    '1' once the one-time coach-mark tooltip has
//                        been dismissed (opening the tour also sets it).
//   cv:tutorial:done:v2  JSON array of finished track ids ('quick-start'
//                        and topic ids): the checkmarks in the topic
//                        list. The 36-step tour's list (cv:tutorial:done)
//                        is not carried over; its sections changed.
// sessionStorage (per-tab, survives full-page route navigations: the
// tour hops between '/', '/polls' and '/bills' via real page loads,
// matching how the navbar itself navigates):
//   cv:tutorial:pos      JSON { v, active, view, trackId, stepIndex,
//                        minimized }. view is 'step', 'end' (the quick
//                        start's end card) or 'topics' (the topic list).
//                        A position without the current TOUR_VERSION is
//                        thrown away, so an old 36-step position never
//                        resurfaces.
//
// Event bridge
// ────────────
// The tour drives surfaces that live behind React state inside
// app/page.js (profiles, pages, the comparison, My Tracked, Feedback,
// Help build, the citizen sign-in). The overlay dispatches a DOM
// CustomEvent and page.js maps it onto its handlers:
//   window event 'cv:tutorial:action'
//     detail: { action, payload, respond(result), claimed }
// emitTutorialAction() returns a promise of the handler's result
// ({ ok, ...facts the step copy needs }). A route with no listener (or
// an unknown action) resolves { ok: false, unhandled: true } at once,
// so a stale config entry can never throw or hang.
//
// page.js announces that it is listening (useTutorialActions sets
// window.__cvTourBridge and fires 'cv:tutorial:bridge'), so a step
// entered right after a page load waits for the listener instead of
// firing into the void. That lost first action is what left the
// profile demo unopened in some runs.
//
// A second event, 'cv:tutorial:changed', fires after every storage
// mutation so hooks (navbar pulse, overlay) re-read synchronously.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { TOUR_VERSION, getTrack, QUICK_START } from './tutorialSegments';

const K_SEEN = 'cv:tutorial:seen';
const K_COACH = 'cv:tutorial:coach';
const K_DONE = 'cv:tutorial:done:v2';
const K_POS = 'cv:tutorial:pos';

export const TUTORIAL_ACTION_EVENT = 'cv:tutorial:action';
export const TUTORIAL_CHANGED_EVENT = 'cv:tutorial:changed';
export const TUTORIAL_BRIDGE_EVENT = 'cv:tutorial:bridge';

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

// ─── finished tracks (checkmarks) ──────────────────────────────────
export function getCompletedSegments() {
  if (!isBrowser()) return [];
  try {
    const raw = lsGet(K_DONE);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function markSegmentCompleted(trackId) {
  if (!isBrowser() || !trackId) return;
  const done = getCompletedSegments();
  if (!done.includes(trackId)) {
    lsSet(K_DONE, JSON.stringify([...done, trackId]));
    emitChanged();
  }
}

// ─── tour position (per-tab; survives route navigation) ────────────
function validPos(pos) {
  if (!pos || typeof pos !== 'object' || pos.v !== TOUR_VERSION) return null;
  if (pos.view === 'topics') return pos;
  const track = getTrack(pos.trackId);
  if (!track) return null;
  if (pos.view === 'end') return pos.trackId === QUICK_START.id ? pos : null;
  if (pos.view !== 'step') return null;
  const i = Number(pos.stepIndex);
  if (!Number.isInteger(i) || i < 0 || i >= track.steps.length) return null;
  return pos;
}

export function getTutorialPos() {
  if (!isBrowser()) return null;
  try {
    const raw = ssGet(K_POS);
    if (!raw) return null;
    const pos = validPos(JSON.parse(raw));
    // An old (36-step) or damaged position is discarded for good.
    if (!pos) ssRemove(K_POS);
    return pos;
  } catch {
    ssRemove(K_POS);
    return null;
  }
}

export function setTutorialPos(pos) {
  if (!isBrowser()) return;
  if (!pos) {
    ssRemove(K_POS);
  } else {
    ssSet(K_POS, JSON.stringify({ ...pos, v: TOUR_VERSION }));
  }
  emitChanged();
}

// ─── open / close ──────────────────────────────────────────────────
function markOpened() {
  lsSet(K_SEEN, '1');
  lsSet(K_COACH, '1');
}

/**
 * Open the tour from the menu.
 *   - Closed partway through a track: resume where it was.
 *   - Finished the quick start (or anything else finished): the topic
 *     list, with the quick start at the top to run again.
 *   - Otherwise: the quick start from step 1.
 */
export function openTutorial() {
  if (!isBrowser()) return;
  markOpened();
  const prev = getTutorialPos();
  const minimized = !!prev?.minimized;
  if (prev && prev.view === 'step') {
    // arrived: false, so the step's own page is opened again even when
    // the visitor has since moved to another route.
    setTutorialPos({ ...prev, active: true, arrived: false });
    return;
  }
  if (getCompletedSegments().includes(QUICK_START.id)) {
    setTutorialPos({ active: true, view: 'topics', minimized });
    return;
  }
  setTutorialPos({ active: true, view: 'step', trackId: QUICK_START.id, stepIndex: 0, minimized });
}

/** Start the quick start from step 1 (the coach mark's button). */
export function startQuickStart() {
  if (!isBrowser()) return;
  markOpened();
  setTutorialPos({ active: true, view: 'step', trackId: QUICK_START.id, stepIndex: 0, minimized: false });
}

export function closeTutorial() {
  if (!isBrowser()) return;
  const prev = getTutorialPos();
  // Keep the position but flip active off: reopening mid-track resumes.
  setTutorialPos(prev ? { ...prev, active: false } : null);
}

// ─── event bridge ──────────────────────────────────────────────────
export function isTutorialBridgeReady() {
  return isBrowser() && (window.__cvTourBridge || 0) > 0;
}

/**
 * Wait until app/page.js is listening, up to `timeoutMs`. Resolves
 * true when it is, false on timeout (the caller then degrades).
 */
export function waitForTutorialBridge(timeoutMs = 4000) {
  if (!isBrowser()) return Promise.resolve(false);
  if (isTutorialBridgeReady()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok) => {
      window.removeEventListener(TUTORIAL_BRIDGE_EVENT, onReady);
      clearTimeout(t);
      resolve(ok);
    };
    const onReady = () => done(true);
    const t = setTimeout(() => done(isTutorialBridgeReady()), timeoutMs);
    window.addEventListener(TUTORIAL_BRIDGE_EVENT, onReady);
  });
}

/**
 * Send a bridge action. Resolves with the handler's result, defaulting
 * to { ok: true }; { ok: false, unhandled: true } when nobody handles
 * it; { ok: false } when the handler throws.
 */
export function emitTutorialAction(action, payload) {
  if (!isBrowser() || !action) return Promise.resolve({ ok: false, unhandled: true });
  return new Promise((resolve) => {
    let settled = false;
    const respond = (result) => {
      if (settled) return;
      settled = true;
      resolve(result && typeof result === 'object' ? result : { ok: true });
    };
    const detail = { action, payload: payload || {}, respond, claimed: false };
    window.dispatchEvent(new CustomEvent(TUTORIAL_ACTION_EVENT, { detail }));
    if (!detail.claimed) respond({ ok: false, unhandled: true });
  });
}

/**
 * Subscribe to tour actions. Used by app/page.js to map bridge
 * actions onto its handlers. A handler may return a value or a
 * promise; it becomes the step's result.
 *
 *   useTutorialActions({ 'open-tracked': () => setTrackedOpen(true), … })
 *
 * The consumer memoizes the map; a change re-binds the listener.
 */
export function useTutorialActions(handlers) {
  useEffect(() => {
    if (!isBrowser() || !handlers) return undefined;
    const onAction = (e) => {
      const detail = e?.detail;
      const fn = handlers[detail?.action];
      if (typeof fn !== 'function') return;
      detail.claimed = true;
      let out;
      try {
        out = fn(detail.payload || {});
      } catch {
        detail.respond?.({ ok: false });
        return;
      }
      Promise.resolve(out).then(
        (r) => detail.respond?.(r && typeof r === 'object' ? r : { ok: true }),
        () => detail.respond?.({ ok: false }),
      );
    };
    window.addEventListener(TUTORIAL_ACTION_EVENT, onAction);
    window.__cvTourBridge = (window.__cvTourBridge || 0) + 1;
    window.dispatchEvent(new CustomEvent(TUTORIAL_BRIDGE_EVENT));
    return () => {
      window.removeEventListener(TUTORIAL_ACTION_EVENT, onAction);
      window.__cvTourBridge = Math.max(0, (window.__cvTourBridge || 1) - 1);
    };
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
 * 'cv:tutorial:changed'. Returns { pos, completed } plus a stable
 * mutator.
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
