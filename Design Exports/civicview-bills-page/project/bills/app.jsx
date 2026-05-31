/* ============================================================
   App — composes the /bills page (PASS 2). Owns chamber/vote/
   selection state, the desktop⇄mobile device toggle, the
   annotation layer, and the Tweaks (tally tones · seat labels ·
   seat size). Mobile = horizontally-scrollable full chart.
   ============================================================ */
const { useState: aUse, useMemo: aMemo, useRef: aRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "tallyTones": "classic",
  "seatLabels": "seat",
  "seatSize": "standard"
}/*EDITMODE-END*/;

// Tally tones — Jeffrey's pick is classic (green Yea / red Nay). Kept distinct
// from the seat encoding (party hue + fill) so bar and chart read separately.
const TONE_SETS = {
  classic: { yea:'#2d6a4f', yeaFg:'#fff', nay:'#d63031', nayFg:'#fff', nv:'#dde1e6', nvFg:'#6c757d', label:'Green / red' },
  mono:    { yea:'#1a1a2e', yeaFg:'#fff', nay:'#cdd2d8', nayFg:'#1a1a2e', nv:'#edf0f2', nvFg:'#6c757d', label:'Charcoal / grey' },
  slate:   { yea:'#34435c', yeaFg:'#fff', nay:'#c2b1a0', nayFg:'#3a2f26', nv:'#edf0f2', nvFg:'#6c757d', label:'Slate / clay' }
};

function seatPxFor(chamber, sizeKey, device) {
  const base = { compact: 10, standard: 13, large: 16 }[sizeKey] || 13;
  return chamber === 'Senate' ? base * 1.7 : base;
}

function HarnessBar({ device, setDevice, annos, setAnnos, openPanel }) {
  return React.createElement('div', { className: 'cv-harness' },
    React.createElement('span', { className: 'cv-harness__tag' }, 'Prototype'),
    React.createElement('div', { className: 'cv-seg' },
      ['desktop', 'mobile'].map((d) => React.createElement('button', {
        key: d, className: 'cv-seg__btn' + (device === d ? ' is-on' : ''), onClick: () => setDevice(d)
      }, d === 'desktop' ? 'Desktop' : 'Mobile'))
    ),
    React.createElement('label', { className: 'cv-harness__toggle' },
      React.createElement('input', { type: 'checkbox', checked: annos, onChange: (e) => setAnnos(e.target.checked) }),
      'Annotations'
    ),
    React.createElement('button', { className: 'cv-harness__btn', onClick: openPanel },
      'Resolved questions \u2192')
  );
}

function Navbar() {
  return React.createElement('header', { className: 'cv-nav' },
    React.createElement('div', { className: 'cv-nav__logo' },
      React.createElement('img', { src: 'assets/civicview-glyph-color.svg', alt: '', width: 26, height: 26 }),
      React.createElement('span', null, 'CivicView')
    ),
    React.createElement('div', { className: 'cv-nav__search' },
      React.createElement('span', { 'aria-hidden': 'true' }, '\u2315'),
      React.createElement('input', { placeholder: 'Search reps, bills, votes', 'aria-label': 'Search' }),
      React.createElement('span', { className: 'cv-nav__kbd' }, '/')
    ),
    React.createElement('nav', { className: 'cv-nav__links' },
      React.createElement('a', { className: 'cv-nav__link is-active', href: '#' }, 'Bills'),
      React.createElement('a', { className: 'cv-nav__link', href: '#' }, 'Map'),
      React.createElement('a', { className: 'cv-nav__link', href: '#' }, 'Polls')
    ),
    React.createElement('div', { className: 'cv-nav__id' },
      React.createElement('span', { className: 'cv-nav__id-name' }, 'Maria H.'),
      React.createElement('span', { className: 'cv-nav__id-scope' }, 'FL-19')
    )
  );
}

// Horizontally-scrollable chart shell with edge fades + arrow controls (mobile)
function ChartScroller({ children, chamber }) {
  const ref = aRef(null);
  const by = (d) => { if (ref.current) ref.current.scrollBy({ left: d, behavior: 'smooth' }); };
  return React.createElement('div', { className: 'cv-scrollwrap' },
    React.createElement('div', { className: 'cv-scroll cv-scroll--' + chamber.toLowerCase(), ref: ref }, children),
    React.createElement('div', { className: 'cv-scroll__fade cv-scroll__fade--l', 'aria-hidden': 'true' }),
    React.createElement('div', { className: 'cv-scroll__fade cv-scroll__fade--r', 'aria-hidden': 'true' }),
    React.createElement('button', { className: 'cv-scroll__arw cv-scroll__arw--l', 'aria-label': 'Scroll chart left', onClick: () => by(-240) }, '\u2039'),
    React.createElement('button', { className: 'cv-scroll__arw cv-scroll__arw--r', 'aria-label': 'Scroll chart right', onClick: () => by(240) }, '\u203A')
  );
}

function BillsApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [device, setDevice] = aUse('desktop');
  const [chamber, setChamber] = aUse('House');
  const [annos, setAnnos] = aUse(true);
  const [panel, setPanel] = aUse(false);
  const [sel, setSel] = aUse({ idx: null, anchor: null });

  const vote = chamber === 'House' ? window.CV_DATA.house : window.CV_DATA.senate;
  const hues = window.CV_PARTY;
  const tones = TONE_SETS[t.tallyTones] || TONE_SETS.classic;
  const isMobile = device === 'mobile';
  const seatPx = seatPxFor(chamber, t.seatSize, device);

  // PASS 2 resolved: mobile = scrollable full chart (non-interactive, at-a-glance),
  // list is the primary find-a-member tool. Desktop/tablet = interactive fit-to-width.
  const chartInteractive = !isMobile;
  const listPrimary = isMobile;

  const parties = chamber === 'Senate' ? ['R', 'D', 'I'] : ['R', 'D'];

  const pick = (idx, anchor) => setSel({ idx, anchor });
  const closeCard = () => setSel({ idx: null, anchor: null });
  const onChamber = (c) => { setChamber(c); closeCard(); };
  const onPickVote = () => { closeCard(); };

  const chartEl = React.createElement(SeatChart, {
    vote: vote, hues: hues, seatPx: seatPx,
    interactive: chartInteractive, onSelect: pick, selectedIdx: sel.idx, labelMode: t.seatLabels
  });

  const stage = React.createElement('div', { className: 'cv-stage' + (isMobile ? ' is-mobile' : '') },
    React.createElement(Navbar, null),
    React.createElement('div', { className: 'cv-hero' },
      React.createElement('div', { className: 'cv-hero__inner' },
        React.createElement('span', { className: 'cv-pin-anchor' }, React.createElement(AnnoPin, { n: 1, show: annos })),
        React.createElement('p', { className: 'cv-hero__eyebrow' }, 'Federal legislation'),
        React.createElement('h1', { className: 'cv-hero__title' }, 'Bills & Votes'),
        React.createElement('p', { className: 'cv-hero__sub' }, 'See how Congress voted — pick a chamber and a vote.')
      )
    ),
    React.createElement('div', { className: 'cv-body' },
      React.createElement('div', { className: 'cv-controls' },
        React.createElement('div', { className: 'cv-controls__l' },
          React.createElement(AnnoPin, { n: 2, show: annos }),
          React.createElement(ChamberToggle, { value: chamber, onChange: onChamber })
        ),
        React.createElement('div', { className: 'cv-controls__r' },
          React.createElement(AnnoPin, { n: 3, show: annos }),
          React.createElement(RecentSelector, { chamber: chamber, current: vote.cite, onPick: onPickVote })
        )
      ),

      React.createElement('div', { className: 'cv-anchored' },
        React.createElement('span', { className: 'cv-pin-float' }, React.createElement(AnnoPin, { n: 4, show: annos })),
        React.createElement(VoteHeader, { vote: vote, tones: tones }),
        React.createElement('span', { className: 'cv-pin-float cv-pin-float--tally' }, React.createElement(AnnoPin, { n: 5, show: annos }))
      ),

      React.createElement('section', { className: 'cv-card cv-chartcard' },
        React.createElement('div', { className: 'cv-chartcard__head' },
          React.createElement('div', null,
            React.createElement('p', { className: 'cl-eyebrow' }, chamber + ' roll-call'),
            React.createElement('p', { className: 'cv-chartcard__sub' },
              chartInteractive
                ? 'Democrats left · Republicans right, sorted by state. Click or arrow-key a seat.'
                : 'At-a-glance outcome — scroll to read state labels; use the list below to open a member.')
          ),
          React.createElement('div', { className: 'cv-chartcard__pins' },
            React.createElement(AnnoPin, { n: 6, show: annos }),
            React.createElement(AnnoPin, { n: 7, show: annos }),
            chartInteractive && React.createElement(AnnoPin, { n: 10, show: annos })
          )
        ),
        isMobile
          ? React.createElement(ChartScroller, { chamber: chamber }, chartEl)
          : chartEl,
        React.createElement(Legend, { hues: hues, parties: parties })
      ),

      React.createElement('div', { className: 'cv-anchored' },
        React.createElement('span', { className: 'cv-pin-float' }, React.createElement(AnnoPin, { n: listPrimary ? 9 : 8, show: annos })),
        React.createElement(VoteList, { vote: vote, onPick: pick, mobilePrimary: listPrimary })
      ),

      React.createElement('p', { className: 'cv-foot' },
        'Synthetic data for design review · ', vote.cite, ' · seats encode hue = party, fill = position · ',
        chamber === 'House' ? '435 seats' : '100 seats')
    ),

    sel.idx != null && React.createElement(SeatMiniCard, {
      seat: vote.seats[sel.idx], chamber: chamber, anchorEl: sel.anchor, idx: sel.idx, onClose: closeCard
    })
  );

  return React.createElement(React.Fragment, null,
    React.createElement(HarnessBar, { device, setDevice, annos, setAnnos, openPanel: () => setPanel(true) }),
    React.createElement('div', { className: 'cv-viewport' + (isMobile ? ' is-mobile' : '') },
      isMobile
        ? React.createElement('div', { className: 'cv-phone' }, React.createElement('div', { className: 'cv-phone__scroll' }, stage))
        : stage
    ),
    React.createElement(ResolvedPanel, { open: panel, onClose: () => setPanel(false) }),

    React.createElement(TweaksPanel, null,
      React.createElement(TweakSection, { label: 'Pass-2 variations' }),
      React.createElement(TweakRadio, {
        label: 'Tally tones', value: t.tallyTones,
        options: ['classic', 'mono', 'slate'],
        onChange: (v) => setTweak('tallyTones', v)
      }),
      React.createElement(TweakRadio, {
        label: 'Seat labels', value: t.seatLabels,
        options: [{ value: 'seat', label: 'Per seat' }, { value: 'group', label: 'Per group' }, { value: 'off', label: 'Off' }],
        onChange: (v) => setTweak('seatLabels', v)
      }),
      React.createElement(TweakRadio, {
        label: 'Seat size', value: t.seatSize,
        options: ['compact', 'standard', 'large'],
        onChange: (v) => setTweak('seatSize', v)
      }),
      React.createElement('p', { className: 'cv-tweak-note' },
        'Seat labels: compare per-seat (every square) vs per-group (one label per state). Switch the device toggle to Mobile to see the scrollable chart.')
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BillsApp));
