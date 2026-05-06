'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Navbar from '@/components/Navbar';
import MapView from '@/components/MapView';
import SidePanel from '@/components/SidePanel';
import PanelResizer from '@/components/PanelResizer';
import NotificationBanner from '@/components/NotificationBanner';
import CommitteesModal from '@/components/CommitteesModal';
import CompareTray from '@/components/CompareTray';
import CompareView from '@/components/CompareView';
import CandidateProfile from '@/components/CandidateProfile';
import MyTrackedModal from '@/components/MyTrackedModal';
import PageView from '@/components/PageView';
import RepLoginModal from '@/components/RepLoginModal';
import CitizenLoginModal from '@/components/CitizenLoginModal';
import CitizenWaitlistModal from '@/components/CitizenWaitlistModal';
import ClaimPageModal from '@/components/ClaimPageModal';
import ConstituentDashboard from '@/components/ConstituentDashboard';
import { fetchAllStateData, fetchBillSnapshot, fetchMemberDetail, fetchCandidate, fetchStatePerson } from '@/lib/api';
import { STATE_NAME_TO_CODE } from '@/lib/constants';
import { getAllTrackedBills, updateTrackedBill } from '@/lib/trackedBills';
import { useAuth, logoutRep } from '@/lib/auth';
import { useCitizenAuth, logoutCitizen } from '@/lib/citizenAuth';
import { useViewport, useIsLandscape } from '@/lib/useViewport';

export default function Home() {
  // Viewport drives the desktop ↔ mobile layout pivot. Computed once at
  // the top so every layout decision below sees a consistent value.
  // 'mobile' (≤900px), 'tablet' (≤1024px), 'desktop' (>1024px).
  const viewport = useViewport();
  const isMobile = viewport === 'mobile';
  // True when the phone is held sideways (or any window where width >
  // height). Used together with isMobile to decide between the stacked
  // mobile layout (map on top, panel below) and the desktop side-by-
  // side layout (map on left, panel on right). On a phone in landscape
  // the viewport is too short (~360–500px) to stack a useful map AND
  // a useful panel, so we pivot to the desktop layout instead.
  const isLandscape = useIsLandscape();
  // Single source of truth for "use the stacked / mobile-style layout"
  // — only true when we're on a small screen AND in portrait. Landscape
  // mobile gets the desktop side-by-side treatment.
  const useStackedLayout = isMobile && !isLandscape;

  const [selectedState, setSelectedState] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [stateData, setStateData] = useState(null);
  const [stateName, setStateName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [notification, setNotification] = useState(null);
  // When set, we filter the Congress list to just this district + senators and
  // tell MapView to zoom to / highlight this district.
  // Shape: {
  //   stateCode, stateFips, district, districtLabel, address,
  //   countyFips, countyName, city, citySlug,
  //   stateSenateDistrict, stateHouseDistrict,
  // }
  const [activeDistrict, setActiveDistrict] = useState(null);
  const [committeesOpen, setCommitteesOpen] = useState(false);
  const [trackedOpen, setTrackedOpen] = useState(false);
  // Lifted SidePanel tab so it survives the candidate-profile detour. Without
  // this, opening a candidate from Elections + clicking Back unmounts SidePanel
  // and resets the tab back to "congress".
  const [sidePanelTab, setSidePanelTab] = useState('congress');
  // Width of the right-side panel in pixels. Users can drag the resizer on
  // its left edge to grow it up to 50% of the viewport. 380 is the minimum
  // (= original fixed width) and is what we start with.
  const [panelWidth, setPanelWidth] = useState(380);
  // Mobile-only: pixel height of the map at the top of the screen.
  // Defaults to 0 — the layout effect below recomputes it on mount
  // based on the actual *visible* viewport height (visualViewport when
  // available, since on Samsung Internet / Chrome Android
  // `window.innerHeight` reports the layout viewport which includes
  // the area behind the URL bar). We then subtract the navbar (56px)
  // and the resizer bar (18px) and take 40% of the remaining
  // space-available-to-the-split. Users can drag the "Map" handle up
  // to collapse the map (down to 0) but not down past the starting
  // height. Re-clamps on resize / orientation change so flipping to
  // landscape and back doesn't strand the map at a stale height.
  const [mapHeightPx, setMapHeightPx] = useState(0);
  const [mapMaxHeightPx, setMapMaxHeightPx] = useState(0);
  useEffect(() => {
    const NAVBAR_PX = 56;
    const RESIZER_PX = 28;
    const recompute = () => {
      const visibleH = (typeof window !== 'undefined' && window.visualViewport)
        ? window.visualViewport.height
        : window.innerHeight;
      const available = Math.max(0, visibleH - NAVBAR_PX - RESIZER_PX);
      const max = Math.round(available * 0.4);
      setMapMaxHeightPx(max);
      setMapHeightPx((current) => (current === 0 || current > max ? max : current));
    };
    recompute();
    window.addEventListener('resize', recompute);
    // visualViewport fires its own resize when the URL bar shows /
    // hides — important so the map collapses cleanly when the user
    // scrolls and the address bar slides in.
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', recompute);
    }
    return () => {
      window.removeEventListener('resize', recompute);
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', recompute);
      }
    };
  }, []);
  // Return-to-list highlighting — after Back from a profile, we briefly pulse
  // the row the user was just viewing so they don't lose their place in a
  // long list. Consumed + cleared by the list (SidePanel / BallotTab).
  const [lastViewedMemberId, setLastViewedMemberId] = useState(null);
  const [lastViewedCandidateId, setLastViewedCandidateId] = useState(null);
  // Clicking the "On ballot" badge on a rep profile lands on the Elections
  // tab with this candidate id focused — BallotTab auto-expands the owning
  // election + race and scroll-pulses the candidate row.
  const [focusCandidateId, setFocusCandidateId] = useState(null);
  // Unified compare state — officials and candidates share one tray/modal,
  // each item tagged with `_kind: 'official' | 'candidate'`. Cap of 3 total.
  const [compareItems, setCompareItems] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const compareIds = new Set(
    compareItems.filter((i) => i._kind === 'official').map((m) => m.bioguide_id || m.id)
  );
  const compareCandidateIds = new Set(
    compareItems.filter((i) => i._kind === 'candidate').map((c) => c.id)
  );
  // Ensure the on-load tracked-bill check only runs once per session
  const trackedCheckedRef = useRef(false);

  // ─── Side-panel scroll preservation ────────────────────────────────
  // The right-side panel hosts a single scroll container (NOP / state
  // tabs / etc.). To preserve its scrollTop when the user opens a
  // profile and then hits Back, we never unmount the SidePanel content:
  //   - ProfileView is rendered as an absolute overlay inside SidePanel
  //     (see SidePanel.js) so its scroll container stays mounted.
  //   - When a candidate profile opens, SidePanel is hidden via
  //     display:none rather than swapped out — the DOM (and therefore
  //     scrollTop) is preserved. See the "panel area" wrapper below.
  // No save/restore plumbing needed — the browser does it for free.

  // ─── Pages layer (phase 1) ─────────────────────────────────────────
  // When truthy, PageView mounts as a full-viewport overlay for that
  // official. The meta blob carries display name / role / photo so the
  // header reads nicely while the /api/pages/{id} payload is loading.
  const [selectedPageOfficialId, setSelectedPageOfficialId] = useState(null);
  const [pageMeta, setPageMeta] = useState(null);
  // Auth state for the rep-login flow — hydrates /api/auth/me on mount.
  const { me } = useAuth();
  // Pages-feature modals. Login modal can be surfaced from a page's "Rep
  // login" button or swapped in from the claim modal's "I already have an
  // account" link. The citizen waitlist fires from any "Comment" or
  // "Subscribe" intent; clickedFrom is stored on the row so we can report
  // the funnel later.
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistFrom, setWaitlistFrom] = useState('comment');
  // Citizen-auth state. The Navbar surfaces login / sign-out; engagement
  // components (likes, comments, poll votes) consume the `citizen` blob
  // to gate writes + tag their requests with geography.
  const { citizen } = useCitizenAuth();
  const [citizenLoginOpen, setCitizenLoginOpen] = useState(false);
  // ConstituentDashboard overlay — opens when a signed-in citizen clicks
  // their identity pill in the Navbar. Auto-closes if the citizen signs out.
  const [dashboardOpen, setDashboardOpen] = useState(false);
  useEffect(() => {
    if (!citizen && dashboardOpen) setDashboardOpen(false);
  }, [citizen, dashboardOpen]);
  const handleCitizenLoginOpen = useCallback(() => setCitizenLoginOpen(true), []);
  const handleCitizenLoginSuccess = useCallback(() => setCitizenLoginOpen(false), []);
  const handleCitizenLogoutClick = useCallback(async () => {
    await logoutCitizen();
  }, []);

  const handleOpenPage = useCallback((id, meta) => {
    if (!id) return;
    setSelectedPageOfficialId(id);
    setPageMeta(meta || null);
  }, []);
  const handleClosePage = useCallback(() => {
    setSelectedPageOfficialId(null);
    setPageMeta(null);
  }, []);
  const handleRequestLogin = useCallback(() => {
    setClaimModalOpen(false);
    setLoginModalOpen(true);
  }, []);
  const handleRequestClaim = useCallback(() => {
    setLoginModalOpen(false);
    setClaimModalOpen(true);
  }, []);
  const handleRequestCitizenWaitlist = useCallback((source) => {
    setWaitlistFrom(source || 'comment');
    setWaitlistOpen(true);
  }, []);
  const handleLogout = useCallback(async () => {
    await logoutRep();
    // Don't close PageView — switching to signed-out view is enough; the
    // rep can log back in via the header "Rep login" button if they want.
  }, []);

  const handleCompareToggle = useCallback((member) => {
    if (!member) return;
    const id = member.bioguide_id || member.id;
    if (!id) return;
    setCompareItems((prev) => {
      if (prev.some((m) => m._kind === 'official' && (m.bioguide_id || m.id) === id)) {
        return prev.filter((m) => !(m._kind === 'official' && (m.bioguide_id || m.id) === id));
      }
      if (prev.length >= 3) {
        setNotification('You can compare up to 3 at a time.');
        return prev;
      }
      return [...prev, { ...member, _kind: 'official' }];
    });
  }, []);

  const handleCandidateCompareToggle = useCallback((candidate) => {
    if (!candidate?.id) return;
    setCompareItems((prev) => {
      if (prev.some((c) => c._kind === 'candidate' && c.id === candidate.id)) {
        return prev.filter((c) => !(c._kind === 'candidate' && c.id === candidate.id));
      }
      if (prev.length >= 3) {
        setNotification('You can compare up to 3 at a time.');
        return prev;
      }
      return [...prev, { ...candidate, _kind: 'candidate' }];
    });
  }, []);

  const handleCompareClear = useCallback(() => setCompareItems([]), []);

  // Unified remove dispatcher — the tray passes the full tagged item back,
  // so we route to the matching toggle based on `_kind`.
  const handleCompareRemove = useCallback((item) => {
    if (!item) return;
    if (item._kind === 'candidate') {
      setCompareItems((prev) => prev.filter((c) => !(c._kind === 'candidate' && c.id === item.id)));
    } else {
      const id = item.bioguide_id || item.id;
      setCompareItems((prev) =>
        prev.filter((m) => !(m._kind === 'official' && (m.bioguide_id || m.id) === id))
      );
    }
  }, []);

  // ─── Candidate selection (opens CandidateProfile) ────────────────────
  // Opening a candidate profile replaces any currently-open rep profile
  // rather than stacking on top of it. Back then returns to the originating
  // view (Elections tab, Congress list, etc.) instead of bouncing to the
  // sitting official — "View Rep." already provides that direction.
  // Keep a ref mirror of selectedMember / selectedCandidate so callbacks can
  // read them without adding a dependency (which would re-bind every open/close
  // cycle and subtly break memoized children).
  const selectedMemberRef = useRef(null);
  const selectedCandidateRef = useRef(null);
  useEffect(() => { selectedMemberRef.current = selectedMember; }, [selectedMember]);
  useEffect(() => { selectedCandidateRef.current = selectedCandidate; }, [selectedCandidate]);

  const handleCandidateSelect = useCallback(async (candidate) => {
    if (!candidate?.id) return;
    // Remember the rep we came from (if any) so Return-to-list highlighting
    // can pulse them on return, and clear the selection so Back pops cleanly
    // back to the list.
    const prev = selectedMemberRef.current;
    if (prev) setLastViewedMemberId(prev.bioguide_id || prev.id || null);
    setSelectedMember(null);
    // If candidate is a thin stub, try to hydrate with full detail
    if (!candidate.top_issues) {
      try {
        const { data } = await fetchCandidate(candidate.id);
        if (data) {
          setSelectedCandidate(data);
          return;
        }
      } catch (e) {
        // Fall through
      }
    }
    setSelectedCandidate(candidate);
  }, []);

  const handleCandidateBack = useCallback(() => {
    const prev = selectedCandidateRef.current;
    if (prev) setLastViewedCandidateId(prev.id || null);
    setSelectedCandidate(null);
  }, []);

  // Cross-nav from a candidate profile → the sitting official's state profile.
  // Used when a state-level candidate (e.g. sitting AG, sitting state legislator)
  // has an `official_id` + `official_scope: 'state'` pointer. Ensures the right
  // state context is loaded before opening the profile.
  const handleStatePersonPick = useCallback(async ({ state, id }) => {
    if (!state || !id) return;
    // Close candidate view first so ProfileView is the visible panel.
    setSelectedCandidate(null);
    setActiveDistrict(null);

    if (state !== selectedState) {
      setSelectedState(state);
      const nameEntry = Object.entries(STATE_NAME_TO_CODE).find(([, code]) => code === state);
      setStateName(nameEntry ? nameEntry[0] : state);
      setLoading(true);
      try {
        const result = await fetchAllStateData(state);
        setStateData(result.data);
        setIsLive(result.isLive);
      } catch (e) {
        console.error('Error loading state after cross-nav:', e);
      } finally {
        setLoading(false);
      }
    }

    try {
      const { data } = await fetchStatePerson(state, id);
      if (data) setSelectedMember(data);
    } catch (e) {
      console.error('Error fetching state person for cross-nav:', e);
    }
  }, [selectedState]);

  const showNotification = useCallback((text) => {
    setNotification(text);
  }, []);

  const handleStateSelect = useCallback(async (stateCode, name) => {
    // Clicking a state on the map clears any active district filter.
    setActiveDistrict(null);
    setSelectedState(stateCode);
    setStateName(name);
    setSelectedMember(null);
    setLoading(true);

    try {
      const result = await fetchAllStateData(stateCode);
      setStateData(result.data);
      setIsLive(result.isLive);
    } catch (error) {
      console.error('Error fetching state data:', error);
      setStateData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMemberSelect = useCallback(async (member) => {
    // If the member has a bioguide_id and limited data, try fetching full detail
    if (member.bioguide_id && !member.bio) {
      try {
        const result = await fetchMemberDetail(member.bioguide_id);
        if (result.data) {
          setSelectedMember(result.data);
          return;
        }
      } catch (e) {
        // Fall through to use the member as-is
      }
    }
    setSelectedMember(member);
  }, []);

  const handleBack = useCallback(() => {
    const prev = selectedMemberRef.current;
    if (prev) setLastViewedMemberId(prev.bioguide_id || prev.id || null);
    setSelectedMember(null);
  }, []);

  // Fully close any open profile (rep or candidate). Used by the × button
  // in profile headers — useful when the panel has been dragged wide and
  // the user wants to return to the list without walking through Back.
  const handleCloseProfile = useCallback(() => {
    const prevM = selectedMemberRef.current;
    const prevC = selectedCandidateRef.current;
    if (prevM) setLastViewedMemberId(prevM.bioguide_id || prevM.id || null);
    if (prevC) setLastViewedCandidateId(prevC.id || null);
    setSelectedMember(null);
    setSelectedCandidate(null);
  }, []);

  // Clicking the "On ballot" badge on a rep profile takes the user to the
  // Elections tab with this candidate focused. Clearing selectedMember lets
  // SidePanel render (not ProfileView), and BallotTab reacts to focusCandidateId
  // to open the right election / race + pulse the candidate row.
  const handleOnBallotClick = useCallback((activeCandidacy) => {
    if (!activeCandidacy?.candidate_id) return;
    const prevM = selectedMemberRef.current;
    if (prevM) setLastViewedMemberId(prevM.bioguide_id || prevM.id || null);
    setSelectedMember(null);
    setSidePanelTab('ballot');
    setFocusCandidateId(activeCandidacy.candidate_id);
  }, []);

  // BallotTab calls this once it has consumed the focus (expanded the card,
  // scrolled into view, started the pulse). Clearing it prevents re-triggering
  // on unrelated re-renders.
  const handleFocusCandidateConsumed = useCallback(() => {
    setFocusCandidateId(null);
  }, []);

  const handleHighlightConsumed = useCallback(() => {
    setLastViewedMemberId(null);
    setLastViewedCandidateId(null);
  }, []);

  // When an address lookup returns results, auto-load that state AND focus on
  // the user's congressional district (map zoom + filtered rep list).
  const handleAddressResult = useCallback(async (data) => {
    if (!data.stateCode) return;

    setSelectedState(data.stateCode);
    const stateNameEntry = Object.entries(STATE_NAME_TO_CODE).find(([, code]) => code === data.stateCode);
    const name = stateNameEntry ? stateNameEntry[0] : data.stateCode;
    setStateName(name);
    setSelectedMember(null);

    // Stash the district info — MapView reacts to this to zoom into the CD,
    // SidePanel filters the rep list accordingly, and BallotTab/LocalOfficialsTab
    // use the richer geography (county, city, state legislative districts).
    setActiveDistrict({
      stateCode: data.stateCode,
      stateFips: data.stateFips,
      district: data.district,
      districtLabel: data.districtLabel,
      address: data.address,
      countyFips: data.countyFips,
      countyName: data.countyName,
      city: data.city,
      citySlug: data.citySlug,
      stateSenateDistrict: data.stateSenateDistrict,
      stateHouseDistrict: data.stateHouseDistrict,
    });

    try {
      const result = await fetchAllStateData(data.stateCode);
      setStateData(result.data);
      setIsLive(result.isLive);
      showNotification(
        `Found your district: ${data.districtLabel || data.stateCode}. Showing your representatives.`
      );
    } catch (e) {
      console.error('Error loading state after address lookup:', e);
    }
  }, [showNotification]);

  const clearDistrictFilter = useCallback(() => {
    setActiveDistrict(null);
  }, []);

  // Clicking on the ocean / outside the US on the map deselects everything
  // but leaves the zoom where it is (non-jarring reset to the welcome state).
  const handleStateDeselect = useCallback(() => {
    setSelectedState(null);
    setStateName(null);
    setStateData(null);
    setActiveDistrict(null);
    setSelectedMember(null);
    setSelectedCandidate(null);
  }, []);

  // Triggered when the user clicks a district polygon on the map.
  // Same effect as an address lookup: zoom in, filter reps.
  const handleDistrictSelect = useCallback((info) => {
    if (!info?.stateFips || !info?.district) return;
    setSelectedMember(null);
    setActiveDistrict(info);
    showNotification(
      `Showing representatives for ${info.districtLabel}${info.district === 'At-Large' ? '' : ' (District ' + info.district + ')'}`
    );
  }, [showNotification]);

  // Triggered by the MapView's "back to <state>" affordance. Clears the
  // district focus but keeps the state selected so the user lands back on
  // the state-wide view.
  const handleDistrictBack = useCallback(() => {
    setActiveDistrict(null);
    setSelectedMember(null);
  }, []);

  // ─── On-load: re-check tracked bills for status changes ────────────
  // Runs once per session. For each tracked bill, fetches the latest snapshot
  // and compares latest_action_date / latest_action against the stored value.
  // If anything has changed, we update the stored snapshot and surface an
  // in-app notification banner with a link to open the tracked-bills modal.
  useEffect(() => {
    if (trackedCheckedRef.current) return;
    trackedCheckedRef.current = true;
    const map = getAllTrackedBills();
    const bills = Object.values(map);
    if (bills.length === 0) return;

    let cancelled = false;
    (async () => {
      const changed = [];
      // Limited concurrency: 3 workers
      const queue = [...bills];
      const worker = async () => {
        while (queue.length) {
          const b = queue.shift();
          try {
            const { data } = await fetchBillSnapshot(b.congress, b.type, b.number);
            if (!data) continue;
            if (
              (data.latest_action_date || '') !== (b.latest_action_date || '') ||
              (data.latest_action || '') !== (b.latest_action || '')
            ) {
              changed.push({ ...b, latest_action: data.latest_action, latest_action_date: data.latest_action_date });
              updateTrackedBill(b.key, {
                latest_action: data.latest_action,
                latest_action_date: data.latest_action_date,
                policy_area: data.policy_area || b.policy_area,
                url: data.url || b.url,
                title: data.title || b.title,
                last_change_seen_at: new Date().toISOString(),
              });
            }
          } catch (e) {
            // Ignore — partial failures are fine
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (cancelled || changed.length === 0) return;
      const summary = changed.length === 1
        ? `Update on ${changed[0].citation || changed[0].title}: ${changed[0].latest_action || 'status changed'}.`
        : `${changed.length} of your tracked bills had status updates.`;
      setNotification(summary);
    })();

    return () => { cancelled = true; };
  }, []);

  // ─── Browser back/forward integration ────────────────────────────────
  // Mirror the three "overlay" bits of nav state (selectedMember,
  // selectedCandidate, sidePanelTab) into `history.state` so the browser
  // Back button / keyboard shortcut walks back through profiles instead of
  // leaving the site. We only record a new history entry when an overlay
  // *opens*; closing it is handled by React state + the popstate listener.
  const skipNextHistoryPushRef = useRef(false);
  const lastHistorySnapshotRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const snapshot = {
      _cl: true,
      memberId: selectedMember ? (selectedMember.bioguide_id || selectedMember.id) : null,
      candidateId: selectedCandidate ? selectedCandidate.id : null,
      tab: sidePanelTab,
    };
    // Skip pushing when the change was caused by a popstate (the browser is
    // already showing the right entry) or on initial mount.
    if (skipNextHistoryPushRef.current) {
      skipNextHistoryPushRef.current = false;
      lastHistorySnapshotRef.current = snapshot;
      return;
    }
    const prev = lastHistorySnapshotRef.current;
    lastHistorySnapshotRef.current = snapshot;
    if (!prev) {
      // First run: replace so we don't accumulate a bogus initial entry.
      window.history.replaceState(snapshot, '');
      return;
    }
    // Only push when an overlay opened (memberId or candidateId became set).
    const opened =
      (snapshot.memberId && snapshot.memberId !== prev.memberId) ||
      (snapshot.candidateId && snapshot.candidateId !== prev.candidateId);
    if (opened) {
      window.history.pushState(snapshot, '');
    } else {
      window.history.replaceState(snapshot, '');
    }
  }, [selectedMember, selectedCandidate, sidePanelTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = (ev) => {
      const st = ev.state;
      if (!st || !st._cl) return;
      skipNextHistoryPushRef.current = true;
      // Close overlays that the target state says should be closed. We don't
      // try to re-open a previous member from just an id — rehydrating requires
      // a fetch and most users just want Back to walk them out of the profile.
      // Read current overlays via refs so we can record the last-viewed id
      // without the double-invoke risk of setState((prev) => ...) in StrictMode.
      if (!st.memberId) {
        const prevM = selectedMemberRef.current;
        if (prevM) {
          setLastViewedMemberId(prevM.bioguide_id || prevM.id || null);
          setSelectedMember(null);
        }
      }
      if (!st.candidateId) {
        const prevC = selectedCandidateRef.current;
        if (prevC) {
          setLastViewedCandidateId(prevC.id || null);
          setSelectedCandidate(null);
        }
      }
      if (st.tab && st.tab !== sidePanelTab) setSidePanelTab(st.tab);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [selectedMember, selectedCandidate, sidePanelTab]);

  // Derive contextual back labels. The profile doesn't need to know *where*
  // it came from — it just needs the human-readable name of the view Back
  // will return to. With Option 1A (candidate select clears selectedMember)
  // that view == the currently-active SidePanel tab.
  const sidePanelTabLabel = ({
    congress: 'Congress',
    state: 'State',
    local: 'Local',
    ballot: 'Elections',
  })[sidePanelTab] || 'list';
  const candidateBackLabel = `Back to ${sidePanelTabLabel}`;
  const memberBackLabel = `Back to ${sidePanelTabLabel}`;

  // Global nav search picks a member from any state — load that state's context
  // and open the profile directly.
  // Also used for cross-nav from a candidate profile → the sitting rep profile.
  // We MUST clear selectedCandidate so the conditional render switches from
  // CandidateProfile back to SidePanel/ProfileView.
  const handleGlobalMemberPick = useCallback(async (member) => {
    if (!member) return;
    setSelectedCandidate(null);
    setActiveDistrict(null);
    setSelectedMember(null);

    if (member.state && member.state !== selectedState) {
      setSelectedState(member.state);
      const nameEntry = Object.entries(STATE_NAME_TO_CODE).find(([, code]) => code === member.state);
      setStateName(nameEntry ? nameEntry[0] : member.state);
      setLoading(true);
      try {
        const result = await fetchAllStateData(member.state);
        setStateData(result.data);
        setIsLive(result.isLive);
      } catch (e) {
        console.error('Error loading state after search pick:', e);
      } finally {
        setLoading(false);
      }
    }

    // Now open the member profile (fetch full detail if the index entry is thin)
    await handleMemberSelect(member);
  }, [selectedState, handleMemberSelect]);

  return (
    <div className="flex flex-col h-screen">
      <Navbar
        onMemberPick={handleGlobalMemberPick}
        onCandidatePick={handleCandidateSelect}
        onOpenCommittees={() => setCommitteesOpen(true)}
        onOpenTracked={() => setTrackedOpen(true)}
        onSubscribe={() => handleRequestCitizenWaitlist('subscribe')}
        citizen={citizen}
        onCitizenLogin={handleCitizenLoginOpen}
        onCitizenLogout={handleCitizenLogoutClick}
        onCitizenDashboard={() => setDashboardOpen(true)}
        onHome={handleStateDeselect}
      />
      <CitizenLoginModal
        open={citizenLoginOpen}
        onClose={() => setCitizenLoginOpen(false)}
        onSuccess={handleCitizenLoginSuccess}
      />
      <CommitteesModal
        open={committeesOpen}
        onClose={() => setCommitteesOpen(false)}
        onMemberPick={handleGlobalMemberPick}
      />
      <MyTrackedModal
        open={trackedOpen}
        onClose={() => setTrackedOpen(false)}
        onMemberPick={handleGlobalMemberPick}
        onNotify={showNotification}
      />
      {/* Layout pivot — desktop / tablet / mobile-landscape all show
          map and panel side-by-side (flex row, map flex-1, panel a
          fixed draggable width). Mobile-portrait stacks them
          vertically (flex column, map a fixed share of the viewport
          on top, panel takes the rest below). Landscape phones use
          the side-by-side layout because a 360-500px-tall viewport
          is too cramped to stack a useful map and a useful panel. */}
      <div className={`flex flex-1 overflow-hidden ${useStackedLayout ? 'flex-col' : ''}`}>
        {/* Map view + banner wrapper. Mobile-portrait: a draggable-
            height row at the top, sized by mapHeightPx (defaulting to
            40% viewport height; user can drag the "Map" handle to
            shrink it to 0). Side-by-side mode: stretches to fill
            remaining horizontal space. */}
        <div
          className="relative flex overflow-hidden"
          style={
            useStackedLayout
              ? { height: mapHeightPx, flexShrink: 0 }
              : { flex: 1 }
          }
        >
          <MapView
            onStateSelect={handleStateSelect}
            onStateDeselect={handleStateDeselect}
            onDistrictSelect={handleDistrictSelect}
            onDistrictBack={handleDistrictBack}
            selectedState={selectedState}
            activeDistrict={activeDistrict}
          />
          <NotificationBanner message={notification} onDismiss={() => setNotification(null)} />
        </div>
        {/* Draggable divider with a "Map" label.
            Side-by-side layout: vertical bar between map (left) and
              panel (right) — dragging widens / narrows the panel.
            Stacked (mobile-portrait): horizontal bar between map
              (top) and panel (bottom) — dragging up / down collapses
              or expands the map area. */}
        {useStackedLayout ? (
          <PanelResizer
            orientation="horizontal"
            onResize={setMapHeightPx}
            minHeight={0}
            maxHeight={mapMaxHeightPx}
            // Navbar is 56px tall — subtract that from touch Y so the
            // bar visually tracks the finger. Keep in sync with the
            // navbar's height style.
            topOffset={56}
            label="Map"
            isMobile={isMobile}
          />
        ) : (
          <PanelResizer
            orientation="vertical"
            onResize={setPanelWidth}
            minWidth={380}
            maxFraction={0.5}
            label="Map"
            // Pass isMobile (touch viewport, not just stacked-layout)
            // so landscape phones still get the chunky thumb-friendly
            // chrome on the vertical resizer.
            isMobile={isMobile}
          />
        )}
        {/* SidePanel is ALWAYS mounted so its scroll container survives
            the candidate-profile detour. When a candidate is open, we
            hide SidePanel via display:none (preserves DOM + scrollTop)
            and render CandidateProfile in its place. */}
        <div
          style={{
            display: selectedCandidate ? 'none' : 'contents',
          }}
        >
          <SidePanel
            stateData={stateData}
            stateCode={selectedState}
            stateName={stateName}
            selectedMember={selectedMember}
            width={panelWidth}
            isMobile={useStackedLayout}
            onMemberSelect={handleMemberSelect}
            onBack={handleBack}
            onClose={handleCloseProfile}
            backLabel={memberBackLabel}
            onOnBallotClick={handleOnBallotClick}
            loading={loading}
            isLive={isLive}
            onNotify={showNotification}
            onAddressResult={handleAddressResult}
            activeDistrict={activeDistrict}
            onClearDistrict={clearDistrictFilter}
            compareIds={compareIds}
            onCompareToggle={handleCompareToggle}
            onCandidateSelect={handleCandidateSelect}
            onCandidateCompareToggle={handleCandidateCompareToggle}
            compareCandidateIds={compareCandidateIds}
            onCandidatePick={handleCandidateSelect}
            activeTab={sidePanelTab}
            onActiveTabChange={setSidePanelTab}
            highlightMemberId={lastViewedMemberId}
            highlightCandidateId={lastViewedCandidateId}
            onHighlightConsumed={handleHighlightConsumed}
            focusCandidateId={focusCandidateId}
            onFocusCandidateConsumed={handleFocusCandidateConsumed}
            onOpenPage={handleOpenPage}
            onRequestVerify={handleCitizenLoginOpen}
            onStatePick={handleStateSelect}
            citizen={citizen}
            onOpenTracked={() => setTrackedOpen(true)}
            onSubscribe={() => handleRequestCitizenWaitlist('subscribe')}
          />
        </div>
        {selectedCandidate && (
          <CandidateProfile
            candidate={selectedCandidate}
            width={panelWidth}
            isMobile={useStackedLayout}
            onBack={handleCandidateBack}
            onClose={handleCloseProfile}
            backLabel={candidateBackLabel}
            onNotify={showNotification}
            onCompareToggle={handleCandidateCompareToggle}
            isComparing={compareCandidateIds.has(selectedCandidate.id)}
            onMemberPick={handleGlobalMemberPick}
            onStatePersonPick={handleStatePersonPick}
            onOpenPage={handleOpenPage}
          />
        )}
      </div>
      <CompareTray
        items={compareItems}
        onRemove={handleCompareRemove}
        onClear={handleCompareClear}
        onOpen={() => setCompareOpen(true)}
      />
      <CompareView
        open={compareOpen}
        items={compareItems}
        onClose={() => setCompareOpen(false)}
      />
      {/* Pages layer — full-viewport overlay. handleOpenPage sets the
          officialId + meta and PageView mounts over everything. The three
          modal intents (rep login, claim, citizen waitlist) are wired to
          state-driven modals below. */}
      {selectedPageOfficialId && (
        <PageView
          officialId={selectedPageOfficialId}
          displayName={pageMeta?.displayName}
          role={pageMeta?.role}
          photoUrl={pageMeta?.photoUrl}
          me={me}
          onClose={handleClosePage}
          onRequestLogin={() => setLoginModalOpen(true)}
          onRequestClaim={handleRequestClaim}
          onRequestCitizenWaitlist={() => handleRequestCitizenWaitlist('comment')}
          onLogout={handleLogout}
          citizen={citizen}
          onCitizenLoginRequired={handleCitizenLoginOpen}
        />
      )}
      {/* ConstituentDashboard — full-page overlay for signed-in citizens.
          Same z-index family as PageView so it sits above the map but
          below modals. */}
      {dashboardOpen && citizen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'var(--cl-bg)',
            overflowY: 'auto',
          }}
        >
          <ConstituentDashboard
            citizen={{
              name: citizen.display_name,
              email: citizen.email,
              district: citizen.congressional_district,
              state: citizen.state,
              city: citizen.city,
            }}
            onClose={() => setDashboardOpen(false)}
            onNavigate={{
              manageTracked: () => {
                setDashboardOpen(false);
                setTrackedOpen(true);
              },
              browseReps: () => setDashboardOpen(false),
              // Compare candidates — close dashboard, open the unified
              // compare modal if the user has items queued; otherwise
              // notify so they know how to add things.
              compareCandidates: () => {
                setDashboardOpen(false);
                if (compareItems.length >= 2) {
                  setCompareOpen(true);
                } else {
                  showNotification(
                    'Add 2+ candidates to compare from any rep or candidate page.'
                  );
                }
              },
              // Polling place + ballot — both close the dashboard and
              // route the citizen to the BallotTab in their SidePanel,
              // where the polling place card lives. Switches the tab if
              // a state is already selected.
              pollingPlace: () => {
                setDashboardOpen(false);
                setSidePanelTab('ballot');
                if (!selectedState) {
                  showNotification('Click your state on the map to see your ballot and polling place.');
                }
              },
              ballot: () => {
                setDashboardOpen(false);
                setSidePanelTab('ballot');
                if (!selectedState) {
                  showNotification('Click your state on the map to see your ballot.');
                }
              },
              districtCalendar: () => setDashboardOpen(false),
              viewActivity: () => setDashboardOpen(false),
              // Account settings has no surface in Phase 1.5 — TODO:
              // wire to a CitizenAccountModal once that ships.
              accountSettings: () => {
                setDashboardOpen(false);
                showNotification('Account settings coming in the next phase.');
              },
            }}
          />
        </div>
      )}
      {/* Rep login modal — hidden httpOnly cookie handles persistence; we
          just need to close the modal on success, and useAuth picks up
          the new `me` via its listener. */}
      <RepLoginModal
        open={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
        onSuccess={() => {
          setLoginModalOpen(false);
          showNotification('Signed in. You can now post on your page.');
        }}
      />
      {/* Citizen waitlist modal — fires from comment CTAs or Subscribe. */}
      <CitizenWaitlistModal
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        clickedFrom={waitlistFrom}
      />
      {/* Claim this page modal — shown from unclaimed-page CTA. */}
      <ClaimPageModal
        open={claimModalOpen}
        onClose={() => setClaimModalOpen(false)}
        onSignInInstead={handleRequestLogin}
        officialName={pageMeta?.displayName}
        officialId={selectedPageOfficialId}
      />
    </div>
  );
}

