/* ============================================================
   SeatMiniCard — popover anchored to a seat or list row.
   Reuses the IdentityPicker model: portaled to body, fixed,
   measured + flipped to stay on-screen, dismiss on click-outside
   + Esc, focus moves in on open and returns to opener on close.
   ============================================================ */
const { useRef: _mUseRef, useState: _mState, useLayoutEffect: _mLayout, useEffect: _mEffect } = React;

function partyWord(p) { return p === 'R' ? 'Republican' : p === 'D' ? 'Democrat' : p === 'I' ? 'Independent' : 'Unknown'; }
function partyHueVar(p) { return p === 'R' ? 'var(--cl-republican)' : p === 'D' ? 'var(--cl-democrat)' : p === 'I' ? 'var(--cl-independent)' : 'var(--cl-text-muted)'; }
function partySoftVar(p) { return p === 'R' ? 'var(--cl-republican-soft)' : p === 'D' ? 'var(--cl-democrat-soft)' : p === 'I' ? 'var(--cl-independent-soft)' : 'var(--cl-bg-soft)'; }

function initials(name) {
  if (!name) return '–';
  // "Donalds, Byron" -> BD
  const parts = name.replace(',', '').split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[1][0] + parts[0][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
function displayName(seat, chamber) {
  return seat.name || ((chamber === 'House' ? 'Representative' : 'Senator') + ' · ' + seat.st);
}

function PositionPill({ pos, small }) {
  const map = {
    yea: { bg: 'var(--cl-success-soft)', fg: 'var(--cl-success-text)', t: 'Voted Yea', mk: '\u2713' },
    nay: { bg: 'var(--cl-bg-soft)', fg: 'var(--cl-text)', t: 'Voted Nay', mk: '\u2715' },
    present: { bg: 'var(--cl-warning-soft)', fg: 'var(--cl-warning-text)', t: 'Present', mk: '\u25A4' },
    nv: { bg: 'var(--cl-bg-soft)', fg: 'var(--cl-text-muted)', t: 'Did not vote', mk: '\u2014' }
  };
  const m = map[pos] || map.nv;
  return React.createElement('span', {
    className: 'cv-pospill', style: {
      background: m.bg, color: m.fg,
      fontSize: small ? '0.62rem' : '0.68rem'
    }
  }, React.createElement('span', { 'aria-hidden': 'true', style: { marginRight: 4, fontWeight: 700 } }, m.mk), m.t);
}
window.PositionPill = PositionPill;
window.partyWord = partyWord; window.partyHueVar = partyHueVar; window.initials = initials; window.displayName = displayName;

function SeatMiniCard({ seat, chamber, anchorEl, idx, onClose }) {
  const cardRef = _mUseRef(null);
  const [pos, setPos] = _mState({ left: -9999, top: -9999, ready: false });
  // resolve a robust anchor: passed node, else the seat by data-si, else chart card
  const anchor = (anchorEl && anchorEl.getBoundingClientRect && anchorEl.isConnected ? anchorEl : null)
    || document.querySelector('.cv-seat[data-si="' + idx + '"]')
    || document.querySelector('.cv-chartcard');

  _mLayout(() => {
    if (!anchor || !cardRef.current) return;
    const a = anchor.getBoundingClientRect();
    const c = cardRef.current.getBoundingClientRect();
    const gap = 10, pad = 12;
    let left = a.left + a.width / 2 - c.width / 2;
    let top = a.bottom + gap;
    // flip vertical if no room below
    if (top + c.height > window.innerHeight - pad) {
      const above = a.top - gap - c.height;
      if (above > pad) top = above;
      else top = Math.max(pad, window.innerHeight - c.height - pad);
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - c.width - pad));
    setPos({ left, top, ready: true });
  }, [anchor, seat]);

  _mEffect(() => {
    const onDoc = (e) => { if (cardRef.current && !cardRef.current.contains(e.target) && e.target !== anchor) onClose(); };
    const onEsc = (e) => { if (e.key === 'Escape') { onClose(); if (anchor && anchor.focus) anchor.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    // move focus in
    const t = setTimeout(() => { if (cardRef.current) { const f = cardRef.current.querySelector('a,button'); if (f) f.focus(); } }, 0);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); clearTimeout(t); };
  }, [anchor, onClose]);

  if (!seat) return null;
  const hue = partyHueVar(seat.party);
  const stName = (window.CV_STATE_NAMES && window.CV_STATE_NAMES[seat.st]) || seat.st;
  const caucusNote = seat.party === 'I' && seat.caucus ? ' · caucuses with ' + (seat.caucus === 'D' ? 'Democrats' : 'Republicans') : '';
  const isExemplar = !!seat.name;

  return ReactDOM.createPortal(
    React.createElement('div', {
      ref: cardRef, className: 'cv-minicard', role: 'dialog',
      'aria-label': displayName(seat, chamber) + ' vote detail',
      style: {
        left: pos.left, top: pos.top,
        transform: pos.ready ? 'translateY(0)' : 'translateY(4px)'
      }
    },
      React.createElement('div', { className: 'cv-minicard__head' },
        React.createElement('div', {
          className: 'cv-minicard__avatar',
          style: { background: partySoftVar(seat.party), color: hue }
        }, initials(seat.name)),
        React.createElement('div', { style: { minWidth: 0 } },
          React.createElement('p', { className: 'cv-minicard__name', title: displayName(seat, chamber) }, displayName(seat, chamber)),
          React.createElement('p', { className: 'cv-minicard__meta' },
            React.createElement('span', { style: { color: hue, fontWeight: 600 } }, partyWord(seat.party)),
            ' · ' + stName + (seat.dist && seat.dist !== seat.st ? ' (' + seat.dist + ')' : '') + caucusNote
          )
        )
      ),
      React.createElement('div', { className: 'cv-minicard__foot' },
        React.createElement(PositionPill, { pos: seat.pos }),
        isExemplar
          ? React.createElement('a', { href: '#profile', className: 'cv-minicard__link', onClick: (e) => e.preventDefault() },
              'View profile ', React.createElement('span', { 'aria-hidden': 'true' }, '\u2192'))
          : React.createElement('span', { className: 'cv-minicard__nolink', title: 'Profile data not seeded in this prototype' }, 'Profile \u2192')
      )
    ),
    document.body
  );
}
window.SeatMiniCard = SeatMiniCard;
