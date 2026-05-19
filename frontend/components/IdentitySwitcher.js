'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * IdentitySwitcher — unified navbar slot for citizen + rep + candidate
 * sessions.
 *
 * Replaces the prior split where the citizen pill lived in the navbar
 * and the rep / candidate pills lived in a separate row below the
 * navbar. Now every signed-in identity surfaces in one slot, with
 * three render modes driven by how many identities are signed in:
 *
 *   0 identities → renders nothing (caller surfaces login buttons
 *                  elsewhere — Citizen login is always visible, plus
 *                  page-contextual Rep / Candidate Login buttons).
 *   1 identity   → renders an inline pill with the identity's
 *                  display name + a 'Sign out' button to its right.
 *                  Clicking the pill opens that identity's dashboard.
 *   2+ identities → renders a 'Signed in (N)' dropdown trigger.
 *                  The dropdown lists each identity as a row with
 *                  'Open dashboard' + 'Sign out' actions.
 *
 * Each identity has its own colour treatment so the user can tell
 * them apart at a glance, matching the contextual login buttons:
 *   • citizen   — white  (matches existing 'Citizen login' button)
 *   • rep       — navy   (#1d3557)
 *   • candidate — purple (#6c3ec1)
 *
 * Props:
 *   citizen, rep, candidate    — current session objects or null
 *   onOpenCitizenDashboard()   — fires when the citizen identity is selected
 *   onOpenRepDashboard(rep)    — fires when the rep identity is selected.
 *                                Caller is expected to navigate to the rep's
 *                                page (rep.official_id) and select the
 *                                Dashboard tab.
 *   onOpenCandidateDashboard(candidate) — same for candidate
 *   onCitizenLogout / onRepLogout / onCandidateLogout — per-identity
 *                                sign-out handlers
 *   isCompact                  — viewport hint; we shrink to icon-only
 *                                pills at <=1024px to fit the navbar
 */
import { useEffect, useRef, useState } from 'react';

// Colours have two contexts: the single-identity pill renders on the
// dark navbar background, while the multi-identity dropdown rows
// render on a white popover background. Citizen's translucent-white
// scheme reads fine on navy but is white-on-white in the dropdown,
// which is why citizen rows used to disappear there. We keep two
// distinct palettes — onDark for the navbar pill, onLight for the
// dropdown row — and pick per render path.
const COLORS = {
  citizen: {
    onDark:  { bg: 'rgba(255,255,255,0.14)', border: 'rgba(255,255,255,0.28)', fg: 'white', badgeBg: 'rgba(255,255,255,0.20)' },
    onLight: { bg: '#475569',                border: '#475569',                fg: 'white', badgeBg: 'rgba(255,255,255,0.22)' },
  },
  rep: {
    onDark:  { bg: '#1d3557', border: '#1d3557', fg: 'white', badgeBg: 'rgba(255,255,255,0.22)' },
    onLight: { bg: '#1d3557', border: '#1d3557', fg: 'white', badgeBg: 'rgba(255,255,255,0.22)' },
  },
  candidate: {
    onDark:  { bg: '#6c3ec1', border: '#6c3ec1', fg: 'white', badgeBg: 'rgba(255,255,255,0.22)' },
    onLight: { bg: '#6c3ec1', border: '#6c3ec1', fg: 'white', badgeBg: 'rgba(255,255,255,0.22)' },
  },
};

const KIND_LABEL = {
  citizen: 'Citizen',
  rep: 'Rep',
  candidate: 'Candidate',
};

// Build a normalized list of present identities so the rest of the
// component reads cleanly without three parallel branches.
function buildEntries({ citizen, rep, candidate }) {
  const out = [];
  if (citizen) {
    out.push({
      kind: 'citizen',
      label: citizen.display_name,
      sublabel: citizen.congressional_district || `${citizen.city || ''}${citizen.state ? ', ' + citizen.state : ''}`,
      session: citizen,
    });
  }
  if (rep) {
    out.push({
      kind: 'rep',
      label: rep.display_name,
      sublabel: rep.role || '',
      session: rep,
    });
  }
  if (candidate) {
    out.push({
      kind: 'candidate',
      label: candidate.display_name,
      sublabel: 'Candidate',
      session: candidate,
    });
  }
  return out;
}

export default function IdentitySwitcher({
  citizen, rep, candidate,
  onOpenCitizenDashboard, onOpenRepDashboard, onOpenCandidateDashboard,
  onCitizenLogout, onRepLogout, onCandidateLogout,
  isCompact = false,
}) {
  const entries = buildEntries({ citizen, rep, candidate });
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);

  // Outside-click + Escape close the multi-identity dropdown.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (entries.length === 0) return null;

  // Resolve handlers + select an entry by clicking on a dropdown row
  // or the single-identity pill.
  const openDashboardFor = (entry) => {
    setMenuOpen(false);
    if (entry.kind === 'citizen') onOpenCitizenDashboard?.();
    else if (entry.kind === 'rep') onOpenRepDashboard?.(entry.session);
    else if (entry.kind === 'candidate') onOpenCandidateDashboard?.(entry.session);
  };
  const logoutFor = (entry) => {
    if (entry.kind === 'citizen') onCitizenLogout?.();
    else if (entry.kind === 'rep') onRepLogout?.();
    else if (entry.kind === 'candidate') onCandidateLogout?.();
  };

  // ── Single-identity mode ────────────────────────────────────────
  if (entries.length === 1) {
    const e = entries[0];
    const c = COLORS[e.kind].onDark;
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} ref={wrapRef}>
        <button
          type="button"
          onClick={() => openDashboardFor(e)}
          title={`Open dashboard — ${e.label}${e.sublabel ? ' · ' + e.sublabel : ''}`}
          style={
            isCompact
              ? {
                  width: 36, height: 36, padding: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                  borderRadius: 999, fontSize: '0.78rem', fontWeight: 800,
                  cursor: 'pointer', flexShrink: 0,
                }
              : {
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px',
                  background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                  borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'var(--cl-font-sans)',
                }
          }
        >
          {isCompact ? (
            <span aria-hidden="true">{(e.label || '?').trim().charAt(0).toUpperCase()}</span>
          ) : (
            <>
              <span style={{
                fontSize: '0.62rem', fontWeight: 800,
                padding: '1px 5px', borderRadius: 9,
                background: c.badgeBg, color: c.fg,
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                {KIND_LABEL[e.kind]}
              </span>
              {e.label}
            </>
          )}
        </button>
        {/* Sign out — visible inline on desktop, hidden on compact to
            save space (compact viewports surface sign-out via the
            hamburger / the per-row Sign out inside the dropdown). */}
        {!isCompact && (
          <button
            type="button"
            onClick={() => logoutFor(e)}
            title={`Sign out (${KIND_LABEL[e.kind].toLowerCase()})`}
            style={{
              padding: '6px 10px', background: 'rgba(255,255,255,0.05)',
              color: 'white', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8, cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600,
            }}
            onMouseOver={(ev) => (ev.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
            onMouseOut={(ev) => (ev.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          >
            Sign out
          </button>
        )}
      </div>
    );
  }

  // ── Multi-identity mode (2+) ────────────────────────────────────
  // 'Signed in (N)' trigger that pops a dropdown with one row per
  // identity, each carrying its own Open + Sign out actions. No
  // global sign-out — too easy to nuke the wrong session by accident.
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        title={`Signed in to ${entries.length} accounts`}
        style={
          isCompact
            ? {
                width: 36, height: 36, padding: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.14)',
                color: 'white', border: '1px solid rgba(255,255,255,0.28)',
                borderRadius: 999, fontSize: '0.78rem', fontWeight: 800,
                cursor: 'pointer', flexShrink: 0,
              }
            : {
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.14)',
                color: 'white', border: '1px solid rgba(255,255,255,0.28)',
                borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'var(--cl-font-sans)',
              }
        }
      >
        {isCompact ? (
          <span aria-hidden="true">{entries.length}</span>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Signed in
            <span style={{
              fontSize: '0.66rem', fontWeight: 800,
              padding: '1px 5px', borderRadius: 9,
              background: 'rgba(255,255,255,0.20)', color: 'white',
            }}>{entries.length}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </>
        )}
      </button>
      {menuOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            minWidth: 260, background: 'white',
            border: '1px solid var(--cl-border)', borderRadius: 10,
            boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            padding: 6, zIndex: 80,
          }}
        >
          {entries.map((e, idx) => {
            const c = COLORS[e.kind].onLight;
            return (
              <div
                key={e.kind}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px',
                  borderBottom: idx < entries.length - 1 ? '1px solid var(--cl-border)' : 'none',
                }}
              >
                <span style={{
                  width: 32, height: 32, borderRadius: 999,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                  fontSize: '0.85rem', fontWeight: 800, flexShrink: 0,
                }}>
                  {(e.label || '?').trim().charAt(0).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.78rem', fontWeight: 700, color: 'var(--cl-text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 800,
                      padding: '1px 5px', borderRadius: 9,
                      background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                    }}>
                      {KIND_LABEL[e.kind]}
                    </span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.label}
                    </span>
                  </div>
                  {e.sublabel && (
                    <div style={{
                      fontSize: '0.72rem', color: 'var(--cl-text-light)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {e.sublabel}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openDashboardFor(e)}
                  title="Open this dashboard"
                  style={{
                    padding: '6px 10px', background: 'var(--cl-bg)',
                    color: 'var(--cl-text)', border: '1px solid var(--cl-border)',
                    borderRadius: 6, cursor: 'pointer',
                    fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
                  }}
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => logoutFor(e)}
                  title={`Sign out (${KIND_LABEL[e.kind].toLowerCase()})`}
                  style={{
                    padding: '6px 8px', background: 'white',
                    color: 'var(--cl-text-light)', border: '1px solid var(--cl-border)',
                    borderRadius: 6, cursor: 'pointer',
                    fontSize: '0.72rem', fontWeight: 600, flexShrink: 0,
                  }}
                  aria-label={`Sign out ${KIND_LABEL[e.kind]}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
