/* ============================================================
   Bills page components: status chip, chamber TabStrip,
   recent-votes selector, vote header card + tally bar, legend,
   and the vote list (the accessible equivalent of the chart).
   ============================================================ */
const { useState: _cState, useRef: _cRef, useEffect: _cEffect, useMemo: _cMemo } = React;

window.CV_STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',
  DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',
  MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
  TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',
  WI:'Wisconsin',WY:'Wyoming'
};

// ---------- Status chip ----------
function StatusChip({ status }) {
  const map = {
    Passed:    { bg: 'var(--cl-success-soft)', fg: 'var(--cl-success-text)', bd: 'var(--cl-success-border)' },
    Confirmed: { bg: 'var(--cl-success-soft)', fg: 'var(--cl-success-text)', bd: 'var(--cl-success-border)' },
    Failed:    { bg: 'var(--cl-danger-soft)',  fg: 'var(--cl-danger-text)',  bd: 'var(--cl-danger-border)' },
    Rejected:  { bg: 'var(--cl-danger-soft)',  fg: 'var(--cl-danger-text)',  bd: 'var(--cl-danger-border)' },
    Upcoming:  { bg: 'var(--cl-warning-soft)', fg: 'var(--cl-warning-text)', bd: 'var(--cl-warning-border)' }
  };
  const m = map[status] || map.Passed;
  return React.createElement('span', {
    className: 'cv-status', style: { background: m.bg, color: m.fg, borderColor: m.bd }
  }, status);
}
window.StatusChip = StatusChip;

// ---------- Chamber TabStrip ----------
function ChamberToggle({ value, onChange }) {
  return React.createElement('div', { className: 'cv-tabstrip', role: 'tablist', 'aria-label': 'Chamber' },
    ['Senate', 'House'].map((c) =>
      React.createElement('button', {
        key: c, role: 'tab', 'aria-selected': value === c,
        className: 'cv-tab' + (value === c ? ' is-active' : ''),
        onClick: () => onChange(c)
      }, c)
    )
  );
}
window.ChamberToggle = ChamberToggle;

// ---------- Recent-votes selector ----------
function RecentSelector({ chamber, current, onPick }) {
  const [open, setOpen] = _cState(false);
  const ref = _cRef(null);
  const list = (window.CV_DATA.recent[chamber] || []);
  _cEffect(() => {
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); };
  }, []);
  return React.createElement('div', { className: 'cv-recent', ref: ref },
    React.createElement('button', {
      className: 'cv-recent__btn', 'aria-haspopup': 'listbox', 'aria-expanded': open,
      onClick: () => setOpen(!open)
    },
      React.createElement('span', { className: 'cv-recent__lbl' }, 'Recent votes'),
      React.createElement('span', { className: 'cv-recent__cur' }, current),
      React.createElement('span', { 'aria-hidden': 'true', className: 'cv-recent__chev' }, '\u25BE')
    ),
    open && React.createElement('div', { className: 'cv-recent__menu', role: 'listbox' },
      list.map((v) =>
        React.createElement('button', {
          key: v.id, role: 'option', 'aria-selected': v.cite === current,
          className: 'cv-recent__row' + (v.cite === current ? ' is-active' : ''),
          onClick: () => { onPick(v); setOpen(false); }
        },
          React.createElement('div', { className: 'cv-recent__rowmain' },
            React.createElement('span', { className: 'cv-recent__cite' }, v.cite),
            React.createElement('span', { className: 'cv-recent__q' }, v.q)
          ),
          React.createElement('div', { className: 'cv-recent__rowmeta' },
            React.createElement('span', { className: 'cv-recent__date' }, v.date),
            React.createElement(StatusChip, { status: v.result })
          )
        )
      )
    )
  );
}
window.RecentSelector = RecentSelector;

// ---------- Tally bar (monochrome by default) ----------
function TallyBar({ vote, tones }) {
  const t = vote.tally, total = vote.total;
  const pct = (n) => (n / total * 100);
  const nonVoting = t.present + t.nv;
  const segs = [
    { key: 'yea', n: t.yea, c: tones.yea, fg: tones.yeaFg, label: 'Yea' },
    { key: 'nay', n: t.nay, c: tones.nay, fg: tones.nayFg, label: 'Nay' }
  ];
  if (nonVoting > 0) segs.push({ key: 'nv', n: nonVoting, c: tones.nv, fg: tones.nvFg, label: 'NV' });
  return React.createElement('div', { className: 'cv-tally' },
    React.createElement('div', { className: 'cv-tally__bar', role: 'img',
      'aria-label': 'Tally: Yea ' + t.yea + ', Nay ' + t.nay + ', not voting ' + nonVoting + ' of ' + total },
      segs.map((s) => React.createElement('div', {
        key: s.key, className: 'cv-tally__seg', style: { width: pct(s.n) + '%', background: s.c, color: s.fg }
      }, pct(s.n) > 7 ? React.createElement('span', { className: 'cl-num' }, s.label + ' ' + s.n) : null))
    ),
    React.createElement('div', { className: 'cv-tally__keys' },
      segs.map((s) => React.createElement('span', { key: s.key, className: 'cv-tally__key' },
        React.createElement('span', { className: 'cv-tally__sw', style: { background: s.c, border: s.key === 'nv' ? '1px solid var(--cl-border-strong)' : 'none' } }),
        React.createElement('span', { className: 'cl-num' }, s.label + ' ' + s.n + ' · ' + pct(s.n).toFixed(1) + '%')
      ))
    )
  );
}
window.TallyBar = TallyBar;

// ---------- Vote header card ----------
function VoteHeader({ vote, tones }) {
  const bp = vote.tally.byParty;
  const seg = (p) => bp[p].yea + '\u2013' + bp[p].nay;
  const hasI = (bp.I.yea + bp.I.nay) > 0;
  return React.createElement('section', { className: 'cv-card cv-header', 'aria-label': 'Vote outcome' },
    React.createElement('div', { className: 'cv-header__top' },
      React.createElement('div', { className: 'cv-header__id' },
        React.createElement('span', { className: 'cv-header__cite' }, vote.cite),
        React.createElement('span', { className: 'cv-header__type' }, '· ' + vote.type)
      ),
      React.createElement(StatusChip, { status: vote.result })
    ),
    vote.title && React.createElement('p', { className: 'cv-header__title' }, vote.title),
    React.createElement('p', { className: 'cv-header__q' }, vote.question),
    React.createElement(TallyBar, { vote: vote, tones: tones }),
    React.createElement('div', { className: 'cv-header__byparty' },
      React.createElement('span', { className: 'cl-num' }, 'By party: ',
        React.createElement('span', { style: { color: 'var(--cl-republican)', fontWeight: 600 } }, 'R ' + seg('R')), ' · ',
        React.createElement('span', { style: { color: 'var(--cl-democrat)', fontWeight: 600 } }, 'D ' + seg('D')),
        hasI ? React.createElement(React.Fragment, null, ' · ',
          React.createElement('span', { style: { color: 'var(--cl-independent)', fontWeight: 600 } }, 'I ' + seg('I'))) : null
      ),
      React.createElement('span', { className: 'cv-header__date' }, vote.date)
    ),
    vote.indCaucusNote && (vote.tally.byParty.I.yea + vote.tally.byParty.I.nay) > 0 &&
      React.createElement('p', { className: 'cv-header__caucus' }, vote.indCaucusNote)
  );
}
window.VoteHeader = VoteHeader;

// ---------- Legend ----------
function Legend({ hues, parties }) {
  const items = [];
  parties.forEach((p) => {
    const w = p === 'R' ? 'Rep' : p === 'D' ? 'Dem' : 'Ind';
    items.push({ label: w + ' · Yea', style: { background: hues[p] } });
    items.push({ label: w + ' · Nay', style: { background: '#fff', border: '1.6px solid ' + hues[p] } });
  });
  items.push({ label: 'Present', style: { background: 'url(#legendhatch)' , backgroundImage: 'repeating-linear-gradient(45deg,#fff 0 2px,#8a93a0 2px 3px)', border: '1px solid var(--cl-border-strong)' } });
  items.push({ label: 'Not voting', style: { background: '#e9ecef', border: '1px solid var(--cl-border-strong)' } });
  return React.createElement('div', { className: 'cv-legend' },
    items.map((it, i) => React.createElement('span', { key: i, className: 'cv-legend__item' },
      React.createElement('span', { className: 'cv-legend__sw', style: it.style }),
      it.label
    ))
  );
}
window.Legend = Legend;

// ---------- Vote list ----------
function PartyBadge({ p }) {
  const cls = p === 'R' ? 'cv-pb--r' : p === 'D' ? 'cv-pb--d' : 'cv-pb--i';
  return React.createElement('span', { className: 'cv-pb ' + cls }, p);
}
window.PartyBadge = PartyBadge;

// ---------- status icon (icon-only) ----------
function StatusIcon({ pos }) {
  const map = {
    yea:     { g: '\u2713', cls: 'is-yea',  t: 'Yea' },        // ✓
    nay:     { g: '\u2715', cls: 'is-nay',  t: 'Nay' },        // ✕
    present: { g: '\u2298', cls: 'is-pres', t: 'Present' },    // ⊘  (4th, distinct)
    nv:      { g: '\u2013', cls: 'is-nv',   t: 'Did not vote' }// –
  };
  const m = map[pos] || map.nv;
  return React.createElement('span', { className: 'cv-sicon ' + m.cls, title: m.t },
    React.createElement('span', { 'aria-hidden': 'true' }, m.g));
}
window.StatusIcon = StatusIcon;

function Pager({ page, pages, onSet, idLabel }) {
  if (pages <= 1) return null;
  return React.createElement('div', { className: 'cv-pager', role: 'navigation', 'aria-label': idLabel + ' list pages' },
    React.createElement('button', {
      className: 'cv-pager__btn', disabled: page === 0, 'aria-label': 'Previous page',
      onClick: () => onSet(Math.max(0, page - 1))
    }, '\u2039'),
    Array.from({ length: pages }).map((_, i) =>
      React.createElement('button', {
        key: i, className: 'cv-pager__num' + (i === page ? ' is-on' : ''),
        'aria-current': i === page ? 'page' : undefined, onClick: () => onSet(i)
      }, i + 1)
    ),
    React.createElement('button', {
      className: 'cv-pager__btn', disabled: page === pages - 1, 'aria-label': 'Next page',
      onClick: () => onSet(Math.min(pages - 1, page + 1))
    }, '\u203A')
  );
}

const PAGE_SIZE = 100;

function VoteList({ vote, onPick, mobilePrimary }) {
  const [q, setQ] = _cState('');
  const [page, setPage] = _cState(0);

  const filtered = _cMemo(() => {
    const sorted = vote.seats.map((s, i) => ({ s, i })).sort((a, b) => {
      const sa = window.CV_STATE_NAMES[a.s.st] || a.s.st, sb = window.CV_STATE_NAMES[b.s.st] || b.s.st;
      if (sa !== sb) return sa < sb ? -1 : 1;
      const po = { R: 0, D: 1, I: 2 };
      if (a.s.party !== b.s.party) return po[a.s.party] - po[b.s.party];
      const na = a.s.name || ('zz' + a.s.initials), nb = b.s.name || ('zz' + b.s.initials);
      return na < nb ? -1 : 1;
    });
    if (!q.trim()) return sorted;
    const ql = q.toLowerCase();
    return sorted.filter(({ s }) =>
      (s.name && s.name.toLowerCase().includes(ql)) ||
      (s.initials && s.initials.toLowerCase().includes(ql)) ||
      s.st.toLowerCase().includes(ql) ||
      (window.CV_STATE_NAMES[s.st] || '').toLowerCase().includes(ql) ||
      POS_LABEL[s.pos].toLowerCase().includes(ql)
    );
  }, [vote, q]);

  // search spans the whole chamber and jumps to page 1 of the matches
  _cEffect(() => { setPage(0); }, [q, vote]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = safePage * PAGE_SIZE + slice.length;

  return React.createElement('section', { className: 'cv-card cv-list', 'aria-label': vote.chamber + ' vote list — full record' },
    React.createElement('div', { className: 'cv-list__head' },
      React.createElement('div', null,
        React.createElement('p', { className: 'cl-eyebrow' }, 'Full record'),
        React.createElement('h3', { className: 'cv-list__title' }, vote.chamber + ' — every member'),
        React.createElement('p', { className: 'cv-list__hint' },
          mobilePrimary ? 'Tap a member for their vote detail.' : 'Click a member for their vote detail.')
      ),
      React.createElement('div', { className: 'cv-list__tools' },
        React.createElement('div', { className: 'cv-search' },
          React.createElement('span', { 'aria-hidden': 'true', className: 'cv-search__ic' }, '\u2315'),
          React.createElement('input', {
            type: 'search', value: q, placeholder: 'Search all ' + vote.total + ' — name or state',
            'aria-label': 'Search the full ' + vote.chamber + ' record', onChange: (e) => setQ(e.target.value)
          })
        ),
        React.createElement('button', { className: 'cv-dl', title: 'Download the full roll-call as CSV' },
          React.createElement('span', { 'aria-hidden': 'true' }, '\u2913'), ' CSV')
      )
    ),

    React.createElement('div', { className: 'cv-list__bar' },
      React.createElement('span', { className: 'cv-list__count cl-num' },
        q.trim()
          ? filtered.length + ' match' + (filtered.length === 1 ? '' : 'es')
          : rangeStart + '\u2013' + rangeEnd + ' of ' + filtered.length),
      React.createElement(Pager, { page: safePage, pages: pages, onSet: setPage, idLabel: 'Top' })
    ),

    filtered.length === 0
      ? React.createElement('p', { className: 'cv-list__empty' }, 'No members match \u201C' + q + '\u201D.')
      : React.createElement('div', { className: 'cv-list__grid', role: 'list' },
          slice.map(({ s, i }) =>
            React.createElement('button', {
              key: i, role: 'listitem', className: 'cv-row',
              onClick: (e) => onPick(i, e.currentTarget),
              'aria-label': displayName(s, vote.chamber) + ', ' + partyWord(s.party)
                + (s.party === 'I' && s.caucus ? ' (caucuses with ' + (s.caucus === 'D' ? 'Democrats' : 'Republicans') + ')' : '')
                + ', ' + (window.CV_STATE_NAMES[s.st] || s.st) + ', voted ' + POS_LABEL[s.pos]
            },
              React.createElement(StatusIcon, { pos: s.pos }),
              React.createElement('span', { className: 'cv-row__st cl-num' }, s.st),
              React.createElement(PartyBadge, { p: s.party }),
              React.createElement('span', { className: 'cv-row__ini' }, s.initials),
              s.party === 'I' && s.caucus ? React.createElement('span', { className: 'cv-row__caucus' }, 'caucuses ' + s.caucus) : null
            )
          )
        ),

    React.createElement('div', { className: 'cv-list__bar cv-list__bar--btm' },
      React.createElement('span', { className: 'cv-list__count cl-num' }, 'Page ' + (safePage + 1) + ' of ' + pages),
      React.createElement(Pager, { page: safePage, pages: pages, onSet: setPage, idLabel: 'Bottom' })
    )
  );
}
window.VoteList = VoteList;
