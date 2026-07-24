'use client';

// CivicView — top-level page (the orchestrator).
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
import CandidateLoginModal from '@/components/CandidateLoginModal';
import CitizenWaitlistModal from '@/components/CitizenWaitlistModal';
import ClaimPageModal from '@/components/ClaimPageModal';
import ConstituentDashboard from '@/components/ConstituentDashboard';
import HelpBuildThisView from '@/components/HelpBuildThisView';
import FeedbackView from '@/components/FeedbackView';
import { fetchAllStateData, fetchAllMembers, fetchBillSnapshot, fetchMemberDetail, fetchCandidate, fetchStatePerson } from '@/lib/api';
import { STATE_NAME_TO_CODE } from '@/lib/constants';
import { getAllTrackedBills, updateTrackedBill } from '@/lib/trackedBills';
import { useAuth, logoutRep } from '@/lib/auth';
import { useCitizenAuth, logoutCitizen } from '@/lib/citizenAuth';
import { useCandidateAuth, logoutCandidate } from '@/lib/candidateAuth';
import { useViewport, useIsLandscape } from '@/lib/useViewport';
import { loadNavState, saveNavState } from '@/lib/navState';
import { useTutorialActions } from '@/lib/tutorial';

export default function Home() {
  // Viewport drives the desktop ↔ mobile layout pivot. Computed once at
  // the top so every layout decision below sees a consistent value.
  // 'mobile' (≤900px), 'tablet' (≤1024px), 'desktop' (>1024px).
  const viewport = useViewport();
  const isMobile = viewport === 'mobile';
  // Includes tablet too. Phones in portrait sometimes report wider CSS
  // widths than the ≤900px mobile threshold (Samsung Internet at certain
  // chrome states reports 901–1024px); they need the stacked layout
  // anyway. Real tablets in portrait also benefit from stacking —
  // a 768–834px wide column of map + panel side-by-side leaves neither
  // half enough room. We pivot back to side-by-side on landscape since
  // the vertical room is then the limiting factor.
  const isCompact = viewport === 'mobile' || viewport === 'tablet';
  // True when the phone is held sideways (or any window where width >
  // height). Used together with isCompact to decide between the stacked
  // mobile layout (map on top, panel below) and the desktop side-by-
  // side layout (map on left, panel on right). On a phone in landscape
  // the viewport is too short (~360–500px) to stack a useful map AND
  // a useful panel, so we pivot to the desktop layout instead.
  const isLandscape = useIsLandscape();
  // Single source of truth for "use the stacked / mobile-style layout"
  // — true on any compact-and-portrait viewport. Landscape compact
  // (phones held sideways) gets the desktop side-by-side treatment.
  const useStackedLayout = isCompact && !isLandscape;

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
  // "Help build this" overlay — transparent project status + crowdfund
  // CTA. Opened from the navbar.
  const [helpBuildOpen, setHelpBuildOpen] = useState(false);
  // Feedback overlay — embedded Google Form. Same mount pattern.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Lifted SidePanel tab so it survives the candidate-profile detour. Without
  // this, opening a candidate from Elections + clicking Back unmounts SidePanel
  // and resets the tab back to "congress".
  const [sidePanelTab, setSidePanelTab] = useState('congress');
  // Width of the right-side panel in pixels. Users can drag the resizer on
  // its left edge to grow it up to 50% of the viewport. 380 is the minimum
  // (= original fixed width) and is what we start with.
  const [panelWidth, setPanelWidth] = useState(380);
  // Tracked viewport width — drives the landscape map slider's
  // open/closed snap targets (50% open, near-full closed). Lives as
  // state so resize / orientation events trigger a re-render with
  // fresh targets, and the resizer's binary-mode clamp stays in
  // sync with the current viewport.
  const [windowWidth, setWindowWidth] = useState(1024);
  useEffect(() => {
    const apply = () => {
      if (typeof window === 'undefined') return;
      const w = window.visualViewport?.width || window.innerWidth;
      setWindowWidth(w);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', apply);
    }
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', apply);
      }
    };
  }, []);
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
  // Tracks whether the first viewport measurement has happened yet, so
  // subsequent recomputes (resize / orientation flip) preserve the
  // user's open/closed choice instead of treating "current is 0" as
  // "not yet initialized, default to open." Without this distinction,
  // flipping landscape → portrait reset the map to its 40% default
  // because the recompute couldn't tell "user closed it" from
  // "first run, no value set yet."
  const mapHeightInitialized = useRef(false);
  // True when the current PageView overlay was reached by navigating IN
  // from another view (e.g. the /polls feed opens official pages via a
  // full-page link with ?page=). Drives context-aware Back below.
  const pageOpenedViaUrlRef = useRef(false);
  useEffect(() => {
    const NAVBAR_PX = 56;
    const RESIZER_PX = 28;
    const recompute = () => {
      const visibleH = (typeof window !== 'undefined' && window.visualViewport)
        ? window.visualViewport.height
        : window.innerHeight;
      const available = Math.max(0, visibleH - NAVBAR_PX - RESIZER_PX);
      const max = Math.round(available * 0.4);
      // Degenerate-measurement guard: on mobile reloads visualViewport
      // can report 0 (or a sliver) before the first layout settles.
      // Treating that as a real measurement used to initialize the map
      // at height 0, and the old persist-on-change effect then recorded
      // "user closed it" — so the map came back closed on every later
      // load even though the user left it open. Any viewport that uses
      // the stacked layout yields a real max far above this floor, so
      // skip the bogus reading and let the next resize/visualViewport
      // event (the URL bar settling fires one) deliver the real number.
      // Skipping BEFORE the initialized flag flips keeps the first-run
      // localStorage read pending until a trustworthy measurement.
      if (max < 80) return;
      setMapMaxHeightPx(max);
      const wasFirstRun = !mapHeightInitialized.current;
      mapHeightInitialized.current = true;
      setMapHeightPx((current) => {
        if (wasFirstRun) {
          // Fresh page load: default OPEN at the 40% height, but honor a
          // remembered collapse choice so the map stays shut across
          // reloads / navigation if the user dragged it closed (request).
          let collapsed = false;
          try { collapsed = window.localStorage.getItem('cl:map:collapsed') === '1'; } catch { /* private mode */ }
          return collapsed ? 0 : max;
        }
        // Subsequent recomputes (orientation flip, URL bar show/hide):
        // preserve the binary open/closed state. 0 stays 0 (user
        // closed it); anything > 0 was "open" — re-clamp to the new
        // max so the map fills the freshly-measured space.
        return current > 0 ? max : 0;
      });
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
  // Persist the mobile map's open/closed choice so it survives reloads
  // and in-app navigation (default open on first ever visit). Written
  // ONLY from the resizer's user gestures — never from an effect
  // watching mapHeightPx — so system-driven heights (the mount-default
  // 0, degenerate early-load measurements, orientation re-clamps) can
  // never masquerade as "the user closed the map". The drag handler
  // streams intermediate heights mid-gesture; the final call on release
  // is the snapped 0 / max, so last-write-wins lands on the user's
  // actual choice.
  const handleMapResize = useCallback((h) => {
    setMapHeightPx(h);
    try {
      window.localStorage.setItem('cl:map:collapsed', h === 0 ? '1' : '0');
    } catch { /* private mode */ }
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
  // One-shot hint for which PageView tab opens first. Used by the
  // navbar IdentitySwitcher — clicking the rep / candidate identity
  // navigates to their page AND wants the Dashboard tab pre-selected
  // (instead of the default 'feed'). The hint is consumed by PageView
  // via `initialActiveView` and cleared on the next render so a
  // subsequent navigation doesn't accidentally reuse it.
  const [pendingActiveView, setPendingActiveView] = useState(null);
  const setActiveViewForNextPage = useCallback((view) => {
    setPendingActiveView(view);
    // Schedule a clear so the hint is only honored on the next mount.
    // The microtask runs after React's state batch so PageView's
    // useState reads the populated value on first render.
    Promise.resolve().then(() => setPendingActiveView(null));
  }, []);
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
  // Candidate auth modal — opens from the rep login modal's
  // "I'm a candidate instead" affordance (Phase 3 wires the modal;
  // Phase 4 adds first-class entry points in the navbar + page
  // claim flow).
  const [candidateLoginOpen, setCandidateLoginOpen] = useState(false);
  // Phase 4b: candidate auth state surfaces in the Navbar pill + the
  // PageView is_owner gating. Logout fires the candidate-auth /logout
  // endpoint (clears cookie + rep+citizen sessions per the
  // _tearDownTwoOtherRoles contract).
  const { candidate } = useCandidateAuth();
  const handleCandidateLoginSuccess = useCallback(() => {
    setCandidateLoginOpen(false);
    showNotification('Signed in as candidate. You can now manage your page.');
  }, []);
  const handleCandidateLogoutClick = useCallback(async () => {
    await logoutCandidate();
  }, []);
  // ConstituentDashboard overlay — opens when a signed-in citizen clicks
  // their identity pill in the Navbar. Auto-closes if the citizen signs out.
  const [dashboardOpen, setDashboardOpen] = useState(false);
  useEffect(() => {
    if (!citizen && dashboardOpen) setDashboardOpen(false);
  }, [citizen, dashboardOpen]);
  // Which dashboard view to open on — 'settings' when deep-linked via
  // /?open=settings (Task #102), otherwise the civic overview.
  const [dashboardInitialView, setDashboardInitialView] = useState('overview');

  // ─── Deep-link surfaces + start-page preference (Task #102) ───────
  // /?open=tracked|dashboard|settings opens the matching overlay
  // directly — used by the /bills navbar (and any future surface) so
  // "Tracked items" / "Dashboard" don't dead-end on the home map.
  // An explicit ?open= also suppresses the start-page redirect below.
  const startPageHandledRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const open = (new URLSearchParams(window.location.search).get('open') || '').toLowerCase();
    if (!open) return;
    startPageHandledRef.current = true; // explicit destination wins
    if (open === 'tracked') {
      setTrackedOpen(true);
    } else if (open === 'dashboard' || open === 'settings') {
      // Dashboard needs the citizen session — wait for it below.
      setDashboardInitialView(open === 'settings' ? 'settings' : 'overview');
      setPendingDashboardOpen(true);
    }
  }, []);
  // /?open=dashboard arrives before useCitizenAuth resolves, and the
  // auto-close effect above would immediately shut an early open. Hold
  // the intent until the citizen lands.
  const [pendingDashboardOpen, setPendingDashboardOpen] = useState(false);
  useEffect(() => {
    if (pendingDashboardOpen && citizen) {
      setPendingDashboardOpen(false);
      setDashboardOpen(true);
    }
  }, [pendingDashboardOpen, citizen]);

  // Start-page preference: once per browser session, when a signed-in
  // citizen lands on '/' with no explicit destination (no nav params,
  // no ?open=), route to their saved start page. sessionStorage guard
  // keeps in-session returns to Home from re-triggering.
  useEffect(() => {
    if (!citizen || startPageHandledRef.current) return;
    startPageHandledRef.current = true;
    const pref = (citizen.start_page || '').toLowerCase();
    if (!pref || pref === 'home') return;
    const url = new URLSearchParams(window.location.search);
    if (['state', 'district', 'member', 'candidate', 'page', 'open'].some((k) => url.get(k))) return;
    try {
      if (sessionStorage.getItem('cv:start-page-applied')) return;
      sessionStorage.setItem('cv:start-page-applied', '1');
    } catch { /* private mode — apply every load, still correct */ }
    if (pref === 'dashboard') {
      setDashboardInitialView('overview');
      setDashboardOpen(true);
    } else if (['polls', 'posts', 'bills', 'stats'].includes(pref)) {
      window.location.assign('/' + pref);
    }
  }, [citizen]);
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
    // Context-aware Back: if this page was reached by navigating in from
    // another in-app view (the /polls or /posts feed links here via a
    // full-page ?page= load), return THERE via browser history instead of
    // just revealing home. Only do so when there's a same-origin history
    // entry to go back to; otherwise (deep link / fresh tab) close the
    // overlay to home as before.
    if (pageOpenedViaUrlRef.current && typeof window !== 'undefined') {
      const ref = document.referrer || '';
      const sameOrigin = ref.startsWith(window.location.origin);
      if (sameOrigin && window.history.length > 1) {
        pageOpenedViaUrlRef.current = false;
        window.history.back();
        return;
      }
    }
    pageOpenedViaUrlRef.current = false;
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
  // PageView overlay ref — lets the popstate handler read the current page
  // id without re-binding the listener on every open/close (matches the
  // member/candidate ref pattern above).
  const selectedPageOfficialIdRef = useRef(null);
  useEffect(() => { selectedPageOfficialIdRef.current = selectedPageOfficialId; }, [selectedPageOfficialId]);

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

  const handleStateSelect = useCallback(async (stateCode, name, options) => {
    // Clicking a state on the map clears any active district filter.
    setActiveDistrict(null);
    setSelectedState(stateCode);
    setStateName(name);
    setSelectedMember(null);
    setLoading(true);
    // Optional tab override — used by the "View {state} page" button in
    // OnTheBallotSection to land directly on the Elections tab instead
    // of the default Congress view. Map clicks and Browse-by-state grid
    // clicks omit this and keep the existing Congress-default behavior.
    if (options?.tab) {
      setSidePanelTab(options.tab);
    }

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

  // ─── Restore navigation state on reload ────────────────────────────
  // Two precedence levels:
  //   1. URL search params (?state=FL&member=K000395&…) — authoritative
  //      when present, since the user explicitly typed/shared that URL.
  //   2. localStorage payload — fallback for "I just hit reload with no
  //      query string and want to be where I was."
  // Whichever wins, navStateRestoredRef gates the save-effect below so
  // the initial defaults don't clobber the source of truth.
  const navStateRestoredRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ─── 1. URL params first ────────────────────────────────────
      const url = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const urlState     = url?.get('state');
      const urlDistrict  = url?.get('district');
      const urlMember    = url?.get('member');
      const urlCandidate = url?.get('candidate');
      const urlPage      = url?.get('page');
      const hasUrlNav = Boolean(urlState || urlDistrict || urlMember || urlCandidate || urlPage);

      if (hasUrlNav) {
        // Layout prefs (desktop panel width) live in nav state, not the
        // URL. Restore them here too: this URL-params branch returns
        // before the localStorage-fallback path that normally re-applies
        // them, so without this a reload on a profile (?member=/?page=)
        // snapped the map/panel split back to the default width.
        const savedLayout = loadNavState();
        if (typeof savedLayout?.panelWidth === 'number') setPanelWidth(savedLayout.panelWidth);
        // State first (loads side-panel data + clears activeDistrict).
        if (urlState) {
          const upper = urlState.toUpperCase();
          // Reverse-lookup the state name so the panel header reads
          // "Florida" not "FL".
          const entry = Object.entries(STATE_NAME_TO_CODE).find(([, code]) => code === upper);
          const stateName = entry ? entry[0] : upper;
          try { await handleStateSelect(upper, stateName); } catch { /* ignore network */ }
          if (cancelled) return;
        }
        // Member by bioguide_id — handleMemberSelect fetches detail
        // when the member object lacks `.bio`.
        if (urlMember) {
          // Reload keeps ?member= in the URL, but that only gives us a
          // bioguide_id — and a detail fetch returns nothing for non-
          // congress officials (President/VP/SCOTUS), blanking the
          // profile. Prefer the FULL member object saved in nav state
          // last session (written on every navigation); fall back to a
          // detail fetch only when there's no matching saved object
          // (shared link / fresh tab).
          const savedNav = loadNavState();
          const savedM = savedNav?.selectedMember;
          if (savedM && (savedM.bioguide_id || savedM.id) === urlMember) {
            setSelectedMember(savedM);
          } else {
            try { await handleMemberSelect({ bioguide_id: urlMember, name: '' }); } catch { /* ignore */ }
          }
          if (cancelled) return;
        }
        // Candidate by id — handleCandidateSelect fetches when the
        // stub lacks `.top_issues`.
        if (urlCandidate) {
          // Same as urlMember above: restore the full saved candidate
          // object on reload instead of re-fetching from just the id.
          const savedNav = loadNavState();
          const savedC = savedNav?.selectedCandidate;
          if (savedC && savedC.id === urlCandidate) {
            setSelectedCandidate(savedC);
          } else {
            try { await handleCandidateSelect({ id: urlCandidate }); } catch { /* ignore */ }
          }
          if (cancelled) return;
        }
        if (urlPage) {
          // The URL only carries the page slug, not the displayName /
          // role / photoUrl. Without restoring those, PageView's
          // heading falls back to 'This official' because the
          // backend's payload.owner is null for unclaimed pages
          // (most reps + candidates right now, since the verified-rep
          // onboarding flow is still pre-launch).
          //
          // Belt-and-suspenders restoration:
          //   1. Check sessionStorage for a matching saved pageMeta
          //      — cheap, no network round-trip.
          //   2. If not present (e.g. shared link, fresh tab), kick
          //      a background registry lookup: rep first
          //      (bioguide_id → Congress), candidate second
          //      (candidate_id → ElectionsService). Whichever
          //      resolves first wins.
          //
          // The page still mounts immediately with whatever meta we
          // have (or null); the async lookup just upgrades the
          // heading from the fallback once it returns.
          const savedForReload = loadNavState();
          const savedMeta = savedForReload?.selectedPageOfficialId === urlPage
            ? savedForReload?.pageMeta
            : null;
          pageOpenedViaUrlRef.current = true;
          handleOpenPage(urlPage, savedMeta || null);
          if (!savedMeta) {
            (async () => {
              try {
                const { data: member } = await fetchMemberDetail(urlPage);
                if (cancelled) return;
                if (member?.name) {
                  const role = member.role
                    || (member.chamber && member.district
                      ? `${member.chamber}, District ${member.district}`
                      : member.chamber);
                  setPageMeta({
                    displayName: member.name,
                    role: role || null,
                    photoUrl: member.photoUrl || null,
                  });
                  return;
                }
              } catch { /* fall through to candidate path */ }
              try {
                const { data: candidate } = await fetchCandidate(urlPage);
                if (cancelled) return;
                if (candidate?.name) {
                  setPageMeta({
                    displayName: candidate.name,
                    role: candidate.seeking_office || 'Candidate',
                    photoUrl: candidate.photo_url || null,
                  });
                }
              } catch { /* heading stays on 'This official' fallback */ }
            })();
          }
        }
        navStateRestoredRef.current = true;
        return;
      }

      // ─── 2. localStorage fallback ───────────────────────────────
      const saved = loadNavState();
      if (!saved) {
        navStateRestoredRef.current = true;
        return;
      }

      // Distinguish *how* the user got here so we know whether to
      // restore the deep navigation context. Typing the bare URL or
      // clicking a bookmark / external link is a "take me home"
      // signal — it would be confusing if the app silently jumped
      // them to the last rep page they had open. Reloading mid-
      // session (or coming back via the browser's history) does
      // mean "I want my context back", so we DO restore there.
      //
      // performance.getEntriesByType('navigation')[0].type:
      //   'navigate'      — typed URL, bookmark, external link, etc.
      //   'reload'        — F5 / Cmd-R / browser reload button
      //   'back_forward'  — back/forward button (history traversal)
      //   'prerender'     — speculative prerender (rare)
      //
      // We treat only 'reload' as "restore deep state" — every other
      // entry point is a fresh navigation that should respect the
      // empty URL the user actually typed.
      let navType = 'navigate';
      try {
        navType = (performance.getEntriesByType('navigation')[0] || {}).type || 'navigate';
      } catch { /* older browsers — assume navigate */ }
      const restoreDeepState = navType === 'reload';

      // 1. UI tweaks — apply immediately, no side-effects. These
      // are preferences, not navigation, so they restore regardless
      // of how the user got here. mapHeightPx is intentionally NOT
      // restored: its initial useState is 0 (= "fully collapsed")
      // and the recompute effect up top sets a sensible 40%-of-
      // viewport default on mount. If we restore a stale 0 here
      // AFTER recompute already set the default, the map ends up
      // closed on reload.
      if (typeof saved.panelWidth === 'number') setPanelWidth(saved.panelWidth);
      if (saved.sidePanelTab) setSidePanelTab(saved.sidePanelTab);

      // Stop here for non-reload navigations — the user typed the
      // URL fresh (or used a bookmark / external link), so the deep
      // navigation context shouldn't auto-restore.
      if (!restoreDeepState) {
        navStateRestoredRef.current = true;
        return;
      }

      // 2. Selected state — fires the state-data fetch synchronously.
      //    handleStateSelect also clears activeDistrict + selectedMember,
      //    so we re-apply those AFTER awaiting it.
      if (saved.selectedState && saved.stateName) {
        try {
          await handleStateSelect(saved.selectedState, saved.stateName);
        } catch {
          // If the state fetch fails (network down, etc.) we still
          // try to restore the rest — the user's session shouldn't
          // be tied to a specific HTTP outcome.
        }
        if (cancelled) return;
      }

      // 3. activeDistrict — JSON-safe blob, set directly.
      if (saved.activeDistrict) setActiveDistrict(saved.activeDistrict);

      // 4. Open profile / candidate. We saved the full member /
      //    candidate object so restoration is synchronous — the
      //    Issues / Bills / etc. tabs do their own lazy fetches when
      //    activated, so a stale-by-a-minute hero is fine.
      if (saved.selectedMember) setSelectedMember(saved.selectedMember);
      if (saved.selectedCandidate) setSelectedCandidate(saved.selectedCandidate);

      // 5. Page overlay (rep's social Page).
      if (saved.selectedPageOfficialId) {
        handleOpenPage(saved.selectedPageOfficialId, saved.pageMeta || null);
      }

      navStateRestoredRef.current = true;
    })();
    return () => { cancelled = true; };
    // Empty deps — runs ONCE on mount. handleStateSelect / handleOpenPage
    // are stable callbacks (useCallback with []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save the navigation state to localStorage whenever any of the
  // tracked pieces change. Gated on navStateRestoredRef so the
  // initial defaults don't overwrite a saved payload before
  // restoration has applied it.
  useEffect(() => {
    if (!navStateRestoredRef.current) return;
    // Note: mapHeightPx is intentionally not saved either. See the
    // restoration block above — it's a transient UI state recomputed
    // on every mount, not a user preference.
    saveNavState({
      selectedState,
      stateName,
      sidePanelTab,
      selectedMember,
      selectedCandidate,
      activeDistrict,
      selectedPageOfficialId,
      pageMeta,
      panelWidth,
    });
  }, [
    selectedState, stateName, sidePanelTab,
    selectedMember, selectedCandidate, activeDistrict,
    selectedPageOfficialId, pageMeta,
    panelWidth,
  ]);

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
      pageId: selectedPageOfficialId || null,
      tab: sidePanelTab,
    };

    // Build the search-param URL that reflects the current nav state,
    // so the address bar is share-friendly. Only includes the
    // identifiers that have a clean string representation
    // (state code, district number, member bioguide_id, candidate id,
    // page id). Everything else stays in localStorage.
    const params = new URLSearchParams();
    if (selectedState) params.set('state', selectedState);
    if (activeDistrict?.district) params.set('district', String(activeDistrict.district));
    if (selectedMember) {
      const id = selectedMember.bioguide_id || selectedMember.id;
      if (id) params.set('member', id);
    }
    if (selectedCandidate?.id) params.set('candidate', selectedCandidate.id);
    if (selectedPageOfficialId) params.set('page', selectedPageOfficialId);
    const qs = params.toString();
    const nextUrl = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;

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
      window.history.replaceState(snapshot, '', nextUrl);
      return;
    }
    // Only push when an overlay opened (memberId or candidateId became set).
    const opened =
      (snapshot.memberId && snapshot.memberId !== prev.memberId) ||
      (snapshot.candidateId && snapshot.candidateId !== prev.candidateId) ||
      (snapshot.pageId && snapshot.pageId !== prev.pageId);
    if (opened) {
      window.history.pushState(snapshot, '', nextUrl);
    } else {
      window.history.replaceState(snapshot, '', nextUrl);
    }
  }, [
    selectedMember, selectedCandidate, sidePanelTab,
    // Trigger on the additional URL-relevant pieces too.
    selectedState, activeDistrict, selectedPageOfficialId,
  ]);

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
      // Close the rep/candidate PageView overlay when Back lands on an entry
      // that no longer carries a pageId. Without this the URL changes but the
      // full-viewport PageView stays mounted (the "flicker, doesn't go back"
      // bug on rep/candidate pages).
      if (!st.pageId) {
        const prevP = selectedPageOfficialIdRef.current;
        if (prevP) {
          pageOpenedViaUrlRef.current = false;
          setSelectedPageOfficialId(null);
          setPageMeta(null);
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

  // Random member picks for the guided tour's live demos. Pulls the
  // same index the navbar search uses (edge-cached, cheap) and
  // samples without replacement so a pair never repeats a person.
  const pickRandomMembers = useCallback(async (n) => {
    try {
      const { data } = await fetchAllMembers();
      const pool = (data || []).filter((m) => m && (m.bioguide_id || m.id));
      if (pool.length < n) return [];
      const picked = [];
      for (let i = 0; i < n; i += 1) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
      }
      return picked;
    } catch {
      return []; // demo steps degrade to text-only — never block the tour
    }
  }, []);

  // ─── Guided-tour bridge (lib/tutorial.js) ────────────────────────
  // The TutorialOverlay (mounted in the root layout) drives surfaces
  // that live behind this page's React state — My Tracked, Feedback,
  // Help Build, the citizen login modal — by emitting bridge actions.
  // Map them onto the existing open/close handlers here. Unknown
  // actions are ignored by the listener, and on routes that don't
  // mount this page (/polls, /bills) the emit is a harmless no-op —
  // the tour step degrades to panel-only text.
  const tutorialActionHandlers = useMemo(() => ({
    'open-citizen-login': () => setCitizenLoginOpen(true),
    // Tucks the mobile stacked-layout map away (mapHeightPx is unused
    // by the side-by-side layout, so this is a no-op on desktop).
    // Deliberately NOT handleMapResize(0) — that would persist
    // 'cl:map:collapsed' as if the USER closed it; a tour-driven
    // collapse should not survive the next reload.
    'collapse-map': () => setMapHeightPx(0),
    // Live demos — the tour opens REAL surfaces with randomly-picked
    // members of Congress so every walkthrough shows actual content.
    'demo-open-profile': async () => {
      const [m] = await pickRandomMembers(1);
      if (m) handleGlobalMemberPick(m);
    },
    'demo-close-profile': () => handleCloseProfile(),
    // State tab / Elections tab demos — keep the user's selected state
    // when there is one; otherwise load Florida (the most fully
    // curated state) directly onto the requested tab. handleStateSelect
    // accepts a tab override, clears district/member selection, and
    // fetches the state payload.
    'demo-open-state-tab': async () => {
      handleCloseProfile();
      if (selectedState) {
        setSidePanelTab('state');
      } else {
        try { await handleStateSelect('FL', 'Florida', { tab: 'state' }); } catch { /* tour degrades to text */ }
      }
    },
    'demo-open-elections-tab': async () => {
      handleCloseProfile();
      if (selectedState) {
        setSidePanelTab('ballot');
      } else {
        try { await handleStateSelect('FL', 'Florida', { tab: 'ballot' }); } catch { /* tour degrades to text */ }
      }
    },
    'demo-compare': async () => {
      handleCloseProfile();
      const pair = await pickRandomMembers(2);
      if (pair.length === 2) {
        setCompareItems(pair.map((m) => ({ ...m, _kind: 'official' })));
        setCompareOpen(true);
      }
    },
    'demo-open-page': async () => {
      // Sweep the compare demo (and any open profile) first so the
      // page view is what the user sees.
      setCompareOpen(false);
      setCompareItems([]);
      handleCloseProfile();
      const [m] = await pickRandomMembers(1);
      if (m) {
        handleOpenPage(m.bioguide_id || m.id, {
          displayName: m.name,
          role: m.chamber
            ? `${m.chamber}${m.district ? `, District ${m.district}` : ''}`
            : null,
          photoUrl: m.photoUrl || null,
        });
      }
    },
    'demo-close-page': () => {
      setSelectedPageOfficialId(null);
      setPageMeta(null);
    },
    'close-citizen-login': () => setCitizenLoginOpen(false),
    'open-tracked': () => setTrackedOpen(true),
    'close-tracked': () => setTrackedOpen(false),
    // The full-page overlays (Feedback / Help Build) are sibling fixed
    // layers in the same z family — whichever renders later in the DOM
    // wins. Opening one from the tour therefore closes the other (and
    // the login modal), or a still-open Feedback would sit on top of
    // the Help Build page the step just asked for.
    'open-feedback': () => {
      setHelpBuildOpen(false);
      setCitizenLoginOpen(false);
      setFeedbackOpen(true);
    },
    'close-feedback': () => setFeedbackOpen(false),
    'open-help-build': () => {
      setFeedbackOpen(false);
      setCitizenLoginOpen(false);
      setHelpBuildOpen(true);
    },
    'close-help-build': () => setHelpBuildOpen(false),
    // Fired when the tour jumps between segments so a surface opened
    // by a skipped step never lingers under the next one.
    'close-overlays': () => {
      setCitizenLoginOpen(false);
      setTrackedOpen(false);
      setFeedbackOpen(false);
      setHelpBuildOpen(false);
      setCommitteesOpen(false);
      // Sweep the live-demo surfaces too so a segment jump never
      // strands a demo profile / comparison / page under the next
      // segment's step.
      setCompareOpen(false);
      setCompareItems([]);
      handleCloseProfile();
      setSelectedPageOfficialId(null);
      setPageMeta(null);
    },
    // handleGlobalMemberPick re-binds when selectedState changes; the
    // others are stable. Re-memoizing (and re-binding the listener)
    // on state switches is cheap and keeps the closures fresh.
  }), [pickRandomMembers, handleGlobalMemberPick, handleCloseProfile, handleOpenPage, handleStateSelect, selectedState]);
  useTutorialActions(tutorialActionHandlers);

  return (
    <div className="flex flex-col cl-h-screen-visible">
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
        candidate={candidate}
        onCandidateLogout={handleCandidateLogoutClick}
        /* Unified IdentitySwitcher dashboard-jump handlers — clicking
           a rep or candidate identity in the navbar navigates to that
           identity's page with the Dashboard tab pre-selected. */
        onOpenRepDashboard={(r) => {
          if (r?.official_id) {
            handleOpenPage(r.official_id, { displayName: r.display_name, role: r.role });
            setActiveViewForNextPage('dashboard');
          }
        }}
        onOpenCandidateDashboard={(c) => {
          if (c?.candidate_id) {
            handleOpenPage(c.candidate_id, { displayName: c.display_name });
            setActiveViewForNextPage('dashboard');
          }
        }}
        onHome={handleStateDeselect}
        onOpenHelpBuild={() => setHelpBuildOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
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
        onOpenInDashboard={() => {
          setTrackedOpen(false);
          setDashboardInitialView('tracked');
          setDashboardOpen(true);
        }}
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
          data-tutorial="map"
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
            onResize={handleMapResize}
            minHeight={0}
            maxHeight={mapMaxHeightPx}
            // Navbar is 56px tall — subtract that from touch Y so the
            // bar visually tracks the finger. Keep in sync with the
            // navbar's height style.
            topOffset={56}
            label="Map"
            isMobile={isMobile}
            // Binary open/close behavior on mobile portrait — the user
            // explicitly preferred a snap-to-state interaction over
            // free-form continuous dragging. The handle still has a
            // "tug" because the move handler applies DRAG_RESISTANCE
            // before committing the visual position; on release the
            // gesture snaps to fully open or fully closed based on
            // direction + threshold. A double-tap toggles instantly.
            binaryMode
            isOpen={mapHeightPx > 0}
          />
        ) : (
          (() => {
            // Landscape (or any touch viewport on the side-by-side
            // layout) gets the same binary-snap UX as portrait:
            // drag with tension, snap to open/closed on release,
            // double-tap toggles. Snap targets:
            //   open   = 50% of viewport (map visible + panel
            //            visible, roughly equal real estate). Floored
            //            at 280px so very narrow landscape phones
            //            still get a usable panel.
            //   closed = viewport width - 28 (the resizer's own
            //            width). Leaves the resizer visible so the
            //            user can re-open the map; without this
            //            margin the resizer + panel would overflow
            //            the viewport and clip the panel's right-
            //            edge content.
            // Desktop pointer keeps the legacy continuous slider —
            // precision dragging is fine with a mouse.
            const landscapeOpen = Math.max(280, Math.floor(windowWidth * 0.5));
            const landscapeClosed = Math.max(landscapeOpen + 80, windowWidth - 28);
            // Treat "near open width" as open. Past the midpoint
            // between open and closed → consider closed. This gives
            // the binary-mode snap-back logic a clean isOpen signal
            // even when panelWidth is mid-transition.
            const landscapeMidpoint = (landscapeOpen + landscapeClosed) / 2;
            const landscapeIsOpen = panelWidth < landscapeMidpoint;
            return (
              <PanelResizer
                orientation="vertical"
                onResize={setPanelWidth}
                // Continuous-mode bounds — only used on desktop, where
                // binaryMode is false. Mobile binary mode ignores these.
                minWidth={isMobile ? 280 : 380}
                maxFraction={0.5}
                label="Map"
                // Pass isMobile (touch viewport, not just stacked-layout)
                // so landscape phones still get the chunky thumb-friendly
                // chrome on the vertical resizer.
                isMobile={isMobile}
                // Binary mode on touch viewports only. Matches the
                // portrait stacked resizer's UX.
                binaryMode={isMobile}
                isOpen={landscapeIsOpen}
                openWidth={landscapeOpen}
                closedWidth={landscapeClosed}
              />
            );
          })()
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
            // Distinct from isMobile (which only flips for stacked
            // mobile-portrait): true on ANY compact viewport — mobile
            // OR tablet, portrait OR landscape. Drives touch-only
            // behaviors like the collapsing header on scroll. Bound
            // to isCompact rather than isMobile so phones reporting
            // 901–1024px CSS width (Samsung Internet at certain
            // chrome states, iPads in portrait) still get the
            // collapse behavior — they're on the stacked layout via
            // useStackedLayout and need the matching scroll affordance.
            isTouch={isCompact}
            // True when the user has dragged the mobile horizontal
            // resizer all the way down (mapHeightPx === 0) OR
            // (in landscape) when the panel has snapped to its
            // 'closed' target — the resizer's own width away from
            // the viewport edge, which is the binary-mode close
            // position. Either way the user has chosen to give the
            // panel the entire visible area — hide the header to
            // honor that.
            mapCollapsed={
              (useStackedLayout && mapHeightPx === 0) ||
              (isMobile && !useStackedLayout && panelWidth >= windowWidth - 40)
            }
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
          onRequestCandidateLogin={() => setCandidateLoginOpen(true)}
          onRequestClaim={handleRequestClaim}
          onRequestCitizenWaitlist={() => handleRequestCitizenWaitlist('comment')}
          onLogout={handleLogout}
          citizen={citizen}
          onCitizenLoginRequired={handleCitizenLoginOpen}
          onCitizenLogout={handleCitizenLogoutClick}
          onCitizenDashboard={() => setDashboardOpen(true)}
          /* Candidate session + dashboard-jump handler — flows into
             the IdentitySwitcher inside the page's compact Navbar
             so the user can see / switch / sign out from any
             active identity without backing out of the page. */
          candidate={candidate}
          onCandidateLogout={handleCandidateLogoutClick}
          onOpenCandidateDashboard={(c) => {
            // Navigate to that candidate's page (their own) and
            // pre-select the Dashboard tab via initialActiveView.
            if (c?.candidate_id) {
              handleOpenPage(c.candidate_id, { displayName: c.display_name });
              setActiveViewForNextPage('dashboard');
            }
          }}
          onOpenRepDashboard={(r) => {
            // Same pattern for rep.
            if (r?.official_id) {
              handleOpenPage(r.official_id, { displayName: r.display_name, role: r.role });
              setActiveViewForNextPage('dashboard');
            }
          }}
          initialActiveView={pendingActiveView}
          onOpenTracked={() => setTrackedOpen(true)}
          onSubscribe={() => handleRequestCitizenWaitlist('subscribe')}
          onOpenHelpBuild={() => setHelpBuildOpen(true)}
          onOpenFeedback={() => setFeedbackOpen(true)}
        />
      )}
      {/* ConstituentDashboard — full-page overlay for signed-in citizens.
          Same z-index family as PageView so it sits above the map but
          below modals. */}
      {/* "Help build this" — transparent project status + crowdfund.
          Same z-index family as PageView so it sits above the map but
          below modals. */}
      {helpBuildOpen && (
        <HelpBuildThisView
          onClose={() => setHelpBuildOpen(false)}
          compactNavbarProps={{
            citizen,
            onCitizenLogin: handleCitizenLoginOpen,
            onCitizenLogout: handleCitizenLogoutClick,
            onCitizenDashboard: () => {
              setHelpBuildOpen(false);
              setDashboardOpen(true);
            },
            onOpenTracked: () => {
              setHelpBuildOpen(false);
              setTrackedOpen(true);
            },
            onSubscribe: () => {
              setHelpBuildOpen(false);
              handleRequestCitizenWaitlist('subscribe');
            },
            onOpenFeedback: () => {
              setHelpBuildOpen(false);
              setFeedbackOpen(true);
            },
          }}
        />
      )}

      {/* Feedback overlay — embedded Google Form. Same z-index +
          chrome pattern as the Help-build overlay. */}
      {feedbackOpen && (
        <FeedbackView
          onClose={() => setFeedbackOpen(false)}
          compactNavbarProps={{
            citizen,
            onCitizenLogin: handleCitizenLoginOpen,
            onCitizenLogout: handleCitizenLogoutClick,
            onCitizenDashboard: () => {
              setFeedbackOpen(false);
              setDashboardOpen(true);
            },
            onOpenTracked: () => {
              setFeedbackOpen(false);
              setTrackedOpen(true);
            },
            onSubscribe: () => {
              setFeedbackOpen(false);
              handleRequestCitizenWaitlist('subscribe');
            },
            onOpenHelpBuild: () => {
              setFeedbackOpen(false);
              setHelpBuildOpen(true);
            },
          }}
        />
      )}

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
              // Subscription state (Task #88) — BillingSection in the
              // dashboard reads these to pick the right render branch.
              // Defaults match the backend's default for legacy
              // sessions that haven't been refreshed since the
              // schema add.
              is_subscribed: !!citizen.is_subscribed,
              subscription_status: citizen.subscription_status || null,
              current_period_end: citizen.current_period_end || null,
              has_billing_account: !!citizen.has_billing_account,
              // Verification state (Task #89) — VerificationSection
              // reads these to pick verified / demo / unverified /
              // coming-soon branches.
              verified: !!citizen.verified,
              verified_at: citizen.verified_at || null,
              verified_method: citizen.verified_method || null,
            }}
            onClose={() => setDashboardOpen(false)}
            initialView={dashboardInitialView}
            onNavigate={{
              openOfficial: (member) => {
                setDashboardOpen(false);
                handleGlobalMemberPick(member);
              },
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
            // Navbar lives inside the dashboard now. Forward citizen
            // identity + login/logout/subscribe/help-build/feedback so
            // the user can navigate anywhere from the dashboard without
            // backing out first. Deliberately NOT forwarding
            // onCitizenDashboard (we're already here) or
            // onOpenCommittees (omitted per design feedback) — the
            // Navbar's compact mode also hides the search bar.
            navbarProps={{
              citizen,
              onCitizenLogin: handleCitizenLoginOpen,
              onCitizenLogout: handleCitizenLogoutClick,
              /* Unified IdentitySwitcher needs the rep + candidate
                 jump handlers here too — otherwise clicking 'Open'
                 on a rep / candidate row from the citizen dashboard
                 navbar dropdown does nothing. Each closes the
                 dashboard overlay first, then opens the matching
                 page with the Dashboard tab pre-selected. */
              onOpenRepDashboard: (r) => {
                if (r?.official_id) {
                  setDashboardOpen(false);
                  handleOpenPage(r.official_id, { displayName: r.display_name, role: r.role });
                  setActiveViewForNextPage('dashboard');
                }
              },
              onOpenCandidateDashboard: (c) => {
                if (c?.candidate_id) {
                  setDashboardOpen(false);
                  handleOpenPage(c.candidate_id, { displayName: c.display_name });
                  setActiveViewForNextPage('dashboard');
                }
              },
              onOpenTracked: () => {
                setDashboardOpen(false);
                setTrackedOpen(true);
              },
              onSubscribe: () => {
                setDashboardOpen(false);
                handleRequestCitizenWaitlist('subscribe');
              },
              onOpenHelpBuild: () => {
                setDashboardOpen(false);
                setHelpBuildOpen(true);
              },
              onOpenFeedback: () => {
                setDashboardOpen(false);
                setFeedbackOpen(true);
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
        // "I'm a candidate" path inside the rep modal. Closes the
        // rep modal and opens the candidate one so users who landed
        // on the wrong sign-in can switch in one click.
        onSignInAsCandidate={() => {
          setLoginModalOpen(false);
          setCandidateLoginOpen(true);
        }}
      />
      {/* Candidate login modal — Phase 3. The cookie + bearer token
          plumbing handles persistence; useCandidateAuth picks up
          the fresh identity via its listener. */}
      <CandidateLoginModal
        open={candidateLoginOpen}
        onClose={() => setCandidateLoginOpen(false)}
        onSuccess={handleCandidateLoginSuccess}
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

