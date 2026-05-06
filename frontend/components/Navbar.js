'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAllMembers, fetchAllCandidates } from '@/lib/api';
import { useTrackedBills } from '@/lib/trackedBills';
import { useTrackedOfficials } from '@/lib/trackedOfficials';
import { useTrackedElections } from '@/lib/trackedElections';
import { useViewport } from '@/lib/useViewport';
import NotificationBellMenu from '@/components/NotificationBellMenu';
import CivicLensLogo from '@/components/brand/CivicLensLogo';

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
  // Click on the logo / wordmark — typically wired to a "go home"
  // handler in page.js that clears selectedState, selectedMember,
  // selectedCandidate, activeDistrict, etc. so the map zooms back
  // out and NOP comes into view.
  onHome,
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
  // ≤768px: a full-bar search overlay (the wide search input is too tall
  // and wide for the navbar at phone widths), and a popover menu that
  // collects the secondary actions (Subscribe / Committees / My Tracked)
  // behind a hamburger so the navbar fits in one row.
  const viewport = useViewport();
  const isMobile = viewport === 'mobile';
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
      className={`flex items-center justify-between shadow-sm border-b ${isMobile ? 'px-3 py-2 gap-2' : 'px-6 py-3'}`}
      style={{ background: 'var(--cl-primary)', height: '56px', position: 'relative', zIndex: 50 }}
    >
      {/* Logo — Phase 4-wiring: swap the prior clock-circle placeholder for
          the locked-in magnify-lens-with-flag mark. Reverse variant has the
          white lens ring/handle so it stands on the navy navbar.
          On mobile: hide the wordmark "CivicLens" — the lens icon alone
          is recognizable enough and we need the horizontal space. */}
      {/* Logo + wordmark — clickable home link. Tapping resets the
          app's selection state (selectedState / member / candidate /
          activeDistrict) so the user lands back on the National
          Officials view with the map zoomed out to the full US. */}
      <button
        type="button"
        onClick={() => onHome?.()}
        aria-label="CivicLens — home"
        className="flex items-center gap-2"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: onHome ? 'pointer' : 'default',
        }}
      >
        <CivicLensLogo size={28} variant="reverse" />
        {/* Wordmark — visible at every breakpoint. Originally hidden
            on mobile in M1.5 to save horizontal space, but real-device
            testing showed there's plenty of room next to the lens
            icon on a 360-414px phone, and the wordmark adds important
            brand recognition for a civic-tech app where users may
            be unfamiliar. */}
        <span className="text-white font-semibold text-lg">CivicLens</span>
      </button>

      {/* Search Bar — desktop / tablet renders inline. On mobile it
          collapses to an icon button (rendered later in the actions
          cluster) that toggles `mobileSearchOpen`; when open, the bar
          takes over the whole navbar via `position: absolute`. */}
      <div
        ref={containerRef}
        className={isMobile ? '' : 'flex-1 mx-8'}
        style={
          isMobile
            ? {
                // Mobile search overlay — covers the rest of the navbar
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
        {/* Mobile back arrow — closes the search overlay. */}
        {isMobile && mobileSearchOpen && (
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
            flex: isMobile ? 1 : undefined,
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
              isMobile
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
            style={{ fontSize: isMobile ? '16px' : '14px' }}
          />
          {/* "/" keyboard hint — hidden on mobile because there's no
              physical keyboard and the cue is meaningless. */}
          {!focused && !isMobile && (
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

      {/* Right-side actions
          ────────────────────
          Desktop: every action visible inline (Citizen-login → Subscribe
          → Committees → My Tracked → Bell).
          Mobile: only essentials visible inline (Search icon → Bell →
          Citizen icon → Hamburger). Subscribe / Committees / My Tracked
          + Sign out collapse into the hamburger popover. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Mobile-only search trigger — opens the full-bar search
            overlay defined above. Hidden on desktop since the search
            bar is always inline there. */}
        {isMobile && (
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

        {/* Citizen-login pill. On desktop / tablet shows the full label
            (or the citizen's display name + district when signed in).
            On mobile compresses to an icon button: a circle with the
            citizen's first initial when signed in, or a generic person
            icon when signed out. */}
        {citizen ? (
          <>
            <button
              type="button"
              onClick={() => onCitizenDashboard?.()}
              title={`Open dashboard — ${citizen.display_name} · ${citizen.city}, ${citizen.state}${citizen.congressional_district ? ` · ${citizen.congressional_district}` : ''}`}
              style={
                isMobile
                  ? {
                      width: 36, height: 36, padding: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255,255,255,0.14)',
                      color: 'white', border: '1px solid rgba(255,255,255,0.28)',
                      borderRadius: 999,
                      fontSize: '0.78rem', fontWeight: 700,
                      cursor: 'pointer', flexShrink: 0,
                    }
                  : {
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '6px 10px', background: 'rgba(255,255,255,0.14)',
                      color: 'white', border: '1px solid rgba(255,255,255,0.28)',
                      borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'var(--cl-font-sans)',
                      transition: 'background var(--cl-duration-fast) var(--cl-ease-standard), border-color var(--cl-duration-fast) var(--cl-ease-standard)',
                    }
              }
              onMouseOver={
                isMobile
                  ? undefined
                  : (e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.22)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.40)';
                    }
              }
              onMouseOut={
                isMobile
                  ? undefined
                  : (e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.14)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
                    }
              }
            >
              {isMobile ? (
                // Initial-letter avatar — recognizable cue that the user
                // is signed in without burning horizontal space.
                <span aria-hidden="true">
                  {(citizen.display_name || '?').trim().charAt(0).toUpperCase()}
                </span>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {citizen.display_name}
                  {citizen.congressional_district && (
                    <span style={{
                      fontSize: '0.66rem', fontWeight: 800,
                      padding: '1px 5px', borderRadius: '9px',
                      background: 'rgba(255,255,255,0.2)',
                      color: 'white', letterSpacing: '0.02em',
                    }}>
                      {citizen.congressional_district}
                    </span>
                  )}
                </>
              )}
            </button>
            {/* Sign-out only on desktop / tablet inline. On mobile it
                lives inside the hamburger popover. */}
            {!isMobile && (
              <button
                onClick={() => onCitizenLogout?.()}
                title="Sign out (citizen)"
                style={{
                  padding: '6px 10px', background: 'rgba(255,255,255,0.05)',
                  color: 'white', border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              >
                Sign out
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => onCitizenLogin?.()}
            title="Sign in as a citizen to like, comment, and vote in polls"
            style={
              isMobile
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
              isMobile
                ? undefined
                : (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.9)'; }
            }
            onMouseOut={
              isMobile
                ? undefined
                : (e) => { e.currentTarget.style.background = 'white'; }
            }
          >
            <svg width={isMobile ? 16 : 14} height={isMobile ? 16 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {!isMobile && 'Citizen login'}
          </button>
        )}

        {/* Subscribe / Committees / My Tracked — desktop / tablet only.
            Mobile collapses these into the hamburger popover below so
            the navbar fits in one row on a phone. */}
        {!isMobile && (
          <>
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
            <button
              onClick={() => onOpenCommittees?.()}
              title="Browse Committees"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', background: 'rgba(255,255,255,0.1)',
                color: 'white', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" />
              </svg>
              Committees
            </button>
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
          </>
        )}

        {/* Notification bell — visible at every breakpoint. The bell's
            own dropdown handles its mobile layout. */}
        <NotificationBellMenu />

        {/* Mobile-only hamburger menu — opens a popover with the
            secondary actions that don't fit inline at phone widths.
            Wears a yellow dot when something inside the menu has a
            count (My Tracked) so the user knows it's not empty. */}
        {isMobile && (
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
              {trackedCount > 0 && (
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
              )}
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
                <MobileMenuItem
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" />
                    </svg>
                  }
                  label="Committees"
                  onClick={() => { setMobileMenuOpen(false); onOpenCommittees?.(); }}
                />
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
                {citizen && (
                  <>
                    <div style={{ height: 1, background: 'var(--cl-border)', margin: '4px 6px' }} />
                    <MobileMenuItem
                      icon={
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                      }
                      label="Sign out"
                      onClick={() => { setMobileMenuOpen(false); onCitizenLogout?.(); }}
                    />
                  </>
                )}
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
