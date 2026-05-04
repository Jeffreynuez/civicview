'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchElections, fetchBallotForAddress } from '@/lib/api';
import useVoterInfo from '@/lib/useVoterInfo';
import FollowButton from './FollowButton';
import CompareButton from './CompareButton';
import TrackElectionButton from './TrackElectionButton';
import {
  EmptyState as UIEmptyState,
  Skeleton,
  CalendarCheck,
  CheckCircle,
  WarningCircle,
  MapPin,
} from './ui';

// Phase 4C: party colors resolve through canonical --cl-* tokens. NP
// (non-partisan races, common at the local level) keeps a neutral grey
// since there's no token-mapped party color for it.
const PARTY_COLORS = {
  R: 'var(--cl-republican)',
  D: 'var(--cl-democrat)',
  I: 'var(--cl-independent)',
  NP: 'var(--cl-text-light)',
};
const PARTY_BG = {
  R: 'var(--cl-republican-soft)',
  D: 'var(--cl-democrat-soft)',
  I: 'var(--cl-independent-soft)',
  NP: 'var(--cl-bg-soft)',
};

/**
 * Elections tab — structured as a list of upcoming elections (Primary,
 * General, and any others). Each election is an expandable card whose
 * body contains Races and Ballot Measures as separate dropdowns. Races
 * are filtered per-phase (primary shows primary candidates only, general
 * shows general-election candidates). Ballot measures sit on the general
 * ballot unless explicitly tagged otherwise. If no upcoming elections are
 * in the data, shows a friendly "None upcoming" state.
 */
export default function BallotTab({
  stateCode,
  stateName,
  activeDistrict,
  onCandidateSelect,
  onCompareToggle,
  compareIds,
  onNotify,
  // When set, BallotTab auto-opens the containing election + race and
  // scrolls/pulses the candidate row. Used by:
  //   - clicking the "On ballot" badge on a rep profile (focusCandidateId)
  //   - returning from a candidate profile via Back (highlightCandidateId)
  // Each is cleared by the corresponding `onConsumed` callback.
  focusCandidateId,
  onFocusCandidateConsumed,
  highlightCandidateId,
  onHighlightConsumed,
}) {
  const [full, setFull] = useState(null);
  const [personalized, setPersonalized] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notSeeded, setNotSeeded] = useState(false);
  const [mode, setMode] = useState('full'); // 'full' | 'personal'

  const hasPersonalGeo = Boolean(
    activeDistrict && (
      activeDistrict.district ||
      activeDistrict.countyFips ||
      activeDistrict.stateSenateDistrict ||
      activeDistrict.stateHouseDistrict
    )
  );

  useEffect(() => {
    if (hasPersonalGeo) setMode('personal');
    else setMode('full');
  }, [hasPersonalGeo, stateCode]);

  // Load full elections payload once per state
  useEffect(() => {
    if (!stateCode) return;
    let cancelled = false;
    setLoading(true);
    setNotSeeded(false);
    (async () => {
      const res = await fetchElections(stateCode);
      if (cancelled) return;
      if (res.notSeeded) {
        setNotSeeded(true);
        setFull(null);
      } else {
        setFull(res.data);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [stateCode]);

  // Personalized ballot for the current geography
  useEffect(() => {
    if (!stateCode || !hasPersonalGeo) { setPersonalized(null); return; }
    let cancelled = false;
    (async () => {
      const res = await fetchBallotForAddress(stateCode, {
        countyFips: activeDistrict.countyFips,
        countyName: activeDistrict.countyName,
        district: activeDistrict.district,
        stateSenateDistrict: activeDistrict.stateSenateDistrict,
        stateHouseDistrict: activeDistrict.stateHouseDistrict,
        citySlug: activeDistrict.citySlug,
      });
      if (!cancelled) setPersonalized(res.data);
    })();
    return () => { cancelled = true; };
  }, [stateCode, hasPersonalGeo, activeDistrict]);

  const view = mode === 'personal' ? personalized : full;

  const elections = useMemo(
    () => buildElections(view, mode, stateCode),
    [view, mode, stateCode]
  );

  // Google Civic voterInfoQuery — populated only when we have the user's
  // full street address (from AddressLookup). Gives us polling places,
  // early-vote sites, and drop-off locations keyed to the next upcoming
  // election. The hook debounces and returns { data, loading, disabled }.
  const voterInfoAddress = mode === 'personal' ? (activeDistrict?.address || '') : '';
  const voterInfo = useVoterInfo(voterInfoAddress);

  // If an on-ballot candidate is focused/highlighted, find which election +
  // race owns them so we can open those cards automatically. Either prop is
  // a simple candidate id; focus takes priority (explicit click) over
  // highlight (passive return-to-list).
  const targetCandidateId = focusCandidateId || highlightCandidateId || null;
  const targetLocation = useMemo(() => {
    if (!targetCandidateId) return null;
    for (const el of elections) {
      for (const r of el.races || []) {
        const found = (r._displayCandidates || []).some((c) => c.id === targetCandidateId);
        if (found) return { electionId: el.id, raceId: r.id };
      }
    }
    return null;
  }, [targetCandidateId, elections]);

  if (loading) return <Loading>Loading elections…</Loading>;
  if (notSeeded) {
    return (
      <EmptyState>
        <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text)' }}>
          Election data not yet available for {stateName || stateCode}
        </div>
        <div>We&apos;re building out the ballot state by state. Florida 2026 is fully seeded.</div>
      </EmptyState>
    );
  }
  if (!view) return null;

  return (
    <div>
      {/* Mode toggle */}
      {hasPersonalGeo && (
        <div style={{
          display: 'flex', gap: '6px', padding: '8px 10px', marginBottom: '12px',
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px',
        }}>
          <ModeChip active={mode === 'personal'} onClick={() => setMode('personal')}>
            📍 Your Ballot
          </ModeChip>
          <ModeChip active={mode === 'full'} onClick={() => setMode('full')}>
            All {stateCode} Races
          </ModeChip>
        </div>
      )}

      {/* Geography context, if personal */}
      {mode === 'personal' && view.geography && (
        <div style={{
          padding: '8px 12px', marginBottom: '12px', background: 'white',
          border: '1px solid var(--border)', borderRadius: '10px',
          fontSize: '0.76rem', color: 'var(--text-light)',
        }}>
          Matched to:
          {view.geography.congressional_district && <Tag>CD-{view.geography.congressional_district}</Tag>}
          {view.geography.state_senate_district && <Tag>SD-{view.geography.state_senate_district}</Tag>}
          {view.geography.state_house_district && <Tag>HD-{view.geography.state_house_district}</Tag>}
          {view.geography.county_fips && view.geography.county_name && <Tag>{view.geography.county_name} Co.</Tag>}
        </div>
      )}

      {/* Voter info (polling places / early vote / drop-off) — only when
          we're in personal mode with a full address. Quiet on disabled so
          users without a Google Civic key don't see a broken-looking panel. */}
      {mode === 'personal' && voterInfoAddress && (
        <VoterInfoBlock
          loading={voterInfo.loading}
          data={voterInfo.data}
          error={voterInfo.error}
          disabled={voterInfo.disabled}
        />
      )}

      {/* Elections list */}
      {elections.length === 0 ? (
        <EmptyState>
          <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text)' }}>
            No upcoming elections
          </div>
          <div>Check back as primary and general election dates approach.</div>
        </EmptyState>
      ) : (
        elections.map((el, idx) => (
          <ElectionCard
            key={el.id}
            election={el}
            defaultOpen={idx === 0 || (targetLocation && targetLocation.electionId === el.id)}
            onCandidateSelect={onCandidateSelect}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
            mode={mode}
            stateCode={stateCode}
            onNotify={onNotify}
            forceOpenRaceId={targetLocation && targetLocation.electionId === el.id ? targetLocation.raceId : null}
            focusCandidateId={focusCandidateId}
            highlightCandidateId={highlightCandidateId}
            onFocusCandidateConsumed={onFocusCandidateConsumed}
            onHighlightConsumed={onHighlightConsumed}
          />
        ))
      )}
    </div>
  );
}

// ─── Elections builder ───────────────────────────────────────────────
// Derive an elections list from the ballot payload. Currently splits on
// primary/general; both can carry races + measures.
function buildElections(view, mode, stateCode) {
  if (!view) return [];
  const cycle = view.cycle || '2026';
  const races = view.races || [];
  const primaryDate = view.key_dates?.primary || null;
  const generalDate = view.key_dates?.general || null;

  // Collect measures. Personal mode: flat array. Full mode: {state, counties}.
  let allMeasures = [];
  if (mode === 'personal') {
    allMeasures = view.ballot_measures || [];
  } else if (view.ballot_measures) {
    allMeasures = [
      ...(view.ballot_measures.state || []),
      ...Object.values(view.ballot_measures.counties || {}).flatMap((a) => a || []),
    ];
  }

  // A measure's phase: unless tagged, assume general ballot.
  const primaryMeasures = allMeasures.filter((m) => m.phase === 'primary');
  const generalMeasures = allMeasures.filter((m) => m.phase !== 'primary');

  // Race phases
  const primaryRaces = races
    .map((r) => {
      const cands = Object.values(r.primary_candidates || {}).flat().filter(Boolean);
      if (!cands.length) return null;
      return { ...r, _displayCandidates: cands, _phase: 'primary' };
    })
    .filter(Boolean);

  const generalRaces = races
    .map((r) => {
      const cands = (r.general_candidates || []).filter(Boolean);
      if (!cands.length) return null;
      return { ...r, _displayCandidates: cands, _phase: 'general' };
    })
    .filter(Boolean);

  const out = [];
  if (primaryDate || primaryRaces.length > 0 || primaryMeasures.length > 0) {
    out.push({
      id: `${cycle}-primary`,
      title: `${cycle} ${stateCode || ''} Primary Election`.replace(/\s+/g, ' ').trim(),
      phase: 'primary',
      date: primaryDate,
      races: primaryRaces,
      measures: primaryMeasures,
      keyDates: [
        view.key_dates?.voter_registration_deadline_primary && { label: 'Voter registration', value: view.key_dates.voter_registration_deadline_primary },
        view.key_dates?.early_voting_window_primary && { label: 'Early voting', value: view.key_dates.early_voting_window_primary, isRange: true },
      ].filter(Boolean),
    });
  }
  if (generalDate || generalRaces.length > 0 || generalMeasures.length > 0) {
    out.push({
      id: `${cycle}-general`,
      title: `${cycle} ${stateCode || ''} General Election`.replace(/\s+/g, ' ').trim(),
      phase: 'general',
      date: generalDate,
      races: generalRaces,
      measures: generalMeasures,
      keyDates: [
        view.key_dates?.voter_registration_deadline_general && { label: 'Voter registration', value: view.key_dates.voter_registration_deadline_general },
        view.key_dates?.early_voting_window_general && { label: 'Early voting', value: view.key_dates.early_voting_window_general, isRange: true },
      ].filter(Boolean),
    });
  }

  // Only keep upcoming (or undated) elections.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return out.filter((el) => {
    if (!el.date) return true;
    const d = new Date(el.date);
    if (isNaN(d.getTime())) return true;
    return d >= today;
  });
}

// ─── Election card ───────────────────────────────────────────────────
function ElectionCard({
  election, defaultOpen, onCandidateSelect, onCompareToggle, compareIds,
  mode, stateCode, onNotify,
  forceOpenRaceId, focusCandidateId, highlightCandidateId,
  onFocusCandidateConsumed, onHighlightConsumed,
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  // If a race inside this election becomes the focus target after initial
  // mount (e.g. user switches candidates), make sure we expand ourselves.
  useEffect(() => {
    if (forceOpenRaceId) setOpen(true);
  }, [forceOpenRaceId]);
  const raceCount = election.races.length;
  const measureCount = election.measures.length;
  const isPrimary = election.phase === 'primary';

  // Snapshot shape expected by trackedElections.trackElection()
  const trackSnapshot = {
    id: election.id,
    name: election.title,
    office: null,
    date: election.date || null,
    state: stateCode || null,
    type: election.phase, // 'primary' | 'general'
    level: 'state',
    candidates_count: (election.races || []).reduce(
      (n, r) => n + ((r._displayCandidates || []).length), 0
    ),
  };

  return (
    <div style={{
      marginBottom: '12px', border: '1px solid var(--border)', borderRadius: '12px',
      background: 'white', overflow: 'hidden',
    }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '14px 16px',
          background: open ? 'var(--bg)' : 'white',
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            background: 'transparent', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.64rem', fontWeight: 800, padding: '2px 8px', borderRadius: '9px',
                background: isPrimary ? '#ffe8cc' : '#d6eadf',
                color: isPrimary ? '#a0530b' : '#1d5a2c',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                {isPrimary ? 'Primary' : 'General'}
              </span>
              {election.date && (
                <span style={{ fontSize: '0.74rem', color: 'var(--text-light)', fontWeight: 600 }}>
                  {formatDate(election.date)}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.96rem', fontWeight: 700, lineHeight: 1.3 }}>
              {election.title}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: '4px' }}>
              {raceCount} race{raceCount === 1 ? '' : 's'}
              {measureCount > 0 && ` · ${measureCount} measure${measureCount === 1 ? '' : 's'}`}
            </div>
          </div>
          <span aria-hidden style={{
            fontSize: '1rem', color: 'var(--text-light)',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
          }}>
            ›
          </span>
        </button>
        <div onClick={(e) => e.stopPropagation()}>
          <TrackElectionButton election={trackSnapshot} size="md" onNotify={onNotify} />
        </div>
      </div>

      {open && (
        <div style={{ padding: '12px 12px 10px' }}>
          {/* Key dates for this election */}
          {election.keyDates && election.keyDates.length > 0 && (
            <div style={{
              padding: '10px 12px', marginBottom: '12px',
              background: '#fff8e6', border: '1px solid #f4d35e', borderRadius: '10px',
            }}>
              <div style={{ fontSize: '0.7rem', color: '#7a5a00', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>
                Key dates
              </div>
              {election.keyDates.map((kd, i) => (
                <DateLine
                  key={i}
                  label={kd.label}
                  value={kd.isRange ? kd.value : formatDate(kd.value)}
                />
              ))}
            </div>
          )}

          {/* Races dropdown */}
          {raceCount > 0 ? (
            <Collapsible title="Races" count={raceCount} defaultOpen>
              {election.races.map((r) => (
                <RaceCard
                  key={r.id}
                  race={r}
                  displayCandidates={r._displayCandidates}
                  phase={r._phase}
                  onCandidateSelect={onCandidateSelect}
                  onCompareToggle={onCompareToggle}
                  compareIds={compareIds}
                  stateCode={stateCode}
                  electionPhase={election.phase}
                  onNotify={onNotify}
                  forceExpanded={forceOpenRaceId === r.id}
                  focusCandidateId={focusCandidateId}
                  highlightCandidateId={highlightCandidateId}
                  onFocusCandidateConsumed={onFocusCandidateConsumed}
                  onHighlightConsumed={onHighlightConsumed}
                />
              ))}
            </Collapsible>
          ) : (
            <Collapsible title="Races" count={0}>
              <div style={{ padding: '8px 4px', fontSize: '0.82rem', color: 'var(--text-light)', fontStyle: 'italic' }}>
                No races on this ballot yet.
              </div>
            </Collapsible>
          )}

          {/* Measures dropdown (only show when applicable to this phase) */}
          {measureCount > 0 && (
            <Collapsible title="Ballot Measures" count={measureCount}>
              {election.measures.map((m) => (
                <MeasureCard key={m.id || `${m.level}-${m.number || m.title}`} measure={m} />
              ))}
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Collapsible primitive ───────────────────────────────────────────
function Collapsible({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      marginBottom: '8px', border: '1px solid var(--border)', borderRadius: '10px',
      background: 'white', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '10px', padding: '9px 12px',
          background: open ? 'var(--bg)' : 'white',
          border: 'none', borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '0.76rem', color: 'var(--primary)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {title}
          </span>
          {typeof count === 'number' && (
            <span style={{
              fontSize: '0.66rem', fontWeight: 700, padding: '1px 7px',
              background: 'var(--bg)', color: 'var(--text-light)', borderRadius: '10px',
            }}>
              {count}
            </span>
          )}
        </div>
        <span aria-hidden style={{
          fontSize: '0.9rem', color: 'var(--text-light)',
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
        }}>
          ›
        </span>
      </button>
      {open && <div style={{ padding: '10px 10px 8px' }}>{children}</div>}
    </div>
  );
}

// ─── Race card ───────────────────────────────────────────────────────
function RaceCard({
  race, displayCandidates, phase, onCandidateSelect, onCompareToggle,
  compareIds, stateCode, electionPhase, onNotify,
  forceExpanded, focusCandidateId, highlightCandidateId,
  onFocusCandidateConsumed, onHighlightConsumed,
}) {
  const [expanded, setExpanded] = useState(Boolean(forceExpanded));
  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);
  const incumbent = race.incumbent || null;
  const candidates = displayCandidates || [];
  const badgeColor = race.level === 'federal' ? '#6c3ec1' : (race.level === 'local' ? '#e76f51' : '#457b9d');

  // Group primary candidates by party for visual clarity
  const groupedPrimary = useMemo(() => {
    if (phase !== 'primary' || !race.primary_candidates) return null;
    const entries = Object.entries(race.primary_candidates)
      .filter(([, arr]) => (arr || []).length > 0);
    return entries.length ? entries : null;
  }, [phase, race.primary_candidates]);

  return (
    <div style={{
      marginBottom: '8px', padding: '11px 13px',
      background: 'white', border: '1px solid var(--border)', borderRadius: '10px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.3 }}>{race.office}</div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '5px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.64rem', fontWeight: 800, padding: '2px 7px',
              borderRadius: '9px', background: `${badgeColor}22`, color: badgeColor,
              textTransform: 'uppercase', letterSpacing: '0.4px',
            }}>
              {race.level || 'state'}
            </span>
            {race.open_seat && (
              <span style={{
                fontSize: '0.64rem', fontWeight: 800, padding: '2px 7px',
                borderRadius: '9px', background: '#f4a261', color: 'white',
              }}>
                OPEN SEAT
              </span>
            )}
            {incumbent && (
              <span style={{
                fontSize: '0.64rem', fontWeight: 700, padding: '2px 7px',
                borderRadius: '9px', background: 'var(--bg)', color: 'var(--text-light)',
              }}>
                Incumbent: {incumbent.name}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: '8px', fontSize: '0.72rem', fontWeight: 600,
            cursor: 'pointer', color: 'var(--text-light)', whiteSpace: 'nowrap',
          }}
        >
          {expanded ? 'Hide' : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {race.notes && (
        <div style={{ fontSize: '0.76rem', color: 'var(--text-light)', fontStyle: 'italic', marginTop: '6px' }}>
          {race.notes}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '10px' }}>
          {groupedPrimary ? (
            groupedPrimary.map(([party, arr]) => (
              <div key={party} style={{ marginBottom: '6px' }}>
                <div style={{
                  fontSize: '0.66rem', color: PARTY_COLORS[party] || '#666',
                  fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px',
                  padding: '2px 0 4px',
                }}>
                  {party === 'R' ? 'Republican primary' : party === 'D' ? 'Democratic primary' : `${party} primary`}
                </div>
                {(arr || []).map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    isIncumbent={incumbent?.id === c.id}
                    onSelect={onCandidateSelect}
                    onCompareToggle={onCompareToggle}
                    isComparing={compareIds?.has(c.id)}
                    race={race}
                    stateCode={stateCode}
                    electionPhase={electionPhase}
                    onNotify={onNotify}
                    isFocused={focusCandidateId === c.id}
                    isHighlighted={highlightCandidateId === c.id}
                    onFocusCandidateConsumed={onFocusCandidateConsumed}
                    onHighlightConsumed={onHighlightConsumed}
                  />
                ))}
              </div>
            ))
          ) : (
            candidates.map((c) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                isIncumbent={incumbent?.id === c.id}
                onSelect={onCandidateSelect}
                onCompareToggle={onCompareToggle}
                isComparing={compareIds?.has(c.id)}
                race={race}
                stateCode={stateCode}
                electionPhase={electionPhase}
                onNotify={onNotify}
                isFocused={focusCandidateId === c.id}
                isHighlighted={highlightCandidateId === c.id}
                onFocusCandidateConsumed={onFocusCandidateConsumed}
                onHighlightConsumed={onHighlightConsumed}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CandidateRow({
  candidate, isIncumbent, onSelect, onCompareToggle, isComparing,
  race, stateCode, electionPhase, onNotify,
  isFocused, isHighlighted, onFocusCandidateConsumed, onHighlightConsumed,
}) {
  const party = candidate.party || 'NP';
  const partyColor = PARTY_COLORS[party] || '#666';
  const partyBg = PARTY_BG[party] || '#eef';
  const followTarget = toCandidateMember(candidate, race, stateCode, electionPhase);

  // Scroll + pulse when this row is the focus/highlight target. We run once
  // after mount with a small delay so the enclosing Election / Race cards
  // have finished expanding first.
  const rowRef = useRef(null);
  useEffect(() => {
    if (!isFocused && !isHighlighted) return;
    const t = setTimeout(() => {
      const node = rowRef.current;
      if (!node) return;
      try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      node.classList.add('civiclens-pulse');
      setTimeout(() => {
        node.classList.remove('civiclens-pulse');
        if (isFocused && onFocusCandidateConsumed) onFocusCandidateConsumed();
        if (isHighlighted && onHighlightConsumed) onHighlightConsumed();
      }, 1500);
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, isHighlighted]);

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px',
        background: 'var(--bg)', borderRadius: '8px', marginBottom: '6px',
        border: isIncumbent ? '1px solid #f4a261' : '1px solid transparent',
      }}
    >
      <div
        onClick={() => onSelect && onSelect(candidate)}
        role="button"
        style={{
          flex: 1, minWidth: 0, cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center',
        }}
      >
        <div style={{
          width: '34px', height: '34px', borderRadius: '50%',
          background: partyBg, color: partyColor, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: '0.78rem',
        }}>
          {candidate.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.2 }}>
            {candidate.name}
            {isIncumbent && (
              <span style={{
                marginLeft: '6px', fontSize: '0.62rem', fontWeight: 800,
                padding: '1px 6px', borderRadius: '8px', background: '#f4a261', color: 'white',
              }}>
                INCUMBENT
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: '2px' }}>
            {candidate.current_office || candidate.hometown || ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <span style={{
          padding: '1px 8px', borderRadius: '9px', fontSize: '0.66rem', fontWeight: 800,
          background: partyBg, color: partyColor,
        }}>
          {party}
        </span>
        <FollowButton member={followTarget} size="sm" onNotify={onNotify} />
        <CompareButton
          member={followTarget}
          size="sm"
          isComparing={isComparing}
          onCompareToggle={() => onCompareToggle && onCompareToggle(candidate)}
        />
      </div>
    </div>
  );
}

/**
 * Map a candidate dict from the ballot payload to a member-shaped object
 * suitable for the shared FollowButton / CompareButton. We use role_type
 * 'candidate' so the notification-prefs schema picks the candidate shape.
 */
function toCandidateMember(candidate, race, stateCode, electionPhase) {
  if (!candidate) return null;
  return {
    id: candidate.id,
    bioguide_id: candidate.bioguide_id || null,
    name: candidate.name,
    party: candidate.party || null,
    title: race?.office || 'Candidate',
    role: 'candidate',
    role_type: 'candidate',
    chamber: race?.level === 'federal' ? (race?.chamber || null) : null,
    state: stateCode || race?.state || null,
    district: race?.district || null,
    photoUrl: candidate.photoUrl || candidate.image || null,
    // Extras carried for downstream use
    race_id: race?.id || null,
    race_office: race?.office || null,
    election_phase: electionPhase || null,
  };
}

// ─── Ballot-measure card ─────────────────────────────────────────────
function MeasureCard({ measure }) {
  const [expanded, setExpanded] = useState(false);
  const levelColor = measure.level === 'state' ? '#2a9d8f' : '#e76f51';
  return (
    <div
      style={{
        marginBottom: '8px', padding: '11px 13px',
        background: 'white', border: '1px solid var(--border)', borderRadius: '10px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.64rem', fontWeight: 800, padding: '2px 7px',
              borderRadius: '9px', background: `${levelColor}22`, color: levelColor,
              textTransform: 'uppercase', letterSpacing: '0.4px',
            }}>
              {measure.level === 'state' ? 'Statewide' : (measure.county ? `${measure.county} Co.` : 'Local')}
            </span>
            {measure.threshold && (
              <span style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-light)' }}>
                Needs {measure.threshold}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.84rem', fontWeight: 700 }}>
            {measure.number && <span style={{ color: 'var(--accent)' }}>{measure.number}: </span>}
            {measure.title}
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: '8px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
            color: 'var(--text-light)',
          }}
        >
          {expanded ? 'Hide' : 'Details'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: '10px' }}>
          {measure.summary && (
            <p style={{ fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--text)', marginBottom: '10px' }}>
              {measure.summary}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <SupportOppose label="Support" items={measure.support?.arguments} color="#1d5a2c" />
            <SupportOppose label="Oppose" items={measure.opposition?.arguments} color="#8a2424" />
          </div>
          {measure.fiscal_impact && (
            <div style={{
              marginTop: '8px', padding: '8px 10px', background: 'var(--bg)',
              borderRadius: '8px', fontSize: '0.76rem', color: 'var(--text)',
            }}>
              <strong>Fiscal impact:</strong> {measure.fiscal_impact}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SupportOppose({ label, items, color }) {
  if (!items || items.length === 0) return (
    <div style={{
      padding: '8px 10px', background: 'var(--bg)', borderRadius: '8px',
      fontSize: '0.74rem', color: 'var(--text-light)', fontStyle: 'italic',
    }}>
      {label}: —
    </div>
  );
  return (
    <div style={{
      padding: '8px 10px', background: 'var(--bg)', borderRadius: '8px',
      fontSize: '0.76rem', color: 'var(--text)',
    }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', color, marginBottom: '4px' }}>
        {label}
      </div>
      <ul style={{ margin: 0, paddingLeft: '14px', lineHeight: 1.4 }}>
        {items.slice(0, 3).map((arg, idx) => (
          <li key={idx} style={{ marginBottom: '2px' }}>{arg}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────
function ModeChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '7px 10px', fontSize: '0.76rem', fontWeight: 700,
        background: active ? 'white' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-light)',
        border: active ? '1px solid var(--border)' : '1px solid transparent',
        borderRadius: '8px', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function DateLine({ label, value, small }) {
  // Phase 4C: hardcoded #7a5a00 (warning-deep) replaced with the canonical
  // --cl-warning-text token. Used inside countdown / election-window
  // panels where the warning palette signals "time-sensitive."
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
        marginTop: 3,
      }}
    >
      <span
        style={{
          fontSize: small ? 'var(--cl-text-xs)' : 'var(--cl-text-sm)',
          color: 'var(--cl-warning-text)',
          fontWeight: small ? 500 : 700,
        }}
      >
        {label}
      </span>
      <span
        className="cl-num"
        style={{
          fontSize: small ? 'var(--cl-text-xs)' : 'var(--cl-text-sm)',
          color: 'var(--cl-warning-text)',
          fontWeight: 700,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Tag({ children }) {
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 6,
        padding: '1px 7px',
        borderRadius: 'var(--cl-radius-md)',
        fontSize: 'var(--cl-text-2xs)',
        fontWeight: 800,
        background: 'var(--cl-bg-soft)',
        color: 'var(--cl-primary)',
        fontFamily: 'var(--cl-font-sans)',
      }}
    >
      {children}
    </span>
  );
}

function Loading({ children }) {
  // Centered loading text — used inside dense BallotTab sections where a
  // full skeleton card would be out of scale. Tokenized in Phase 4C.
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '40px 20px',
        color: 'var(--cl-text-light)',
        fontFamily: 'var(--cl-font-sans)',
        fontSize: 'var(--cl-text-sm)',
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  // Tab-internal "no data seeded" placeholder. Dashed border is
  // intentional — communicates "intentional empty state, not error."
  return (
    <div
      style={{
        margin: '20px 10px',
        padding: '18px 16px',
        textAlign: 'center',
        background: 'var(--cl-bg)',
        border: '1px dashed var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        color: 'var(--cl-text-light)',
        fontSize: 'var(--cl-text-sm)',
        fontFamily: 'var(--cl-font-sans)',
        lineHeight: 'var(--cl-leading-normal)',
      }}
    >
      {children}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// ── Voter info (Google Civic voterInfoQuery) ──────────────────────────
// Renders the election header + up to 3 collapsible groups: polling
// location(s), early-vote sites, drop-off locations. When there's no
// data yet (off-season, or Google hasn't published polling places for
// the upcoming election yet — typically < 30–60 days out) we show a
// gentle empty state so users know the feature is alive and will
// populate as election day approaches.
function VoterInfoBlock({ loading, data, error, disabled }) {
  // Debug breadcrumbs so you can diagnose from devtools without reading the code.
  useEffect(() => {
    if (disabled) {
      console.debug('[CivicLens] voterInfo: disabled (GOOGLE_CIVIC_API_KEY not set on backend)');
    } else if (error) {
      console.debug('[CivicLens] voterInfo: error', error);
    } else if (!loading && data) {
      const sizes = {
        polling: (data.polling_locations || []).length,
        early:   (data.early_vote_sites  || []).length,
        dropoff: (data.drop_off_locations || []).length,
        contests: (data.contests || []).length,
        election: data.election?.name || null,
      };
      console.debug('[CivicLens] voterInfo payload:', sizes);
    }
  }, [loading, data, error, disabled]);

  if (disabled) {
    return null; // server has no key — stay quiet, this is the opt-out path
  }

  if (loading) {
    return (
      <div style={{
        padding: '10px 14px', marginBottom: '12px', background: 'white',
        border: '1px solid var(--border)', borderRadius: '10px',
        fontSize: '0.78rem', color: 'var(--text-light)',
      }}>
        Looking up your polling place…
      </div>
    );
  }

  const polling = (data && data.polling_locations) || [];
  const early   = (data && data.early_vote_sites)  || [];
  const dropoff = (data && data.drop_off_locations) || [];
  const election = data && data.election;
  const hasAnyLocations = polling.length || early.length || dropoff.length;

  // Network / parse failure — distinct from "off-season, no data yet".
  if (error && !hasAnyLocations) {
    return (
      <div style={{
        padding: '10px 14px', marginBottom: '12px', background: 'white',
        border: '1px solid var(--border)', borderRadius: '10px',
        fontSize: '0.78rem', color: 'var(--text-light)',
      }}>
        Couldn&apos;t load polling-place info right now. Check again later.
      </div>
    );
  }

  // Off-season / no election currently keyed to this address. Show a
  // subtle placeholder rather than hiding, so users know the block exists.
  if (!election && !hasAnyLocations) {
    return (
      <div style={{
        padding: '12px 14px', marginBottom: '14px', background: 'white',
        border: '1px solid var(--border)', borderRadius: '12px',
      }}>
        <div style={{
          fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px',
          textTransform: 'uppercase', color: 'var(--primary)', marginBottom: '6px',
        }}>
          Where to vote
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
          Polling places and early-vote sites will appear here as election day approaches.
          Google publishes this ~30–60 days before a state&apos;s next election.
        </div>
        <div style={{ marginTop: '8px', fontSize: '0.68rem', color: 'var(--text-light)' }}>
          Source: Google Civic Information
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 14px', marginBottom: '14px', background: 'white',
      border: '1px solid var(--border)', borderRadius: '12px',
    }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px',
        textTransform: 'uppercase', color: 'var(--primary)', marginBottom: '4px',
      }}>
        Where to vote
      </div>
      {election && (
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: '10px' }}>
          {election.name}
          {election.day && (
            <span style={{ color: 'var(--text-light)', fontWeight: 400, marginLeft: '6px' }}>
              · {formatDate(election.day)}
            </span>
          )}
        </div>
      )}

      {polling.length > 0 && (
        <LocationGroup label="Polling place" locations={polling} />
      )}
      {early.length > 0 && (
        <LocationGroup label="Early voting" locations={early} />
      )}
      {dropoff.length > 0 && (
        <LocationGroup label="Ballot drop-off" locations={dropoff} />
      )}

      <div style={{ marginTop: '8px', fontSize: '0.68rem', color: 'var(--text-light)' }}>
        Source: Google Civic Information
      </div>
    </div>
  );
}

function LocationGroup({ label, locations }) {
  // Collapsed by default past the first location to keep the block small.
  const [expanded, setExpanded] = useState(false);
  const first = locations[0];
  const rest = locations.slice(1);
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-light)',
        textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '4px',
      }}>
        {label}
      </div>
      <LocationRow loc={first} />
      {rest.length > 0 && (
        <>
          {expanded && rest.map((loc, i) => <LocationRow key={i} loc={loc} />)}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: '4px', background: 'none', border: 'none',
              padding: 0, fontSize: '0.74rem', color: 'var(--primary)',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            {expanded ? 'Show less' : `Show ${rest.length} more`}
          </button>
        </>
      )}
    </div>
  );
}

function LocationRow({ loc }) {
  if (!loc) return null;
  const mapsHref = loc.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`
    : null;
  return (
    <div style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
      {loc.name && (
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>
          {loc.name}
        </div>
      )}
      {loc.address && (
        mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.78rem', color: 'var(--primary)', textDecoration: 'none' }}
          >
            {loc.address}
          </a>
        ) : (
          <div style={{ fontSize: '0.78rem', color: 'var(--text)' }}>{loc.address}</div>
        )
      )}
      {loc.hours && (
        <div style={{ fontSize: '0.74rem', color: 'var(--text-light)', marginTop: '2px', whiteSpace: 'pre-wrap' }}>
          {loc.hours}
        </div>
      )}
      {(loc.start_date || loc.end_date) && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: '2px' }}>
          {loc.start_date && formatDate(loc.start_date)}
          {loc.start_date && loc.end_date && ' – '}
          {loc.end_date && formatDate(loc.end_date)}
        </div>
      )}
    </div>
  );
}
