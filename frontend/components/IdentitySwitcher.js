'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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

import { User, ChevronDown } from 'lucide-react';
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

  // ── Unified dropdown mode (any non-zero identity count) ─────────
  // Always render the dropdown pattern, whether the user has 1
  // identity signed in or 3. The previous code had a separate
  // single-identity pill with an inline Sign out button — but the
  // inline Sign out was hidden on compact viewports to save navbar
  // width, leaving mobile users with no way to sign out (the
  // hamburger Sign out was also removed earlier so per-identity
  // sign-out always lives near the identity). Unifying on the
  // dropdown fixes that AND removes the surface-area inconsistency
  // between '1 signed in' and '2+ signed in' modes.
  //
  // Trigger button shows: user icon + 'Signed in' label + count
  // badge + chevron on desktop; user icon + count number on compact.
  // Dropdown rows always carry Open + × actions so the user can
  // jump to their dashboard or sign out without leaving the navbar
  // context.
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
            <User size={14} strokeWidth={2} />
            Signed in
            <span style={{
              fontSize: '0.66rem', fontWeight: 800,
              padding: '1px 5px', borderRadius: 9,
              background: 'rgba(255,255,255,0.20)', color: 'white',
            }}>{entries.length}</span>
            <ChevronDown size={12} strokeWidth={2} />
          </>
        )}
      </button>
      {menuOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            // Minimal width — just enough for the compact row (avatar
            // + Open + ×). Down from minWidth:260 because the rows
            // now skip the kind badge + name + sublabel.
            minWidth: 160,
            // Hard safety against any future row content pushing the
            // dropdown past the right-aligned viewport edge on phones.
            maxWidth: 'calc(100vw - 16px)',
            background: 'white',
            border: '1px solid var(--cl-border)', borderRadius: 10,
            boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            padding: 6, zIndex: 80,
          }}
        >
          {/* Compact row design — colour uniquely identifies the
              identity type (citizen slate, rep navy, candidate purple)
              and since only ONE of each type can be signed in at a
              time, the colour + first letter pair uniquely tags every
              row. Title tooltip on the avatar carries the full name
              + type for desktop hover + screen readers. */}
          {entries.map((e, idx) => {
            const c = COLORS[e.kind].onLight;
            const tooltip = `${KIND_LABEL[e.kind]} — ${e.label}${e.sublabel ? ' · ' + e.sublabel : ''}`;
            return (
              <div
                key={e.kind}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px',
                  borderBottom: idx < entries.length - 1 ? '1px solid var(--cl-border)' : 'none',
                }}
              >
                <span
                  title={tooltip}
                  aria-label={tooltip}
                  style={{
                    width: 32, height: 32, borderRadius: 999,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                    fontSize: '0.9rem', fontWeight: 800, flexShrink: 0,
                  }}
                >
                  {(e.label || '?').trim().charAt(0).toUpperCase()}
                </span>
                {/* Spacer keeps Open + × pushed to the right edge
                    without depending on a name column for that space. */}
                <span style={{ flex: 1, minWidth: 0 }} aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => openDashboardFor(e)}
                  title={`Open ${KIND_LABEL[e.kind].toLowerCase()} dashboard — ${e.label}`}
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
                  title={`Sign out (${KIND_LABEL[e.kind].toLowerCase()}) — ${e.label}`}
                  style={{
                    padding: '6px 8px', background: 'white',
                    color: 'var(--cl-text-light)', border: '1px solid var(--cl-border)',
                    borderRadius: 6, cursor: 'pointer',
                    fontSize: '0.85rem', fontWeight: 700, flexShrink: 0,
                    lineHeight: 1, minWidth: 28,
                  }}
                  aria-label={`Sign out ${KIND_LABEL[e.kind]} — ${e.label}`}
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
