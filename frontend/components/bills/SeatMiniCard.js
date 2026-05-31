// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

'use client';

/**
 * SeatMiniCard — popover anchored to a seat or list row. Reuses the
 * IdentityPicker model: portaled to body, position:fixed, measured +
 * flipped to stay on-screen, dismiss on click-outside + Esc, focus moves
 * in on open and returns to the opener on close. "View profile" links to
 * the member's ProfileView profile window (/?member=<bioguide>), NOT the
 * engagement page. Ported from the Claude Design export.
 */
import { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { partyWord, partyHueVar, partySoftVar, initials, displayName } from './voteHelpers';
import { STATE_NAMES } from '@/lib/usStates';

function PositionPill({ pos }) {
  const map = {
    yea: { bg: 'var(--cl-success-soft)', fg: 'var(--cl-success-text)', t: 'Voted Yea', mk: '✓' },
    nay: { bg: 'var(--cl-danger-soft)', fg: 'var(--cl-danger-text)', t: 'Voted Nay', mk: '✕' },
    present: { bg: 'var(--cl-warning-soft)', fg: 'var(--cl-warning-text)', t: 'Present', mk: '⊘' },
    nv: { bg: 'var(--cl-bg-soft)', fg: 'var(--cl-text-muted)', t: 'Did not vote', mk: '—' },
  };
  const m = map[pos] || map.nv;
  return (
    <span className="cv-pospill" style={{ background: m.bg, color: m.fg, fontSize: '0.68rem' }}>
      <span aria-hidden="true" style={{ marginRight: 4, fontWeight: 700 }}>{m.mk}</span>
      {m.t}
    </span>
  );
}

export default function SeatMiniCard({ seat, chamber, anchorEl, idx, onClose, onViewProfile }) {
  const cardRef = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999, ready: false });

  const anchor =
    (anchorEl && anchorEl.getBoundingClientRect && anchorEl.isConnected ? anchorEl : null) ||
    (typeof document !== 'undefined' && document.querySelector('.cv-seat[data-si="' + idx + '"]')) ||
    (typeof document !== 'undefined' && document.querySelector('.cv-chartcard'));

  useLayoutEffect(() => {
    if (!anchor || !cardRef.current) return;
    const a = anchor.getBoundingClientRect();
    const c = cardRef.current.getBoundingClientRect();
    const gap = 10;
    const pad = 12;
    let left = a.left + a.width / 2 - c.width / 2;
    let top = a.bottom + gap;
    if (top + c.height > window.innerHeight - pad) {
      const above = a.top - gap - c.height;
      if (above > pad) top = above;
      else top = Math.max(pad, window.innerHeight - c.height - pad);
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - c.width - pad));
    setPos({ left, top, ready: true });
  }, [anchor, seat]);

  useEffect(() => {
    const onDoc = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target) && e.target !== anchor) onClose();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        onClose();
        if (anchor && anchor.focus) anchor.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    const t = setTimeout(() => {
      if (cardRef.current) {
        const f = cardRef.current.querySelector('a,button');
        if (f) f.focus();
      }
    }, 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
      clearTimeout(t);
    };
  }, [anchor, onClose]);

  if (!seat || typeof document === 'undefined') return null;
  const hue = partyHueVar(seat.party);
  const stName = STATE_NAMES[seat.st] || seat.st;
  const caucusNote =
    seat.party === 'I' && seat.caucus
      ? ' · caucuses with ' + (seat.caucus === 'D' ? 'Democrats' : 'Republicans')
      : '';
  const hasProfile = !!seat.bioguide;

  return createPortal(
    <div
      ref={cardRef}
      className="cv-minicard"
      role="dialog"
      aria-label={displayName(seat, chamber) + ' vote detail'}
      style={{ left: pos.left, top: pos.top, transform: pos.ready ? 'translateY(0)' : 'translateY(4px)' }}
    >
      <div className="cv-minicard__head">
        <div
          className="cv-minicard__avatar"
          style={{ background: partySoftVar(seat.party), color: hue }}
        >
          {initials(seat.name)}
        </div>
        <div style={{ minWidth: 0 }}>
          <p className="cv-minicard__name" title={displayName(seat, chamber)}>
            {displayName(seat, chamber)}
          </p>
          <p className="cv-minicard__meta">
            <span style={{ color: hue, fontWeight: 600 }}>{partyWord(seat.party)}</span>
            {' · ' + stName + (seat.dist && seat.dist !== seat.st ? ' (' + seat.dist + ')' : '') + caucusNote}
          </p>
        </div>
      </div>
      <div className="cv-minicard__foot">
        <PositionPill pos={seat.pos} />
        {hasProfile ? (
          <a
            href={'/?member=' + encodeURIComponent(seat.bioguide)}
            className="cv-minicard__link"
            onClick={(e) => {
              e.preventDefault();
              onViewProfile(seat.bioguide);
            }}
          >
            View profile <span aria-hidden="true">{'→'}</span>
          </a>
        ) : (
          <span className="cv-minicard__nolink" title="Profile not available for this member">
            Profile {'→'}
          </span>
        )}
      </div>
    </div>,
    document.body
  );
}
