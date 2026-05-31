// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

'use client';

/**
 * SeatChart — hemicycle info-graphic for a single roll-call (the crux).
 *   • hue = party · fill = position (Yea solid / Nay outline /
 *     Present hatched / Not-voting gray) · small rounded-square seats
 *   • order: party-blocked (Dem left · Ind center · Rep right),
 *     state-sorted within each block so same-state seats cluster
 *   • 2-letter state label under each seat (or once per state group)
 *   • roving tabindex: one seat tabbable, arrows move focus,
 *     Enter/Space opens the mini-card; the vote list is the
 *     screen-reader-complete equivalent.
 * Ported from the Claude Design export (Design Exports/civicview-bills-page).
 */
import { useRef, useState, useMemo, useCallback } from 'react';
import { POS_LABEL, PARTY_RANK } from './voteHelpers';
import { STATE_NAMES } from '@/lib/usStates';

// Lay n seats on concentric arcs, return ordered left→right, inner→outer.
function buildHemicycle(n, rows, r0, r1) {
  const radii = [];
  const weights = [];
  let wsum = 0;
  for (let i = 0; i < rows; i++) {
    const r = r0 + (r1 - r0) * (rows === 1 ? 0 : i / (rows - 1));
    radii.push(r);
    weights.push(r);
    wsum += r;
  }
  const counts = weights.map((w) => Math.max(2, Math.round((n * w) / wsum)));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  let idx = rows - 1;
  while (diff !== 0) {
    counts[idx] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
    idx = (idx - 1 + rows) % rows;
  }
  const seats = [];
  for (let i = 0; i < rows; i++) {
    const c = counts[i];
    const r = radii[i];
    for (let j = 0; j < c; j++) {
      const t = c === 1 ? 0.5 : j / (c - 1);
      const ang = Math.PI - t * Math.PI;
      seats.push({ ang, r, row: i });
    }
  }
  seats.sort((a, b) => b.ang - a.ang || a.r - b.r);
  return seats.slice(0, n);
}

// Fill style per seat, honoring the locked encoding.
function seatStyle(party, pos, hues) {
  const hue = hues[party] || '#adb5bd';
  if (pos === 'yea') return { fill: hue, stroke: hue, sw: 1 };
  if (pos === 'nay') return { fill: '#ffffff', stroke: hue, sw: 1.6 };
  if (pos === 'present') return { fill: 'url(#cv-hatch)', stroke: hue, sw: 1.2 };
  return { fill: '#e9ecef', stroke: '#c4cad1', sw: 1 }; // not voting
}

export default function SeatChart({
  vote,
  hues,
  seatPx,
  interactive,
  onSelect,
  selectedIdx,
  labelMode = 'seat',
}) {
  const wrapRef = useRef(null);
  const [focusK, setFocusK] = useState(0);

  const isHouse = vote.chamber === 'House';
  const rows = isHouse ? 13 : 4;
  const VBW = 820;
  const VBH = isHouse ? 446 : 372;
  const cx = VBW / 2;
  const cy = VBH - 30;
  const maxR = VBW * (isHouse ? 0.455 : 0.42);
  const r0 = isHouse ? 0.4 : 0.48;

  const geo = useMemo(
    () => buildHemicycle(vote.seats.length, rows, r0, 1.0),
    [vote.seats.length, rows, r0]
  );

  // party-blocked, state-sorted ordering → [{ s, i(origIdx) }]
  const ordered = useMemo(() => {
    return vote.seats
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const pr = PARTY_RANK[a.s.party] - PARTY_RANK[b.s.party];
        if (pr) return pr;
        const na = STATE_NAMES[a.s.st] || a.s.st;
        const nb = STATE_NAMES[b.s.st] || b.s.st;
        if (na !== nb) return na < nb ? -1 : 1;
        return a.i - b.i;
      });
  }, [vote.seats]);

  // contiguous same-state runs (for per-group labels)
  const groupLabelK = useMemo(() => {
    const set = new Set();
    let runStart = 0;
    for (let k = 1; k <= ordered.length; k++) {
      if (k === ordered.length || ordered[k].s.st !== ordered[runStart].s.st) {
        set.add(runStart + Math.floor((k - 1 - runStart) / 2));
        runStart = k;
      }
    }
    return set;
  }, [ordered]);

  const sz = seatPx;
  const rx = Math.max(1.5, sz * 0.22);
  const labelFont = Math.max(4.6, Math.min(9, sz * 0.62));
  const showLabels = labelMode !== 'off';

  const pts = useMemo(
    () =>
      geo.map((g) => ({
        x: cx + Math.cos(g.ang) * g.r * maxR,
        y: cy - Math.sin(g.ang) * g.r * maxR,
      })),
    [geo, cx, cy, maxR]
  );

  const onKey = useCallback(
    (e) => {
      if (!interactive) return;
      const n = ordered.length;
      let next = focusK;
      if (e.key === 'ArrowRight') next = Math.min(n - 1, focusK + 1);
      else if (e.key === 'ArrowLeft') next = Math.max(0, focusK - 1);
      else if (e.key === 'ArrowDown') next = Math.min(n - 1, focusK + (isHouse ? 22 : 10));
      else if (e.key === 'ArrowUp') next = Math.max(0, focusK - (isHouse ? 22 : 10));
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = n - 1;
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const el = wrapRef.current && wrapRef.current.querySelector('[data-k="' + focusK + '"]');
        if (el) onSelect(ordered[focusK].i, el);
        return;
      } else return;
      e.preventDefault();
      setFocusK(next);
      const el = wrapRef.current && wrapRef.current.querySelector('[data-k="' + next + '"]');
      if (el) el.focus();
    },
    [focusK, interactive, ordered, isHouse, onSelect]
  );

  const ariaLabel = interactive
    ? `${vote.chamber} roll-call seats — ${vote.cite}. ${ordered.length} seats, Democrats on the left, Republicans on the right; use arrow keys to move, Enter to open a member.`
    : `${vote.chamber} vote outcome, ${vote.tally.yea} yea to ${vote.tally.nay} nay, ${vote.result}.`;

  return (
    <div className="cv-chart-wrap" ref={wrapRef} onKeyDown={interactive ? onKey : undefined}>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        width="100%"
        className="cv-hemi"
        role={interactive ? 'group' : 'img'}
        aria-label={ariaLabel}
      >
        <defs>
          <pattern
            id="cv-hatch"
            width="3"
            height="3"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="3" height="3" fill="#ffffff" />
            <rect width="1.3" height="3" fill="#8a93a0" />
          </pattern>
        </defs>

        {ordered.map((o, k) => {
          const s = o.s;
          const p = pts[k];
          if (!p) return null;
          const st = seatStyle(s.party, s.pos, hues);
          const isSel = selectedIdx === o.i;
          const isTab = interactive && focusK === k;
          const partyName = s.party === 'R' ? 'Republican' : s.party === 'D' ? 'Democrat' : 'Independent';
          const seatName = s.name || `${isHouse ? 'Representative' : 'Senator'} (${s.st})`;
          const aria = `${seatName}, ${partyName}, ${s.st}, voted ${POS_LABEL[s.pos]}`;
          const drawLabel = showLabels && (labelMode === 'seat' || groupLabelK.has(k));
          return (
            <g
              key={k}
              data-k={k}
              data-si={o.i}
              tabIndex={interactive ? (isTab ? 0 : -1) : undefined}
              role={interactive ? 'button' : undefined}
              aria-label={interactive ? aria : undefined}
              className={'cv-seat' + (interactive ? ' is-int' : '') + (isSel ? ' is-sel' : '')}
              onClick={interactive ? (e) => { setFocusK(k); onSelect(o.i, e.currentTarget); } : undefined}
              onFocus={interactive ? () => setFocusK(k) : undefined}
              style={{ cursor: interactive ? 'pointer' : 'default' }}
            >
              {isSel && (
                <rect
                  x={(p.x - sz / 2 - 2.5).toFixed(1)}
                  y={(p.y - sz / 2 - 2.5).toFixed(1)}
                  width={sz + 5}
                  height={sz + 5}
                  rx={rx + 1.5}
                  fill="none"
                  stroke="var(--cl-accent)"
                  strokeWidth={2}
                />
              )}
              <rect
                x={(p.x - sz / 2).toFixed(1)}
                y={(p.y - sz / 2).toFixed(1)}
                width={sz}
                height={sz}
                rx={rx}
                fill={st.fill}
                stroke={st.stroke}
                strokeWidth={st.sw}
              />
              {drawLabel && (
                <text
                  x={p.x.toFixed(1)}
                  y={(p.y + sz / 2 + labelFont + 0.5).toFixed(1)}
                  textAnchor="middle"
                  className={'cv-seat__lbl' + (labelMode === 'group' ? ' is-group' : '')}
                  fontSize={(labelMode === 'group' ? labelFont + 1.4 : labelFont).toFixed(1)}
                >
                  {s.st}
                </text>
              )}
            </g>
          );
        })}

        <text x={cx} y={cy - 60} textAnchor="middle" className="cv-hemi__margin">
          {vote.tally.yea + '–' + vote.tally.nay}
        </text>
        <text x={cx} y={cy - 36} textAnchor="middle" className="cv-hemi__result">
          {(vote.result || '').toUpperCase()}
        </text>
      </svg>
    </div>
  );
}
