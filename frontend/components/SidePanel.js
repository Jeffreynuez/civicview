'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';
import { Skeleton } from './ui';
import PersonCard from './PersonCard';
import ProfileView from './ProfileView';
import AddressLookup from './AddressLookup';
import StatewideOfficialsTab from './StatewideOfficialsTab';
import LocalOfficialsTab from './LocalOfficialsTab';
import BallotTab from './BallotTab';
import NationalOfficialsPanel from './NationalOfficialsPanel';

// Known Federal Register slugs for presidents we have data on — mirrors
// PRESIDENT_FEDREG_SLUGS in the backend so we can build an executive-orders
// URL without a round-trip.
const PRESIDENT_FEDREG_SLUGS = {
  'us-pres-trump':   'donald-trump',
  'us-pres-biden':   'joseph-r-biden',
  'us-pres-obama':   'barack-obama',
  'us-pres-wbush':   'george-w-bush',
  'us-pres-clinton': 'william-j-clinton',
};

// Turn a state-official dict (from /api/state-officials) into a member object
// ProfileView can render. Injects `role_type`, `chamber`, `state`, `district`,
// and preserves the `contact` block so the Contact tab can render without a
// backend round-trip.
function toStateMember(person, roleType, stateCode) {
  if (!person) return null;
  const chamberByRole = {
    state_governor: 'Executive',
    state_cabinet: 'Executive',
    state_legislator:
      (person.chamber && /house/i.test(person.chamber)) ? 'State House'
      : (person.chamber && /senate/i.test(person.chamber)) ? 'State Senate'
      : (person.chamber || 'State Legislature'),
    state_scotus: 'State Supreme Court',
    state_dca: person.chamber || 'District Court of Appeal',
    state_circuit_judge: person.chamber || 'Circuit Court',
    state_county_judge: person.chamber || 'County Court',
  };
  return {
    ...person,
    id: person.id,
    bioguide_id: person.bioguide_id || null,
    name: person.name,
    party: person.party || null,
    title: person.role || person.title || '',
    chamber: person.chamber || chamberByRole[roleType] || null,
    state: person.state || (stateCode ? stateCode.toUpperCase() : null),
    district: person.district || null,
    role_type: roleType,
    photoUrl: person.image || person.photoUrl || null,
    contact: person.contact || null,
  };
}

// Turn a federal-official dict (from /api/federal-officials) into a member
// object that ProfileView can render. Injects `role_type`, `chamber`, and —
// for presidents — `federal_register_slug`.
function toFederalMember(person, roleType) {
  if (!person) return null;
  const chamberByRole = {
    president: 'Executive Branch',
    vice_president: 'Executive Branch',
    cabinet: person.department || 'Cabinet',
    scotus: 'Supreme Court',
    congress_leader: person.chamber || 'U.S. Congress',
  };
  return {
    ...person,
    id: person.id,
    // Synthetic: no bioguide_id on most federal officials, but some Congress
    // leaders have one and the existing Congress flow uses it.
    bioguide_id: person.bioguide_id || null,
    name: person.name,
    party: person.party || null,
    title: person.role || person.title || '',
    chamber: person.chamber || chamberByRole[roleType] || null,
    role_type: roleType,
    photoUrl: person.image || person.photoUrl || null,
    federal_register_slug:
      person.federal_register_slug || PRESIDENT_FEDREG_SLUGS[person.id] || null,
  };
}

export default function SidePanel({
  stateData,
  stateCode,
  stateName,
  selectedMember,
  onMemberSelect,
  onBack,
  onClose,
  backLabel,
  onOnBallotClick,
  loading,
  isLive,
  onNotify,
  onAddressResult,
  activeDistrict,
  onClearDistrict,
  compareIds,
  onCompareToggle,
  onCandidateSelect,
  onCandidateCompareToggle,
  compareCandidateIds,
  onCandidatePick,
  activeTab: activeTabProp,
  onActiveTabChange,
  width = 380,
  highlightMemberId,
  highlightCandidateId,
  onHighlightConsumed,
  focusCandidateId,
  onFocusCandidateConsumed,
  // Pages layer — forwarded to PersonCard/ProfileView/NationalOfficialsPanel
  // so every entrypoint can launch the full-page social view.
  onOpenPage,
  // NOP hero / CTA-strip "Find my reps" / "Verify your address" —
  // wired by parent to open CitizenLoginModal so unauth visitors can
  // sign in. Forwarded only to NationalOfficialsPanel.
  onRequestVerify,
  // NOP Browse-by-State grid — clicks pick a state and route through
  // the parent's existing state-selection flow (same handler used by
  // MapView clicks).
  onStatePick,
  // Phase 4C: BallotTab voter-status banner reads the current citizen
  // for the registered/out-of-state variant. Forwarded transparently
  // — null when no citizen is signed in, in which case the banner is
  // omitted.
  citizen,
  // NOP footer Citizen-column wires (mirror the navbar buttons of the
  // same name). Forwarded only to NationalOfficialsPanel.
  onOpenTracked,
  onSubscribe,
  // True on viewports ≤768px. When set, SidePanel takes 100% width
  // (the panel sits below the map in a vertical stack) and the panel-
  // width prop is ignored.
  isMobile = false,
  // True on any phone-sized viewport regardless of orientation —
  // includes mobile-portrait (where isMobile is also true) AND
  // mobile-landscape (where isMobile is false because the layout
  // is side-by-side like desktop). Drives touch-specific behaviors
  // that should apply in both orientations: header collapse on
  // scroll, etc.
  isTouch = false,
  // True when the user has dragged the mobile drag handle all the way
  // down (map height = 0) OR widened the panel to fully cover the map
  // in landscape. Used together with scroll position to hide the panel
  // header on mobile so the rep window gets the full visible area.
  // Has no effect on desktop, where the header is always shown.
  mapCollapsed = false,
}) {
  const isInCompare = (m) => Boolean(compareIds && m && compareIds.has(m.bioguide_id || m.id));
  // Controlled tab state when the parent lifts it (so selecting a candidate
  // from the Elections tab and clicking Back returns to Elections, not
  // Congress). Falls back to uncontrolled local state for any older callers.
  const [localActiveTab, setLocalActiveTab] = useState('congress');
  const activeTab = activeTabProp !== undefined ? activeTabProp : localActiveTab;
  const setActiveTab = onActiveTabChange || setLocalActiveTab;
  const [showLookupInPanel, setShowLookupInPanel] = useState(false);
  const [partyFilter, setPartyFilter] = useState('all'); // 'all' | 'R' | 'D' | 'I'
  const [chamberFilter, setChamberFilter] = useState('all'); // 'all' | 'Senate' | 'House'
  const [sortBy, setSortBy] = useState('name-asc'); // 'name-asc'|'name-desc'|'tenure-long'|'tenure-short'

  // Back-to-top FAB + collapsing header. The scroll container (line
  // ~330) is the only element here that scrolls — both NOP and the
  // state tabs render inside it. The same scroll listener powers two
  // things:
  //   - showBackToTop: scrollTop > 600 → render the bottom-right FAB
  //   - scrolled:      scrollTop > 40  → hide the panel header on
  //     mobile so the rep window gets the full vertical space (the
  //     header is "United States · National officials …" or the
  //     state name when one is selected, and is over-cumbersome on a
  //     short mobile viewport once the user has started reading).
  const scrollRef = useRef(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setShowBackToTop(el.scrollTop > 600);
      setScrolled(el.scrollTop > 40);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  // Header collapses on any touch viewport (portrait OR landscape) when
  // the user has scrolled into content OR when the map has been fully
  // closed/covered. Desktop always shows the header — the larger
  // viewport doesn't have the same vertical squeeze.
  const hideHeader = isTouch && (scrolled || mapCollapsed);

  // Measure the header's natural height so the slide-up animation can
  // transition from 0 → measured-px (and back) smoothly. ResizeObserver
  // keeps the measurement live as the active-district chip appears /
  // disappears or the panel is resized. Without a measured height we'd
  // either have to hardcode a max or use max-height (which animates
  // clunkily because the easing curve runs to a value larger than the
  // actual content height).
  const headerInnerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerInnerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      setHeaderHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const handleBackToTop = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // NOTE: ProfileView is rendered as an absolutely-positioned overlay at
  // the bottom of this component (search for "ProfileView overlay" below)
  // *instead of* via an early return. That way the SidePanel's scroll
  // container — which hosts NOP and the state tabs — is never unmounted
  // when the user opens a profile, so its scrollTop is preserved
  // naturally and the user lands back exactly where they were on Back.
  // (An earlier attempt used an early return + useLayoutEffect-based
  // scroll restore, but NOP re-fetches on remount and the scroll
  // container's height was too small to honor scrollTop until after the
  // fetch resolved.)

  // When an address-lookup district is active, narrow the Congress list to just
  // that district's Representative (plus the state's two Senators).
  const filterByDistrict = (reps) => {
    if (!activeDistrict || !reps) return reps || [];
    const d = activeDistrict.district;
    if (d === 'At-Large') {
      // Single-district states: keep whichever rep(s) the backend returned
      return reps;
    }
    const asNum = Number(d);
    return reps.filter((r) => Number(r.district) === asNum);
  };

  const applyUserFilters = (members) => {
    let out = members;
    if (partyFilter !== 'all') out = out.filter((m) => (m.party || 'I') === partyFilter);
    // chamberFilter applies at the section level (senators vs reps), so it's
    // interpreted in rendering rather than here
    const comparators = {
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name),
      'tenure-long': (a, b) => (parseInt(a.serving_since || '9999') - parseInt(b.serving_since || '9999')),
      'tenure-short': (a, b) => (parseInt(b.serving_since || '0') - parseInt(a.serving_since || '0')),
    };
    const cmp = comparators[sortBy] || comparators['name-asc'];
    return [...out].sort(cmp);
  };

  const rawSenators = stateData?.congress?.senators || [];
  const rawReps = filterByDistrict(stateData?.congress?.representatives);

  const showSenators = chamberFilter === 'all' || chamberFilter === 'Senate';
  const showReps = chamberFilter === 'all' || chamberFilter === 'House';
  const districtSenators = showSenators ? applyUserFilters(rawSenators) : [];
  const districtReps = showReps ? applyUserFilters(rawReps) : [];

  const activeFilterCount =
    (partyFilter !== 'all' ? 1 : 0) + (chamberFilter !== 'all' ? 1 : 0) + (sortBy !== 'name-asc' ? 1 : 0);

  return (
    <div
      className="flex flex-col overflow-hidden bg-white"
      style={
        isMobile
          ? { width: '100%', flex: 1, minHeight: 0, position: 'relative' }
          : { width: `${width}px`, flexShrink: 0, position: 'relative' }
      }
    >
      {/* Header — collapses on touch viewports when the user scrolls
          past 40px OR when the map has been fully closed/covered.
          Two-layer animation for a smooth slide:
            - Outer wrapper: animates `height` from measured-px → 0 so
              the layout below (tabs, content) flows up to fill the
              vacated space.
            - Inner content:  uses `transform: translateY(-100%)` so the
              header text actually slides up out of frame instead of
              just being clipped in place.
          Both transitions share the same duration + easing so they
          stay locked together. aria-hidden toggles in lockstep so
          screen readers don't read a hidden header. */}
      <div
        aria-hidden={hideHeader}
        style={{
          height: hideHeader ? 0 : headerHeight,
          overflow: 'hidden',
          transition: 'height 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          // Border only renders in the open state so we don't get a
          // thin floating line above the tabs when collapsed.
          borderBottom: hideHeader ? 'none' : '1px solid var(--cl-border)',
          background: 'var(--cl-bg)',
          flexShrink: 0,
        }}
      >
        <div
          ref={headerInnerRef}
          style={{
            transform: hideHeader ? 'translateY(-100%)' : 'translateY(0)',
            transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div style={{ padding: '16px 20px' }}>
          <h2 style={{ fontSize: '1.1rem', color: 'var(--cl-primary)', marginBottom: '2px', fontWeight: 700 }}>
            {stateName || 'United States'}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--cl-text-light)' }}>
            {stateName
              ? `Elected officials and upcoming elections${isLive ? ' · Live data' : ''}`
              : 'National officials — look up your district or click a state on the map'}
          </p>

        {/* District filter chip - shown when an address lookup is active */}
        {activeDistrict && (
          <div
            style={{
              marginTop: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'white',
              border: '1px solid var(--cl-border)',
              borderRadius: '999px',
              padding: '5px 8px 5px 12px',
              fontSize: '0.78rem',
            }}
          >
            <span style={{ color: 'var(--cl-accent)', fontWeight: 700 }}>
              {activeDistrict.districtLabel || `${activeDistrict.stateCode} — ${activeDistrict.district}`}
            </span>
            <span style={{ color: 'var(--cl-text-light)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeDistrict.address}
            </span>
            <button
              onClick={onClearDistrict}
              title="Show all representatives for this state"
              style={{
                padding: '2px 8px',
                background: 'var(--cl-bg)',
                border: '1px solid var(--cl-border)',
                borderRadius: '999px',
                fontSize: '0.72rem',
                color: 'var(--cl-text-light)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--cl-accent)'; e.currentTarget.style.color = 'var(--cl-accent)'; }}
              onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--cl-border)'; e.currentTarget.style.color = 'var(--cl-text-light)'; }}
            >
              Clear
            </button>
          </div>
        )}
        </div>
        </div>
      </div>

      {/* Tabs — Congress / State / Local / Elections. Mobile bumps
          padding so the row clears the 44px tap-target minimum and
          shrinks the font slightly so "🗳 Elections" doesn't wrap on
          a 375px screen. */}
      {stateData && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--cl-border)', background: 'white' }}>
          {[
            { key: 'congress', label: 'Congress' },
            { key: 'state', label: 'State' },
            { key: 'local', label: 'Local' },
            { key: 'ballot', label: '🗳 Elections' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                flex: 1,
                padding: isMobile ? '14px 4px' : '10px',
                textAlign: 'center',
                fontSize: isMobile ? '0.78rem' : '0.8rem',
                fontWeight: 600,
                color: activeTab === key ? 'var(--cl-primary)' : 'var(--cl-text-light)',
                borderBottom: activeTab === key ? '2px solid var(--cl-accent)' : '2px solid transparent',
                cursor: 'pointer', background: 'none', border: 'none',
                borderBottomStyle: 'solid',
                borderBottomWidth: '2px',
                borderBottomColor: activeTab === key ? 'var(--cl-accent)' : 'transparent',
                transition: 'all 0.2s',
                minHeight: isMobile ? 44 : undefined,
                whiteSpace: 'nowrap',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--cl-bg)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Content — single scroll container that survives the
          ProfileView overlay (member case) and the SidePanel-hidden
          state (candidate case in page.js). Browser preserves its
          scrollTop across both, so Back lands the user exactly where
          they were. */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {loading && (
          <div style={{ padding: 16 }}>
            <Skeleton variant="list" count={3} />
          </div>
        )}

        {!loading && !stateData && (
          <div>
            {/* Address Lookup — the main CTA */}
            <AddressLookup
              onResult={(data) => {
                if (onAddressResult) onAddressResult(data);
              }}
              onMemberSelect={onMemberSelect}
            />

            {/* National officials — landing-page layout (Hero → Executive
                → Senate / House Leadership → SCOTUS → CTA strip → Footer).
                The "or click any state on the map" hint that used to sit
                here was redundant with the panel header subtitle ("National
                officials — look up your district or click a state on the
                map") and was burning ~38px of vertical space the panel
                content needs more — removed.
                onOpenPage routes through to handleOpenPage in page.js so
                the Page button on each card opens the rep's PageView. */}
            <NationalOfficialsPanel
              onSelectPerson={(person, roleType) => {
                const m = toFederalMember(person, roleType);
                if (m && onMemberSelect) onMemberSelect(m);
              }}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
              onOpenPage={onOpenPage}
              onRequestVerify={onRequestVerify}
              onStatePick={onStatePick}
              citizen={citizen}
              onOpenTracked={onOpenTracked}
              onSubscribe={onSubscribe}
            />
          </div>
        )}

        {/* Congress Tab */}
        {!loading && stateData && activeTab === 'congress' && (
          <>
            {/* Filter & sort controls (hidden when a district filter is active) */}
            {!activeDistrict && (
              <FilterBar
                partyFilter={partyFilter} setPartyFilter={setPartyFilter}
                chamberFilter={chamberFilter} setChamberFilter={setChamberFilter}
                sortBy={sortBy} setSortBy={setSortBy}
                activeFilterCount={activeFilterCount}
                onReset={() => { setPartyFilter('all'); setChamberFilter('all'); setSortBy('name-asc'); }}
              />
            )}

            {/* Persistent entry point: let the user search a different address */}
            {!activeDistrict && (
              showLookupInPanel ? (
                <div style={{ border: '1px solid var(--cl-border)', borderRadius: '10px', marginBottom: '10px', background: 'var(--cl-bg)' }}>
                  <AddressLookup
                    onResult={(data) => {
                      setShowLookupInPanel(false);
                      if (onAddressResult) onAddressResult(data);
                    }}
                    onMemberSelect={onMemberSelect}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowLookupInPanel(true)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    marginBottom: '10px',
                    background: 'white',
                    border: '1px dashed var(--cl-border)',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    color: 'var(--cl-accent)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.borderStyle = 'solid')}
                  onMouseOut={(e) => (e.currentTarget.style.borderStyle = 'dashed')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                  <span>Find my district by address</span>
                </button>
              )
            )}

            {districtSenators.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 12px' }}>
                  {activeDistrict ? 'Your Senators' : `Senators (${districtSenators.length})`}
                </div>
                {districtSenators.map((m) => (
                  <PersonCard
                    key={m.id}
                    member={m}
                    onClick={() => onMemberSelect(m)}
                    onCompareToggle={onCompareToggle}
                    isComparing={isInCompare(m)}
                    onNotify={onNotify}
                    highlight={
                      highlightMemberId &&
                      (m.bioguide_id === highlightMemberId || m.id === highlightMemberId)
                    }
                    onHighlightConsumed={onHighlightConsumed}
                    onOpenPage={onOpenPage}
                  />
                ))}
              </div>
            )}
            {districtReps.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 12px' }}>
                  {activeDistrict
                    ? `Your Representative (District ${activeDistrict.district})`
                    : `Representatives (${districtReps.length})`}
                </div>
                {districtReps.map((m) => (
                  <PersonCard
                    key={m.id}
                    member={m}
                    onClick={() => onMemberSelect(m)}
                    onCompareToggle={onCompareToggle}
                    isComparing={isInCompare(m)}
                    onNotify={onNotify}
                    highlight={
                      highlightMemberId &&
                      (m.bioguide_id === highlightMemberId || m.id === highlightMemberId)
                    }
                    onHighlightConsumed={onHighlightConsumed}
                    onOpenPage={onOpenPage}
                  />
                ))}
              </div>
            )}
            {activeDistrict && districtReps.length === 0 && (
              <div style={{ padding: '12px', background: '#fff8e1', border: '1px solid #ffe08a', borderRadius: '8px', fontSize: '0.82rem', color: '#856404', margin: '8px 0' }}>
                Couldn&apos;t find the District {activeDistrict.district} representative in our current data set.
                <button
                  onClick={onClearDistrict}
                  style={{ marginLeft: '6px', padding: '2px 8px', background: 'white', border: '1px solid #ffe08a', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', color: '#856404', fontWeight: 600 }}
                >
                  Show all reps
                </button>
              </div>
            )}
            {(!districtSenators.length && !districtReps.length && !activeDistrict) && (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--cl-text-light)' }}>
                <p style={{ fontSize: '0.95rem', fontWeight: 500 }}>Data coming soon</p>
                <p style={{ fontSize: '0.82rem', marginTop: '4px' }}>We&apos;re building out data coverage for this state.</p>
              </div>
            )}
          </>
        )}

        {/* State Tab — governor + cabinet + state legislature (curated JSON) */}
        {!loading && stateData && activeTab === 'state' && (
          <StatewideOfficialsTab
            stateCode={stateCode}
            stateName={stateName}
            onNotify={onNotify}
            onSelectPerson={(person, roleType) => {
              const m = toStateMember(person, roleType, stateCode);
              if (m && onMemberSelect) onMemberSelect(m);
            }}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        )}

        {/* Local Tab — city picker → mayor + council */}
        {!loading && stateData && activeTab === 'local' && (
          <LocalOfficialsTab
            stateCode={stateCode}
            stateName={stateName}
            initialCitySlug={activeDistrict?.citySlug}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        )}

        {/* Ballot Tab — upcoming races + candidates + measures */}
        {!loading && stateData && activeTab === 'ballot' && (
          <BallotTab
            stateCode={stateCode}
            stateName={stateName}
            activeDistrict={activeDistrict}
            onCandidateSelect={onCandidateSelect}
            onCompareToggle={onCandidateCompareToggle}
            compareIds={compareCandidateIds}
            onNotify={onNotify}
            citizen={citizen}
            focusCandidateId={focusCandidateId}
            onFocusCandidateConsumed={onFocusCandidateConsumed}
            highlightCandidateId={highlightCandidateId}
            onHighlightConsumed={onHighlightConsumed}
          />
        )}
      </div>

      {/* Back-to-top FAB — only renders once the user has scrolled past
          ~600px in the scroll container above. Hidden when a profile is
          open (the ProfileView overlay sits above this and has its own
          back/close affordances). Position is bottom-right of the panel
          with a generous offset so it doesn't crowd the citizen-banner /
          mobile drag handle. Pointer-events:none on the wrapper so the
          fade-out doesn't block clicks underneath. */}
      {!selectedMember && (
        <div
          aria-hidden={!showBackToTop}
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            pointerEvents: showBackToTop ? 'auto' : 'none',
            opacity: showBackToTop ? 1 : 0,
            transform: showBackToTop ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.18s ease, transform 0.18s ease',
            zIndex: 6,
          }}
        >
          <button
            type="button"
            onClick={handleBackToTop}
            aria-label="Back to top"
            title="Back to top"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--cl-primary, #1b263b)',
              color: 'white',
              border: 'none',
              boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
              cursor: 'pointer',
              fontFamily: 'var(--cl-font-sans)',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--cl-primary-light, #415a77)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'var(--cl-primary, #1b263b)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 3l5 5h-3v5H6V8H3l5-5z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      )}

      {/* ProfileView overlay — covers the entire SidePanel chrome whenever
          a member is selected. Critically, the SidePanel content above is
          NOT torn down: its scroll container stays mounted with its
          scrollTop intact, so when the user hits Back / × the panel
          appears exactly where they left it (no remount, no refetch, no
          jump to top).

          On mobile we promote this to a full-viewport overlay (position:
          fixed, top: 56px so the navbar stays visible). The map takes
          the top half and the panel takes the bottom in browse mode, so
          the in-panel overlay would only cover ~60% of the viewport —
          way too cramped for reading a profile. Going fullscreen below
          the navbar matches the mobile UX expectation that opening a
          person's page is a takeover interaction. */}
      {selectedMember && (
        <div
          style={
            isMobile
              ? {
                  position: 'fixed',
                  // 56px = the navbar's fixed height. Keep it in sync if
                  // we ever change the navbar height.
                  top: 56,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'white',
                  display: 'flex',
                  flexDirection: 'column',
                  // Below the navbar (z:50) so the navbar's logo / search
                  // / menu stay reachable. The map's NotificationBanner
                  // is z:50 too, so a transient district-selection
                  // banner could briefly float over the profile — fine,
                  // it self-dismisses in 4 seconds and only fires on
                  // map-side interactions the user isn't doing inside
                  // a profile.
                  zIndex: 45,
                }
              : {
                  position: 'absolute',
                  inset: 0,
                  background: 'white',
                  display: 'flex',
                  flexDirection: 'column',
                  zIndex: 5,
                }
          }
        >
          <ProfileView
            member={selectedMember}
            width={width}
            isMobile={isMobile}
            onBack={onBack}
            onClose={onClose}
            backLabel={backLabel}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            isComparing={isInCompare(selectedMember)}
            onCandidatePick={onCandidatePick}
            onOnBallotClick={onOnBallotClick}
            onOpenPage={onOpenPage}
          />
        </div>
      )}
    </div>
  );
}

// ─── Filter / sort bar ────────────────────────────────────────────────
function FilterBar({
  partyFilter, setPartyFilter,
  chamberFilter, setChamberFilter,
  sortBy, setSortBy,
  activeFilterCount, onReset,
}) {
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
        padding: '8px 10px', marginBottom: '10px',
        background: 'white', border: '1px solid var(--cl-border)', borderRadius: '10px',
      }}
    >
      <Chip label="All" active={partyFilter === 'all'} onClick={() => setPartyFilter('all')} />
      <Chip label="R" active={partyFilter === 'R'} onClick={() => setPartyFilter('R')} color="#e63946" />
      <Chip label="D" active={partyFilter === 'D'} onClick={() => setPartyFilter('D')} color="#457b9d" />
      <Chip label="I" active={partyFilter === 'I'} onClick={() => setPartyFilter('I')} color="#6c3ec1" />
      <div style={{ width: '1px', height: '18px', background: 'var(--cl-border)', margin: '0 4px' }} />
      <Chip label="Both" active={chamberFilter === 'all'} onClick={() => setChamberFilter('all')} />
      <Chip label="Senate" active={chamberFilter === 'Senate'} onClick={() => setChamberFilter('Senate')} />
      <Chip label="House" active={chamberFilter === 'House'} onClick={() => setChamberFilter('House')} />
      <div style={{ flex: 1 }} />
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        aria-label="Sort representatives"
        style={{
          fontSize: '0.74rem', fontWeight: 600, padding: '4px 8px',
          border: '1px solid var(--cl-border)', borderRadius: '14px',
          background: 'white', color: 'var(--cl-text)', cursor: 'pointer',
        }}
      >
        <option value="name-asc">Name A-Z</option>
        <option value="name-desc">Name Z-A</option>
        <option value="tenure-long">Tenure: longest</option>
        <option value="tenure-short">Tenure: newest</option>
      </select>
      {activeFilterCount > 0 && (
        <button
          onClick={onReset}
          title="Reset filters"
          style={{
            padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600,
            background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
            borderRadius: '14px', color: 'var(--cl-text-light)', cursor: 'pointer',
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

function Chip({ label, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.3px',
        borderRadius: '14px', cursor: 'pointer',
        border: active
          ? `1.5px solid ${color || 'var(--cl-accent)'}`
          : '1px solid var(--cl-border)',
        background: active ? (color ? `${color}14` : 'var(--cl-bg)') : 'white',
        color: active ? (color || 'var(--cl-accent)') : 'var(--cl-text-light)',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}
