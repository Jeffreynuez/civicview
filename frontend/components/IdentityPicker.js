'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * IdentityPicker — small popover dropdown that appears next to a
 * like / vote / react button when the user is signed in to multiple
 * identities and needs to pick which one performs the action.
 *
 * Always shows the same set: every signed-in identity, regardless of
 * whether they've already acted. Identities that have ALREADY acted
 * with this picker's specific kind/option get a ✓ marker so the user
 * can see at a glance who's done what. Clicking an identity that
 * already acted is equivalent to a toggle — the backend's reaction
 * endpoint already handles "click the same kind twice → remove" for
 * the rep / candidate / citizen path identically.
 *
 * Props:
 *   open       — controls visibility
 *   identities — array of { kind, label, sublabel, currentState? }
 *                currentState ∈ {'up' | 'down' | 'voted' | null}.
 *                Caller sets this to the kind ONLY when the identity
 *                has acted with THIS picker's specific kind/option
 *                (e.g. for the 👍 picker, currentState='up' iff that
 *                identity up-voted; 'down' votes don't qualify).
 *   onPick(kind) — fired when the user selects an identity
 *   onClose()    — fired when the user clicks outside or presses Esc
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const KIND_BADGE = {
  citizen:   { label: 'Citizen',   color: '#1d3557' },
  rep:       { label: 'Rep',       color: '#2a7a2a' },
  candidate: { label: 'Candidate', color: '#2a7a2a' },
};

// Per-row max label width before CSS-ellipsis kicks in. Tuned to
// fit the picker's ~200px minWidth alongside the badge + sublabel
// + ✓ marker. Full text remains in the row's title attribute so
// hover shows it.
const LABEL_MAX_WIDTH = 130;
const SUBLABEL_MAX_WIDTH = 100;

export default function IdentityPicker({
  open, identities = [], mode = 'pick', onPick, onClose,
}) {
  const ref = useRef(null);        // ref to the portaled picker (for click-outside + measurement)
  const sentinelRef = useRef(null); // 0x0 marker stays in the original DOM tree to locate the anchor

  // Anchor rect + flip flags. The anchor is the picker's natural
  // parentElement (the position:relative wrapper that holds the
  // trigger button alongside the IdentityPicker JSX element). Because
  // we portal out of the DOM, we can't use parentElement directly on
  // the portaled node — the sentinel below stays in place to give us
  // a reference back to the original parent.
  const [anchor, setAnchor] = useState(null);
  const [placement, setPlacement] = useState({ vertical: 'bottom', horizontal: 'left' });

  // First useLayoutEffect: when the picker opens, measure the
  // anchor (the sentinel's parentElement). Runs before paint so the
  // portaled picker renders at the correct coords on first frame.
  useLayoutEffect(() => {
    if (!open || !sentinelRef.current) {
      setAnchor(null);
      return;
    }
    const parent = sentinelRef.current.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    setAnchor({
      top: r.top, bottom: r.bottom,
      left: r.left, right: r.right,
      width: r.width, height: r.height,
    });
  }, [open]);

  // Second useLayoutEffect: once the picker is rendered into the
  // portal, measure ITS bbox and flip vertical / horizontal placement
  // if it would overflow the viewport. Same flip logic as the prior
  // inline version, just running against the picker's portaled rect.
  useLayoutEffect(() => {
    if (!open || !ref.current || !anchor) return;
    const rect = ref.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const margin = 12;
    const nextVertical = rect.bottom > vh - margin ? 'top' : 'bottom';
    const nextHorizontal = rect.right > vw - margin ? 'right' : 'left';
    if (nextVertical !== placement.vertical || nextHorizontal !== placement.horizontal) {
      setPlacement({ vertical: nextVertical, horizontal: nextHorizontal });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchor, identities.length]);

  // Close on click-outside + Escape. Wired only while open. The
  // click-outside check uses the portaled picker's ref AND the
  // sentinel's parent — clicking the trigger button (which lives
  // inside sentinelRef.current.parentElement) should NOT auto-close
  // since the trigger's own onClick toggles the picker.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const picker = ref.current;
      const anchorEl = sentinelRef.current?.parentElement;
      if (picker && picker.contains(e.target)) return;
      if (anchorEl && anchorEl.contains(e.target)) return;
      onClose?.();
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

  // The sentinel renders in EVERY state (even closed) so its
  // parentElement lookup works on the first open. It has zero
  // dimensions and zero visibility — pure DOM anchor.
  const sentinel = (
    <span
      ref={sentinelRef}
      aria-hidden="true"
      style={{ display: 'none' }}
    />
  );

  if (!open || identities.length === 0) return sentinel;

  // Compute fixed-position coords from the anchor's viewport rect.
  // Vertical: drop below by default (anchor.bottom + 4); flip to
  // anchor.top - <picker_height> - 4 if it'd overflow viewport
  // bottom (handled via `bottom:` instead of `top:` so we don't have
  // to know picker height up front).
  // Horizontal: align left edge with anchor by default; flip to
  // right-align if the picker would overflow viewport right.
  let positionStyle = {};
  if (anchor) {
    positionStyle = placement.vertical === 'top'
      ? { bottom: `${window.innerHeight - anchor.top + 4}px` }
      : { top: `${anchor.bottom + 4}px` };
    positionStyle = placement.horizontal === 'right'
      ? { ...positionStyle, right: `${window.innerWidth - anchor.right}px` }
      : { ...positionStyle, left: `${anchor.left}px` };
  } else {
    // First frame before anchor is measured — render off-screen so
    // we don't flash a mis-positioned picker.
    positionStyle = { top: -9999, left: -9999 };
  }

  const pickerNode = (
    <div
      ref={ref}
      role="menu"
      aria-label="Choose identity"
      style={{
        position: 'fixed',
        zIndex: 10000,
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
        Act as
      </div>
      {identities.map((id) => {
        const badge = KIND_BADGE[id.kind] || { label: id.kind, color: '#666' };
        // ✓ stamp: render whenever this identity has acted with the
        // picker's specific kind/option (currentState is set by the
        // caller — see IdentityPicker docstring). Clicking the row
        // is a toggle when this is set; the backend handles "same
        // kind twice → remove" symmetrically across all three
        // identity paths.
        let stateLabel = null;
        if (id.currentState === 'up') stateLabel = '✓ Liked';
        else if (id.currentState === 'down') stateLabel = '✓ Disliked';
        else if (id.currentState === 'voted') stateLabel = '✓ Voted';
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
            title={[id.label, id.sublabel].filter(Boolean).join(' · ')}
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
            {/* Label truncates with ellipsis when it would overflow
                the row. min-width:0 lets flexbox compress; the title
                attribute on the parent button surfaces the full
                text on hover. */}
            <span style={{
              flex: 1, fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0, maxWidth: LABEL_MAX_WIDTH,
            }}>
              {id.label}
            </span>
            {id.sublabel && (
              <span style={{
                fontSize: '0.7rem', color: 'var(--cl-text-light)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: SUBLABEL_MAX_WIDTH, flexShrink: 0,
              }}>
                {id.sublabel}
              </span>
            )}
            {stateLabel && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 700,
                color: 'var(--cl-accent)',
                marginLeft: 'auto',
                flexShrink: 0,
              }}>
                {stateLabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {sentinel}
      {createPortal(pickerNode, document.body)}
    </>
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

  // NOTE: no duplicate click-outside handler here.
  // IdentityPicker (which we delegate the dropdown rendering to)
  // already runs a portal-aware click-outside check internally and
  // calls onClose. The earlier wrapRef-based handler intercepted
  // clicks on the portaled IdentityPicker DOM (which lives in
  // document.body, OUTSIDE wrapRef) and fired setOpen(false) BEFORE
  // the option's onPick could run. Net effect: clicking a different
  // identity in the dropdown closed the popover but never committed
  // the selection — the pill always reverted to citizen.
  // Removing this handler lets the portal-aware path in IdentityPicker
  // handle dismissal correctly via onClose below.

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
        maxWidth: '100%',
      }}>
        <span style={{ flexShrink: 0 }}>Posting as</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '1px 8px', borderRadius: 999,
          background: badge.color, color: 'white',
          fontSize: '0.62rem', fontWeight: 800,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          {badge.label}
        </span>
        <span
          style={{
            fontWeight: 600, color: 'var(--cl-text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: LABEL_MAX_WIDTH, minWidth: 0,
          }}
          title={only.label}
        >
          {only.label}
        </span>
      </div>
    );
  }

  // Multi-identity — render an interactive pill that opens the picker.
  const current = identities.find((i) => i.kind === value) || identities[0];
  const badge = KIND_BADGE[current.kind] || { label: current.kind, color: '#666' };
  return (
    <div ref={wrapRef} style={{ position: 'relative', marginBottom: 6, display: 'inline-block', maxWidth: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={current.label}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px 3px 4px',
          border: '1px solid var(--cl-border)', borderRadius: 999,
          background: 'white', color: 'var(--cl-text)',
          fontFamily: 'inherit', fontSize: '0.74rem',
          cursor: 'pointer',
          maxWidth: '100%',
        }}
      >
        <span style={{
          fontSize: '0.6rem', fontWeight: 800,
          padding: '1px 7px', borderRadius: 999,
          background: badge.color, color: 'white',
          letterSpacing: '0.04em', textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          {badge.label}
        </span>
        <span style={{
          fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: LABEL_MAX_WIDTH, minWidth: 0,
        }}>
          {current.label}
        </span>
        <span aria-hidden style={{ fontSize: '0.62rem', color: 'var(--cl-text-light)', flexShrink: 0 }}>▾</span>
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
