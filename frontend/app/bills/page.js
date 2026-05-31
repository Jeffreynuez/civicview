'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /bills — federal Bills & Votes (Phase A).
 *
 * A chamber-wide vote browser: land on the most recent passage/nomination
 * roll-call for a chamber, see the outcome + an interactive seat chart of
 * how every member voted, switch chambers + votes, and click any seat or
 * list row to reach that member's ProfileView profile window.
 *
 * Wired to the official-source backend:
 *   GET /api/votes/recent?chamber=        (Senate menu / House via GovTrack)
 *   GET /api/votes/{vote_id}/members       (seat-chart backbone)
 *
 * Class names + layout match the Claude Design export. Styles in ./bills.css.
 * Locked design: classic green/red tally, small seats with per-seat state
 * labels, full member names in the two-column list, mobile = scrollable
 * chart + single-column list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchRecentVotes, fetchVoteMembers } from '@/lib/api';
import Navbar from '@/components/Navbar';
import { useCitizenAuth, logoutCitizen } from '@/lib/citizenAuth';
import SeatChart from '@/components/bills/SeatChart';
import SeatMiniCard from '@/components/bills/SeatMiniCard';
import {
  POS_LABEL,
  PARTY_RANK,
  partyWord,
  displayName,
  positionToPos,
  normalizeResult,
} from '@/components/bills/voteHelpers';
import { STATE_NAMES } from '@/lib/usStates';
import './bills.css';

const PARTY_HUES = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
const TONES = { yea: '#2d6a4f', yeaFg: '#fff', nay: '#d63031', nayFg: '#fff', nv: '#dde1e6', nvFg: '#6c757d' };
const PAGE_SIZE = 100;
const SEAT_BASE = 10; // "small" seats (locked) so state labels fit
function seatPxFor(chamber) {
  return chamber === 'Senate' ? SEAT_BASE * 1.7 : SEAT_BASE;
}

function formatHouseCite(legis) {
  if (!legis) return '';
  const toks = legis.trim().split(/\s+/);
  if (toks.length < 2) return legis;
  const num = toks[toks.length - 1];
  const letters = toks.slice(0, -1).map((t) => {
    const u = t.toUpperCase();
    if (u === 'RES') return 'Res';
    if (u === 'CON') return 'Con';
    return u;
  });
  return letters.join('.') + '. ' + num;
}

function deriveCite(detail, recentRaw, chamber) {
  if (chamber === 'House') {
    return formatHouseCite(detail.legis_num) || (recentRaw && recentRaw.issue) || ('Roll ' + detail.rollcall);
  }
  if (detail.bill && detail.bill.number) return `${detail.bill.type} ${detail.bill.number}`.trim();
  if (recentRaw && recentRaw.issue) return recentRaw.issue;
  return detail.kind === 'nomination' ? 'Nomination' : ('Vote ' + detail.rollcall);
}

function formatDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const houseM = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  let d;
  if (houseM) d = new Date(`${houseM[2]} ${houseM[1]}, ${houseM[3]}`);
  else d = new Date(s.replace(/,\s*$/, ''));
  if (isNaN(d.getTime())) {
    const parts = s.split(',');
    if (parts.length >= 2) d = new Date(parts[0] + ',' + parts[1]);
  }
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function synthQuestion(chamber, cite, type) {
  if (type === 'nomination') return 'This was a vote on a nomination in the Senate.';
  return `This was a vote to pass ${cite} in the ${chamber}.`;
}

function mapVote(detail, recentRaw, chamber) {
  const type = chamber === 'House' ? 'passage' : (detail.kind || 'passage');
  const cite = deriveCite(detail, recentRaw, chamber);
  const totals = detail.totals || {};
  const yea = totals.yea || 0;
  const nay = totals.nay || 0;
  const present = totals.present || 0;
  const nv = totals.not_voting || 0;
  const bpSrc = detail.by_party || {};
  const bp = {};
  ['R', 'D', 'I'].forEach((p) => {
    const v = bpSrc[p] || {};
    bp[p] = { yea: v.yea || 0, nay: v.nay || 0 };
  });
  const seats = (detail.members || []).map((m) => ({
    st: m.state || '??',
    party: m.party || '?',
    pos: positionToPos(m.position),
    name: m.name || null,
    bioguide: m.bioguide_id || null,
    dist: undefined,
    caucus: undefined,
  }));
  const title = chamber === 'Senate'
    ? (detail.title || (detail.bill && detail.bill.title) || '')
    : ((recentRaw && recentRaw.title) || '');
  return {
    id: detail.vote_id,
    chamber,
    cite,
    type,
    title,
    question: synthQuestion(chamber, cite, type),
    result: normalizeResult(detail.result),
    date: formatDate(detail.date),
    tally: { yea, nay, present, nv, byParty: bp },
    total: yea + nay + present + nv,
    seats,
    indCaucusNote: chamber === 'Senate' ? 'Independents are grouped with the party they caucus with.' : '',
  };
}

function mapRecentItem(item) {
  return {
    id: item.vote_id,
    cite: item.issue || item.title || ('Roll ' + item.rollcall),
    q: item.question || '',
    date: formatDate(item.date),
    result: normalizeResult(item.result),
    raw: item,
  };
}

function StatusChip({ status }) {
  const map = {
    Passed: { bg: 'var(--cl-success-soft)', fg: 'var(--cl-success-text)', bd: 'var(--cl-success-border)' },
    Confirmed: { bg: 'var(--cl-success-soft)', fg: 'var(--cl-success-text)', bd: 'var(--cl-success-border)' },
    Failed: { bg: 'var(--cl-danger-soft)', fg: 'var(--cl-danger-text)', bd: 'var(--cl-danger-border)' },
    Rejected: { bg: 'var(--cl-danger-soft)', fg: 'var(--cl-danger-text)', bd: 'var(--cl-danger-border)' },
    Upcoming: { bg: 'var(--cl-warning-soft)', fg: 'var(--cl-warning-text)', bd: 'var(--cl-warning-border)' },
  };
  const m = map[status] || map.Passed;
  return (
    <span className="cv-status" style={{ background: m.bg, color: m.fg, borderColor: m.bd }}>
      {status}
    </span>
  );
}

function ChamberToggle({ value, onChange }) {
  return (
    <div className="cv-tabstrip" role="tablist" aria-label="Chamber">
      {['Senate', 'House'].map((c) => (
        <button
          key={c}
          role="tab"
          aria-selected={value === c}
          className={'cv-tab' + (value === c ? ' is-active' : '')}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function RecentSelector({ list, current, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', f);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); };
  }, []);
  return (
    <div className="cv-recent" ref={ref}>
      <button className="cv-recent__btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="cv-recent__lbl">Recent votes</span>
        <span className="cv-recent__cur">{current}</span>
        <span aria-hidden="true" className="cv-recent__chev">▾</span>
      </button>
      {open && (
        <div className="cv-recent__menu" role="listbox">
          {list.map((v) => (
            <button
              key={v.id}
              role="option"
              aria-selected={v.cite === current}
              className={'cv-recent__row' + (v.cite === current ? ' is-active' : '')}
              onClick={() => { onPick(v); setOpen(false); }}
            >
              <div className="cv-recent__rowmain">
                <span className="cv-recent__cite">{v.cite}</span>
                <span className="cv-recent__q">{v.q}</span>
              </div>
              <div className="cv-recent__rowmeta">
                <span className="cv-recent__date">{v.date}</span>
                <StatusChip status={v.result} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TallyBar({ vote }) {
  const t = vote.tally;
  const total = vote.total || 1;
  const pct = (n) => (n / total) * 100;
  const nonVoting = t.present + t.nv;
  const segs = [
    { key: 'yea', n: t.yea, c: TONES.yea, fg: TONES.yeaFg, label: 'Yea' },
    { key: 'nay', n: t.nay, c: TONES.nay, fg: TONES.nayFg, label: 'Nay' },
  ];
  if (nonVoting > 0) segs.push({ key: 'nv', n: nonVoting, c: TONES.nv, fg: TONES.nvFg, label: 'NV' });
  return (
    <div className="cv-tally">
      <div className="cv-tally__bar" role="img" aria-label={`Tally: Yea ${t.yea}, Nay ${t.nay}, not voting ${nonVoting} of ${total}`}>
        {segs.map((s) => (
          <div key={s.key} className="cv-tally__seg" style={{ width: pct(s.n) + '%', background: s.c, color: s.fg }}>
            {pct(s.n) > 7 ? <span className="cl-num">{s.label + ' ' + s.n}</span> : null}
          </div>
        ))}
      </div>
      <div className="cv-tally__keys">
        {segs.map((s) => (
          <span key={s.key} className="cv-tally__key">
            <span className="cv-tally__sw" style={{ background: s.c, border: s.key === 'nv' ? '1px solid var(--cl-border-strong)' : 'none' }} />
            <span className="cl-num">{s.label + ' ' + s.n + ' · ' + pct(s.n).toFixed(1) + '%'}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function VoteHeader({ vote }) {
  const bp = vote.tally.byParty;
  const seg = (p) => bp[p].yea + '–' + bp[p].nay;
  const hasI = (bp.I.yea + bp.I.nay) > 0;
  return (
    <section className="cv-card cv-header" aria-label="Vote outcome">
      <div className="cv-header__top">
        <div className="cv-header__id">
          <span className="cv-header__cite">{vote.cite}</span>
          <span className="cv-header__type">{'· ' + vote.type}</span>
        </div>
        <StatusChip status={vote.result} />
      </div>
      {vote.title ? <p className="cv-header__title">{vote.title}</p> : null}
      <p className="cv-header__q">{vote.question}</p>
      <TallyBar vote={vote} />
      <div className="cv-header__byparty">
        <span className="cl-num">
          {'By party: '}
          <span style={{ color: 'var(--cl-republican)', fontWeight: 600 }}>{'R ' + seg('R')}</span>
          {' · '}
          <span style={{ color: 'var(--cl-democrat)', fontWeight: 600 }}>{'D ' + seg('D')}</span>
          {hasI ? (
            <>
              {' · '}
              <span style={{ color: 'var(--cl-independent)', fontWeight: 600 }}>{'I ' + seg('I')}</span>
            </>
          ) : null}
        </span>
        <span className="cv-header__date">{vote.date}</span>
      </div>
      {vote.indCaucusNote && hasI ? <p className="cv-header__caucus">{vote.indCaucusNote}</p> : null}
    </section>
  );
}

function Legend({ parties }) {
  const items = [];
  parties.forEach((p) => {
    const w = p === 'R' ? 'Rep' : p === 'D' ? 'Dem' : 'Ind';
    items.push({ label: w + ' · Yea', style: { background: PARTY_HUES[p] } });
    items.push({ label: w + ' · Nay', style: { background: '#fff', border: '1.6px solid ' + PARTY_HUES[p] } });
  });
  items.push({ label: 'Present', style: { backgroundImage: 'repeating-linear-gradient(45deg,#fff 0 2px,#8a93a0 2px 3px)', border: '1px solid var(--cl-border-strong)' } });
  items.push({ label: 'Not voting', style: { background: '#e9ecef', border: '1px solid var(--cl-border-strong)' } });
  return (
    <div className="cv-legend">
      {items.map((it, i) => (
        <span key={i} className="cv-legend__item">
          <span className="cv-legend__sw" style={it.style} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function PartyBadge({ p }) {
  const cls = p === 'R' ? 'cv-pb--r' : p === 'D' ? 'cv-pb--d' : 'cv-pb--i';
  return <span className={'cv-pb ' + cls}>{p}</span>;
}

function StatusIcon({ pos }) {
  const map = {
    yea: { g: '✓', cls: 'is-yea', t: 'Yea' },
    nay: { g: '✕', cls: 'is-nay', t: 'Nay' },
    present: { g: '⊘', cls: 'is-pres', t: 'Present' },
    nv: { g: '–', cls: 'is-nv', t: 'Did not vote' },
  };
  const m = map[pos] || map.nv;
  return (
    <span className={'cv-sicon ' + m.cls} title={m.t}>
      <span aria-hidden="true">{m.g}</span>
    </span>
  );
}

function Pager({ page, pages, onSet, idLabel }) {
  if (pages <= 1) return null;
  return (
    <div className="cv-pager" role="navigation" aria-label={idLabel + ' list pages'}>
      <button className="cv-pager__btn" disabled={page === 0} aria-label="Previous page" onClick={() => onSet(Math.max(0, page - 1))}>‹</button>
      {Array.from({ length: pages }).map((_, i) => (
        <button
          key={i}
          className={'cv-pager__num' + (i === page ? ' is-on' : '')}
          aria-current={i === page ? 'page' : undefined}
          onClick={() => onSet(i)}
        >
          {i + 1}
        </button>
      ))}
      <button className="cv-pager__btn" disabled={page === pages - 1} aria-label="Next page" onClick={() => onSet(Math.min(pages - 1, page + 1))}>›</button>
    </div>
  );
}

function VoteList({ vote, onPick, mobilePrimary }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const sorted = vote.seats
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const sa = STATE_NAMES[a.s.st] || a.s.st;
        const sb = STATE_NAMES[b.s.st] || b.s.st;
        if (sa !== sb) return sa < sb ? -1 : 1;
        if (a.s.party !== b.s.party) return (PARTY_RANK[a.s.party] ?? 9) - (PARTY_RANK[b.s.party] ?? 9);
        const na = a.s.name || 'zz';
        const nb = b.s.name || 'zz';
        return na < nb ? -1 : 1;
      });
    if (!q.trim()) return sorted;
    const ql = q.toLowerCase();
    return sorted.filter(({ s }) =>
      (s.name && s.name.toLowerCase().includes(ql)) ||
      s.st.toLowerCase().includes(ql) ||
      (STATE_NAMES[s.st] || '').toLowerCase().includes(ql) ||
      POS_LABEL[s.pos].toLowerCase().includes(ql)
    );
  }, [vote, q]);

  useEffect(() => { setPage(0); }, [q, vote]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = safePage * PAGE_SIZE + slice.length;

  return (
    <section className="cv-card cv-list" aria-label={vote.chamber + ' vote list — full record'}>
      <div className="cv-list__head">
        <div>
          <p className="cl-eyebrow">Full record</p>
          <h3 className="cv-list__title">{vote.chamber + ' — every member'}</h3>
          <p className="cv-list__hint">{mobilePrimary ? 'Tap a member for their vote detail.' : 'Click a member for their vote detail.'}</p>
        </div>
        <div className="cv-list__tools">
          <div className="cv-search">
            <span aria-hidden="true" className="cv-search__ic">⌕</span>
            <input
              type="search"
              value={q}
              placeholder={'Search all ' + vote.total + ' — name or state'}
              aria-label={'Search the full ' + vote.chamber + ' record'}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="cv-list__bar">
        <span className="cv-list__count cl-num">
          {q.trim()
            ? filtered.length + ' match' + (filtered.length === 1 ? '' : 'es')
            : rangeStart + '–' + rangeEnd + ' of ' + filtered.length}
        </span>
        <Pager page={safePage} pages={pages} onSet={setPage} idLabel="Top" />
      </div>

      {filtered.length === 0 ? (
        <p className="cv-list__empty">{'No members match “' + q + '”.'}</p>
      ) : (
        <div className="cv-list__grid" role="list">
          {slice.map(({ s, i }) => (
            <button
              key={i}
              role="listitem"
              className="cv-row"
              onClick={(e) => onPick(i, e.currentTarget)}
              aria-label={
                displayName(s, vote.chamber) + ', ' + partyWord(s.party) + ', ' +
                (STATE_NAMES[s.st] || s.st) + ', voted ' + POS_LABEL[s.pos]
              }
            >
              <StatusIcon pos={s.pos} />
              <span className="cv-row__st cl-num">{s.st}</span>
              <PartyBadge p={s.party} />
              <span className="cv-row__name">{displayName(s, vote.chamber)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="cv-list__bar cv-list__bar--btm">
        <span className="cv-list__count cl-num">{'Page ' + (safePage + 1) + ' of ' + pages}</span>
        <Pager page={safePage} pages={pages} onSet={setPage} idLabel="Bottom" />
      </div>
    </section>
  );
}

function ChartScroller({ children, chamber }) {
  const ref = useRef(null);
  const by = (d) => { if (ref.current) ref.current.scrollBy({ left: d, behavior: 'smooth' }); };
  return (
    <div className="cv-scrollwrap">
      <div className={'cv-scroll cv-scroll--' + chamber.toLowerCase()} ref={ref}>{children}</div>
      <div className="cv-scroll__fade cv-scroll__fade--l" aria-hidden="true" />
      <div className="cv-scroll__fade cv-scroll__fade--r" aria-hidden="true" />
      <button className="cv-scroll__arw cv-scroll__arw--l" aria-label="Scroll chart left" onClick={() => by(-240)}>‹</button>
      <button className="cv-scroll__arw cv-scroll__arw--r" aria-label="Scroll chart right" onClick={() => by(240)}>›</button>
    </div>
  );
}

export default function BillsPage() {
  const router = useRouter();
  const { citizen } = useCitizenAuth();

  const [chamber, setChamber] = useState('House');
  const [recent, setRecent] = useState([]);
  const [vote, setVote] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState({ idx: null, anchor: null });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const loadVote = useCallback(async (voteId, recentRaw, chamberCap) => {
    setLoading(true);
    setError(null);
    setSel({ idx: null, anchor: null });
    const { data } = await fetchVoteMembers(voteId);
    if (!data) { setLoading(false); setError('load'); return; }
    setVote(mapVote(data, recentRaw, chamberCap));
    setActiveId(voteId);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setVote(null);
      setRecent([]);
      setSel({ idx: null, anchor: null });
      const chamberApi = chamber === 'House' ? 'house' : 'senate';
      const { data: rows } = await fetchRecentVotes(chamberApi, 20);
      if (cancelled) return;
      const mapped = rows.map(mapRecentItem);
      setRecent(mapped);
      if (!mapped.length) { setLoading(false); setError('recess'); return; }
      await loadVote(mapped[0].id, mapped[0].raw, chamber);
    })();
    return () => { cancelled = true; };
  }, [chamber, loadVote]);

  const pick = (idx, anchor) => setSel({ idx, anchor });
  const closeCard = () => setSel({ idx: null, anchor: null });
  const onChamber = (c) => { if (c !== chamber) { closeCard(); setChamber(c); } };
  const onPickVote = (item) => { closeCard(); loadVote(item.id, item.raw, chamber); };
  const onViewProfile = (bioguide) => { closeCard(); router.push('/?member=' + encodeURIComponent(bioguide)); };
  const retry = () => {
    const cur = recent.find((r) => r.id === activeId);
    loadVote(activeId, cur && cur.raw, chamber);
  };

  const chartInteractive = !isMobile;
  const parties = chamber === 'Senate' ? ['R', 'D', 'I'] : ['R', 'D'];
  const seatPx = seatPxFor(chamber);

  const chartEl = vote ? (
    <SeatChart
      vote={vote}
      hues={PARTY_HUES}
      seatPx={seatPx}
      interactive={chartInteractive}
      onSelect={pick}
      selectedIdx={sel.idx}
      labelMode="seat"
    />
  ) : null;

  return (
    <div className="bills-page cv-stage">
      <div style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <Navbar
          compact
          onMemberPick={(m) => { if (m && m.bioguide_id) router.push('/?member=' + encodeURIComponent(m.bioguide_id)); else router.push('/'); }}
          onCandidatePick={(c) => { if (c && c.candidate_id) router.push('/?page=' + encodeURIComponent(c.candidate_id)); else router.push('/'); }}
          onOpenTracked={() => router.push('/')}
          onSubscribe={() => router.push('/')}
          citizen={citizen}
          onCitizenLogin={() => router.push('/')}
          onCitizenLogout={() => { try { logoutCitizen && logoutCitizen(); } catch (e) {} router.push('/'); }}
          onCitizenDashboard={() => router.push('/')}
          onOpenRepDashboard={(r) => { if (r && r.official_id) router.push('/?page=' + encodeURIComponent(r.official_id)); }}
          onOpenCandidateDashboard={(c) => { if (c && c.candidate_id) router.push('/?page=' + encodeURIComponent(c.candidate_id)); }}
          onOpenHelpBuild={() => router.push('/')}
          onOpenFeedback={() => router.push('/')}
          onHome={() => router.push('/')}
        />
      </div>

      <div className="cv-hero">
        <div className="cv-hero__inner">
          <p className="cv-hero__eyebrow">Federal legislation</p>
          <h1 className="cv-hero__title">Bills &amp; Votes</h1>
          <p className="cv-hero__sub">See how Congress voted — pick a chamber and a vote.</p>
        </div>
      </div>

      <div className="cv-body">
        <div className="cv-controls">
          <div className="cv-controls__l">
            <ChamberToggle value={chamber} onChange={onChamber} />
          </div>
          <div className="cv-controls__r">
            {recent.length > 0 && vote && (
              <RecentSelector list={recent} current={vote.cite} onPick={onPickVote} />
            )}
          </div>
        </div>

        {loading && (
          <section className="cv-card bills-state" aria-busy="true">
            <p>Loading {chamber} votes…</p>
          </section>
        )}

        {!loading && error === 'recess' && (
          <section className="cv-card bills-state">
            <p>The {chamber} isn’t recording floor votes right now.</p>
            <p className="bills-state__sub">Check back when Congress is in session.</p>
          </section>
        )}

        {!loading && error === 'load' && (
          <section className="cv-card bills-state">
            <p>Couldn’t load this vote.</p>
            <button className="bills-state__retry" onClick={retry}>Retry</button>
          </section>
        )}

        {!loading && !error && vote && (
          <>
            <VoteHeader vote={vote} />

            <section className="cv-card cv-chartcard">
              <div className="cv-chartcard__head">
                <div>
                  <p className="cl-eyebrow">{chamber + ' roll-call'}</p>
                  <p className="cv-chartcard__sub">
                    {chartInteractive
                      ? 'Democrats left · Republicans right, sorted by state. Click or arrow-key a seat.'
                      : 'At-a-glance outcome — scroll to read state labels; use the list below to open a member.'}
                  </p>
                </div>
              </div>
              {isMobile ? <ChartScroller chamber={chamber}>{chartEl}</ChartScroller> : chartEl}
              <Legend parties={parties} />
            </section>

            <VoteList vote={vote} onPick={pick} mobilePrimary={isMobile} />

            <p className="cv-foot">
              {vote.cite} · seats encode hue = party, fill = position · {chamber === 'House' ? '435 seats' : '100 seats'}
            </p>
          </>
        )}
      </div>

      {sel.idx != null && vote && vote.seats[sel.idx] && (
        <SeatMiniCard
          seat={vote.seats[sel.idx]}
          chamber={chamber}
          anchorEl={sel.anchor}
          idx={sel.idx}
          onClose={closeCard}
          onViewProfile={onViewProfile}
        />
      )}
    </div>
  );
}
