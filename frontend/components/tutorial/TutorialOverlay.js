'use client';

// CivicView — guided app tour ("Take the tour").
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Mounted once in app/layout.js so it exists on every route. Three
// responsibilities:
//
//   1. COACH MARK — a one-time "New here?" tooltip anchored under the
//      navbar hamburger for visitors who have never opened the tour.
//      Dismissed forever on ✕ or on opening the tour.
//   2. TOUR PANEL — when the tour is active: a docked segment list
//      (left panel on desktop, bottom sheet on mobile/tablet) with
//      always-visible close (✕ = opt out, per spec), jump-to-any-
//      segment, Back / Next, and per-segment ✓ completion marks.
//   3. SPOTLIGHT — a non-blocking dim layer with a cut-out ring over
//      the current step's [data-tutorial] anchor. pointer-events:none
//      throughout, so the live app stays fully usable mid-tour (the
//      tour points at real UI; users are encouraged to try things).
//
// Cross-surface plumbing:
//   • Steps on another route (/polls, /bills) navigate via a real page
//     load — same as the navbar's own links — and the tour resumes
//     after load from its sessionStorage position (lib/tutorial.js).
//   • Steps that need an overlay surface owned by app/page.js (My
//     Tracked, Feedback, Help Build, citizen login) emit bridge
//     actions; page.js maps them onto its existing handlers. Missing
//     listener (e.g. viewing /bills) → the action is a no-op and the
//     step degrades to panel-only text. Never throws, never blocks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TUTORIAL_SEGMENTS,
  TIER_BADGES,
  TOTAL_STEPS,
  getSegmentIndex,
} from '@/lib/tutorialSegments';
import {
  useTutorialState,
  useTutorialSeen,
  openTutorial,
  closeTutorial,
  markSegmentCompleted,
  dismissCoachMark,
  emitTutorialAction,
} from '@/lib/tutorial';
import { useIsCompact } from '@/lib/useViewport';
import './TutorialOverlay.css';

// Rects closer than this are treated as unchanged — keeps the 400ms
// measure poll from re-rendering when nothing moved.
const EPSILON = 1.5;
const rectsClose = (a, b) =>
  !!a && !!b &&
  Math.abs(a.top - b.top) < EPSILON &&
  Math.abs(a.left - b.left) < EPSILON &&
  Math.abs(a.width - b.width) < EPSILON &&
  Math.abs(a.height - b.height) < EPSILON;

export default function TutorialOverlay() {
  const { pos, completed, update } = useTutorialState();
  const { seen, coachDismissed } = useTutorialSeen();
  const isCompact = useIsCompact();

  const active = !!pos?.active;
  // Normalize position — a null segmentId (first open) means segment 0.
  const segmentId = pos?.segmentId || TUTORIAL_SEGMENTS[0].id;
  const segIndex = Math.max(0, getSegmentIndex(segmentId));
  const segment = TUTORIAL_SEGMENTS[segIndex];
  const stepIndex = Math.min(
    Math.max(0, pos?.stepIndex || 0),
    segment.steps.length - 1
  );
  const step = segment.steps[stepIndex];

  // ─── Step entry: route + bridge action ───────────────────────────
  // On every (active, segment, step) change: if the step lives on a
  // different route, navigate (position survives in sessionStorage and
  // this component re-runs after load). Otherwise emit the step's
  // bridge action after a beat so the target surface mounts before the
  // spotlight measures it.
  const navigatingRef = useRef(false);
  useEffect(() => {
    if (!active || !step) return undefined;
    if (typeof window === 'undefined') return undefined;
    if (window.location.pathname !== step.route) {
      if (!navigatingRef.current) {
        navigatingRef.current = true;
        window.location.href = step.route;
      }
      return undefined;
    }
    if (step.action) {
      const t = setTimeout(() => emitTutorialAction(step.action), 180);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [active, segmentId, stepIndex, step]);

  // ─── Spotlight measurement ───────────────────────────────────────
  // Poll the anchor's rect while the tour is active. Polling (vs a
  // ResizeObserver on the target) deliberately survives the target
  // unmounting/remounting — overlays and route content come and go.
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!active) { setRect(null); return undefined; }
    const measure = () => {
      // step.target may be a single anchor name or an array of
      // fallbacks (e.g. ['nav-identity', 'nav-citizen-login'] — the
      // signed-in pill when present, else the login button). Some
      // anchors also exist twice in the DOM (desktop + mobile variants
      // of the same control) — the first VISIBLE match wins.
      const targets = Array.isArray(step?.target)
        ? step.target
        : step?.target ? [step.target] : [];
      for (const t of targets) {
        const els = document.querySelectorAll(`[data-tutorial="${t}"]`);
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          const next = { top: r.top, left: r.left, width: r.width, height: r.height };
          setRect((prev) => (rectsClose(prev, next) ? prev : next));
          return;
        }
      }
      setRect(null);
    };
    measure();
    const iv = setInterval(measure, 400);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(iv);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, segmentId, stepIndex, step]);

  // ─── Navigation between steps / segments ─────────────────────────
  const jumpToSegment = useCallback((id) => {
    // Jumping can skip a step whose job was to close a surface the
    // tour opened (e.g. leaving "My Tracked" mid-segment) — sweep
    // everything shut so the next segment starts clean.
    emitTutorialAction('close-overlays');
    update({ active: true, segmentId: id, stepIndex: 0 });
  }, [update]);

  const goNext = useCallback(() => {
    if (stepIndex < segment.steps.length - 1) {
      update({ active: true, segmentId, stepIndex: stepIndex + 1 });
      return;
    }
    markSegmentCompleted(segmentId);
    const nextSeg = TUTORIAL_SEGMENTS[segIndex + 1];
    if (nextSeg) {
      update({ active: true, segmentId: nextSeg.id, stepIndex: 0 });
    } else {
      emitTutorialAction('close-overlays');
      closeTutorial();
    }
  }, [segment, segmentId, segIndex, stepIndex, update]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) {
      update({ active: true, segmentId, stepIndex: stepIndex - 1 });
      return;
    }
    const prevSeg = TUTORIAL_SEGMENTS[segIndex - 1];
    if (prevSeg) {
      emitTutorialAction('close-overlays');
      update({ active: true, segmentId: prevSeg.id, stepIndex: prevSeg.steps.length - 1 });
    }
  }, [segmentId, segIndex, stepIndex, update]);

  const handleClose = useCallback(() => {
    // Opt out — leave whatever surface is on screen as-is (the user
    // may be closing the tour precisely to keep using it).
    closeTutorial();
  }, []);

  // Overall progress: flat step number across all segments.
  const flatStep = useMemo(() => {
    let n = 0;
    for (let i = 0; i < segIndex; i += 1) n += TUTORIAL_SEGMENTS[i].steps.length;
    return n + stepIndex + 1;
  }, [segIndex, stepIndex]);

  const isFirstStep = segIndex === 0 && stepIndex === 0;
  const isLastStep =
    segIndex === TUTORIAL_SEGMENTS.length - 1 &&
    stepIndex === segment.steps.length - 1;

  return (
    <>
      {!active && !seen && !coachDismissed && (
        <CoachMark
          onTakeTour={() => openTutorial(TUTORIAL_SEGMENTS[0].id, 0)}
          onDismiss={dismissCoachMark}
        />
      )}

      {active && (
        <>
          {/* Spotlight — pure visual; pointer-events:none so the page
              underneath stays interactive. Rendered only when the
              current step has a live, measurable anchor. */}
          {rect && (
            <div
              className="cvtour-spotlight"
              aria-hidden="true"
              style={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              }}
            />
          )}

          {isCompact ? (
            <BottomSheet
              segment={segment}
              segIndex={segIndex}
              step={step}
              stepIndex={stepIndex}
              completed={completed}
              flatStep={flatStep}
              isFirstStep={isFirstStep}
              isLastStep={isLastStep}
              onJump={jumpToSegment}
              onNext={goNext}
              onBack={goBack}
              onClose={handleClose}
            />
          ) : (
            <>
              {/* Desktop: the glassy segment list on the left + a
                  floating step callout that rides next to whatever the
                  spotlight is pointing at. */}
              <SidePanelDock
                segment={segment}
                completed={completed}
                onJump={jumpToSegment}
                onClose={handleClose}
              />
              <StepCallout
                rect={rect}
                segment={segment}
                step={step}
                stepIndex={stepIndex}
                flatStep={flatStep}
                isFirstStep={isFirstStep}
                isLastStep={isLastStep}
                onNext={goNext}
                onBack={goBack}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

// ─── Coach mark ──────────────────────────────────────────────────────
// One-time "New here?" tooltip anchored under the navbar hamburger
// ([data-tutorial="nav-hamburger"]). Self-positioning so the Navbar
// stays free of tour plumbing beyond its anchors + pulse dot.
function CoachMark({ onTakeTour, onDismiss }) {
  const [anchor, setAnchor] = useState(null);
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('[data-tutorial="nav-hamburger"]');
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
        Take a quick tour of everything you can do here.
      </p>
      <button type="button" className="cvtour-coach__cta" onClick={onTakeTour}>
        Take the tour
      </button>
    </div>
  );
}

// ─── Shared segment list row ─────────────────────────────────────────
function SegmentRow({ seg, idx, isCurrent, isDone, onJump }) {
  const badge = TIER_BADGES[seg.tier];
  return (
    <button
      type="button"
      className={`cvtour-seg ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`}
      onClick={() => onJump(seg.id)}
      aria-current={isCurrent ? 'step' : undefined}
    >
      <span className="cvtour-seg__num" aria-hidden="true">
        {isDone ? '✓' : idx + 1}
      </span>
      <span className="cvtour-seg__title">{seg.title}</span>
      {badge && (
        <span className="cvtour-seg__badge" title={badge.title}>
          {badge.label}
        </span>
      )}
    </button>
  );
}

// ─── Step body + controls (shared by both layouts) ──────────────────
function StepBody({ segment, step, stepIndex, flatStep, isFirstStep, isLastStep, onNext, onBack }) {
  return (
    <div className="cvtour-step">
      <p className="cvtour-step__meta">
        {segment.title}
        {segment.steps.length > 1 && (
          <span className="cvtour-step__dots" aria-label={`Step ${stepIndex + 1} of ${segment.steps.length} in this section`}>
            {segment.steps.map((_, i) => (
              <span key={i} className={`cvtour-step__dot ${i === stepIndex ? 'is-on' : ''}`} />
            ))}
          </span>
        )}
      </p>
      <h3 className="cvtour-step__title">{step.title}</h3>
      <p className="cvtour-step__body">{step.body}</p>
      <div className="cvtour-step__controls">
        <span className="cvtour-step__progress">{flatStep} / {TOTAL_STEPS}</span>
        <div className="cvtour-step__btns">
          <button
            type="button"
            className="cvtour-btn cvtour-btn--ghost"
            onClick={onBack}
            disabled={isFirstStep}
          >
            Back
          </button>
          <button type="button" className="cvtour-btn cvtour-btn--primary" onClick={onNext}>
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Desktop: docked left panel (glassy — the map shows through) ────
// Width kept in sync with the .cvtour-panel CSS rule; the callout's
// placement logic uses it to avoid sliding under the list.
const PANEL_W = 300;
const NAVBAR_H = 56;

function SidePanelDock({ segment, completed, onJump, onClose }) {
  return (
    <aside className="cvtour-panel" aria-label="App tour">
      <div className="cvtour-panel__head">
        <span className="cvtour-panel__brand">App tour</span>
        <button
          type="button"
          className="cvtour-x"
          aria-label="Close the tour"
          title="Close the tour (reopen it anytime from the ☰ menu)"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="cvtour-panel__list" role="list">
        {TUTORIAL_SEGMENTS.map((seg, idx) => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            idx={idx}
            isCurrent={seg.id === segment.id}
            isDone={completed.includes(seg.id)}
            onJump={onJump}
          />
        ))}
      </div>
    </aside>
  );
}

// ─── Desktop: floating step callout ─────────────────────────────────
// A small translucent window that rides NEXT TO the spotlighted
// element: right of it first, then left, then below, then above —
// overlapping the target only when nothing else fits (per spec).
// Steps with no target (or an anchor that isn't on screen) center the
// callout in the space right of the segment list.
function computeCalloutPos(rect, size, vw, vh, corner) {
  const GAP = 14;   // breathing room between target and callout
  const PAD = 10;   // minimum distance from viewport edges
  const minLeft = PANEL_W + PAD;      // stay clear of the segment list
  const minTop = NAVBAR_H + PAD;      // …and the navbar
  const { width: w, height: h } = size;
  const clampTop = (t) => Math.min(Math.max(t, minTop), Math.max(minTop, vh - h - PAD));
  const clampLeft = (l) => Math.min(Math.max(l, minLeft), Math.max(minLeft, vw - w - PAD));

  if (!rect) {
    // No spotlight. Steps over a full-screen surface (comparison view,
    // an official's page) set corner:true so the callout hugs the
    // bottom-right instead of covering the content being described.
    if (corner) {
      return {
        top: Math.max(minTop, vh - h - PAD),
        left: Math.max(minLeft, vw - w - PAD),
      };
    }
    // Otherwise center in the area right of the panel.
    return {
      top: Math.max(minTop, (vh - h) / 2),
      left: Math.max(minLeft, PANEL_W + (vw - PANEL_W - w) / 2),
    };
  }
  const centeredTop = clampTop(rect.top + rect.height / 2 - h / 2);
  // 1. Right of the target.
  if (rect.left + rect.width + GAP + w <= vw - PAD) {
    return { top: centeredTop, left: rect.left + rect.width + GAP };
  }
  // 2. Left of the target (without sliding under the segment list).
  if (rect.left - GAP - w >= minLeft) {
    return { top: centeredTop, left: rect.left - GAP - w };
  }
  // 3. Below.
  if (rect.top + rect.height + GAP + h <= vh - PAD) {
    return { top: rect.top + rect.height + GAP, left: clampLeft(rect.left) };
  }
  // 4. Above.
  if (rect.top - GAP - h >= minTop) {
    return { top: rect.top - GAP - h, left: clampLeft(rect.left) };
  }
  // 5. Nothing fits — overlap is allowed as the last resort; hug the
  //    target's near corner, clamped on-screen.
  return { top: clampTop(rect.top + GAP), left: clampLeft(rect.left + rect.width - w) };
}

function StepCallout({ rect, segment, step, stepIndex, flatStep, isFirstStep, isLastStep, onNext, onBack }) {
  const boxRef = useRef(null);
  const [size, setSize] = useState(null);
  // Re-measure whenever the step content changes (height varies with
  // copy length). Hidden until measured so the first paint never
  // flashes at a stale position.
  useEffect(() => {
    setSize(null);
  }, [segment.id, stepIndex]);
  useEffect(() => {
    if (size) return;
    const el = boxRef.current;
    if (!el) return;
    setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [size]);
  // Window resizes reposition targeted callouts via the parent's rect
  // poll, but a no-target (centered) callout has no rect changes to
  // ride on — re-render explicitly so the center tracks the viewport.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const onResize = () => forceTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const pos = size ? computeCalloutPos(rect, size, vw, vh, step?.corner) : null;

  return (
    <div
      ref={boxRef}
      className="cvtour-callout"
      role="region"
      aria-label="Tour step"
      style={pos
        ? { top: pos.top, left: pos.left, visibility: 'visible' }
        : { top: NAVBAR_H + 10, left: PANEL_W + 10, visibility: 'hidden' }}
    >
      <StepBody
        segment={segment}
        step={step}
        stepIndex={stepIndex}
        flatStep={flatStep}
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        onNext={onNext}
        onBack={onBack}
      />
    </div>
  );
}

// ─── Mobile / tablet: bottom sheet ──────────────────────────────────
function BottomSheet(props) {
  const { segment, completed, onJump, onClose } = props;
  const stripRef = useRef(null);
  // Keep the current segment's chip scrolled into view.
  useEffect(() => {
    const el = stripRef.current?.querySelector('.is-current');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }, [segment.id]);
  return (
    <section className="cvtour-sheet" aria-label="App tour">
      <div className="cvtour-sheet__head">
        <span className="cvtour-panel__brand">App tour</span>
        <button
          type="button"
          className="cvtour-x"
          aria-label="Close the tour"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="cvtour-sheet__strip" ref={stripRef}>
        {TUTORIAL_SEGMENTS.map((seg, idx) => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            idx={idx}
            isCurrent={seg.id === segment.id}
            isDone={completed.includes(seg.id)}
            onJump={onJump}
          />
        ))}
      </div>
      <div className="cvtour-sheet__stepwrap">
        <StepBody {...props} />
      </div>
    </section>
  );
}
