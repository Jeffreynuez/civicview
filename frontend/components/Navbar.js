'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAllMembers, fetchAllCandidates } from '@/lib/api';
import { adminWhoami, adminUnreadCount } from '@/lib/pagesApi';
import { useAuth } from '@/lib/auth';
import { useCandidateAuth, logoutCandidate as logoutCandidateLib } from '@/lib/candidateAuth';
import { useCitizenAuth, logoutCitizen as logoutCitizenLib } from '@/lib/citizenAuth';
import { logoutRep as logoutRepLib } from '@/lib/auth';
import { useTrackedBills } from '@/lib/trackedBills';
import { useTrackedOfficials } from '@/lib/trackedOfficials';
import { useTrackedElections } from '@/lib/trackedElections';
import { useIsCompact } from '@/lib/useViewport';
import NotificationBellMenu from '@/components/NotificationBellMenu';
import CivicViewLogo from '@/components/brand/CivicViewLogo';
import IdentitySwitcher from '@/components/IdentitySwitcher';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };

export default function Navbar({
  onMemberPick, onCandidatePick, onOpenCommittees, onOpenTracked,
  // Pages layer — opens the citizen-waitlist modal so voters can be
  // notified when verified citizen accounts (comments + personalized
  // feed) go live. Standalone button per spec — not tied to Follow.
  onSubscribe,
  // Citizen-auth layer (Phase 1.5 demo). `citizen` is the current
  // logged-in CitizenAccount (or null). When null we show a "Citizen
  // login" pill; when set we show the citizen's display name + Sign
  // out. onCitizenLogin / onCitizenLogout are the click handlers.
  // onCitizenDashboard fires when the signed-in pill is clicked —
  // opens ConstituentDashboard as a full-page overlay.
  citizen,
  onCitizenLogin,
  onCitizenLogout,
  onCitizenDashboard,
  // Phase 4b candidate identity. When set, the navbar renders a
  // candidate-styled identity pill (in addition to / instead of
  // citizen). Sign-out fires logoutCandidate via the parent
  // handler. As of the unified-identity-slot refactor (Task #70),
  // candidate + rep + citizen all surface through IdentitySwitcher
  // rather than the prior split (citizen in navbar, rep/candidate
  // in a below-navbar pill).
  candidate,
  onCandidateLogout,
  onOpenCandidateDashboard,
  // Rep identity — the navbar now also surfaces a signed-in rep
  // through IdentitySwitcher. Previously the rep pill lived in a
  // separate row below the navbar (inside PageView's page-level
  // top bar). The `me` from useAuth() is already read internally
  // for the admin-badge probe; pass it through so the switcher
  // can render the rep entry too.
  rep,
  onRepLogout,
  onOpenRepDashboard,
  // Page-context hints — drive which contextual login button shows
  // in the navbar. When pageContext.kind === 'rep' AND no rep is
  // signed in, a navy 'Rep Login' button appears; same for
  // 'candidate' (purple). Citizen login button is always shown
  // when no citizen is signed in, regardless of page context.
  // pageContext shape: { kind: 'rep' | 'candidate', label?: string }
  pageContext,
  onRepLogin,
  onCandidateLogin,
  // Click on the logo / wordmark — typically wired to a "go home"
  // handler in page.js that clears selectedState, selectedMember,
  // selectedCandidate, activeDistrict, etc. so the map zooms back
  // out and NOP comes into view.
  onHome,
  // Opens the "Help build this" overlay — the transparent status +
  // crowdfund page. Wired through to page.js. When omitted, the
  // navbar button is hidden (so this can be enabled progressively).
  onOpenHelpBuild,
  // Opens the Feedback overlay (embedded Google Form). Same
  // progressive-rollout pattern: hidden when not wired.
  onOpenFeedback,
  // When true, render a slimmer navbar without the search bar and the
  // Committees button. Used inside PageView (and similar full-screen
  // takeovers) where global navigation chrome would compete with the
  // page's own header. The citizen identity / login + Subscribe + My
  // Tracked still render — those are the ones the user needs reach
  // to without backing out of the page.
  compact = false,
  // When true, hide the inline "Polls" link on the right cluster. The
  // /polls page itself sets this so the navbar doesn't render a
  // redundant self-link.
  hidePollsLink = false,
}) {
  const { list: trackedList } = useTrackedBills();
  const { list: trackedOfficialsList } = useTrackedOfficials();
  const { list: trackedElectionsList } = useTrackedElections();
  const trackedCount =
    trackedList.length + trackedOfficialsList.length + trackedElectionsList.length;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [allMembers, setAllMembers] = useState([]);
  const [allCandidates, setAllCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Mobile compression — drives two pieces of state that only matter at
  // ≤900px: a full-bar search overlay (the wide search input is too tall
  // and wide for the navbar at phone widths), and a popover menu that
  // collects the secondary actions (Subscribe / Committees / My Tracked)
  // behind a hamburger so the navbar fits in one row.
  //
  // Landscape phones still use the compressed navbar — putting all four
  // nav buttons + the inline search bar in a row at ~850px wide
  // overflows the navbar past the viewport edge, which is what was
  // causing the page to show white when zoomed out.
  // Compact = mobile + tablet (≤1024px). The whole navbar's
  // mobile-vs-desktop density (inline cluster vs hamburger, full text
  // vs icon, inline search bar vs collapse-to-icon) flips on this
  // threshold. We used isMobile (≤900px) before, but tablet and
  // landscape-phone widths (901–1024px) couldn't fit the full inline
  // cluster + search bar without overflowing past the viewport edge.
  // Bumping to 1024px gives the inline layout the room it needs on
  // true desktops without leaving intermediate widths broken.
  const isCompact = useIsCompact();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef(null);

  // Close the mobile menu on outside click + Escape.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onDoc = (e) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setMobileMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileMenuOpen]);

  // When the search overlay opens on mobile, focus the input. When it
  // closes, clear the query so reopening is a fresh slate.
  useEffect(() => {
    if (mobileSearchOpen) {
      inputRef.current?.focus();
    } else {
      setQuery('');
      setOpen(false);
    }
  }, [mobileSearchOpen]);

  // Lazy-load both indices on first focus. We search across sitting reps and
  // declared candidates in the same dropdown, dispatching to the right handler
  // based on the `_kind` tag attached to each result.
  useEffect(() => {
    if (!focused || loading) return;
    if (allMembers.length > 0 && allCandidates.length > 0) return;
    setLoading(true);
    Promise.all([fetchAllMembers(), fetchAllCandidates()]).then(([m, c]) => {
      setAllMembers(m.data || []);
      setAllCandidates(c.data || []);
      setLoading(false);
    });
  }, [focused, allMembers.length, allCandidates.length, loading]);

  // Admin badge — probe whoami once on mount; if the current user is
  // an admin, poll the unread-report count every 60s. The admin
  // navbar pill appears only when isAdmin is true, with a red dot
  // badge if count > 0. Non-admin users never see the pill and never
  // hit unread-count (so we don't generate 401 noise on every poll).
  //
  // The probe re-runs whenever EITHER auth state changes (citizen OR
  // rep). The earlier version only depended on `citizen`, which meant
  // signing out as a citizen while a stale rep cookie was still valid
  // left the admin pill showing — the probe would fire, find the
  // valid rep session on the backend, and stay green. Now we also
  // depend on rep auth so any sign-in/out on either side re-checks.
  //
  // Belt-and-suspenders: we ALSO clamp isAdmin to false whenever
  // BOTH client-side auth stores report "signed out" — so even if
  // the backend has a leftover cookie we couldn't clear (network
  // blip during the mutually-exclusive logout cleanup), the UI
  // honors the user's intent of "I clicked sign out."
  const { me: repAuth } = useAuth();
  // Auto-fetch ALL three identities so the navbar's IdentitySwitcher
  // always has ground truth, regardless of which page is mounting
  // the Navbar. Some mounts (ConstituentDashboard, polls, admin) don't
  // pass every identity explicitly; without these hooks the dropdown
  // would silently drop the un-passed ones (the bug that hid the
  // citizen row on the ConstituentDashboard mount despite the user
  // being signed in — citizen wasn't being threaded through the
  // navbarProps reliably). The explicit `citizen` / `rep` /
  // `candidate` props still win when passed — useful for the rare
  // page that needs to suppress an identity.
  const { candidate: candidateAuto } = useCandidateAuth();
  const { citizen: citizenAuto } = useCitizenAuth();
  // Truthy check (not `!== undefined`) so a stale `citizen={null}` /
  // `rep={null}` / `candidate={null}` from a parent that didn't refresh
  // its prop after hydration doesn't override a live auto-fetched
  // session. This was hiding the citizen entry on ConstituentDashboard:
  // navbarProps.citizen was momentarily null on a re-render and the
  // `!== undefined` check let it win over the truthy useCitizenAuth()
  // value, so IdentitySwitcher built entries without the citizen row
  // (counter still said 3 because rep + candidate + a separate path
  // populated other state — but the rendered dropdown only showed 2).
  const effectiveCandidate = candidate || candidateAuto;
  const effectiveRep = rep || repAuth;
  const effectiveCitizen = citizen || citizenAuto;
  // Auto-fetch fallback handlers — if a consumer didn't pass an
  // explicit logout/dashboard handler, fall back to the lib-level
  // logout (which fires the matching DELETE endpoint + clears local
  // cache). Lets us promote the unified IdentitySwitcher to every
  // page without having to thread per-page handlers through every
  // Navbar mount.
  const effectiveCandidateLogout = onCandidateLogout || logoutCandidateLib;
  const effectiveRepLogout = onRepLogout || logoutRepLib;
  const effectiveCitizenLogout = onCitizenLogout || logoutCitizenLib;
  const [isAdmin, setIsAdmin] = useState(false);
  const [unreadReports, setUnreadReports] = useState(0);
  const clientSignedOut = !effectiveCitizen && !repAuth;
  useEffect(() => {
    if (clientSignedOut) {
      setIsAdmin(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { status } = await adminWhoami();
      if (cancelled) return;
      setIsAdmin(status === 200);
    })();
    return () => { cancelled = true; };
  }, [effectiveCitizen, repAuth, clientSignedOut]);
  useEffect(() => {
    if (!isAdmin) {
      setUnreadReports(0);
      return undefined;
    }
    let cancelled = false;
    const fetchCount = async () => {
      const { data } = await adminUnreadCount();
      if (!cancelled && data) setUnreadReports(Number(data.count) || 0);
    };
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isAdmin]);

  // Keyboard shortcut: `/` focuses the search
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    const scored = [];

    // Score sitting members on: name, state, bioguide_id.
    for (const m of allMembers) {
      const name = (m.name || '').toLowerCase();
      const state = (m.state || '').toLowerCase();
      const bg = (m.bioguide_id || '').toLowerCase();
      let score = 0;
      if (name.startsWith(q)) score += 10;
      else if (name.includes(q)) score += 5;
      const nameTokens = name.split(/\s+/);
      if (nameTokens.some((t) => t.startsWith(q))) score += 3;
      if (state === q) score += 4; // exact state code match
      if (bg === q) score += 8;
      if (score > 0) scored.push({ item: { ...m, _kind: 'member' }, score });
    }

    // Score declared candidates on: name, state, seeking_office, hometown.
    for (const c of allCandidates) {
      const name = (c.name || '').toLowerCase();
      const state = (c.state || '').toLowerCase();
      const seeking = (c.seeking_office || '').toLowerCase();
      const hometown = (c.hometown || '').toLowerCase();
      let score = 0;
      if (name.startsWith(q)) score += 10;
      else if (name.includes(q)) score += 5;
      const nameTokens = name.split(/\s+/);
      if (nameTokens.some((t) => t.startsWith(q))) score += 3;
      if (state === q) score += 4;
      if (seeking.includes(q)) score += 2;
      if (hometown.includes(q)) score += 1;
      if (score > 0) scored.push({ item: { ...c, _kind: 'candidate' }, score });
    }

    scored.sort((a, b) =>
      b.score - a.score || (a.item.name || '').localeCompare(b.item.name || '')
    );
    return scored.slice(0, 10).map((s) => s.item);
  }, [query, allMembers, allCandidates]);

  const pick = (item) => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    // On mobile, dismiss the full-bar search overlay too so the user
    // returns to the map / panel after picking. On desktop the bar
    // stays inline so we just close the dropdown.
    setMobileSearchOpen(false);
    if (item?._kind === 'candidate') {
      onCandidatePick?.(item);
    } else {
      onMemberPick?.(item);
    }
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[activeIdx]);
    }
  };

  return (
    <nav
      className={`flex items-center justify-between shadow-sm border-b ${isCompact ? 'px-3 py-2 gap-2' : 'px-6 py-3'}`}
      // zIndex 100 — bumped from 50 so the navbar's stacking context
      // (and the IdentitySwitcher dropdown inside it) wins over any
      // page-level sticky bar at the same nominal z-index. The
      // ConstituentDashboard sticky Back bar also uses zIndex 50 and
      // sits later in DOM order; previously that clipped the first
      // row of the dropdown (the citizen entry) behind the bar. The
      // PageView / dashboard / modal overlay layers are all ≥1200
      // so this bump can't accidentally land above them.
      style={{ background: 'var(--cl-primary)', height: '56px', position: 'relative', zIndex: 100 }}
    >
      {/* Logo — Phase 4-wiring: swap the prior clock-circle placeholder for
          the locked-in magnify-lens-with-flag mark. Reverse variant has the
          white lens ring/handle so it stands on the navy navbar.
          On mobile: hide the wordmark "CivicView" — the lens icon alone
          is recognizable enough and we need the horizontal space. */}
      {/* Logo + wordmark — clickable home link. Tapping resets the
          app's selection state (selectedState / member / candidate /
          activeDistrict) so the user lands back on the National
          Officials view with the map zoomed out to the full US. */}
      <button
        type="button"
        onClick={() => onHome?.()}
        aria-label="CivicView — home"
        className="flex items-center gap-2"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: onHome ? 'pointer' : 'default',
        }}
      >
        <CivicViewLogo size={28} variant="reverse" />
        {/* Wordmark — visible at every breakpoint. Originally hidden
            on mobile in M1.5 to save horizontal space, but real-device
            testing showed there's plenty of room next to the lens
            icon on a 360-414px phone, and the wordmark adds important
            brand recognition for a civic-tech app where users may
            be unfamiliar. */}
        <span className="text-white font-semibold text-lg">CivicView</span>
      </button>

      {/* Search Bar — true desktop (>1024px) renders the bar inline.
          On compact viewports (mobile + tablet ≤1024px) it collapses
          to an icon button (rendered later in the actions cluster)
          that toggles `mobileSearchOpen`; when open, the bar takes
          over the whole navbar via `position: absolute`.
          When `compact` (the PROP — not the breakpoint hook), we
          skip the search entirely; PageView and similar full-screen
          takeovers don't need global rep search competing with the
          page's own scope.
          Note: this uses isCompact (≤1024px) rather than isMobile
          (≤900px) so the inline search bar doesn't claim navbar
          width on tablet / landscape phones that fall between those
          two thresholds — that overflowed Citizen-login and the
          hamburger off the right edge on real-device testing. */}
      {!compact && (
      <div
        ref={containerRef}
        className={isCompact ? '' : 'flex-1 mx-8'}
        style={
          isCompact
            ? {
                // Compact search overlay — covers the rest of the navbar
                // when active; hidden otherwise. Matches the navbar
                // height so it doesn't shift layout.
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                padding: '0 12px',
                display: mobileSearchOpen ? 'flex' : 'none',
                alignItems: 'center',
                gap: 8,
                background: 'var(--cl-primary)',
                zIndex: 60,
              }
            : { position: 'relative', maxWidth: '560px' }
        }
      >
        {/* Compact-viewport back arrow — closes the search overlay. */}
        {isCompact && mobileSearchOpen && (
          <button
            type="button"
            onClick={() => setMobileSearchOpen(false)}
            aria-label="Close search"
            style={{
              flexShrink: 0,
              width: 36, height: 36,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              color: 'white', cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        <div
          className="relative"
          style={{
            flex: isCompact ? 1 : undefined,
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            border: `1px solid ${focused ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)'}`,
            borderRadius: '8px',
            transition: 'border-color 0.15s',
          }}
        >
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2"
            width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255, 255, 255, 0.6)" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder={
              isCompact
                ? 'Search reps or candidates…'
                : 'Search representatives or candidates by name, state, or office…'
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIdx(0);
            }}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-white outline-none py-2 pl-10 pr-14"
            // 16px font on mobile prevents iOS Safari from auto-zooming
            // when the input is focused. 14px stays the desktop default.
            style={{ fontSize: isCompact ? '16px' : '14px' }}
          />
          {/* "/" keyboard hint — hidden on compact (mobile + tablet)
              because there's no physical keyboard and the cue is
              meaningless. */}
          {!focused && !isCompact && (
            <span
              style={{
                position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px',
                padding: '1px 6px', pointerEvents: 'none',
              }}
            >
              /
            </span>
          )}
        </div>

        {/* Results dropdown */}
        {open && query.trim().length >= 2 && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
              background: 'white', borderRadius: '10px',
              boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
              border: '1px solid var(--cl-border)',
              maxHeight: '440px', overflowY: 'auto',
              zIndex: 60,
            }}
          >
            {loading && results.length === 0 && (
              <div style={{ padding: '14px', textAlign: 'center', color: 'var(--cl-text-light)', fontSize: '0.85rem' }}>
                Loading index…
              </div>
            )}
            {!loading && results.length === 0 && (
              <div style={{ padding: '14px', textAlign: 'center', color: 'var(--cl-text-light)', fontSize: '0.85rem' }}>
                No matches for &ldquo;{query}&rdquo;.
              </div>
            )}
            {results.map((item, i) => {
              const isCandidate = item._kind === 'candidate';
              const photo = isCandidate ? item.photo_url : item.photoUrl;
              const subtitle = isCandidate
                ? (item.seeking_office || 'Candidate')
                : `${item.chamber || ''}${item.district ? `, Dist ${item.district}` : ''}`;
              return (
                <button
                  key={`${item._kind}:${item.bioguide_id || item.id}`}
                  onMouseDown={(e) => { e.preventDefault(); pick(item); }}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    width: '100%', padding: '10px 14px', border: 'none',
                    background: i === activeIdx ? 'var(--cl-bg)' : 'white',
                    cursor: 'pointer', textAlign: 'left',
                    borderBottom: i === results.length - 1 ? 'none' : '1px solid #f1f3f5',
                  }}
                >
                  {photo ? (
                    <img
                      src={photo}
                      alt=""
                      style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#e9ecef' }}
                      onError={(e) => { e.target.style.visibility = 'hidden'; }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                        background: '#e9ecef', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', color: 'var(--cl-text-light)',
                        fontSize: '0.7rem', fontWeight: 700,
                      }}
                    >
                      {(item.name || '?').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--cl-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--cl-text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.state && <span style={{ fontWeight: 600 }}>{item.state}</span>}
                      {item.state && ' · '}
                      {subtitle}
                    </div>
                  </div>
                  {/* Candidate badge sits before the party pill so the user can
                      tell at a glance which side of the search the row came from. */}
                  {isCandidate && (
                    <span
                      style={{
                        padding: '2px 7px', borderRadius: '10px',
                        fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.03em',
                        background: '#fff4e6', color: '#b85c00',
                        border: '1px solid #ffd8a8',
                        flexShrink: 0,
                      }}
                    >
                      CANDIDATE
                    </span>
                  )}
                  <span
                    style={{
                      padding: '2px 8px', borderRadius: '10px',
                      fontSize: '0.7rem', fontWeight: 700,
                      background: item.party === 'R' ? '#fde8e8' : item.party === 'D' ? '#e3f0f7' : '#f0eaff',
                      color: PARTY_COLORS[item.party] || PARTY_COLORS.I,
                      flexShrink: 0,
                    }}
                  >
                    {item.party || 'I'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Right-side actions
          ────────────────────
          Desktop: every action visible inline (Citizen-login → Subscribe
          → Committees → My Tracked → Bell).
          Mobile: only essentials visible inline (Search icon → Bell →
          Citizen icon → Hamburger). Subscribe / Committees / My Tracked
          + Sign out collapse into the hamburger popover. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Compact-viewport search trigger — opens the full-bar
            search overlay defined above. Hidden on true desktop
            since the search bar is always inline there. Also hidden
            when the `compact` prop is set (PageView), where global
            search would compete with the page's own scope. */}
        {isCompact && !compact && (
          <button
            type="button"
            onClick={() => setMobileSearchOpen(true)}
            aria-label="Search"
            title="Search"
            style={{
              width: 36, height: 36,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 8,
              color: 'white', cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
        )}

        {/* ── Unified identity slot (IdentitySwitcher) ────────────
            Replaces the prior split where the citizen pill lived
            in the navbar and the rep / candidate pill lived in a
            separate row below the navbar. Now ALL three identities
            surface in one place:
              0 signed in → renders nothing (login buttons below take
                            care of CTAs).
              1 signed in → renders an inline pill with that
                            identity's display name + Sign out.
              2+ signed in → renders a 'Signed in (N)' dropdown
                            with one row per identity, each with
                            its own Open + Sign out actions.
            The contextual login buttons below the switcher take
            care of the not-signed-in CTAs (citizen always; rep
            only on rep pages; candidate only on candidate pages). */}
        <IdentitySwitcher
          citizen={effectiveCitizen}
          rep={effectiveRep}
          candidate={effectiveCandidate}
          onOpenCitizenDashboard={onCitizenDashboard}
          onOpenRepDashboard={onOpenRepDashboard}
          onOpenCandidateDashboard={onOpenCandidateDashboard}
          onCitizenLogout={effectiveCitizenLogout}
          onRepLogout={effectiveRepLogout}
          onCandidateLogout={effectiveCandidateLogout}
          isCompact={isCompact}
        />

        {/* Citizen login button — always visible when no citizen
            signed in, at every breakpoint. The contextual Rep /
            Candidate login buttons sit next to it when on the
            matching page type. */}
        {!effectiveCitizen && (
          <button
            onClick={() => onCitizenLogin?.()}
            title="Sign in as a citizen to like, comment, and vote in polls"
            style={
              isCompact
                ? {
                    width: 36, height: 36, padding: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'white', color: 'var(--cl-primary)',
                    border: '1px solid white', borderRadius: 999,
                    cursor: 'pointer', flexShrink: 0,
                  }
                : {
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 12px', background: 'white',
                    color: 'var(--cl-primary)', border: '1px solid white',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                  }
            }
            onMouseOver={
              isCompact
                ? undefined
                : (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.9)'; }
            }
            onMouseOut={
              isCompact
                ? undefined
                : (e) => { e.currentTarget.style.background = 'white'; }
            }
          >
            <svg width={isCompact ? 16 : 14} height={isCompact ? 16 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {!isCompact && 'Citizen login'}
          </button>
        )}

        {/* Page-contextual Rep Login — only when viewing a rep page
            AND no rep is currently signed in. Navy (#1d3557) so it
            reads as 'official' and is visually distinct from the
            white citizen pill + purple candidate pill. */}
        {pageContext?.kind === 'rep' && !effectiveRep && (
          <button
            onClick={() => onRepLogin?.()}
            title={`Sign in to manage this page${pageContext.label ? ' — ' + pageContext.label : ''}`}
            style={
              isCompact
                ? {
                    width: 36, height: 36, padding: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: '#1d3557', color: 'white',
                    border: '1px solid #1d3557', borderRadius: 999,
                    cursor: 'pointer', flexShrink: 0,
                  }
                : {
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 12px', background: '#1d3557',
                    color: 'white', border: '1px solid #1d3557',
                    borderRadius: '8px', cursor: 'pointer',
                    fontSize: '0.82rem', fontWeight: 700,
                  }
            }
            onMouseOver={
              isCompact
                ? undefined
                : (e) => { e.currentTarget.style.background = '#2a4a6e'; e.currentTarget.style.borderColor = '#2a4a6e'; }
            }
            onMouseOut={
              isCompact
                ? undefined
                : (e) => { e.currentTarget.style.background = '#1d3557'; e.currentTarget.style.borderColor = '#1d3557'; }
            }
          >
            <svg width={isCompact ? 16 : 14} height={isCompact ? 16 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {!isCompact && 'Rep Login'}
          </button>
        )}

        {/* Page-contextual Candidate Login — same pattern. Purple
            (#6c3ec1) — distinct from rep navy AND from party R/D
            primaries (so neither side feels co-opted) AND it
            matches the candidate accent in IdentitySwitcher. */}
        {pageContext?.kind === 'candidate' && !effectiveCandidate && (
          <button
            onClick={() => onCandidateLogin?.()}
            title={`Sign in to manage this candidate page${pageContext.label ? ' — ' + pageContext.label : ''}`}
            style={
              isCompact
                ? {
                    width: 36, height: 36, padding: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: '#6c3ec1', color: 'white',
                    border: '1px solid #6c3ec1', borderRadius: 999,
                    cursor: 'pointer', flexShrink: 0,
                  }
                : {
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 12px', background: '#6c3ec1',
                    color: 'white', border: '1px solid #6c3ec1',
                    borderRadius: '8px', cursor: 'pointer',
                    fontSize: '0.82rem', fontWeight: 700,
                  }
            }
            onMouseOver={
              isCompact
                ? undefined
                : (e) => { e.currentTarget.style.background = '#8055d2'; e.currentTarget.style.borderColor = '#8055d2'; }
            }
            onMouseOut={
              isCompact
                ? undefined
                : (e) => { e.currentTarget.style.background = '#6c3ec1'; e.currentTarget.style.borderColor = '#6c3ec1'; }
            }
          >
            <svg width={isCompact ? 16 : 14} height={isCompact ? 16 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M3 21h18M5 21V11l7-4 7 4v10M9 21v-6h6v6" />
            </svg>
            {!isCompact && 'Candidate Login'}
          </button>
        )}

        {/* Subscribe / Committees / My Tracked / Help-build /
            Feedback — desktop ONLY (>1024px). Tablet and mobile both
            collapse the whole cluster into the hamburger popover
            below so the navbar fits in one row at any width. The
            previous mobile-only threshold (≤900px) was too narrow:
            real-device testing on Samsung phones in landscape and
            mid-range tablets (901–1024px) overflowed the cluster
            past the viewport edge and clipped Citizen login. */}
        {!isCompact && (
          <>
            {/* "Help build this" — accent-green pill so it reads as a
                primary call-to-action (paired with the yellow Subscribe
                button for visual variety). Hidden when no handler is
                wired, which lets us roll this out progressively.
                Also hidden on tablet / landscape-phone widths
                (isCompact) — the existing Subscribe + Committees +
                My Tracked cluster already pushes tablet navbars to
                their horizontal budget; adding these two extras
                overflows the viewport and clipped Citizen login on
                real-device testing. Compact viewports get them via
                the hamburger menu below. */}
            {onOpenHelpBuild && !isCompact && (
              <button
                onClick={() => onOpenHelpBuild?.()}
                title="See what's done, in progress, and blocked on funding"
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px',
                  background: 'var(--cl-accent)',
                  color: 'white',
                  border: '1px solid var(--cl-accent)',
                  borderRadius: '8px', cursor: 'pointer',
                  fontSize: '0.82rem', fontWeight: 700,
                }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
                onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M12 2v6M12 22v-6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M16 12h6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24" />
                </svg>
                Help build this
              </button>
            )}
            {/* Feedback moved to the hamburger popover at every
                viewport (per user request). Same with Committees and
                Admin below — see the popover content for where they
                live now. */}
            <button
              onClick={() => onSubscribe?.()}
              title="Get notified when verified citizen accounts open up"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', background: '#ffba08',
                color: '#1d1d1d', border: '1px solid #ffba08',
                borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = '#ffc733')}
              onMouseOut={(e) => (e.currentTarget.style.background = '#ffba08')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M4 4h16v16l-4-3-4 3-4-3-4 3z" />
                <path d="M8 10h8M8 14h5" />
              </svg>
              Subscribe
            </button>
            {/* Committees moved to the hamburger popover. */}
            {/* Polls — the global polls feed. Inline on desktop next
                to My Tracked because it's a primary engagement
                surface; mobile gets it via the hamburger.
                Hidden via `hidePollsLink` on /polls itself so the
                navbar doesn't render a redundant self-link. */}
            {!isCompact && !hidePollsLink && (
              <a
                href="/polls"
                title="Browse every active poll across the app"
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px', background: 'rgba(255,255,255,0.1)',
                  color: 'white', border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                  textDecoration: 'none',
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12h4l3 -9l4 18l3 -9h4" />
                </svg>
                Polls
              </a>
            )}
            <button
              onClick={() => onOpenTracked?.()}
              title="My tracked subjects"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', background: 'rgba(255,255,255,0.1)',
                color: 'white', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                position: 'relative',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              My Tracked
              {trackedCount > 0 && (
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: '18px', height: '18px', padding: '0 5px',
                    background: '#ffba08', color: '#1d1d1d',
                    borderRadius: '9px', fontSize: '0.7rem', fontWeight: 800,
                  }}
                >
                  {trackedCount}
                </span>
              )}
            </button>
            {/* Admin moved to the hamburger popover. The unread-
                reports count surfaces as a red dot on the hamburger
                button itself so the operator still gets the at-a-
                glance signal without opening the menu. */}
          </>
        )}

        {/* Notification bell — visible at every breakpoint. The bell's
            own dropdown handles its mobile layout. */}
        <NotificationBellMenu />

        {/* Hamburger menu — always visible. On desktop it holds the
            three secondary actions the user wanted collapsed
            (Committees, Feedback, Admin). On compact viewports it
            holds the full secondary cluster including items that
            were inline on desktop. The popover gates each entry on
            isCompact so the right set renders per viewport.
            Wears a yellow dot if there's something inside that has
            a count (tracked items, or open admin reports). */}
        {(
          <div ref={mobileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="More"
              aria-expanded={mobileMenuOpen}
              title="More"
              style={{
                width: 36, height: 36,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 8,
                color: 'white', cursor: 'pointer',
                flexShrink: 0, position: 'relative',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
              {/* Admin open-reports dot takes priority over tracked
                  dot because moderation queue is more time-sensitive
                  than a personal tracked-list signal. Falls through
                  to the yellow tracked dot otherwise. */}
              {isAdmin && unreadReports > 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 4, right: 4,
                    width: 8, height: 8,
                    background: '#d63031',
                    borderRadius: 999,
                  }}
                />
              ) : trackedCount > 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 4, right: 4,
                    width: 8, height: 8,
                    background: '#ffba08',
                    borderRadius: 999,
                  }}
                />
              ) : null}
            </button>
            {mobileMenuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  minWidth: 220,
                  background: 'white',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 10,
                  boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
                  padding: 6,
                  zIndex: 70,
                }}
              >
                {/* Floor Bills — the federal Bills & Votes page. Surfaced
                    at every viewport (no inline desktop link), placed at the
                    top of the menu as a primary navigation destination. */}
                <MobileMenuItem
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6M9 13h6M9 17h6" />
                    </svg>
                  }
                  label="Floor Bills"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (typeof window !== 'undefined') window.location.href = '/bills';
                  }}
                />
                {/* Help build this — already inline on desktop, so
                    only surface in the hamburger on compact viewports
                    where it isn't inline. */}
                {onOpenHelpBuild && isCompact && (
                  <MobileMenuItem
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <path d="M12 2v6M12 22v-6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M16 12h6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24" />
                      </svg>
                    }
                    label="Help build this"
                    accent="var(--cl-accent)"
                    onClick={() => { setMobileMenuOpen(false); onOpenHelpBuild?.(); }}
                  />
                )}
                {/* Feedback — in the hamburger at every viewport per
                    user request. */}
                {onOpenFeedback && (
                  <MobileMenuItem
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    }
                    label="Feedback"
                    onClick={() => { setMobileMenuOpen(false); onOpenFeedback?.(); }}
                  />
                )}
                {/* Account security (TOTP 2FA enrollment) deliberately
                    lives inside the Citizens Dashboard rather than
                    in the navbar — keeps the navbar focused on
                    navigation, not settings, per design feedback. */}
                {/* Subscribe — inline on desktop, so only show in
                    hamburger on compact. */}
                {isCompact && (
                  <MobileMenuItem
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <path d="M4 4h16v16l-4-3-4 3-4-3-4 3z" />
                        <path d="M8 10h8M8 14h5" />
                      </svg>
                    }
                    label="Subscribe"
                    accent="#ffba08"
                    onClick={() => { setMobileMenuOpen(false); onSubscribe?.(); }}
                  />
                )}
                {/* Committees — in the hamburger at every viewport. */}
                {!compact && (
                  <MobileMenuItem
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" />
                      </svg>
                    }
                    label="Committees"
                    onClick={() => { setMobileMenuOpen(false); onOpenCommittees?.(); }}
                  />
                )}
                {/* My Tracked — inline on desktop, so only show in
                    hamburger on compact. */}
                {isCompact && (
                  <MobileMenuItem
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                    }
                    label="My Tracked"
                    badge={trackedCount > 0 ? trackedCount : null}
                    onClick={() => { setMobileMenuOpen(false); onOpenTracked?.(); }}
                  />
                )}
                {/* Polls — inline on desktop, in the hamburger on
                    compact viewports (matches the My Tracked
                    distribution). Suppressed when `hidePollsLink` is
                    set, e.g. on the /polls page itself. */}
                {isCompact && !hidePollsLink && (
                  <MobileMenuItem
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 12h4l3 -9l4 18l3 -9h4" />
                      </svg>
                    }
                    label="Polls"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      if (typeof window !== 'undefined') window.location.href = '/polls';
                    }}
                  />
                )}
                {/* Admin — in the hamburger at every viewport per
                    user request. Badge surfaces the open-reports
                    count so the user doesn't have to open the menu
                    to see urgency. */}
                {isAdmin && (
                  <MobileMenuItem
                    icon={
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    }
                    label="Admin"
                    badge={unreadReports > 0 ? unreadReports : null}
                    onClick={() => {
                      setMobileMenuOpen(false);
                      if (typeof window !== 'undefined') window.location.href = '/admin';
                    }}
                  />
                )}
                {/* Per-identity sign-out moved into IdentitySwitcher's
                    dropdown rows (visible at every breakpoint, since
                    the dropdown opens on tap as a popover). The
                    hamburger no longer carries a Sign out entry —
                    keeps the per-identity action close to the
                    identity it targets and avoids ambiguity about
                    which session 'Sign out' would end when multiple
                    are active. */}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

// ─── Mobile menu row ───────────────────────────────────────────────
// Pure presentational helper used only by the mobile hamburger popover
// above. Kept inside this file because it's tightly coupled to the
// navbar's mobile compression and isn't reused elsewhere.
function MobileMenuItem({ icon, label, badge, accent, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 12px',
        background: 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: '0.9rem',
        fontWeight: 600,
        color: accent || 'var(--cl-text)',
        fontFamily: 'var(--cl-font-sans)',
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = 'var(--cl-bg-soft)')}
      onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ flexShrink: 0, color: accent || 'var(--cl-text-light)', display: 'inline-flex' }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && (
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 20, height: 20, padding: '0 6px',
            background: '#ffba08', color: '#1d1d1d',
            borderRadius: 10, fontSize: '0.72rem', fontWeight: 800,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
