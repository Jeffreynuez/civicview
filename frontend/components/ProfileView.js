'use client';

import { useEffect, useRef, useState } from 'react';
import { Spinner } from './ui';
import {
  fetchExecutiveOrders,
  fetchGovernorActions,
  fetchMemberBills,
  fetchMemberContact,
  fetchMemberEvents,
  fetchMemberStats,
  fetchMemberVotes,
  fetchPresidentialActions,
  fetchSCOTUSCases,
  fetchStateCourtCases,
  fetchStateLegislatorBills,
  fetchStateLegislatorVotes,
} from '../lib/api';
import { billKey, isTracked as isBillTracked, trackBill, untrackBill, useTrackedBills } from '../lib/trackedBills';
import {
  isOfficialTracked,
  toggleOfficial,
  useTrackedOfficials,
} from '../lib/trackedOfficials';
import SelectionBadge from './SelectionBadge';
import OnBallotBadge from './OnBallotBadge';
import PageButton from './PageButton';
import TabStrip from './TabStrip';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent' };

// Per-role tab configuration. Congress members fall through to 'congress'
// so the existing US-Senate/US-House behavior is preserved.
const ROLE_TABS = {
  congress: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'bills', label: 'Bills' },
    { id: 'votes', label: 'Votes' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  congress_leader: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'bills', label: 'Bills' },
    { id: 'votes', label: 'Votes' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  president: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'exec_orders', label: 'Exec. Orders' },
    { id: 'pres_actions', label: 'Bills' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  vice_president: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'pres_actions', label: 'Bills' },
    { id: 'votes', label: 'Votes' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  cabinet: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  scotus: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Focus' },
    { id: 'experience', label: 'Experience' },
    { id: 'cases', label: 'Cases' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  // ── State-level roles ──────────────────────────────────────────────
  state_governor: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'exec_orders', label: 'Exec. Orders' },
    { id: 'gov_actions', label: 'Bills' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  state_cabinet: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  state_legislator: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'state_bills', label: 'Bills' },
    { id: 'state_votes', label: 'Votes' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  state_scotus: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Focus' },
    { id: 'experience', label: 'Experience' },
    { id: 'state_cases', label: 'Cases' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  state_dca: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Focus' },
    { id: 'experience', label: 'Experience' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  state_circuit_judge: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Focus' },
    { id: 'experience', label: 'Experience' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  state_county_judge: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Focus' },
    { id: 'experience', label: 'Experience' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
  // ── Local roles (mayors + council members) ─────────────────────────
  local_official: [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'experience', label: 'Experience' },
    { id: 'events', label: 'Events' },
    { id: 'contact', label: 'Contact' },
  ],
};

// Role-type groupings used across data loaders, overview layout, and the
// non-Congress short-circuit for contact / events fetches.
const STATE_ROLES = new Set([
  'state_governor', 'state_cabinet', 'state_legislator',
  'state_scotus', 'state_dca', 'state_circuit_judge', 'state_county_judge',
]);

function isStateRole(role) { return STATE_ROLES.has(role); }

function resolveRole(member) {
  if (!member) return 'congress';
  if (member.role_type && ROLE_TABS[member.role_type]) return member.role_type;
  return 'congress';
}

export default function ProfileView({
  member, onBack, onClose, backLabel, onNotify,
  onCompareToggle, isComparing, onCandidatePick, onOnBallotClick,
  // Pages layer: opens the rep/candidate's page view. Rendered as a pill
  // next to Follow/Compare so the Pages entrypoint is always one click away.
  onOpenPage,
  width = 380,
  // True on viewports ≤768px. When set, ProfileView fills its parent
  // (SidePanel overlay) instead of using the desktop fixed width.
  isMobile = false,
}) {
  // Subscribe to the persistent trackedOfficials store so the hero Follow
  // button stays in sync with icon buttons elsewhere in the app (roster
  // rows, local tab, etc.) and survives reloads.
  useTrackedOfficials();
  const isFollowing = isOfficialTracked(member);
  const [activeTab, setActiveTab] = useState('overview');

  // Hero collapse state — when true, the hero is condensed to a single
  // row (back arrow + small avatar + name + party chip + ✕). Frees up
  // vertical space so the tabs and tab content stay reachable on
  // viewports where the full hero would take the entire fold (mobile
  // landscape especially). Persisted across reloads as a user
  // preference. Try/catch around localStorage so private-mode Safari
  // doesn't throw.
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('cl:profile:hero-collapsed');
      if (stored === '1') setHeroCollapsed(true);
    } catch { /* ignore */ }
  }, []);
  const toggleHero = () => {
    setHeroCollapsed((v) => {
      const next = !v;
      try { window.localStorage.setItem('cl:profile:hero-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const role = resolveRole(member);
  const tabs = ROLE_TABS[role] || ROLE_TABS.congress;
  const isCongressRole = role === 'congress' || role === 'congress_leader';
  // Stable cache key for all lazy loaders — Congress members use bioguide_id,
  // federal officials use their seed id (e.g. 'us-pres-trump').
  const cacheKey = member.bioguide_id || member.id;

  // Lazy-loaded data caches
  const [statsState, setStatsState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [billsState, setBillsState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [contactState, setContactState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [eventsState, setEventsState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  // Federal-specific buckets
  const [eoState, setEoState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [paState, setPaState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [casesState, setCasesState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  // State-specific buckets
  const [stateBillsState, setStateBillsState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [stateVotesState, setStateVotesState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [govActionsState, setGovActionsState] = useState({ loading: false, loaded: false, data: null, isLive: false });
  const [stateCasesState, setStateCasesState] = useState({ loading: false, loaded: false, data: null, isLive: false });

  const party = member.party || 'I';
  const partyFull = PARTY_NAMES[party] || 'Independent';

  // Reset tabs & caches whenever the active person changes
  useEffect(() => {
    setActiveTab('overview');
    setStatsState({ loading: false, loaded: false, data: null, isLive: false });
    setBillsState({ loading: false, loaded: false, data: null, isLive: false });
    setContactState({ loading: false, loaded: false, data: null, isLive: false });
    setEventsState({ loading: false, loaded: false, data: null, isLive: false });
    setEoState({ loading: false, loaded: false, data: null, isLive: false });
    setPaState({ loading: false, loaded: false, data: null, isLive: false });
    setCasesState({ loading: false, loaded: false, data: null, isLive: false });
    setStateBillsState({ loading: false, loaded: false, data: null, isLive: false });
    setStateVotesState({ loading: false, loaded: false, data: null, isLive: false });
    setGovActionsState({ loading: false, loaded: false, data: null, isLive: false });
    setStateCasesState({ loading: false, loaded: false, data: null, isLive: false });
  }, [cacheKey]);

  // Eager: only congress roles have per-member stats (party-line pct, issues).
  useEffect(() => {
    if (!isCongressRole || !member.bioguide_id) return;
    if (statsState.loaded || statsState.loading) return;
    setStatsState((s) => ({ ...s, loading: true }));
    fetchMemberStats(member.bioguide_id, member.party).then(({ data, isLive }) => {
      setStatsState({ loading: false, loaded: true, data, isLive });
    });
  }, [isCongressRole, member.bioguide_id, member.party, statsState.loaded, statsState.loading]);

  // Lazy-load on first visit of each tab.
  useEffect(() => {
    if (!cacheKey) return;

    // ── Congress-member tabs ────────────────────────────────────────
    if (activeTab === 'bills' && isCongressRole && !billsState.loaded && !billsState.loading) {
      setBillsState((s) => ({ ...s, loading: true }));
      fetchMemberBills(member.bioguide_id, 10).then(({ data, isLive }) => {
        setBillsState({ loading: false, loaded: true, data, isLive });
      });
    }
    // Votes tab is self-managing now — it owns year/month/search state and
    // fetches its own data on year change via fetchMemberVotes({year}).
    // No outer prefetch required.
    if (activeTab === 'contact' && isCongressRole && !contactState.loaded && !contactState.loading) {
      setContactState((s) => ({ ...s, loading: true }));
      fetchMemberContact(member.bioguide_id).then(({ data, isLive }) => {
        setContactState({ loading: false, loaded: true, data, isLive });
      });
    }
    if (activeTab === 'events' && isCongressRole && !eventsState.loaded && !eventsState.loading) {
      setEventsState((s) => ({ ...s, loading: true }));
      fetchMemberEvents(member.bioguide_id).then(({ data, isLive }) => {
        setEventsState({ loading: false, loaded: true, data, isLive });
      });
    }

    // ── Federal + State: contact + events short-circuit ────────────
    if (!isCongressRole) {
      if (activeTab === 'contact' && !contactState.loaded && !contactState.loading) {
        // Federal + state people carry a `contact` block on the member itself.
        setContactState({
          loading: false,
          loaded: true,
          data: member.contact || null,
          isLive: true,
        });
      }
      if (activeTab === 'events' && !eventsState.loaded && !eventsState.loading) {
        // Task #71: federal officials now have curated events keyed by
        // their federal-official ID (us-pres-trump, us-vp-vance, etc.)
        // in events.json. Try to fetch — if there's nothing curated for
        // this id, we fall back to an empty list for the friendly empty
        // state. State officials don't have curated events yet, but the
        // same call is harmless (it just returns []) so we run it for
        // every non-Congress role.
        const officialId = member.id || member.bioguide_id;
        if (officialId) {
          setEventsState((s) => ({ ...s, loading: true }));
          fetchMemberEvents(officialId).then(({ data, isLive }) => {
            setEventsState({ loading: false, loaded: true, data, isLive });
          });
        } else {
          setEventsState({ loading: false, loaded: true, data: [], isLive: false });
        }
      }
    }

    if (activeTab === 'exec_orders' && role === 'president'
        && !eoState.loaded && !eoState.loading) {
      const slug = member.federal_register_slug;
      if (slug) {
        setEoState((s) => ({ ...s, loading: true }));
        fetchExecutiveOrders(slug, 20).then(({ data, isLive }) => {
          setEoState({ loading: false, loaded: true, data, isLive });
        });
      } else {
        setEoState({ loading: false, loaded: true, data: [], isLive: false });
      }
    }

    // State governors also have an Exec. Orders tab. We don't have a live
    // FL EO feed today — resolve with an empty list so the tab shows a
    // friendly empty state + a link to the governor's website.
    if (activeTab === 'exec_orders' && role === 'state_governor'
        && !eoState.loaded && !eoState.loading) {
      setEoState({ loading: false, loaded: true, data: [], isLive: false });
    }

    if (activeTab === 'pres_actions'
        && (role === 'president' || role === 'vice_president')
        && !paState.loaded && !paState.loading) {
      setPaState((s) => ({ ...s, loading: true }));
      Promise.all([
        fetchPresidentialActions({ congress: 119, type: 'signed', limit: 15 }),
        fetchPresidentialActions({ congress: 119, type: 'vetoed', limit: 15 }),
      ]).then(([signed, vetoed]) => {
        setPaState({
          loading: false,
          loaded: true,
          data: { signed: signed.data || [], vetoed: vetoed.data || [] },
          isLive: signed.isLive || vetoed.isLive,
        });
      });
    }

    if (activeTab === 'cases' && role === 'scotus'
        && !casesState.loaded && !casesState.loading) {
      setCasesState((s) => ({ ...s, loading: true }));
      // Use the justice's surname as a client-side filter hint.
      const surname = (member.name || '').split(' ').slice(-1)[0] || null;
      fetchSCOTUSCases({ justiceName: surname, limit: 15 }).then(({ data, isLive }) => {
        setCasesState({ loading: false, loaded: true, data, isLive });
      });
    }

    // ── State legislator tabs ──────────────────────────────────────
    if (activeTab === 'state_bills' && role === 'state_legislator'
        && !stateBillsState.loaded && !stateBillsState.loading) {
      setStateBillsState((s) => ({ ...s, loading: true }));
      const chamber = (member.chamber || '').toLowerCase().includes('house') ? 'house' : 'senate';
      fetchStateLegislatorBills({
        stateCode: member.state || 'FL',
        name: member.name,
        chamber,
        district: member.district,
        limit: 15,
      }).then(({ data, isLive }) => {
        setStateBillsState({ loading: false, loaded: true, data, isLive });
      });
    }

    if (activeTab === 'state_votes' && role === 'state_legislator'
        && !stateVotesState.loaded && !stateVotesState.loading) {
      setStateVotesState((s) => ({ ...s, loading: true }));
      const chamber = (member.chamber || '').toLowerCase().includes('house') ? 'house' : 'senate';
      fetchStateLegislatorVotes({
        stateCode: member.state || 'FL',
        name: member.name,
        chamber,
        district: member.district,
        limit: 15,
      }).then(({ data, isLive }) => {
        setStateVotesState({ loading: false, loaded: true, data, isLive });
      });
    }

    // ── State governor Bills tab ───────────────────────────────────
    if (activeTab === 'gov_actions' && role === 'state_governor'
        && !govActionsState.loaded && !govActionsState.loading) {
      setGovActionsState((s) => ({ ...s, loading: true }));
      Promise.all([
        fetchGovernorActions({ stateCode: member.state || 'FL', type: 'signed', limit: 15 }),
        fetchGovernorActions({ stateCode: member.state || 'FL', type: 'vetoed', limit: 15 }),
      ]).then(([signed, vetoed]) => {
        setGovActionsState({
          loading: false,
          loaded: true,
          data: { signed: signed.data || [], vetoed: vetoed.data || [] },
          isLive: signed.isLive || vetoed.isLive,
        });
      });
    }

    // ── State supreme-court cases ──────────────────────────────────
    if (activeTab === 'state_cases' && role === 'state_scotus'
        && !stateCasesState.loaded && !stateCasesState.loading) {
      setStateCasesState((s) => ({ ...s, loading: true }));
      const surname = (member.name || '').split(' ').slice(-1)[0] || null;
      fetchStateCourtCases({
        stateCode: member.state || 'FL',
        justiceName: surname,
        limit: 15,
      }).then(({ data, isLive }) => {
        setStateCasesState({ loading: false, loaded: true, data, isLive });
      });
    }
  }, [
    activeTab, cacheKey, isCongressRole, role,
    member.bioguide_id, member.federal_register_slug, member.name, member.contact,
    member.state, member.chamber, member.district,
    billsState.loaded, billsState.loading,
    contactState.loaded, contactState.loading,
    eventsState.loaded, eventsState.loading,
    eoState.loaded, eoState.loading,
    paState.loaded, paState.loading,
    casesState.loaded, casesState.loading,
    stateBillsState.loaded, stateBillsState.loading,
    stateVotesState.loaded, stateVotesState.loading,
    govActionsState.loaded, govActionsState.loading,
    stateCasesState.loaded, stateCasesState.loading,
  ]);

  const toggleFollow = () => {
    // Persist to the shared trackedOfficials store so every FollowButton in
    // the app (and this hero button) reflects the same state.
    const nowFollowing = toggleOfficial(member);
    if (onNotify) {
      if (nowFollowing) {
        onNotify(`Now following ${member.name}. You'll be notified of new legislation and votes.`);
      } else {
        onNotify(`Stopped following ${member.name}.`);
      }
    }
  };

  return (
    <div
      style={
        isMobile
          ? { width: '100%', flex: 1, minHeight: 0, background: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
          : { width: `${width}px`, background: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }
      }
    >
      {/* Back + Close row — the contextual back label tells the user exactly
          where Back will take them (e.g. "← Back to Congress"), and the ×
          on the right fully closes the profile. The middle chevron toggle
          collapses or expands the hero block below. Mobile bumps the
          row's height and target sizes to clear the 44px minimum. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          borderBottom: '1px solid var(--cl-border)',
          minHeight: isMobile ? 48 : undefined,
        }}
      >
        <div
          onClick={onBack}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBack?.(); }}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: isMobile ? '14px 16px' : '10px 16px',
            fontSize: isMobile ? '0.95rem' : '0.85rem',
            color: 'var(--cl-accent)', cursor: 'pointer',
            fontWeight: 500,
            minHeight: isMobile ? 44 : undefined,
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'var(--cl-bg)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
        >
          <svg width={isMobile ? 18 : 16} height={isMobile ? 18 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
          {backLabel || 'Back to list'}
        </div>
        {/* Hero collapse toggle — chevron rotates to indicate state.
            Sits between Back and × so it's always reachable. Choice is
            persisted to localStorage as cl:profile:hero-collapsed. */}
        <button
          type="button"
          onClick={toggleHero}
          aria-label={heroCollapsed ? 'Expand profile header' : 'Collapse profile header'}
          aria-expanded={!heroCollapsed}
          title={heroCollapsed ? 'Expand profile header' : 'Collapse profile header'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--cl-text-light)',
            padding: isMobile ? '12px 14px' : '8px 12px',
            minWidth: isMobile ? 44 : undefined,
            minHeight: isMobile ? 44 : undefined,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseOver={(e) => (e.currentTarget.style.color = 'var(--cl-text)')}
          onMouseOut={(e) => (e.currentTarget.style.color = 'var(--cl-text-light)')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
            style={{
              transform: heroCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'transform 0.18s ease',
            }}
          >
            {/* Chevron pointing down by default — rotated 180° when hero
                is open ("collapse" arrow). */}
            <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close profile"
            title="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--cl-text-light)',
              padding: isMobile ? '12px 18px' : '8px 14px',
              fontSize: isMobile ? '1.4rem' : '1.15rem',
              lineHeight: 1,
              minWidth: isMobile ? 44 : undefined,
              minHeight: isMobile ? 44 : undefined,
            }}
            onMouseOver={(e) => (e.currentTarget.style.color = 'var(--cl-text)')}
            onMouseOut={(e) => (e.currentTarget.style.color = 'var(--cl-text-light)')}
          >
            ×
          </button>
        )}
      </div>

      {/* Compact hero — visible when the user has collapsed the full
          hero. Single row: small avatar + name + party chip. Tab strip
          and tab content land right below, giving them the bulk of the
          vertical space. */}
      {heroCollapsed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            borderBottom: '1px solid var(--cl-border)',
            background: 'white',
          }}
        >
          {member.photoUrl ? (
            <img
              src={member.photoUrl}
              alt=""
              style={{
                width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
                border: '2px solid var(--cl-border)', background: '#e9ecef',
                flexShrink: 0,
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: '#e9ecef',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.85rem', fontWeight: 700, color: '#999', flexShrink: 0,
            }}>
              {member.name.split(' ').map((n) => n[0]).join('')}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.95rem', fontWeight: 700, color: 'var(--cl-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {member.name}
            </div>
            <div style={{
              fontSize: '0.72rem', color: 'var(--cl-text-light)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {member.chamber || member.title || ''}
            </div>
          </div>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
            fontSize: '0.7rem', fontWeight: 700,
            background: party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : '#f0eaff',
            color: PARTY_COLORS[party],
            flexShrink: 0,
          }}>
            {party}
          </span>
        </div>
      )}

      {/* Hero — full version. Hidden when collapsed. */}
      {!heroCollapsed && (
      <div style={{ textAlign: 'center', padding: '20px 20px 14px', borderBottom: '1px solid var(--cl-border)' }}>
        {member.photoUrl ? (
          <img
            src={member.photoUrl}
            alt={member.name}
            // display:block + margin auto so the avatar reliably centers
            // in the textAlign:center hero. Without these, the inline
            // <img> picks up the parent's text-align centering on some
            // browsers but not others — Chrome desktop in particular
            // was rendering it left-aligned because of inherited flex
            // behavior from upstream wrappers.
            style={{ display: 'block', width: '88px', height: '88px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--cl-border)', margin: '0 auto 10px', background: '#e9ecef' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div style={{ width: '88px', height: '88px', borderRadius: '50%', background: '#e9ecef', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', fontWeight: 700, color: '#999', margin: '0 auto 10px' }}>
            {member.name.split(' ').map((n) => n[0]).join('')}
          </div>
        )}
        <h2 style={{ fontSize: '1.2rem', marginBottom: '4px', fontWeight: 700 }}>{member.name}</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)' }}>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700,
            background: party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : '#f0eaff',
            color: PARTY_COLORS[party], marginRight: '6px',
          }}>
            {partyFull}
          </span>
          {member.active_candidacy && (
            <>
              <OnBallotBadge
                activeCandidacy={member.active_candidacy}
                size="sm"
                onClick={onOnBallotClick ? () => onOnBallotClick(member.active_candidacy) : undefined}
              />
              <span style={{ marginRight: '6px' }} />
            </>
          )}
          {member.chamber || ''}
        </p>
        {member.selection_method && (
          <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'center' }}>
            <SelectionBadge
              method={member.selection_method}
              detail={member.selection_detail}
              normallyElected={member.normally_elected}
            />
          </div>
        )}
        {member.selection_detail && (
          <p style={{
            fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '6px',
            padding: '0 12px', lineHeight: 1.4, fontStyle: 'italic',
          }}>
            {member.selection_detail}
          </p>
        )}
        {member.title && (
          <p style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)', marginTop: '4px' }}>{member.title}</p>
        )}
        {/* Action row — Follow / Compare / View Candidate / Page.
            Mobile bumps padding so each button hits the 44px minimum
            tap target, allows wrap so all four can show on a 375px
            screen, and uses justify-content: center on each row. */}
        <div
          style={{
            marginTop: '12px',
            display: 'flex',
            justifyContent: 'center',
            gap: isMobile ? 8 : 6,
            flexWrap: isMobile ? 'wrap' : 'nowrap',
          }}
        >
          <button
            onClick={toggleFollow}
            style={{
              padding: isMobile ? '11px 22px' : '7px 18px',
              borderRadius: '8px',
              fontSize: isMobile ? '0.92rem' : '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s',
              background: isFollowing ? 'white' : 'var(--cl-accent)',
              color: isFollowing ? 'var(--cl-accent)' : 'white',
              border: isFollowing ? '2px solid var(--cl-accent)' : 'none',
              minHeight: isMobile ? 44 : undefined,
            }}
          >
            {isFollowing ? '✓ Following' : '+ Follow'}
          </button>
          {onCompareToggle && (
            <button
              onClick={() => onCompareToggle(member)}
              title={isComparing ? 'Remove from compare' : 'Add to compare'}
              style={{
                padding: isMobile ? '11px 18px' : '7px 14px',
                borderRadius: '8px',
                fontSize: isMobile ? '0.9rem' : '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: isComparing ? `${PARTY_COLORS[party]}14` : 'white',
                color: isComparing ? PARTY_COLORS[party] : 'var(--cl-text)',
                border: isComparing ? `1.5px solid ${PARTY_COLORS[party]}` : '1px solid var(--cl-border)',
                minHeight: isMobile ? 44 : undefined,
              }}
            >
              {isComparing ? '✓ In compare' : '+ Compare'}
            </button>
          )}
          {/* Cross-nav: this sitting official is also running in an upcoming
              election. Sits alongside Follow/Compare so the user gets a
              direct "flip to the other view" button, matching the pattern on
              the candidate side. */}
          {member.active_candidacy && onCandidatePick && (
            <button
              onClick={() => onCandidatePick({ id: member.active_candidacy.candidate_id })}
              title={
                member.active_candidacy.seeking_office
                  ? `Running for ${member.active_candidacy.seeking_office} — open candidate profile`
                  : 'Open candidate profile'
              }
              style={{
                padding: isMobile ? '11px 18px' : '7px 14px',
                borderRadius: '8px',
                fontSize: isMobile ? '0.9rem' : '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: 'white', color: 'var(--cl-text)',
                border: '1px solid var(--cl-border)',
                minHeight: isMobile ? 44 : undefined,
              }}
            >
              View Candidate
            </button>
          )}
          {onOpenPage && (
            <PageButton
              size="md"
              officialId={member.bioguide_id || member.id}
              onOpen={(id) => onOpenPage(id, {
                displayName: member.name,
                role: member.title || member.role || '',
                photoUrl: member.photoUrl,
              })}
            />
          )}
        </div>
      </div>
      )}

      {/* Tab bar — desktop / tablet uses flex:1 per tab so all six fit
          edge-to-edge. On mobile that crushes labels at narrow widths,
          so we switch to a horizontally-scrollable strip with a fixed
          min-width per tab. The browser-native scrollbar is hidden via
          inline `scrollbarWidth`/`msOverflowStyle` (Firefox / IE) and
          a `cl-no-scrollbar` class for WebKit (defined in globals.css
          if needed; falls back to a thin scrollbar otherwise). */}
      <TabStrip
        isMobile={isMobile}
        tabs={tabs}
        activeId={activeTab}
        onSelect={setActiveTab}
      />

      {/* Tab panel — wrapped in relative container by the tab strip
          above so fade indicators don't bleed into here. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {activeTab === 'overview' && (
          <OverviewTab member={member} role={role} statsState={statsState} />
        )}
        {activeTab === 'issues' && (
          <IssuesTab member={member} role={role} />
        )}
        {activeTab === 'experience' && (
          <ExperienceTab member={member} />
        )}
        {activeTab === 'bills' && (
          <BillsTab state={billsState} member={member} onNotify={onNotify} />
        )}
        {activeTab === 'contact' && (
          <ContactTab
            state={contactState}
            fallbackOffice={member.office}
            fallbackPhone={member.phone}
          />
        )}
        {activeTab === 'votes' && (
          <VotesTab role={role} member={member} />
        )}
        {activeTab === 'events' && (
          <EventsTab state={eventsState} memberName={member.name} />
        )}
        {activeTab === 'exec_orders' && (
          <ExecutiveOrdersTab state={eoState} member={member} />
        )}
        {activeTab === 'pres_actions' && (
          <PresidentialActionsTab state={paState} role={role} />
        )}
        {activeTab === 'cases' && (
          <SCOTUSCasesTab state={casesState} member={member} />
        )}
        {activeTab === 'state_bills' && (
          <StateLegislatorBillsTab state={stateBillsState} member={member} />
        )}
        {activeTab === 'state_votes' && (
          <StateLegislatorVotesTab state={stateVotesState} member={member} />
        )}
        {activeTab === 'gov_actions' && (
          <GovernorActionsTab state={govActionsState} member={member} />
        )}
        {activeTab === 'state_cases' && (
          <StateCourtCasesTab state={stateCasesState} member={member} />
        )}
      </div>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────
function OverviewTab({ member, role, statsState }) {
  const isCongressRole = role === 'congress' || role === 'congress_leader';
  const hasBio = Boolean(member.bio);
  const hasCommittees = member.committees && member.committees.length > 0;
  const stats = statsState?.data;
  const statsLoading = statsState?.loading || !statsState?.loaded;

  // Federal-specific at-a-glance rows
  const department = member.department;
  const sworn = member.sworn_in || member.serving_since;
  const confirmedBy = member.confirmed_by;
  const appointedBy = member.appointed_by;
  const positionOn = member.position_on_court;
  const servingSince = member.serving_since;

  return (
    <div>
      {isCongressRole ? (
        <>
          <SectionHeader>At a Glance</SectionHeader>
          <StatsBlock
            party={member.party}
            stats={stats}
            loading={statsLoading}
          />
        </>
      ) : (
        <>
          <SectionHeader>At a Glance</SectionHeader>
          <div style={{ marginBottom: '8px' }}>
            {member.title && <Row label="Role" value={member.title} />}
            {department && <Row label="Department" value={department} />}
            {positionOn && <Row label="Position" value={positionOn} />}
            {appointedBy && <Row label="Appointed by" value={appointedBy} />}
            {confirmedBy && <Row label="Confirmed" value={confirmedBy} />}
            {sworn && <Row label="Sworn in" value={sworn} />}
            {servingSince && role !== 'scotus' && (
              <Row label="Serving since" value={servingSince} last />
            )}
          </div>
        </>
      )}

      <div style={{ height: '14px' }} />
      <SectionHeader>About</SectionHeader>
      {hasBio ? (
        <div style={rowStyle}>{member.bio}</div>
      ) : (
        !isCongressRole && (
          <EmptyNote>
            No biographical summary on file. External sources may have more
            detail.
          </EmptyNote>
        )
      )}
      {isCongressRole && member.office && (
        <Row label="Office" value={member.office} />
      )}
      {isCongressRole && member.phone && (
        <Row label="Phone" value={member.phone} />
      )}
      {hasCommittees && (
        <Row label="Committees" value={member.committees.join(', ')} last />
      )}
      {isCongressRole && !hasBio && !member.office && !member.phone && !hasCommittees && (
        <EmptyState message="No biographical information available." />
      )}

      {/* Curated top-issues preview — surfaces the sidecar data in a
          candidate-style chip row so non-Congress roles also have an
          at-a-glance sense of priorities. Full stances live in the
          "Issues" tab. Rendered for every role that has curated data. */}
      {Array.isArray(member.top_issues)
        && member.top_issues.some((i) => i && typeof i === 'object' && i.name) && (
          <div style={{ marginTop: '14px' }}>
            <SectionHeader>
              {(role === 'scotus' || role === 'state_scotus'
                || role === 'state_dca' || role === 'state_circuit_judge'
                || role === 'state_county_judge')
                ? 'Areas of Focus'
                : 'Top Priorities'}
            </SectionHeader>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
              {member.top_issues.slice(0, 6).map((i, idx) => (
                i?.name ? (
                  <span
                    key={idx}
                    title={i.stance || ''}
                    style={{
                      fontSize: '0.75rem', fontWeight: 600,
                      padding: '4px 10px', borderRadius: '14px',
                      background: 'var(--cl-bg)', color: 'var(--cl-primary)',
                      border: '1px solid var(--cl-border)',
                    }}
                  >
                    {i.name}
                  </span>
                ) : null
              ))}
            </div>
          </div>
      )}
    </div>
  );
}

function StatsBlock({ party, stats, loading }) {
  const partyColor = PARTY_COLORS[party] || PARTY_COLORS.I;
  const pct = stats?.party_line_pct;
  const analyzed = stats?.votes_analyzed || 0;
  const issues = stats?.top_issues || [];

  // Helpful interpretation label for the %
  let pctLabel = '';
  if (typeof pct === 'number') {
    if (pct >= 95) pctLabel = 'Near-perfect party unity';
    else if (pct >= 85) pctLabel = 'Strong party loyalty';
    else if (pct >= 70) pctLabel = 'Mostly votes with party';
    else if (pct >= 50) pctLabel = 'Mixed voting record';
    else pctLabel = 'Frequently breaks with party';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '4px' }}>
      {/* Party-line % */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--cl-text-light)', fontWeight: 600 }}>
            Party-line voting
          </div>
          {typeof pct === 'number' && (
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: partyColor }}>
              {pct}%
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ height: '8px', borderRadius: '4px', background: 'var(--cl-bg)', overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, transparent, var(--cl-border), transparent)',
              animation: 'civiclens-shimmer 1.2s linear infinite',
            }} />
            <style jsx>{`
              @keyframes civiclens-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
            `}</style>
          </div>
        ) : typeof pct === 'number' ? (
          <>
            <div style={{ height: '8px', borderRadius: '4px', background: 'var(--cl-bg)', overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%', background: partyColor,
                transition: 'width 0.4s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '4px' }}>
              <span>{pctLabel}</span>
              <span>based on last {analyzed} votes</span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontStyle: 'italic', padding: '4px 0' }}>
            Not enough recent roll-call votes to compute.
          </div>
        )}
      </div>

      {/* Key issues */}
      <div>
        <div style={{ fontSize: '0.8rem', color: 'var(--cl-text-light)', fontWeight: 600, marginBottom: '6px' }}>
          Key issues
        </div>
        {loading ? (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: '70px', height: '22px', borderRadius: '12px',
                  background: 'var(--cl-bg)',
                }}
              />
            ))}
          </div>
        ) : issues.length > 0 ? (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {issues.map((iss) => (
              <span
                key={iss.name}
                title={`${iss.count} bill${iss.count === 1 ? '' : 's'} tagged ${iss.name}`}
                style={{
                  padding: '4px 10px', borderRadius: '12px',
                  fontSize: '0.75rem', fontWeight: 600,
                  background: 'var(--cl-bg)', color: 'var(--cl-primary)',
                  border: '1px solid var(--cl-border)',
                }}
              >
                {iss.name}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontStyle: 'italic', padding: '4px 0' }}>
            No issue signal from recent legislation yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Issues (curated top_issues with stance) ─────────────────────────
// Shared across every role. Renders the curated `member.top_issues` array
// of `{name, stance}` objects with the same card styling candidates use.
function IssuesTab({ member, role }) {
  const issues = Array.isArray(member?.top_issues)
    ? member.top_issues.filter((i) => i && typeof i === 'object' && i.name)
    : [];

  if (issues.length === 0) {
    const judicialRoles = new Set([
      'scotus', 'state_scotus', 'state_dca',
      'state_circuit_judge', 'state_county_judge',
    ]);
    const msg = judicialRoles.has(role)
      ? 'No judicial focus areas on file yet.'
      : 'No issue positions listed yet.';
    return <EmptyState message={msg} />;
  }

  const judicialRoles = new Set([
    'scotus', 'state_scotus', 'state_dca',
    'state_circuit_judge', 'state_county_judge',
  ]);
  const header = judicialRoles.has(role) ? 'Areas of Focus' : 'Top Issue Positions';

  return (
    <div>
      <SectionHeader>{header}</SectionHeader>
      {issues.map((issue, idx) => (
        <div
          key={idx}
          style={{
            marginBottom: '10px', padding: '12px 14px',
            background: 'var(--cl-bg)', borderRadius: '10px',
            border: '1px solid var(--cl-border)',
          }}
        >
          <div style={{
            fontSize: '0.86rem', fontWeight: 700,
            color: 'var(--cl-primary)', marginBottom: '4px',
          }}>
            {issue.name}
          </div>
          {issue.stance && (
            <div style={{
              fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--cl-text)',
            }}>
              {issue.stance}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Experience (curated career history) ──────────────────────────────
function ExperienceTab({ member }) {
  const experience = Array.isArray(member?.experience)
    ? member.experience.filter((x) => x && typeof x === 'object' && x.role)
    : [];

  if (experience.length === 0) {
    return <EmptyState message="No experience history on file yet." />;
  }

  return (
    <div>
      <SectionHeader>Career & Prior Roles</SectionHeader>
      {experience.map((x, idx) => (
        <div
          key={idx}
          style={{
            position: 'relative', paddingLeft: '20px', paddingBottom: '12px',
            borderLeft: '2px solid var(--cl-border)', marginLeft: '4px',
          }}
        >
          <span style={{
            position: 'absolute', left: '-6px', top: '4px',
            width: '10px', height: '10px', background: 'var(--cl-accent)',
            borderRadius: '50%', border: '2px solid white',
          }} />
          <div style={{
            fontSize: '0.75rem', color: 'var(--cl-text-light)', fontWeight: 600,
          }}>
            {formatTenure(x.from, x.to)}
          </div>
          <div style={{ fontSize: '0.88rem', fontWeight: 600, marginTop: '2px' }}>
            {x.role}
          </div>
          {x.note && (
            <div style={{
              fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: '2px',
            }}>
              {x.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatTenure(from, to) {
  const f = from == null ? '' : String(from);
  if (to == null || to === '' || String(to).toLowerCase() === 'present') {
    return f ? `${f} – Present` : 'Present';
  }
  const t = String(to);
  if (t === f) return f;
  return f ? `${f}–${t}` : t;
}

// ─── Bills ────────────────────────────────────────────────────────────
function BillsTab({ state, member, onNotify }) {
  // Subscribe so Track buttons re-render when state mutates anywhere.
  useTrackedBills();

  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading bills…" />;
  }
  const sponsored = state.data?.sponsored || [];
  const cosponsored = state.data?.cosponsored || [];

  if (sponsored.length === 0 && cosponsored.length === 0) {
    return <EmptyState message="No bills found for this member in the current Congress." />;
  }

  return (
    <div>
      <SectionHeader>Sponsored ({sponsored.length})</SectionHeader>
      {sponsored.length === 0 ? (
        <EmptyNote>No sponsored bills.</EmptyNote>
      ) : (
        sponsored.map((b, i) => (
          <BillCard key={`s-${i}`} bill={b} member={member} onNotify={onNotify} />
        ))
      )}

      <div style={{ height: '16px' }} />

      <SectionHeader>Cosponsored ({cosponsored.length})</SectionHeader>
      {cosponsored.length === 0 ? (
        <EmptyNote>No cosponsored bills.</EmptyNote>
      ) : (
        cosponsored.map((b, i) => (
          <BillCard key={`c-${i}`} bill={b} member={member} onNotify={onNotify} />
        ))
      )}
    </div>
  );
}

function BillCard({ bill, member, onNotify }) {
  const citation = bill.citation || (bill.type && bill.number ? `${bill.type} ${bill.number}` : '');
  const actionDate = bill.latest_action_date || bill.introduced_date || '';
  const key = billKey(bill.congress, bill.type, bill.number);
  const tracked = key ? isBillTracked(key) : false;

  const handleTrack = (e) => {
    e.stopPropagation();
    if (!key) return;
    if (tracked) {
      untrackBill(key);
      if (onNotify) onNotify(`Stopped tracking ${citation || bill.title}.`);
    } else {
      trackBill({
        key,
        congress: bill.congress,
        type: bill.type,
        number: bill.number,
        citation,
        title: bill.title,
        latest_action: bill.latest_action,
        latest_action_date: bill.latest_action_date,
        introduced_date: bill.introduced_date,
        policy_area: bill.policy_area,
        url: bill.url,
        sponsor_bioguide: member?.bioguide_id || null,
        sponsor_name: member?.name || null,
      });
      if (onNotify) onNotify(`Now tracking ${citation || bill.title}. You'll be alerted when its status changes.`);
    }
  };

  return (
    <div style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
        {citation && (
          <span style={{ fontWeight: 700, color: 'var(--cl-primary)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
            {citation}
          </span>
        )}
        {actionDate && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>{actionDate}</span>
        )}
      </div>
      <div style={{ fontWeight: 500, marginBottom: '4px', lineHeight: '1.3' }}>
        {bill.title || 'Untitled bill'}
      </div>
      {bill.latest_action && (
        <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
          {bill.latest_action}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '8px' }}>
        {bill.url ? (
          <a
            href={bill.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.75rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}
          >
            View on Congress.gov →
          </a>
        ) : <span />}
        {key && (
          <button
            onClick={handleTrack}
            title={tracked ? 'Stop tracking this bill' : 'Track this bill for status updates'}
            style={{
              padding: '4px 10px', borderRadius: '12px', fontSize: '0.72rem',
              fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              background: tracked ? 'var(--cl-accent)' : 'white',
              color: tracked ? 'white' : 'var(--cl-accent)',
              border: tracked ? '1px solid var(--cl-accent)' : '1px solid var(--cl-accent)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {tracked ? '✓ Tracking' : '+ Track'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Events ───────────────────────────────────────────────────────────
function EventsTab({ state, memberName }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading upcoming events…" />;
  }
  const events = state.data || [];
  if (events.length === 0) {
    return (
      <EmptyState
        message={`No upcoming public events listed for ${memberName || 'this member'}. Check the member's official website for the latest schedule.`}
      />
    );
  }
  return (
    <div>
      <SectionHeader>Upcoming Events ({events.length})</SectionHeader>
      {events.map((evt) => (
        <EventCard key={evt.id} event={evt} />
      ))}
    </div>
  );
}

function EventCard({ event }) {
  const dt = parseEventDate(event.date);
  const dateLabel = dt
    ? dt.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : event.date;

  const typeColor = eventTypeColor(event.type);

  return (
    <div style={{ padding: '12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '8px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
        <span
          style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
            fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.3px',
            background: `${typeColor}1f`, color: typeColor, whiteSpace: 'nowrap',
          }}
        >
          {(event.type || 'EVENT').toUpperCase()}
        </span>
        {event.virtual && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, color: '#5a3aa8',
            padding: '2px 8px', borderRadius: '10px', background: '#f0eaff',
          }}>
            VIRTUAL
          </span>
        )}
      </div>
      <div style={{ fontWeight: 600, marginBottom: '4px', lineHeight: '1.3' }}>
        {event.title}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginBottom: '4px' }}>
        📅 {dateLabel}
      </div>
      {event.location && (
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginBottom: '4px' }}>
          📍 {event.location}
        </div>
      )}
      {event.description && (
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text)', marginTop: '6px', lineHeight: '1.4' }}>
          {event.description}
        </div>
      )}
      {event.rsvp_url && (
        <a
          href={event.rsvp_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', marginTop: '8px', padding: '5px 12px',
            background: 'var(--cl-accent)', color: 'white', textDecoration: 'none',
            borderRadius: '6px', fontSize: '0.76rem', fontWeight: 600,
          }}
        >
          RSVP / Details →
        </a>
      )}
    </div>
  );
}

function parseEventDate(s) {
  if (!s) return null;
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

function eventTypeColor(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('town hall')) return '#1d4e89';
  if (t.includes('virtual') || t.includes('tele')) return '#5a3aa8';
  if (t.includes('meet') || t.includes('coffee')) return '#a05a00';
  if (t.includes('listening')) return '#1d8a4b';
  if (t.includes('roundtable')) return '#9c2c54';
  if (t.includes('mobile')) return '#207d83';
  if (t.includes('field hearing') || t.includes('hearing')) return '#374151';
  if (t.includes('fair')) return '#b8860b';
  if (t.includes('office')) return '#374151';
  return '#374151';
}

// ─── Contact ──────────────────────────────────────────────────────────
function ContactTab({ state, fallbackOffice, fallbackPhone }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading contact info…" />;
  }

  // The federal payload uses the same keys as Congress' contact block, so
  // this branch works for both Congress and federal officials. `district_offices`
  // is simply empty for federal roles.
  const dcOffice = state.data?.dc_office || fallbackOffice;
  const dcPhone = state.data?.dc_phone || fallbackPhone;
  const website = state.data?.official_website;
  const districtOffices = state.data?.district_offices || [];
  const socials = state.data?.socials || {};

  const hasAnything =
    dcOffice || dcPhone || website || districtOffices.length > 0 || Object.keys(socials).length > 0;

  if (!hasAnything) {
    return <EmptyState message="No contact information available." />;
  }

  return (
    <div>
      {(dcOffice || dcPhone || website) && (
        <>
          <SectionHeader>Washington, D.C.</SectionHeader>
          {dcOffice && <Row label="Office" value={dcOffice} />}
          {dcPhone && (
            <Row
              label="Phone"
              value={<a href={`tel:${dcPhone.replace(/[^\d+]/g, '')}`} style={linkStyle}>{dcPhone}</a>}
            />
          )}
          {website && (
            <Row
              label="Website"
              value={<a href={website} target="_blank" rel="noopener noreferrer" style={linkStyle}>{websiteLabel(website)}</a>}
              last
            />
          )}
        </>
      )}

      {districtOffices.length > 0 && (
        <>
          <div style={{ height: '14px' }} />
          <SectionHeader>District Offices ({districtOffices.length})</SectionHeader>
          {districtOffices.map((o, i) => (
            <div
              key={i}
              style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}
            >
              {o.city && (
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  {o.city}{o.state ? `, ${o.state}` : ''}
                </div>
              )}
              {o.address && (
                <div style={{ color: 'var(--cl-text-light)', fontSize: '0.78rem', marginBottom: '2px' }}>
                  {o.address}{o.suite ? `, ${o.suite}` : ''}
                  {o.zip ? ` ${o.zip}` : ''}
                </div>
              )}
              {o.phone && (
                <div style={{ fontSize: '0.78rem', marginTop: '2px' }}>
                  <a href={`tel:${o.phone.replace(/[^\d+]/g, '')}`} style={linkStyle}>{o.phone}</a>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {Object.keys(socials).length > 0 && (
        <>
          <div style={{ height: '14px' }} />
          <SectionHeader>Social</SectionHeader>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {socials.twitter && (
              <SocialPill href={`https://twitter.com/${socials.twitter}`} label={`@${socials.twitter}`} />
            )}
            {socials.facebook && (
              <SocialPill href={`https://facebook.com/${socials.facebook}`} label="Facebook" />
            )}
            {socials.instagram && (
              <SocialPill href={`https://instagram.com/${socials.instagram}`} label="Instagram" />
            )}
            {socials.youtube && (
              <SocialPill href={`https://youtube.com/${socials.youtube}`} label="YouTube" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SocialPill({ href, label }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        padding: '5px 12px', borderRadius: '14px', background: 'var(--cl-bg)',
        fontSize: '0.78rem', color: 'var(--cl-accent)', fontWeight: 600, textDecoration: 'none',
        border: '1px solid var(--cl-border)',
      }}
    >
      {label}
    </a>
  );
}

function websiteLabel(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ─── Votes ────────────────────────────────────────────────────────────
// Roll-call votes from GovTrack, with year + month + category + search
// filters. Year-level fetches are cached in lib/api so month-switching
// and search are instant after the first year load.
//
// Category taxonomy:
//   "Substantive" (default on) — passage, passage_suspension, cloture,
//     conference, veto_override, treaty, amendment
//   "Procedural" (default off) — procedural, quorum, leadership, unknown
//   "Nominations" (Senate) — nomination, conviction, impeachment
const SUBSTANTIVE_CATS = new Set([
  'passage', 'passage_suspension', 'cloture', 'conference', 'veto_override',
  'treaty', 'amendment',
]);
const NOMINATION_CATS = new Set([
  'nomination', 'conviction', 'impeachment',
]);
const CATEGORY_LABELS = {
  passage: 'Final Passage',
  passage_suspension: 'Passage (Suspension)',
  cloture: 'Cloture',
  conference: 'Conference Report',
  veto_override: 'Veto Override',
  treaty: 'Treaty',
  amendment: 'Amendment',
  nomination: 'Nomination',
  conviction: 'Conviction',
  impeachment: 'Impeachment',
  procedural: 'Procedural',
  quorum: 'Quorum',
  leadership: 'Leadership',
  unknown: 'Other',
};

function VotesTab({ role, member }) {
  // VP short-circuit — no meaningful roll-call record to show.
  if (role === 'vice_president') {
    return (
      <div>
        <SectionHeader>Tie-Breaking Votes</SectionHeader>
        <EmptyState
          message={`As President of the Senate, ${member.name || 'the Vice President'} only casts a vote to break 50–50 ties. Recent tie-breakers are published on Senate.gov; we don't yet mirror them here.`}
        />
      </div>
    );
  }

  const currentYear = new Date().getFullYear();
  const startYear = parseInt(String(member.serving_since || currentYear).slice(0, 4), 10) || currentYear;

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [showProcedural, setShowProcedural] = useState(false);
  const [loading, setLoading] = useState(false);
  const [votes, setVotes] = useState(null); // null = initial, [] = loaded+empty

  // Fetch whenever year changes. Month filter is client-side so changing
  // month doesn't refetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMemberVotes(member.bioguide_id, { year }).then(({ data }) => {
      if (cancelled) return;
      setVotes(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [member.bioguide_id, year]);

  // Build year dropdown: from member's first year served up through current.
  const yearOptions = [];
  for (let y = currentYear; y >= startYear; y--) yearOptions.push(y);

  const filtered = (votes || []).filter((v) => {
    const cat = (v.category || 'unknown').toLowerCase();
    // Category toggle.
    if (!showProcedural && !SUBSTANTIVE_CATS.has(cat) && !NOMINATION_CATS.has(cat)) return false;
    // Month filter.
    if (month !== 'all') {
      const mm = (v.date || '').slice(5, 7);
      if (mm !== String(month).padStart(2, '0')) return false;
    }
    // Search filter (question text + bill number/title).
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      const hay = [
        v.question || '',
        v.bill?.display_number || '',
        v.bill?.title || '',
      ].join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const totalForYear = votes ? votes.length : 0;

  const hiddenCount = votes
    ? votes.filter((v) => {
        const cat = (v.category || 'unknown').toLowerCase();
        return !SUBSTANTIVE_CATS.has(cat) && !NOMINATION_CATS.has(cat);
      }).length
    : 0;

  return (
    <div>
      <SectionHeader>Roll-Call Votes</SectionHeader>

      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px',
        padding: '10px', background: 'var(--cl-bg)', borderRadius: '8px',
        alignItems: 'center',
      }}>
        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          style={selectStyle}
          aria-label="Year"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={selectStyle}
          aria-label="Month"
        >
          <option value="all">All months</option>
          {[
            ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
            ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
            ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
          ].map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search bill # or text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: '1 1 160px', padding: '6px 10px', fontSize: '0.82rem',
            border: '1px solid var(--cl-border)', borderRadius: '6px',
            background: 'var(--card)', color: 'var(--cl-text)',
          }}
        />
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: '0.78rem', color: 'var(--cl-text-light)', cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}>
          <input
            type="checkbox"
            checked={showProcedural}
            onChange={(e) => setShowProcedural(e.target.checked)}
            style={{ accentColor: 'var(--cl-accent)' }}
          />
          Show procedural
        </label>
      </div>

      {/* Status line */}
      {!loading && votes !== null && (
        <div style={{ fontSize: '0.75rem', color: 'var(--cl-text-light)', marginBottom: '8px' }}>
          Showing <strong style={{ color: 'var(--cl-text)' }}>{filtered.length}</strong>
          {totalForYear > 0 && (
            <> of {totalForYear} vote{totalForYear === 1 ? '' : 's'} in {year}</>
          )}
          {!showProcedural && hiddenCount > 0 && (
            <> · <span style={{ fontStyle: 'italic' }}>{hiddenCount} procedural hidden</span></>
          )}
        </div>
      )}

      {loading && <LoadingState label={`Loading ${year} voting record…`} />}

      {!loading && votes !== null && votes.length === 0 && (
        <EmptyState message={`No votes recorded for ${member.name} in ${year}.`} />
      )}

      {!loading && filtered.length === 0 && votes && votes.length > 0 && (
        <EmptyState message="No votes match your filters. Try clearing the search or picking a different month." />
      )}

      {!loading && filtered.map((v, i) => (
        <VoteRow key={v.vote_id || i} vote={v} />
      ))}
    </div>
  );
}

const selectStyle = {
  padding: '6px 10px', fontSize: '0.82rem',
  border: '1px solid var(--cl-border)', borderRadius: '6px',
  background: 'var(--card)', color: 'var(--cl-text)',
  cursor: 'pointer',
};

function VoteRow({ vote }) {
  const position = (vote.position || vote.vote || '').toString();
  const posLower = position.toLowerCase();
  let posColor = 'var(--cl-text-light)';
  let posBg = '#eef0f2';
  if (posLower === 'yea' || posLower === 'aye' || posLower === 'yes') {
    posColor = '#1f6f1f'; posBg = '#e7f4e7';
  } else if (posLower === 'nay' || posLower === 'no') {
    posColor = '#a82a35'; posBg = '#fde8e8';
  }

  const title = vote.question || vote.title || vote.desc || 'Roll-call vote';
  const date = vote.date || '';
  const result = vote.result || '';
  const cat = (vote.category || '').toLowerCase();
  const catLabel = CATEGORY_LABELS[cat] || null;
  const bill = vote.bill;

  return (
    <div style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {bill?.display_number && (
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--cl-accent)', marginBottom: '2px', letterSpacing: '0.03em' }}>
              {bill.display_number}
            </div>
          )}
          <div style={{ fontWeight: 600, lineHeight: '1.35' }}>{title}</div>
          {bill?.title && bill.title !== title && (
            <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', marginTop: '2px', lineHeight: 1.35 }}>
              {bill.title}
            </div>
          )}
        </div>
        {position && (
          <span style={{
            fontWeight: 700, color: posColor, background: posBg,
            fontSize: '0.72rem', padding: '3px 8px', borderRadius: '10px',
            whiteSpace: 'nowrap', letterSpacing: '0.03em',
          }}>
            {position.toUpperCase()}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '0.72rem', color: 'var(--cl-text-light)', alignItems: 'center' }}>
        {date && <span>{date}</span>}
        {catLabel && (
          <span style={{
            padding: '1px 7px', borderRadius: '8px',
            background: 'var(--card)', border: '1px solid var(--cl-border)',
            fontWeight: 600, letterSpacing: '0.02em',
          }}>{catLabel}</span>
        )}
        {result && <span style={{ flex: 1, textAlign: 'right' }}>{result}</span>}
      </div>
      {vote.url && (
        <a
          href={vote.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: '6px', fontSize: '0.75rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}
        >
          Vote details →
        </a>
      )}
    </div>
  );
}

// ─── Executive orders (Federal Register) ──────────────────────────────
function ExecutiveOrdersTab({ state, member }) {
  if (!member.federal_register_slug) {
    return (
      <EmptyState
        message="Executive orders aren't published via the Federal Register API for this president. Older presidents may appear here once we add their slug."
      />
    );
  }
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading executive orders…" />;
  }
  const orders = state.data || [];
  if (orders.length === 0) {
    return <EmptyState message="No recent executive orders found." />;
  }
  return (
    <div>
      <SectionHeader>Recent Executive Orders ({orders.length})</SectionHeader>
      {orders.map((eo) => (
        <EOCard key={eo.document_number || eo.title} order={eo} />
      ))}
    </div>
  );
}

function EOCard({ order }) {
  const number = order.eo_number ? `EO ${order.eo_number}` : order.citation;
  const date = order.signing_date || order.publication_date;
  return (
    <div style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
        {number && (
          <span style={{ fontWeight: 700, color: 'var(--cl-primary)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
            {number}
          </span>
        )}
        {date && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>{date}</span>
        )}
      </div>
      <div style={{ fontWeight: 500, marginBottom: '4px', lineHeight: '1.3' }}>
        {order.title || 'Untitled executive order'}
      </div>
      {order.abstract && (
        <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', lineHeight: 1.4 }}>
          {order.abstract}
        </div>
      )}
      {(order.url || order.pdf_url) && (
        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          {order.url && (
            <a
              href={order.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '0.75rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}
            >
              View on FederalRegister.gov →
            </a>
          )}
          {order.pdf_url && (
            <a
              href={order.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '0.75rem', color: 'var(--cl-text-light)', textDecoration: 'none', fontWeight: 600 }}
            >
              PDF
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Presidential actions (signed laws + vetoes) ──────────────────────
function PresidentialActionsTab({ state, role }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading bill activity…" />;
  }
  const signed = state.data?.signed || [];
  const vetoed = state.data?.vetoed || [];
  if (signed.length === 0 && vetoed.length === 0) {
    return (
      <EmptyState
        message={
          role === 'vice_president'
            ? "No enacted or vetoed bills for this administration in the current Congress. Requires a Congress.gov API key on the server."
            : "No enacted or vetoed bills for this president in the current Congress. Requires a Congress.gov API key on the server."
        }
      />
    );
  }
  return (
    <div>
      <SectionHeader>Signed into Law ({signed.length})</SectionHeader>
      {signed.length === 0 ? (
        <EmptyNote>No enacted laws yet this Congress.</EmptyNote>
      ) : (
        signed.map((b, i) => (
          <PresActionCard key={`s-${i}`} bill={b} outcome="signed" />
        ))
      )}

      <div style={{ height: '16px' }} />
      <SectionHeader>Vetoed ({vetoed.length})</SectionHeader>
      {vetoed.length === 0 ? (
        <EmptyNote>No vetoes recorded this Congress.</EmptyNote>
      ) : (
        vetoed.map((b, i) => (
          <PresActionCard key={`v-${i}`} bill={b} outcome="vetoed" />
        ))
      )}
    </div>
  );
}

function PresActionCard({ bill, outcome }) {
  const citation = bill.citation || (bill.type && bill.number ? `${bill.type} ${bill.number}` : '');
  const actionDate = bill.latest_action_date || '';
  const badgeColor = outcome === 'signed' ? '#2a7a2a' : '#e63946';
  const badgeBg = outcome === 'signed' ? '#e6f4ea' : '#fde8e8';
  const badgeLabel = outcome === 'signed'
    ? (bill.law_number ? `LAW ${bill.law_number}` : 'ENACTED')
    : 'VETOED';
  return (
    <div style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
          {citation && (
            <span style={{ fontWeight: 700, color: 'var(--cl-primary)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
              {citation}
            </span>
          )}
          <span style={{
            padding: '1px 6px', borderRadius: '10px',
            fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.3px',
            background: badgeBg, color: badgeColor, whiteSpace: 'nowrap',
          }}>
            {badgeLabel}
          </span>
        </div>
        {actionDate && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>{actionDate}</span>
        )}
      </div>
      <div style={{ fontWeight: 500, marginBottom: '4px', lineHeight: '1.3' }}>
        {bill.title || 'Untitled bill'}
      </div>
      {bill.latest_action && (
        <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
          {bill.latest_action}
        </div>
      )}
      {bill.url && (
        <a
          href={bill.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: '6px', fontSize: '0.75rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}
        >
          View on Congress.gov →
        </a>
      )}
    </div>
  );
}

// ─── SCOTUS cases (CourtListener) ─────────────────────────────────────
function SCOTUSCasesTab({ state, member }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading recent opinions…" />;
  }
  const cases = state.data || [];
  if (cases.length === 0) {
    const surname = (member.name || '').split(' ').slice(-1)[0] || 'this justice';
    return (
      <EmptyState
        message={`No recent SCOTUS opinion clusters matched Justice ${surname} in the CourtListener feed. Try again later — the feed updates as new decisions publish.`}
      />
    );
  }
  return (
    <div>
      <SectionHeader>Recent Opinions ({cases.length})</SectionHeader>
      {cases.map((c) => (
        <CaseCard key={c.id} caseData={c} />
      ))}
    </div>
  );
}

function CaseCard({ caseData }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
        <span style={{ fontWeight: 600, lineHeight: '1.3' }}>
          {caseData.case_name || 'Untitled case'}
        </span>
        {caseData.date_filed && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', whiteSpace: 'nowrap' }}>
            {caseData.date_filed}
          </span>
        )}
      </div>
      {caseData.docket_number && (
        <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', marginBottom: '2px' }}>
          Docket: {caseData.docket_number}
        </div>
      )}
      {caseData.precedential_status && (
        <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', marginBottom: '2px' }}>
          {caseData.precedential_status}
        </div>
      )}
      {caseData.judges && (
        <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', marginTop: '4px', fontStyle: 'italic' }}>
          Panel: {caseData.judges}
        </div>
      )}
      {caseData.url && (
        <a
          href={caseData.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: '6px', fontSize: '0.75rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}
        >
          View on CourtListener →
        </a>
      )}
    </div>
  );
}

// ─── Shared atoms ─────────────────────────────────────────────────────
function SectionHeader({ children }) {
  return (
    <h3 style={{
      fontSize: '0.78rem', color: 'var(--cl-primary-light)', textTransform: 'uppercase',
      letterSpacing: '0.5px', marginBottom: '8px', paddingBottom: '4px',
      borderBottom: '1px solid var(--cl-border)',
    }}>
      {children}
    </h3>
  );
}

const rowStyle = { padding: '8px 0', borderBottom: '1px solid #f1f3f5', fontSize: '0.88rem' };
const linkStyle = { color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 500 };

function Row({ label, value, last }) {
  return (
    <div style={{ ...rowStyle, borderBottom: last ? 'none' : rowStyle.borderBottom }}>
      <div style={{ color: 'var(--cl-text-light)', fontSize: '0.76rem' }}>{label}</div>
      <div style={{ fontWeight: 500, marginTop: '2px' }}>{value}</div>
    </div>
  );
}

function LoadingState({ label }) {
  // Tab-internal loading affordance — small accent-green spinner with
  // a label below. Swapped to the canonical Spinner primitive in the
  // ProfileView primitives sweep so the keyframe + ring geometry
  // matches every other loading affordance in the app.
  return (
    <div
      style={{
        padding: '24px 8px',
        textAlign: 'center',
        color: 'var(--cl-text-light)',
        fontSize: 'var(--cl-text-sm)',
        fontFamily: 'var(--cl-font-sans)',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          marginBottom: 8,
          color: 'var(--cl-accent)',
        }}
      >
        <Spinner size={18} />
      </div>
      <div>{label}</div>
    </div>
  );
}

function EmptyState({ message }) {
  // Tab-internal "no data" placeholder. Body-only (no headline / icon
  // plate) because the surrounding tab heading provides context — a
  // second headline here would be redundant. Callers that want the
  // full hero-empty treatment use UIEmptyState from ./ui directly.
  return (
    <div
      style={{
        padding: '24px 12px',
        textAlign: 'center',
        color: 'var(--cl-text-light)',
        fontSize: 'var(--cl-text-sm)',
        fontFamily: 'var(--cl-font-sans)',
        background: 'var(--cl-bg)',
        borderRadius: 'var(--cl-radius-md)',
        lineHeight: 'var(--cl-leading-snug)',
      }}
    >
      {message}
    </div>
  );
}

function EmptyNote({ children }) {
  // Inline "no data" microcopy — used when an empty state would over-
  // decorate the surrounding row (e.g., between section dividers).
  return (
    <div
      style={{
        padding: '8px 0',
        fontSize: 'var(--cl-text-sm)',
        color: 'var(--cl-text-light)',
        fontFamily: 'var(--cl-font-sans)',
        fontStyle: 'italic',
      }}
    >
      {children}
    </div>
  );
}

// ─── State legislator bills (OpenStates) ──────────────────────────────
function StateLegislatorBillsTab({ state, member }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading recent bills…" />;
  }
  const bills = state.data || [];
  if (bills.length === 0) {
    return (
      <EmptyState
        message={`No recent bills found for ${member.name} in the OpenStates feed. If your admin hasn't added an OPENSTATES_API_KEY, this tab will be empty — state legislator data is powered by openstates.org.`}
      />
    );
  }
  return (
    <div>
      <SectionHeader>Recent Bills ({bills.length})</SectionHeader>
      {bills.map((b) => (
        <StateBillCard key={b.id || b.identifier} bill={b} />
      ))}
    </div>
  );
}

function StateBillCard({ bill }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
        <span style={{ fontWeight: 700, color: 'var(--cl-primary)' }}>
          {bill.identifier || 'Bill'}
        </span>
        {bill.latest_action_date && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', whiteSpace: 'nowrap' }}>
            {bill.latest_action_date}
          </span>
        )}
      </div>
      {bill.title && (
        <div style={{ fontSize: '0.82rem', lineHeight: 1.35, marginBottom: '4px' }}>
          {bill.title}
        </div>
      )}
      {bill.latest_action && (
        <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
          {bill.latest_action}
        </div>
      )}
      {bill.url && (
        <a
          href={bill.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: '6px', fontSize: '0.75rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}
        >
          View on OpenStates →
        </a>
      )}
    </div>
  );
}

// ─── State legislator votes (OpenStates) ──────────────────────────────
function StateLegislatorVotesTab({ state, member }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading recent votes…" />;
  }
  const votes = state.data || [];
  if (votes.length === 0) {
    return (
      <EmptyState
        message={`No recent votes recorded for ${member.name} in the OpenStates feed. This can also happen when OPENSTATES_API_KEY is not configured.`}
      />
    );
  }
  return (
    <div>
      <SectionHeader>Recent Votes ({votes.length})</SectionHeader>
      {votes.map((v) => (
        <StateVoteCard key={v.id} vote={v} />
      ))}
    </div>
  );
}

function StateVoteCard({ vote }) {
  const positionColor = {
    yes:  { bg: '#e8f5ec', fg: '#1f7a3a' },
    no:   { bg: '#fde8e8', fg: '#a12626' },
    absent:  { bg: 'var(--cl-bg)', fg: 'var(--cl-text-light)' },
    'not voting': { bg: 'var(--cl-bg)', fg: 'var(--cl-text-light)' },
  };
  const mv = (vote.my_vote || '').toLowerCase();
  const style = positionColor[mv] || { bg: 'var(--cl-bg)', fg: 'var(--cl-text-light)' };
  return (
    <div style={{ padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px', marginBottom: '6px', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
        <span style={{ fontWeight: 700, color: 'var(--cl-primary)' }}>
          {vote.bill_id || 'Vote'}
        </span>
        {vote.date && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', whiteSpace: 'nowrap' }}>
            {vote.date}
          </span>
        )}
      </div>
      {vote.motion && (
        <div style={{ fontSize: '0.8rem', lineHeight: 1.35, marginBottom: '4px' }}>
          {vote.motion}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
        <span style={{
          padding: '2px 8px', borderRadius: '10px',
          background: style.bg, color: style.fg,
          fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
        }}>
          {vote.my_vote || '—'}
        </span>
        {vote.result && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
            Outcome: {vote.result}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Governor actions — signed / vetoed bills ─────────────────────────
function GovernorActionsTab({ state, member }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading recent governor actions…" />;
  }
  const signed = state.data?.signed || [];
  const vetoed = state.data?.vetoed || [];
  if (!signed.length && !vetoed.length) {
    return (
      <EmptyState
        message={`No recent signed or vetoed bills found for the Office of the Governor in the OpenStates feed. If OPENSTATES_API_KEY is not configured this tab will be empty.`}
      />
    );
  }
  return (
    <div>
      {signed.length > 0 && (
        <>
          <SectionHeader>Signed into Law ({signed.length})</SectionHeader>
          {signed.map((b) => (
            <StateBillCard key={`s-${b.id || b.identifier}`} bill={b} />
          ))}
        </>
      )}
      {vetoed.length > 0 && (
        <>
          {signed.length > 0 && <div style={{ height: 12 }} />}
          <SectionHeader>Vetoed ({vetoed.length})</SectionHeader>
          {vetoed.map((b) => (
            <StateBillCard key={`v-${b.id || b.identifier}`} bill={b} />
          ))}
        </>
      )}
    </div>
  );
}

// ─── State supreme-court cases (CourtListener) ───────────────────────
function StateCourtCasesTab({ state, member }) {
  if (state.loading || !state.loaded) {
    return <LoadingState label="Loading recent opinions…" />;
  }
  const cases = state.data || [];
  if (cases.length === 0) {
    const surname = (member.name || '').split(' ').slice(-1)[0] || 'this justice';
    return (
      <EmptyState
        message={`No recent ${member.chamber || 'state supreme court'} opinion clusters matched ${surname} in the CourtListener feed. If CourtListener is unavailable without a token, set COURTLISTENER_TOKEN on the server.`}
      />
    );
  }
  return (
    <div>
      <SectionHeader>Recent Opinions ({cases.length})</SectionHeader>
      {cases.map((c) => (
        <CaseCard key={c.id} caseData={c} />
      ))}
    </div>
  );
}
