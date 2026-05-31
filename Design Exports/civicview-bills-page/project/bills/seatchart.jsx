/* ============================================================
   SeatChart — hemicycle info-graphic (the crux) · PASS 2
   · hue = party · fill = position (Yea solid / Nay outline /
     Present hatched / Not-voting gray) · rounded-square seats
   · ORDER: party-blocked (Dem left · Ind center · Rep right),
     state-sorted within each block so same-state seats cluster
   · 2-letter state label under each seat (or once per state-group)
   · roving tabindex: one seat tabbable, arrows move focus,
     Enter/Space opens the mini-card
   ============================================================ */
const { useRef: _useRef, useState: _useState, useMemo: _useMemo, useEffect: _useEffect, useCallback: _useCb } = React;

// ---- geometry: lay n seats on concentric arcs, return ordered left→right ----
function buildHemicycle(n, rows, r0, r1) {
  const radii = [], weights = [];
  let wsum = 0;
  for (let i = 0; i < rows; i++) {
    const r = r0 + (r1 - r0) * (rows === 1 ? 0 : i / (rows - 1));
    radii.push(r); weights.push(r); wsum += r;
  }
  const counts = weights.map((w) => Math.max(2, Math.round(n * w / wsum)));
  let diff = n - counts.reduce((a, b) => a + b, 0), idx = rows - 1;
  while (diff !== 0) { counts[idx] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1; idx = (idx - 1 + rows) % rows; }
  const seats = [];
  for (let i = 0; i < rows; i++) {
    const c = counts[i], r = radii[i];
    for (let j = 0; j < c; j++) {
      const t = c === 1 ? 0.5 : j / (c - 1);
      const ang = Math.PI - t * Math.PI;
      seats.push({ ang, r, row: i });
    }
  }
  // left → right, inner → outer  (angle-major: each state becomes a vertical wedge)
  seats.sort((a, b) => (b.ang - a.ang) || (a.r - b.r));
  return seats.slice(0, n);
}

const POS_LABEL = { yea: 'Yea', nay: 'Nay', present: 'Present', nv: 'Did not vote' };
const PARTY_RANK = { D: 0, I: 1, R: 2 };

// fill style per seat, honoring the locked encoding
function seatStyle(party, pos, hues) {
  const hue = hues[party] || '#adb5bd';
  if (pos === 'yea')     return { fill: hue, stroke: hue, sw: 1, hatch: false };
  if (pos === 'nay')     return { fill: '#ffffff', stroke: hue, sw: 1.6, hatch: false };
  if (pos === 'present') return { fill: 'url(#cv-hatch)', stroke: hue, sw: 1.2, hatch: true };
  return { fill: '#e9ecef', stroke: '#c4cad1', sw: 1, hatch: false }; // not voting
}

function SeatChart({ vote, hues, seatPx, interactive, onSelect, selectedIdx, labelMode }) {
  const wrapRef = _useRef(null);
  const [focusK, setFocusK] = _useState(0);

  const isHouse = vote.chamber === 'House';
  const rows = isHouse ? 13 : 4;
  const VBW = 820, VBH = isHouse ? 446 : 372;
  const cx = VBW / 2, cy = VBH - 30, maxR = VBW * (isHouse ? 0.455 : 0.42);
  const r0 = isHouse ? 0.40 : 0.48;
  const geo = _useMemo(() => buildHemicycle(vote.seats.length, rows, r0, 1.0), [vote.seats.length, rows, r0]);

  // party-blocked, state-sorted ordering → [{s, i(origIdx)}]
  const ordered = _useMemo(() => {
    const names = window.CV_STATE_NAMES || {};
    return vote.seats.map((s, i) => ({ s, i })).sort((a, b) => {
      const pr = PARTY_RANK[a.s.party] - PARTY_RANK[b.s.party];
      if (pr) return pr;
      const na = names[a.s.st] || a.s.st, nb = names[b.s.st] || b.s.st;
      if (na !== nb) return na < nb ? -1 : 1;
      return a.i - b.i;
    });
  }, [vote.seats]);

  // contiguous same-state runs (for per-group labels)
  const groupLabelK = _useMemo(() => {
    const set = new Set();
    let runStart = 0;
    for (let k = 1; k <= ordered.length; k++) {
      if (k === ordered.length || ordered[k].s.st !== ordered[runStart].s.st) {
        set.add(runStart + Math.floor((k - 1 - runStart) / 2)); // middle of the run
        runStart = k;
      }
    }
    return set;
  }, [ordered]);

  const sz = seatPx;
  const rx = Math.max(1.5, sz * 0.22);
  const labelFont = Math.max(4.6, Math.min(9, sz * 0.62));
  const showLabels = labelMode !== 'off';

  // precompute positions
  const pts = _useMemo(() => geo.map((g) => ({
    x: cx + Math.cos(g.ang) * g.r * maxR,
    y: cy - Math.sin(g.ang) * g.r * maxR
  })), [geo, cx, cy, maxR]);

  // keyboard roving (over chart order k)
  const onKey = _useCb((e) => {
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
      const el = wrapRef.current.querySelector('[data-k="' + focusK + '"]');
      if (el) onSelect(ordered[focusK].i, el);
      return;
    } else return;
    e.preventDefault();
    setFocusK(next);
    const el = wrapRef.current.querySelector('[data-k="' + next + '"]');
    if (el) el.focus();
  }, [focusK, interactive, ordered, isHouse, onSelect]);

  return (
    React.createElement('div', { className: 'cv-chart-wrap', ref: wrapRef, onKeyDown: interactive ? onKey : undefined },
      React.createElement('svg', {
        viewBox: '0 0 ' + VBW + ' ' + VBH, width: '100%',
        className: 'cv-hemi', role: interactive ? 'group' : 'img',
        'aria-label': interactive
          ? vote.chamber + ' roll-call seats — ' + vote.cite + '. ' + ordered.length + ' seats, Democrats on the left, Republicans on the right; use arrow keys to move, Enter to open a member.'
          : vote.chamber + ' vote outcome, ' + vote.tally.yea + ' yea to ' + vote.tally.nay + ' nay, ' + vote.result
      },
        React.createElement('defs', null,
          React.createElement('pattern', { id: 'cv-hatch', width: 3, height: 3, patternTransform: 'rotate(45)', patternUnits: 'userSpaceOnUse' },
            React.createElement('rect', { width: 3, height: 3, fill: '#ffffff' }),
            React.createElement('rect', { width: 1.3, height: 3, fill: '#8a93a0' })
          )
        ),
        // seats
        ordered.map((o, k) => {
          const s = o.s; const p = pts[k]; if (!p) return null;
          const st = seatStyle(s.party, s.pos, hues);
          const isSel = selectedIdx === o.i;
          const isTab = interactive && focusK === k;
          const aria = (s.name || (isHouse ? 'Representative' : 'Senator') + ' (' + s.st + ')')
            + ', ' + (s.party === 'R' ? 'Republican' : s.party === 'D' ? 'Democrat' : 'Independent')
            + ', ' + s.st + ', voted ' + POS_LABEL[s.pos];
          const drawLabel = showLabels && (labelMode === 'seat' || groupLabelK.has(k));
          return React.createElement('g', {
            key: k, 'data-k': k, 'data-si': o.i,
            tabIndex: interactive ? (isTab ? 0 : -1) : undefined,
            role: interactive ? 'button' : undefined,
            'aria-label': interactive ? aria : undefined,
            className: 'cv-seat' + (interactive ? ' is-int' : '') + (isSel ? ' is-sel' : ''),
            onClick: interactive ? (e) => { setFocusK(k); onSelect(o.i, e.currentTarget); } : undefined,
            onFocus: interactive ? () => setFocusK(k) : undefined,
            style: { cursor: interactive ? 'pointer' : 'default' }
          },
            isSel && React.createElement('rect', {
              x: (p.x - sz / 2 - 2.5).toFixed(1), y: (p.y - sz / 2 - 2.5).toFixed(1),
              width: sz + 5, height: sz + 5, rx: rx + 1.5, fill: 'none',
              stroke: 'var(--cl-accent)', strokeWidth: 2
            }),
            React.createElement('rect', {
              x: (p.x - sz / 2).toFixed(1), y: (p.y - sz / 2).toFixed(1),
              width: sz, height: sz, rx: rx,
              fill: st.fill, stroke: st.stroke, strokeWidth: st.sw
            }),
            drawLabel && React.createElement('text', {
              x: p.x.toFixed(1), y: (p.y + sz / 2 + labelFont + 0.5).toFixed(1),
              textAnchor: 'middle', className: 'cv-seat__lbl' + (labelMode === 'group' ? ' is-group' : ''),
              fontSize: labelMode === 'group' ? (labelFont + 1.4).toFixed(1) : labelFont.toFixed(1)
            }, s.st)
          );
        }),
        // center outcome
        React.createElement('text', { x: cx, y: cy - 60, textAnchor: 'middle', className: 'cv-hemi__margin' },
          vote.tally.yea + '\u2013' + vote.tally.nay),
        React.createElement('text', { x: cx, y: cy - 36, textAnchor: 'middle', className: 'cv-hemi__result' },
          vote.result.toUpperCase())
      )
    )
  );
}

window.SeatChart = SeatChart;
window.POS_LABEL = POS_LABEL;
window.seatStyle = seatStyle;
