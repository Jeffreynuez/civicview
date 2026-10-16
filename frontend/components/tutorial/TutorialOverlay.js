'use client';

// CivicView — guided app tour ("Take the tour").
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Mounted once in app/layout.js so it exists on every route. Four
// responsibilities:
//
//   1. COACH MARK: a one-time "New to CivicView?" tooltip under the
//      navbar menu button for visitors who have never opened the tour.
//   2. TOUR CARD: the current step. On desktop a small floating card
//      that sits beside whatever is lit (or in a corner when nothing
//      is), with a Topics button instead of a docked list, so nothing
//      full-screen is ever covered. On phones and tablets (the navbar
//      collapses at 1024px) a short bottom sheet that can be minimized
//      to a slim bar holding the step title and Next.
//   3. SPOTLIGHT: a non-blocking dim layer with a cut-out ring over the
//      step's [data-tutorial] anchor. pointer-events:none throughout, so
//      the live app stays fully usable mid-tour.
//   4. KEYBOARD + SCREEN READERS: Esc closes, Left/Right are Back/Next
//      (never while typing), focus moves to the step title on open and
//      on every step, step changes are announced politely, and focus
//      returns to the menu button on close. No focus trap: the page
//      under the tour stays usable.
//
// Cross-surface plumbing:
//   • A step on another route (/polls, /bills) navigates via a real
//     page load, the same as the navbar's own links; the tour resumes
//     from its sessionStorage position (lib/tutorial.js).
//   • Steps that need a surface owned by app/page.js (a profile, a page,
//     the comparison, My Tracked, Feedback, Help build, the sign-in)
//     send bridge actions and get a result back. Live demos wait until
//     their surface has rendered and fall back to text when it doesn't.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  QUICK_START,
  QUICK_START_END,
  ALL_TRACKS,
  TOUR_VIDEO_URL,
  getTrack,
  resolveField,
} from '@/lib/tutorialSegments';
import {
  useTutorialState,
  useTutorialSeen,
  startQuickStart,
  closeTutorial,
  markSegmentCompleted,
  dismissCoachMark,
  emitTutorialAction,
  waitForTutorialBridge,
  isTutorialBridgeReady,
} from '@/lib/tutorial';
import { useIsCompact } from '@/lib/useViewport';
import { useCitizenAuth } from '@/lib/citizenAuth';
import './TutorialOverlay.css';

const NAVBAR_H = 56;
// Rects closer than this are treated as unchanged, so the measure poll
// does not re-render when nothing moved.
const EPSILON = 1.5;
// How long a live demo may take to render before the step falls back
// to its text version.
const DEMO_TIMEOUT_MS = 12000;

const rectsClose = (a, b) =>
  !!a && !!b &&
  a.fullTop === b.fullTop && a.fullBottom === b.fullBottom &&
  Math.abs(a.top - b.top) < EPSILON &&
  Math.abs(a.left - b.left) < EPSILON &&
  Math.abs(a.width - b.width) < EPSILON &&
  Math.abs(a.height - b.height) < EPSILON;

const toList = (t) => (Array.isArray(t) ? t : t ? [t] : []);
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

// ─── Anchor lookup ──────────────────────────────────────────────────
// Some anchors exist more than once (desktop and phone variants, or the
// home navbar underneath a full-screen page's own navbar). Prefer the
// instance that is actually on top at its visible center; when none is
// on screen yet (it needs scrolling), the last sized one in DOM order,
// which is the one rendered above the others.
function isOnTop(el) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(r.left, 0);
  const right = Math.min(r.right, vw);
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, vh);
  if (right - left < 2 || bottom - top < 2) return false;
  const x = clamp((left + right) / 2, 1, vw - 1);
  const y = clamp(top + Math.min((bottom - top) / 2, 24), 1, vh - 1);
  const hit = document.elementFromPoint(x, y);
  if (!hit) return false;
  // The tour's own card may sit over the anchor; that still counts.
  return el === hit || el.contains(hit) || !!hit.closest('.cvtour-ui');
}

function findAnchor(names, { ready = false } = {}) {
  if (typeof document === 'undefined') return null;
  for (const name of names) {
    const sized = Array.from(document.querySelectorAll(`[data-tutorial="${name}"]`)).filter((el) => {
      if (ready && el.getAttribute('data-tour-busy') === '1') return false;
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    });
    if (!sized.length) continue;
    const onTop = sized.find(isOnTop);
    return onTop || sized[sized.length - 1];
  }
  return null;
}

function waitForAnchor(names, timeoutMs, isCancelled) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isCancelled()) { resolve(null); return; }
      const el = findAnchor(names, { ready: true });
      if (el) { resolve(el); return; }
      if (Date.now() - started > timeoutMs) { resolve(null); return; }
      setTimeout(tick, 150);
    };
    tick();
  });
}

// Scroll the anchor so it sits inside the band the tour leaves free:
// below the navbar (and the top of its own scroll container) and above
// the phone sheet. Walks up the scrollable ancestors; instant, so the
// spotlight's measure loop follows at once. When the anchor is at the
// very end of its scroll area (the sign-in window's "Create a demo
// account"), there is nothing left to scroll: with `room` given, the
// tour adds just enough bottom padding to that area for the anchor to
// clear the sheet, records it in room.current, and the caller takes it
// off again when the step changes.
function bringIntoView(el, bandTop, bandBottom, room) {
  const inBand = () => {
    const r = el.getBoundingClientRect();
    return r.top >= bandTop - 1 && r.bottom <= bandBottom + 1;
  };
  if (inBand()) return;
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const cs = window.getComputedStyle(node);
    const scrollable = /(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (scrollable) {
      const cr = node.getBoundingClientRect();
      const top = Math.max(bandTop, cr.top + 8);
      const bottom = Math.min(bandBottom, cr.bottom - 8);
      const r = el.getBoundingClientRect();
      const room = bottom - top;
      const desired = r.height <= room ? top + (room - r.height) / 2 : top;
      const delta = r.top - desired;
      if (Math.abs(delta) > 2) node.scrollTop += delta;
      if (inBand()) return;
    }
    node = node.parentElement;
  }
  const r = el.getBoundingClientRect();
  if (room && r.bottom > bandBottom && r.height <= bandBottom - bandTop) {
    let area = el.parentElement;
    while (area && area !== document.body) {
      if (/(auto|scroll)/.test(window.getComputedStyle(area).overflowY)) break;
      area = area.parentElement;
    }
    if (area && area !== document.body && !room.current) {
      const extra = Math.ceil(r.bottom - bandBottom) + 16;
      room.current = { el: area, prev: area.style.paddingBottom };
      const base = parseFloat(window.getComputedStyle(area).paddingBottom) || 0;
      area.style.paddingBottom = `${base + extra}px`;
      area.scrollTop += extra;
      if (inBand()) return;
    }
  }
  const r2 = el.getBoundingClientRect();
  if (r2.top < bandTop || r2.bottom > bandBottom) {
    window.scrollBy(0, r2.top - bandTop - 8);
  }
}

function releaseRoom(room) {
  if (room?.current) {
    try { room.current.el.style.paddingBottom = room.current.prev; } catch { /* gone */ }
    room.current = null;
  }
}

function isTypingTarget(t) {
  if (!t || typeof t.closest !== 'function') return false;
  if (t.isContentEditable) return true;
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return true;
  // Widgets that use the arrow keys themselves.
  return !!t.closest('[role="slider"], [role="tablist"], [role="menu"], [role="listbox"], [role="radiogroup"], [role="grid"]');
}

function focusMenuButton() {
  const el = findAnchor(['nav-hamburger']);
  if (el && typeof el.focus === 'function') {
    try { el.focus({ preventScroll: true }); } catch { /* old browser */ }
  }
}

// ─── Component ──────────────────────────────────────────────────────
export default function TutorialOverlay() {
  const { pos, completed, update } = useTutorialState();
  const { seen, coachDismissed } = useTutorialSeen();
  const compact = useIsCompact();
  const { citizen } = useCitizenAuth();
  const signedIn = !!citizen;

  const active = !!pos?.active;
  const view = active ? pos.view : null; // 'step' | 'end' | 'topics'
  const trackId = pos?.trackId || null;
  const track = view === 'step' || view === 'end' ? getTrack(trackId) : null;
  const stepIndex = view === 'step' ? pos.stepIndex : 0;
  const step = view === 'step' && track ? track.steps[stepIndex] : null;
  const minimized = !!pos?.minimized;
  const isLastStep = !!track && stepIndex === track.steps.length - 1;

  // The topic list opened from the Topics button (local; the 'topics'
  // view is the list as its own screen).
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => { setListOpen(false); }, [view, trackId, stepIndex]);

  // ─── Step entry: route, bridge action, demo readiness ───────────
  // run.phase: 'ready' (show the step), 'pending' (a live demo is still
  // opening), 'fallback' (the demo failed: show the text version).
  const [run, setRun] = useState({ key: null, phase: 'ready', result: null });
  const runTokenRef = useRef(0);
  const navigatingRef = useRef(false);
  const stepKey = view === 'step' && step ? `${trackId}:${stepIndex}` : view;

  useEffect(() => {
    if (!active) return undefined;
    if (view === 'end') {
      // Close the sign-in window the last quick-start step opened.
      if (isTutorialBridgeReady()) emitTutorialAction(QUICK_START_END.action);
      return undefined;
    }
    if (view !== 'step' || !step) return undefined;
    if (window.location.pathname !== step.route) {
      if (pos?.arrived) {
        // The visitor navigated away from this step on their own: get
        // out of the way. Reopening the tour resumes here.
        closeTutorial();
        return undefined;
      }
      if (!navigatingRef.current) {
        navigatingRef.current = true;
        window.location.href = step.route;
      }
      return undefined;
    }
    if (!pos?.arrived) update({ ...pos, arrived: true });

    const token = ++runTokenRef.current;
    const key = `${trackId}:${stepIndex}`;
    const cancelled = () => token !== runTokenRef.current;
    const ctx0 = { compact, signedIn };
    const action = resolveField(step.action, ctx0);
    setRun({ key, phase: step.demo ? 'pending' : 'ready', result: null });

    (async () => {
      let result = { ok: true };
      if (action) {
        const ready = await waitForTutorialBridge(4000);
        if (cancelled()) return;
        result = ready ? await emitTutorialAction(action) : { ok: false, unhandled: true };
        if (cancelled()) return;
      }
      if (!step.demo) return;
      if (!result.ok) {
        setRun({ key, phase: 'fallback', result });
        return;
      }
      const waitNames = step.waitFor ? toList(step.waitFor) : toList(resolveField(step.target, ctx0));
      const el = waitNames.length ? await waitForAnchor(waitNames, DEMO_TIMEOUT_MS, cancelled) : true;
      if (cancelled()) return;
      setRun({ key, phase: el ? 'ready' : 'fallback', result });
    })();
    return undefined;
    // Re-run on a new step or when the tour reopens; compact/signedIn
    // changes mid-step only change the copy, not the action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, view, trackId, stepIndex]);

  const phase = view === 'step' && run.key === `${trackId}:${stepIndex}` ? run.phase : (step?.demo ? 'pending' : 'ready');
  const ctx = useMemo(
    () => ({ compact, signedIn, result: run.result || {} }),
    [compact, signedIn, run.result],
  );

  // ─── Phone sheet height (the band the tour leaves free) ─────────
  const sheetRef = useRef(null);
  const [sheetH, setSheetH] = useState(0);
  useEffect(() => {
    const el = sheetRef.current;
    if (!active || !compact || !el || typeof ResizeObserver === 'undefined') {
      setSheetH(0);
      return undefined;
    }
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    setSheetH(el.offsetHeight);
    return () => ro.disconnect();
  }, [active, compact, view, minimized]);

  // ─── Spotlight measurement + scroll into view ──────────────────
  const targetNames = useMemo(
    () => (view === 'step' && step && phase === 'ready' ? toList(resolveField(step.target, ctx)) : []),
    [view, step, phase, ctx],
  );
  const targetKey = targetNames.join('|');
  const [rect, setRect] = useState(null);
  const [avoidRect, setAvoidRect] = useState(null);
  // When the step's target was first found. Scrolling it into view is
  // retried for a short while, because content still loading above it
  // can push it back down; after that the visitor scrolls freely.
  const scrollWindowRef = useRef({ key: null, since: 0 });
  // Bottom padding the tour added to a scroll area (phones), if any.
  const roomRef = useRef(null);
  useEffect(() => {
    if (!active || !targetNames.length) { setRect(null); setAvoidRect(null); return undefined; }
    const avoidNames = toList(step?.avoid);
    const measure = () => {
      const el = findAnchor(targetNames);
      if (!el) { setRect(null); return; }
      const vh = window.innerHeight;
      const sheetTop = compact ? vh - (sheetRef.current?.offsetHeight || sheetH) : vh;
      const scrollKey = `${stepKey}:${targetKey}`;
      if (scrollWindowRef.current.key !== scrollKey) {
        scrollWindowRef.current = { key: scrollKey, since: Date.now() };
      }
      if (Date.now() - scrollWindowRef.current.since < 2500) {
        // Standalone routes (/polls, /bills) pin a back row under the
        // navbar (StickyPageHeader's .cv-sticky-head): keep clear of it.
        const sticky = document.querySelector('.cv-sticky-head');
        const stickyBottom = sticky ? sticky.getBoundingClientRect().bottom : 0;
        bringIntoView(el, Math.max(NAVBAR_H, stickyBottom) + 8, sheetTop - 8, compact ? roomRef : null);
      }
      // Ring only the part that is on screen (above the phone sheet),
      // so a target taller than the screen never puts the ring off it.
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, sheetTop - 10);
      const left = Math.max(r.left, 0);
      const right = Math.min(r.right, window.innerWidth);
      const next = bottom - top >= 4 && right - left >= 4
        // full: the control's own top and bottom, before clipping (kept
        // on the ring as data attributes for the tour's screenshot test).
        ? { top, left, width: right - left, height: bottom - top, fullTop: Math.round(r.top), fullBottom: Math.round(r.bottom) }
        : null;
      setRect((prev) => (next && rectsClose(prev, next) ? prev : next));
      const av = avoidNames.length ? findAnchor(avoidNames) : null;
      const ar = av ? av.getBoundingClientRect() : null;
      const nextAvoid = ar ? { top: ar.top, left: ar.left, width: ar.width, height: ar.height } : null;
      setAvoidRect((prev) => (nextAvoid && rectsClose(prev, nextAvoid) ? prev : nextAvoid));
    };
    measure();
    const iv = setInterval(measure, 400);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(iv);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      releaseRoom(roomRef);
    };
    // targetKey stands in for targetNames (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, targetKey, stepKey, compact]);

  // ─── Navigation ─────────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (view !== 'step' || !track) return;
    if (!isLastStep) {
      update({ active: true, view: 'step', trackId, stepIndex: stepIndex + 1, minimized });
      return;
    }
    markSegmentCompleted(trackId);
    if (trackId === QUICK_START.id) {
      update({ active: true, view: 'end', trackId, stepIndex, minimized: false });
    } else {
      // Close the windows a topic opened; the page itself stays as is.
      if (isTutorialBridgeReady()) emitTutorialAction('close-windows');
      update({ active: true, view: 'topics', minimized: false });
    }
  }, [view, track, isLastStep, trackId, stepIndex, minimized, update]);

  const goBack = useCallback(() => {
    if (view !== 'step' || stepIndex === 0) return;
    update({ active: true, view: 'step', trackId, stepIndex: stepIndex - 1, minimized });
  }, [view, trackId, stepIndex, minimized, update]);

  const jumpToTrack = useCallback((id) => {
    // Sweep whatever the previous track opened so the next one starts
    // clean.
    if (isTutorialBridgeReady()) emitTutorialAction('close-overlays');
    setListOpen(false);
    update({ active: true, view: 'step', trackId: id, stepIndex: 0, minimized: false });
  }, [update]);

  const showTopics = useCallback(() => {
    update({ active: true, view: 'topics', minimized: false });
  }, [update]);

  const handleClose = useCallback(() => {
    // Opt out: leave whatever is on screen as is (the visitor may be
    // closing the tour precisely to keep using it).
    closeTutorial();
    setTimeout(focusMenuButton, 0);
  }, []);

  const finishQuickStart = useCallback(() => {
    // Done: the quick start is finished; reopening shows the topics.
    update({ active: false, view: 'topics', minimized: false });
    setTimeout(focusMenuButton, 0);
  }, [update]);

  const toggleMinimized = useCallback(() => {
    update({ ...pos, minimized: !minimized });
  }, [pos, minimized, update]);

  // ─── Keyboard ───────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return undefined;
    // Esc, in the capture phase: the tour sees it before the app's own
    // window and document listeners.
    const onEsc = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      const inTour = !!(t && typeof t.closest === 'function' && t.closest('.cvtour-ui'));
      // Inside one of the app's own modal windows, Esc belongs to it.
      if (!inTour && t && typeof t.closest === 'function' && t.closest('[aria-modal="true"]')) return;
      // From the tour's own controls, Esc closes the tour only, not the
      // window or comparison under it as well.
      if (inTour) e.stopPropagation();
      handleClose();
    };
    // Left/Right, in the bubble phase: widgets that use the arrow keys
    // themselves (a tab strip, the seat chart) get them first.
    const onArrow = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (view !== 'step' || listOpen) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (e.key === 'ArrowRight') goNext(); else goBack();
    };
    window.addEventListener('keydown', onEsc, true);
    window.addEventListener('keydown', onArrow);
    return () => {
      window.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('keydown', onArrow);
    };
  }, [active, view, listOpen, goNext, goBack, handleClose]);

  // ─── Content for the current screen ─────────────────────────────
  let content = null;
  if (active && view === 'step' && step && track) {
    const meta = `${track.title} · Step ${stepIndex + 1} of ${track.steps.length}`;
    let title;
    let body;
    if (phase === 'pending') {
      title = typeof step.title === 'string' ? step.title : (step.fallbackTitle || track.title);
      body = 'Opening a live example…';
    } else if (phase === 'fallback') {
      title = step.fallbackTitle || (typeof step.title === 'string' ? step.title : track.title);
      body = step.fallbackBody || resolveField(step.body, ctx);
    } else {
      title = resolveField(step.title, ctx);
      body = resolveField(step.body, ctx);
    }
    content = { kind: 'step', meta, title, body, pending: phase === 'pending' };
  } else if (active && view === 'end') {
    content = { kind: 'end', meta: 'Quick start', title: QUICK_START_END.title, body: QUICK_START_END.body };
  } else if (active && view === 'topics') {
    content = { kind: 'topics', meta: 'App tour', title: 'Tour topics' };
  }
  const showList = content && (content.kind === 'topics' || listOpen);
  const contentKey = showList ? `list:${stepKey}` : `${stepKey}:${content?.pending ? 'p' : 'r'}`;

  // ─── Focus + announcement on every new screen ──────────────────
  const titleRef = useRef(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!active || !content) return undefined;
    const t = setTimeout(() => {
      const el = titleRef.current;
      if (el && typeof el.focus === 'function') {
        try { el.focus({ preventScroll: true }); } catch { /* old browser */ }
      }
      if (showList) setAnnounce('Tour topics');
      else setAnnounce(content.kind === 'step' ? `${content.meta}: ${content.title}` : content.title);
    }, 60);
    return () => clearTimeout(t);
    // contentKey captures every screen change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, contentKey, minimized]);

  return (
    <>
      {!active && !seen && !coachDismissed && (
        <CoachMark onTakeTour={startQuickStart} onDismiss={dismissCoachMark} />
      )}

      {active && content && (
        <>
          {/* Spotlight: purely visual, pointer-events none, so the page
              underneath stays usable. Only when the step has a live,
              measurable anchor. */}
          {rect && !showList && (
            <div
              className="cvtour-spotlight"
              aria-hidden="true"
              data-full-top={rect.fullTop}
              data-full-bottom={rect.fullBottom}
              style={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              }}
            />
          )}

          <div className="cvtour-sr" role="status" aria-live="polite">{announce}</div>

          {compact ? (
            <BottomSheet
              sheetRef={sheetRef}
              content={content}
              showList={showList}
              minimized={minimized && content.kind === 'step' && !listOpen}
              titleRef={titleRef}
              step={step}
              stepIndex={stepIndex}
              isLastStep={isLastStep}
              trackId={trackId}
              completed={completed}
              onNext={goNext}
              onBack={goBack}
              onClose={handleClose}
              onToggleMinimized={toggleMinimized}
              onOpenList={() => setListOpen(true)}
              onCloseList={() => setListOpen(false)}
              onJump={jumpToTrack}
              onTopics={showTopics}
              onDone={finishQuickStart}
            />
          ) : (
            <StepCallout
              rect={showList ? null : rect}
              avoidRect={showList ? null : avoidRect}
              content={content}
              showList={showList}
              titleRef={titleRef}
              step={step}
              stepIndex={stepIndex}
              isLastStep={isLastStep}
              trackId={trackId}
              completed={completed}
              onNext={goNext}
              onBack={goBack}
              onClose={handleClose}
              onOpenList={() => setListOpen(true)}
              onCloseList={() => setListOpen(false)}
              onJump={jumpToTrack}
              onTopics={showTopics}
              onDone={finishQuickStart}
            />
          )}
        </>
      )}
    </>
  );
}

// ─── Coach mark ──────────────────────────────────────────────────────
// One-time "New to CivicView?" tooltip anchored under the navbar menu
// button ([data-tutorial="nav-hamburger"]). Self-positioning so the
// Navbar stays free of tour plumbing beyond its anchors + pulse dot.
function CoachMark({ onTakeTour, onDismiss }) {
  const [anchor, setAnchor] = useState(null);
  useEffect(() => {
    const measure = () => {
      const el = findAnchor(['nav-hamburger']);
      if (!el) { setAnchor(null); return; }
      const r = el.getBoundingClientRect();
      if (r.width < 2) { setAnchor(null); return; }
      setAnchor((prev) => {
        const next = { top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right) };
        return prev && Math.abs(prev.top - next.top) < EPSILON && Math.abs(prev.right - next.right) < EPSILON
          ? prev
          : next;
      });
    };
    measure();
    const iv = setInterval(measure, 600);
    window.addEventListener('resize', measure);
    return () => { clearInterval(iv); window.removeEventListener('resize', measure); };
  }, []);

  if (!anchor) return null;
  return (
    <div
      className="cvtour-coach"
      style={{ top: anchor.top, right: anchor.right }}
      role="dialog"
      aria-label="Take the app tour"
    >
      <div className="cvtour-coach__arrow" aria-hidden="true" />
      <button
        type="button"
        className="cvtour-coach__x"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
      <p className="cvtour-coach__title">New to CivicView?</p>
      <p className="cvtour-coach__body">
        Start with a 6-step quick start, then explore any topic you like.
      </p>
      <button type="button" className="cvtour-coach__cta" onClick={onTakeTour}>
        Take the tour
      </button>
    </div>
  );
}

// ─── Shared pieces ──────────────────────────────────────────────────
function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function stepsLabel(n) {
  return `${n} ${n === 1 ? 'step' : 'steps'}`;
}

// The quick start and every topic, with step counts and checkmarks.
function TopicList({ trackId, completed, onJump, onCloseList, titleRef, asScreen }) {
  return (
    <div className="cvtour-list">
      <h2 className="cvtour-list__title" ref={titleRef} tabIndex={-1}>
        Tour topics
      </h2>
      <ul className="cvtour-list__items">
        {ALL_TRACKS.map((t, idx) => {
          const done = completed.includes(t.id);
          const current = !asScreen && t.id === trackId;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`cvtour-topic ${current ? 'is-current' : ''} ${done ? 'is-done' : ''}`}
                onClick={() => onJump(t.id)}
                aria-current={current ? 'step' : undefined}
              >
                <span className="cvtour-topic__num" aria-hidden="true">
                  {done ? <CheckIcon /> : idx + 1}
                </span>
                <span className="cvtour-topic__title">{t.title}</span>
                <span className="cvtour-topic__count">
                  {done ? <span className="cvtour-sr">Finished. </span> : null}
                  {stepsLabel(t.steps.length)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!asScreen && (
        <button type="button" className="cvtour-btn cvtour-btn--ghost cvtour-list__back" onClick={onCloseList}>
          Back to the step
        </button>
      )}
    </div>
  );
}

// Title, copy and controls for one screen (shared by both layouts).
function CardBody({ content, titleRef, step, stepIndex, isLastStep, trackId, onNext, onBack, onTopics, onDone }) {
  if (content.kind === 'end') {
    return (
      <div className="cvtour-step">
        <h2 className="cvtour-step__title" ref={titleRef} tabIndex={-1}>{content.title}</h2>
        <p className="cvtour-step__body">{content.body}</p>
        <div className="cvtour-step__controls cvtour-step__controls--end">
          <button type="button" className="cvtour-btn cvtour-btn--ghost" onClick={onDone}>
            Done
          </button>
          <button type="button" className="cvtour-btn cvtour-btn--primary" onClick={onTopics}>
            Explore more topics
          </button>
        </div>
      </div>
    );
  }
  const nextLabel = isLastStep && trackId !== QUICK_START.id ? 'Done' : 'Next';
  return (
    <div className="cvtour-step" aria-busy={content.pending ? 'true' : undefined}>
      <h2 className="cvtour-step__title" ref={titleRef} tabIndex={-1}>{content.title}</h2>
      <p className={`cvtour-step__body ${content.pending ? 'is-pending' : ''}`}>{content.body}</p>
      {step?.video && TOUR_VIDEO_URL ? (
        <a
          className="cvtour-btn cvtour-btn--video"
          href={TOUR_VIDEO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch a 2-minute overview
        </a>
      ) : null}
      <div className="cvtour-step__controls">
        <button
          type="button"
          className="cvtour-btn cvtour-btn--ghost"
          onClick={onBack}
          disabled={stepIndex === 0}
        >
          Back
        </button>
        <button type="button" className="cvtour-btn cvtour-btn--primary" onClick={onNext}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function HeaderButtons({ content, showList, onOpenList, onClose, onToggleMinimized }) {
  return (
    <div className="cvtour-head__btns">
      {content.kind !== 'topics' && !showList && (
        <button type="button" className="cvtour-hbtn" onClick={onOpenList}>
          Topics
        </button>
      )}
      {onToggleMinimized && content.kind === 'step' && !showList && (
        <button
          type="button"
          className="cvtour-hbtn cvtour-hbtn--icon"
          onClick={onToggleMinimized}
          aria-label="Minimize the tour"
          title="Minimize"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="cvtour-hbtn cvtour-hbtn--icon"
        aria-label="Close the tour"
        title="Close the tour (reopen it anytime from the menu)"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

// ─── Desktop: floating step card ────────────────────────────────────
// Sits NEXT TO the spotlighted element and never on it: right of it,
// then left, below, above, then the four corners, taking the first
// spot that does not touch the lit area. Very wide targets (a
// full-width header, the map) try the corners first, so the card lands
// in a corner instead of across the content under the target. With no
// spotlight it takes the bottom-right corner (or the middle, for the
// Welcome card, the end card and the topic list).
function computeCalloutPos(rect, size, vw, vh, placement, avoidRect) {
  const GAP = 14;
  const PAD = 12;
  const minTop = NAVBAR_H + PAD;
  const { width: w, height: h } = size;
  const clampTop = (t) => clamp(t, minTop, Math.max(minTop, vh - h - PAD));
  const clampLeft = (l) => clamp(l, PAD, Math.max(PAD, vw - w - PAD));
  const corners = {
    br: { top: Math.max(minTop, vh - h - PAD), left: Math.max(PAD, vw - w - PAD) },
    bl: { top: Math.max(minTop, vh - h - PAD), left: PAD },
    tr: { top: minTop, left: Math.max(PAD, vw - w - PAD) },
    tl: { top: minTop, left: PAD },
  };

  if (!rect) {
    if (placement === 'center') {
      return { top: clampTop((vh - h) / 2), left: clampLeft((vw - w) / 2) };
    }
    return corners.br;
  }
  const centeredTop = clampTop(rect.top + rect.height / 2 - h / 2);
  const sides = [
    { top: centeredTop, left: rect.left + rect.width + GAP },
    { top: centeredTop, left: rect.left - GAP - w },
    { top: rect.top + rect.height + GAP, left: clampLeft(rect.left) },
    { top: rect.top - GAP - h, left: clampLeft(rect.left) },
  ];
  const cornerList = [corners.br, corners.bl, corners.tr, corners.tl];
  const wide = rect.width > vw * 0.55;
  const candidates = wide ? [...cornerList, ...sides] : [...sides, ...cornerList];
  const lit = {
    top: rect.top - 10, left: rect.left - 10,
    bottom: rect.top + rect.height + 10, right: rect.left + rect.width + 10,
  };
  const fits = (c) => c.left >= PAD - 0.5 && c.top >= minTop - 0.5
    && c.left + w <= vw - PAD + 0.5 && c.top + h <= vh - PAD + 0.5;
  const clearOf = (c, b) => c.left + w <= b.left || c.left >= b.right
    || c.top + h <= b.top || c.top >= b.bottom;
  const clear = (c) => clearOf(c, lit);
  // A step can also name a window to stay off (the sign-in window the
  // step opened): try spots clear of both first.
  if (avoidRect) {
    const av = {
      top: avoidRect.top - 8, left: avoidRect.left - 8,
      bottom: avoidRect.top + avoidRect.height + 8, right: avoidRect.left + avoidRect.width + 8,
    };
    const both = candidates.find((c) => fits(c) && clear(c) && clearOf(c, av));
    if (both) return both;
  }
  const spot = candidates.find((c) => fits(c) && clear(c));
  if (spot) return spot;
  // Nothing is clear of it: the corner farthest from the target.
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return cy > vh / 2
    ? (cx > vw / 2 ? corners.tl : corners.tr)
    : (cx > vw / 2 ? corners.bl : corners.br);
}

function StepCallout(props) {
  const { rect, avoidRect, content, showList, step, onClose, onOpenList } = props;
  const boxRef = useRef(null);
  const [size, setSize] = useState(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const read = () => setSize((prev) => {
      const next = { width: el.offsetWidth, height: el.offsetHeight };
      return prev && prev.width === next.width && prev.height === next.height ? prev : next;
    });
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A no-target card has no rect changes to ride on: re-render on
  // window resizes so the corner tracks the viewport.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const onResize = () => forceTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const placement = showList || content.kind !== 'step' ? 'center' : step?.placement;
  const pos = size ? computeCalloutPos(rect, size, vw, vh, placement, avoidRect) : null;

  return (
    <section
      ref={boxRef}
      className="cvtour-ui cvtour-callout"
      data-focus-trap-allow
      aria-label="App tour"
      // Transparent (not visibility: hidden) while it measures, so the
      // focused button keeps focus from one step to the next.
      style={pos
        ? { top: pos.top, left: pos.left, opacity: 1 }
        : { top: NAVBAR_H + 12, left: 12, opacity: 0, pointerEvents: 'none' }}
    >
      <div className="cvtour-head">
        <span className="cvtour-head__meta">{showList ? 'App tour' : content.meta}</span>
        <HeaderButtons content={content} showList={showList} onOpenList={onOpenList} onClose={onClose} />
      </div>
      {showList ? (
        <TopicList {...props} asScreen={content.kind === 'topics'} />
      ) : (
        <CardBody {...props} />
      )}
    </section>
  );
}

// ─── Phones and tablets: bottom sheet ───────────────────────────────
function BottomSheet(props) {
  const { sheetRef, content, showList, minimized, titleRef, onClose, onOpenList, onToggleMinimized, onNext } = props;

  if (minimized) {
    return (
      <section
        ref={sheetRef}
        className="cvtour-ui cvtour-sheet cvtour-sheet--min"
        data-focus-trap-allow
        aria-label="App tour, minimized"
      >
        <button
          type="button"
          ref={titleRef}
          className="cvtour-sheet__expand"
          onClick={onToggleMinimized}
          aria-label={`Expand the tour: ${content.title}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <polyline points="6 15 12 9 18 15" />
          </svg>
          <span className="cvtour-sheet__mintitle">{content.title}</span>
        </button>
        <button type="button" className="cvtour-btn cvtour-btn--primary" onClick={onNext}>
          Next
        </button>
      </section>
    );
  }

  return (
    <section
      ref={sheetRef}
      className="cvtour-ui cvtour-sheet"
      data-focus-trap-allow
      aria-label="App tour"
    >
      <div className="cvtour-head cvtour-head--sheet">
        <span className="cvtour-head__meta">{showList ? 'App tour' : content.meta}</span>
        <HeaderButtons
          content={content}
          showList={showList}
          onOpenList={onOpenList}
          onClose={onClose}
          onToggleMinimized={onToggleMinimized}
        />
      </div>
      <div className="cvtour-sheet__body">
        {showList ? (
          <TopicList {...props} asScreen={content.kind === 'topics'} />
        ) : (
          <CardBody {...props} />
        )}
      </div>
    </section>
  );
}
