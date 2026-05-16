'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * IdentityPicker — small popover dropdown that appears next to a
 * like / vote / react button when the user is signed in to multiple
 * identities AND needs to disambiguate which one performs the action.
 *
 * Two modes:
 *   • pick    — accounts that haven't acted yet. Click one → fire the
 *               action as that identity.
 *   • toggle  — all identities have already acted. Click one → retract
 *               (toggle off) that identity's reaction. Each entry shows
 *               its current state (e.g. "✓ Up") so the user can see
 *               what's set without guessing.
 *
 * Positioning: anchored next to the click target via the `anchor` prop
 * (a DOM rect or null for in-flow). For phase-6 simplicity we render
 * inline below the trigger when no anchor is provided.
 *
 * Props:
 *   open       — controls visibility
 *   identities — array of { kind, label, sublabel, currentState? }
 *                currentState is 'up' | 'down' | null — used in
 *                toggle mode to show what's currently set.
 *   mode       — 'pick' | 'toggle' (drives the per-entry hint)
 *   onPick(kind) — fired when the user selects an identity
 *   onClose()    — fired when the user clicks outside or presses Esc
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const KIND_BADGE = {
  citizen:   { label: 'Citizen',   color: '#1d3557' },
  rep:       { label: 'Rep',       color: '#2a7a2a' },
  candidate: { label: 'Candidate', color: '#2a7a2a' },
};

export default function IdentityPicker({
  open, identities = [], mode = 'pick', onPick, onClose,
}) {
  const ref = useRef(null);

  // Edge-aware placement. We start with the default (drop below + align
  // left) and let a useLayoutEffect measure the rendered position. If
  // the picker would overflow the viewport bottom or right, we flip
  // to drop-above and/or right-align. useLayoutEffect fires before
  // paint, so the corrected position is what the user sees — no
  // visible flicker.
  const [placement, setPlacement] = useState({ vertical: 'bottom', horizontal: 'left' });

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const margin = 12;
    const nextVertical = rect.bottom > vh - margin ? 'top' : 'bottom';
    const nextHorizontal = rect.right > vw - margin ? 'right' : 'left';
    if (nextVertical !== placement.vertical || nextHorizontal !== placement.horizontal) {
      setPlacement({ vertical: nextVertical, horizontal: nextHorizontal });
    }
  // We deliberately re-measure on every open + on identities count
  // change (different option counts → different heights). We DON'T
  // depend on `placement` itself because the goal is to settle on
  // the correct placement after one measure, not oscillate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identities.length]);

  // Close on click-outside + Escape. Wired only while open so the
  // listener doesn't fire on every render.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose?.();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || identities.length === 0) return null;

  // Compose position styles from the resolved placement. We use
  // `calc(100% + 4px)` so the picker hangs 4px outside the anchor
  // (matches the original marginTop spacing).
  const positionStyle = {
    ...(placement.vertical === 'top'
      ? { bottom: 'calc(100% + 4px)' }
      : { top: 'calc(100% + 4px)' }),
    ...(placement.horizontal === 'right'
      ? { right: 0 }
      : { left: 0 }),
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Choose identity"
      style={{
        position: 'absolute',
        zIndex: 1000,
        minWidth: 200,
        background: 'white',
        border: '1px solid var(--cl-border)',
        borderRadius: 8,
        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
        padding: 4,
        ...positionStyle,
      }}
    >
      <div style={{
        fontSize: '0.62rem', fontWeight: 800,
        color: 'var(--cl-text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        padding: '6px 10px 4px',
      }}>
        {mode === 'toggle' ? 'Toggle off' : 'Act as'}
      </div>
      {identities.map((id) => {
        const badge = KIND_BADGE[id.kind] || { label: id.kind, color: '#666' };
        const stateLabel = mode === 'toggle' && id.currentState
          ? (id.currentState === 'up' ? '✓ Liked' : '✓ Disliked')
          : null;
        return (
          <button
            key={id.kind}
            type="button"
            role="menuitem"
            onClick={() => {
              onPick?.(id.kind);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 10px',
              border: 'none',
              background: 'transparent',
              color: 'var(--cl-text)',
              fontSize: '0.82rem',
              cursor: 'pointer',
              borderRadius: 6,
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--cl-bg)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{
              fontSize: '0.58rem', fontWeight: 800,
              padding: '1px 6px', borderRadius: 999,
              background: badge.color, color: 'white',
              letterSpacing: '0.04em', textTransform: 'uppercase',
              flexShrink: 0,
            }}>
              {badge.label}
            </span>
            <span style={{ flex: 1, fontWeight: 600 }}>{id.label}</span>
            {id.sublabel && (
              <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)' }}>
                {id.sublabel}
              </span>
            )}
            {stateLabel && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 700,
                color: 'var(--cl-accent)',
                marginLeft: 'auto',
              }}>
                {stateLabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * PostingAsPicker — persistent inline pill that sits above a comment
 * or reply composer textarea. Shows the active identity that will
 * author the comment when Post is pressed. Tapping it opens a small
 * popover to switch identities.
 *
 * Single-identity callers don't need to render this (or they can
 * pass a single-element `identities` array and the pill renders as
 * a non-interactive label).
 *
 * Props:
 *   identities — array of { kind, label, sublabel }
 *   value      — currently-selected kind ('citizen' / 'rep' / 'candidate')
 *   onChange(kind) — fires when user picks a new identity
 */
export function PostingAsPicker({ identities = [], value, onChange }) {
  const wrapRef = useRef(null);
  // open/close state for the popover. Each composer manages its own
  // picker independently so two open at once never happens.
  const [open, setOpen] = useState(false);

  // Close on outside-click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!identities || identities.length === 0) return null;
  if (identities.length === 1) {
    // Show as a non-interactive pill so the user still sees who
    // they're posting as, but there's nothing to pick.
    const only = identities[0];
    const badge = KIND_BADGE[only.kind] || { label: only.kind, color: '#666' };
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: '0.72rem', color: 'var(--cl-text-light)',
        marginBottom: 6,
      }}>
        <span>Posting as</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '1px 8px', borderRadius: 999,
          background: badge.color, color: 'white',
          fontSize: '0.62rem', fontWeight: 800,
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          {badge.label}
        </span>
        <span style={{ fontWeight: 600, color: 'var(--cl-text)' }}>{only.label}</span>
      </div>
    );
  }

  // Multi-identity — render an interactive pill that opens the picker.
  const current = identities.find((i) => i.kind === value) || identities[0];
  const badge = KIND_BADGE[current.kind] || { label: current.kind, color: '#666' };
  return (
    <div ref={wrapRef} style={{ position: 'relative', marginBottom: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px 3px 4px',
          border: '1px solid var(--cl-border)', borderRadius: 999,
          background: 'white', color: 'var(--cl-text)',
          fontFamily: 'inherit', fontSize: '0.74rem',
          cursor: 'pointer',
        }}
      >
        <span style={{
          fontSize: '0.6rem', fontWeight: 800,
          padding: '1px 7px', borderRadius: 999,
          background: badge.color, color: 'white',
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          {badge.label}
        </span>
        <span style={{ fontWeight: 600 }}>{current.label}</span>
        <span aria-hidden style={{ fontSize: '0.62rem', color: 'var(--cl-text-light)' }}>▾</span>
      </button>
      <IdentityPicker
        open={open}
        identities={identities}
        mode="pick"
        onPick={(kind) => {
          onChange?.(kind);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
