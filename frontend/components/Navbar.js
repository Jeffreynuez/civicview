'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAllMembers, fetchAllCandidates } from '@/lib/api';
import { useTrackedBills } from '@/lib/trackedBills';
import { useTrackedOfficials } from '@/lib/trackedOfficials';
import { useTrackedElections } from '@/lib/trackedElections';
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
      className="flex items-center justify-between px-6 py-3 shadow-sm border-b"
      style={{ background: 'var(--primary)', height: '56px', position: 'relative', zIndex: 50 }}
    >
      {/* Logo — Phase 4-wiring: swap the prior clock-circle placeholder for
          the locked-in magnify-lens-with-flag mark. Reverse variant has the
          white lens ring/handle so it stands on the navy navbar. */}
      <div className="flex items-center gap-2">
        <CivicLensLogo size={28} variant="reverse" />
        <span className="text-white font-semibold text-lg">CivicLens</span>
      </div>

      {/* Search Bar */}
      <div ref={containerRef} className="flex-1 mx-8" style={{ position: 'relative', maxWidth: '560px' }}>
        <div
          className="relative"
          style={{
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
            placeholder="Search representatives or candidates by name, state, or office…"
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
            style={{ fontSize: '14px' }}
          />
          {!focused && (
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
              border: '1px solid var(--border)',
              maxHeight: '440px', overflowY: 'auto',
              zIndex: 60,
            }}
          >
            {loading && results.length === 0 && (
              <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.85rem' }}>
                Loading index…
              </div>
            )}
            {!loading && results.length === 0 && (
              <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.85rem' }}>
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
                    background: i === activeIdx ? 'var(--bg)' : 'white',
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
                        justifyContent: 'center', color: 'var(--text-light)',
                        fontSize: '0.7rem', fontWeight: 700,
                      }}
                    >
                      {(item.name || '?').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

      {/* Right-side actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Citizen-login pill. Deliberately placed leftmost in the action
            cluster so first-time visitors see "you can engage as a
            citizen" before they see the secondary browse actions. Shows
            the citizen's state+district in the signed-in state so the
            reviewer can tell at a glance which demo identity they're on. */}
        {citizen ? (
          <>
            {/* Citizen identity pill — clickable button that opens the
                Constituent Dashboard overlay. Hover lightens (per design
                system spec — never darkens). */}
            <button
              type="button"
              onClick={() => onCitizenDashboard?.()}
              title={`Open dashboard — ${citizen.display_name} · ${citizen.city}, ${citizen.state}${citizen.congressional_district ? ` · ${citizen.congressional_district}` : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '6px 10px', background: 'rgba(255,255,255,0.14)',
                color: 'white', border: '1px solid rgba(255,255,255,0.28)',
                borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--cl-font-sans)',
                transition: 'background var(--cl-duration-fast) var(--cl-ease-standard), border-color var(--cl-duration-fast) var(--cl-ease-standard)',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.22)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.40)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.14)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
              }}
            >
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
            </button>
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
          </>
        ) : (
          <button
            onClick={() => onCitizenLogin?.()}
            title="Sign in as a citizen to like, comment, and vote in polls"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 12px', background: 'white',
              color: 'var(--primary)', border: '1px solid white',
              borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.9)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'white'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Citizen login
          </button>
        )}
        {/* Standalone Subscribe button — opens the citizen waitlist so
            voters can get notified the moment verified accounts open up.
            Intentionally lives next to Committees / My Tracked (not on
            any rep's Follow button) so it reads as "subscribe to
            CivicLens," not "subscribe to this person." */}
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
        <NotificationBellMenu />
      </div>
    </nav>
  );
}
