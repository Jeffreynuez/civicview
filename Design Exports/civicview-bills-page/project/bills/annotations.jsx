/* ============================================================
   Annotation layer (PASS 2): numbered pins at component anchors
   (toggleable) + a slide-over panel resolving pass-2 decisions
   and the items called out to "decide & annotate".
   ============================================================ */
const { useState: _aState } = React;

const ANNO = {
  1: { t: 'Hero band', d: 'Reuses the /polls hero — --cl-primary (#1b263b) ground, on-dark eyebrow / title / sub. Body sits on --cl-bg in a centered max-width column.' },
  2: { t: 'Chamber toggle = TabStrip', d: 'ProfileView TabStrip. Active = --cl-accent text + 2px accent underline + 600; inactive = --cl-text-light. Defaults to the chamber with the newest qualifying vote.' },
  3: { t: 'Recent-votes selector', d: 'Popover (--cl-radius-lg, --cl-shadow-pop). Row = citation · question · date · result chip. Picking one swaps header + chart + list (URL updates in prod).' },
  4: { t: 'Vote header card', d: '--cl-card / 1px --cl-border / --cl-radius-2xl / --cl-shadow-card. Citation (.cl-h2) + type, right status chip, plain-language question, tally bar, by-party line + date.' },
  5: { t: 'Tally bar — classic', d: 'Pass 2: reverted to classic green Yea / red Nay (Jeffrey\u2019s call). Deliberately a SOLID bar in success/danger tones — distinct from the seat encoding (party hue + fill) so bar and chart read as two separate things. Counts .cl-num.' },
  6: { t: 'Seat chart — organized', d: 'Party-blocked: Democrats left, Republicans right, Independents adjacent to their caucus (center). Sorted by state within each block, so same-state seats sit together as a vertical wedge. Even concentric rows. Standard seat size, rounded square.' },
  7: { t: 'Labels + fill encoding', d: 'A 2-letter state label sits under each seat (Tweaks → Seat labels: per-seat vs per-group). Fill = position: Yea solid · Nay outline · Present hatch · Not-voting grey — never colour alone; reads in greyscale. Labels are a supplementary cue; the aria-label carries the full record.' },
  8: { t: 'Seat mini-card', d: 'IdentityPicker model: portaled, fixed, measured + flipped, dismiss on click-outside + Esc, focus returns to opener. Photo (initials) + name + party·state + position pill + "View profile →" to the ProfileView window (NOT the engagement page).' },
  9: { t: 'Full record — condensed', d: 'Two columns (single on mobile), row-major DOM. Status icon only (✓ Yea / ✕ Nay / ⊘ Present / – did-not-vote), state abbr, party badge, member initials. No trailing arrow — whole row opens the mini-card. Pager top + bottom; House 5 pages, Senate 1. Search spans all 435 and jumps to page 1 of matches. CSV exports the full record.' },
  10: { t: 'Keyboard / roving tabindex', d: 'The 100–435 seats are ONE composite widget: one seat tabbable; arrows move focus (←/→ seat, ↑/↓ row), Home/End jump, Enter/Space opens the mini-card. role="group" + aria-label naming chamber + bill + the left/right party layout.' }
};

function AnnoPin({ n, show }) {
  const [open, setOpen] = _aState(false);
  if (!show) return null;
  const a = ANNO[n];
  return React.createElement('span', { className: 'cv-pin-wrap' },
    React.createElement('button', {
      className: 'cv-pin', 'aria-label': 'Annotation ' + n + ': ' + a.t,
      onClick: (e) => { e.stopPropagation(); setOpen(!open); },
      onBlur: () => setOpen(false)
    }, n),
    open && React.createElement('span', { className: 'cv-pin-note', role: 'tooltip' },
      React.createElement('strong', null, a.t),
      React.createElement('span', null, a.d)
    )
  );
}
window.AnnoPin = AnnoPin;

function RPItem({ n, h, children }) {
  return React.createElement('div', { className: 'cv-rp__q' },
    React.createElement('span', { className: 'cv-rp__num' }, n),
    React.createElement('div', null, React.createElement('h3', null, h), children)
  );
}

function ResolvedPanel({ open, onClose }) {
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'cv-rp-scrim' + (open ? ' is-open' : ''), onClick: onClose, 'aria-hidden': 'true' }),
    React.createElement('aside', {
      className: 'cv-rp' + (open ? ' is-open' : ''),
      'aria-label': 'Resolved decisions and annotations', 'aria-hidden': !open
    },
      React.createElement('div', { className: 'cv-rp__head' },
        React.createElement('div', null,
          React.createElement('p', { className: 'cl-eyebrow' }, 'Design handoff · Phase A · pass 2'),
          React.createElement('h2', { className: 'cv-rp__title' }, 'Decisions & annotations')
        ),
        React.createElement('button', { className: 'cv-rp__close', onClick: onClose, 'aria-label': 'Close panel' }, '\u2715')
      ),
      React.createElement('div', { className: 'cv-rp__body' },

        React.createElement('p', { className: 'cl-eyebrow' }, 'Resolved this pass'),

        React.createElement(RPItem, { n: '1', h: 'Seat chart — organized' },
          React.createElement('p', null, React.createElement('strong', null, 'Party-blocked, state-sorted.'), ' Democrats left, Republicans right, Independents adjacent to their caucus (center). Within each block, sorted by state so a state\u2019s seats form one contiguous vertical wedge. Even concentric rows; standard seat size. This replaces pass-1\u2019s scattered, speckled look.'),
          React.createElement('p', { className: 'cv-rp__alt' }, 'Senate rebuilt the same way — tidy rows, each state\u2019s 2 seats grouped.')
        ),
        React.createElement(RPItem, { n: '2', h: 'Per-seat state labels' },
          React.createElement('p', null, 'A 2-letter state label sits under every seat. It\u2019s a ', React.createElement('em', null, 'supplementary'), ' cue — the per-seat aria-label still carries full name + state + position, so micro-text is never the only way to ID a seat. This drives the seat spacing and the mobile scroll.'),
          React.createElement('p', { className: 'cv-rp__alt' }, 'Tweaks → Seat labels toggles per-seat vs per-group vs off — see annotation #2 below.')
        ),
        React.createElement(RPItem, { n: '3', h: 'Tally tones — classic' },
          React.createElement('p', null, React.createElement('strong', null, 'Green Yea / red Nay'), ' (--cl-accent / --cl-danger). Kept as a solid bar in success/danger tones so it stays visually distinct from the seat encoding (party hue + fill).')
        ),
        React.createElement(RPItem, { n: '4', h: 'Mobile' },
          React.createElement('p', null, React.createElement('strong', null, 'Horizontally-scrollable full chart'), ' with extra seat separation so labels stay legible, plus a clear scroll affordance (edge fade + arrows). The list drops to a single column and is the primary find-a-member tool; the chart is the at-a-glance outcome.')
        ),

        React.createElement('p', { className: 'cl-eyebrow', style: { marginTop: '4px' } }, 'Decided & annotated'),

        React.createElement('div', { className: 'cv-rp__note' },
          React.createElement('h4', null, '1 · Present glyph'),
          React.createElement('p', null, 'List uses ', React.createElement('strong', null, '\u2298'), ' (circled slash) in the warning tone — distinct from ', React.createElement('strong', null, '\u2013'), ' did-not-vote (grey), ', React.createElement('strong', null, '\u2713'), ' Yea, ', React.createElement('strong', null, '\u2715'), ' Nay. The chart keeps the hatched-fill seat for Present.')
        ),
        React.createElement('div', { className: 'cv-rp__note' },
          React.createElement('h4', null, '2 · Per-seat vs per-group labels'),
          React.createElement('p', null, 'Both shipped (Tweaks → Seat labels). Per-seat repeats the abbr down each state wedge — fine on small delegations, busy on CA ×52. Per-group prints one bold label at each state\u2019s center — much cleaner. ', React.createElement('strong', null, 'Recommend per-group as the production default'), ', per-seat as an opt-in.')
        ),
        React.createElement('div', { className: 'cv-rp__note' },
          React.createElement('h4', null, '3 · Legend at mobile width'),
          React.createElement('p', null, 'Six seat states wrap to two centered rows on a phone rather than squeezing one line — confirmed legible, no awkward mid-item break.')
        ),
        React.createElement('div', { className: 'cv-rp__note' },
          React.createElement('h4', null, '4 · Senate independents'),
          React.createElement('p', null, 'Hue = --cl-independent (purple). Seated adjacent to their caucus (center-left, next to the Democrats). Labeled \u201Ccaucuses with D\u201D in the by-party line, a caucus tag in the list, and the mini-card.')
        ),
        React.createElement('div', { className: 'cv-rp__note' },
          React.createElement('h4', null, '5 · Two-column reading order'),
          React.createElement('p', null, 'The grid uses ', React.createElement('code', null, 'grid-auto-flow: row'), ' so DOM order is row-major (left, right, next row) — keyboard/SR traversal reads sensibly across the two columns.')
        ),

        React.createElement('div', { className: 'cv-rp__tok' },
          React.createElement('p', { className: 'cl-eyebrow' }, 'Token references'),
          React.createElement('ul', null,
            React.createElement('li', null, React.createElement('code', null, '--cl-primary'), ' hero · ', React.createElement('code', null, '--cl-accent'), ' toggle/links/Yea bar'),
            React.createElement('li', null, React.createElement('code', null, '--cl-republican / --cl-democrat / --cl-independent'), ' seat hue'),
            React.createElement('li', null, React.createElement('code', null, '--cl-danger'), ' Nay bar · ', React.createElement('code', null, '--cl-success-text'), ' Passed text (AA-safe)'),
            React.createElement('li', null, React.createElement('code', null, '--cl-warning-*'), ' Present glyph · ', React.createElement('code', null, '--cl-bg-soft'), ' did-not-vote'),
            React.createElement('li', null, React.createElement('code', null, '--cl-radius-* · --cl-shadow-card/-pop · --cl-shadow-focus'), ' seat ring')
          )
        ),

        React.createElement('div', { className: 'cv-rp__a11y' },
          React.createElement('p', { className: 'cl-eyebrow' }, 'Accessibility (P0)'),
          React.createElement('p', null, 'Roving tabindex over seats · per-seat aria-label \u201C{Name}, {Party}, {State}, voted {Position}\u201D · the list is the SR-complete equivalent (now paginated; search spans all members) · position encoded by fill not colour · mini-card role="dialog" with focus return · 44px row + link targets · hover-lift off under prefers-reduced-motion.')
        )
      )
    )
  );
}
window.ResolvedPanel = ResolvedPanel;
