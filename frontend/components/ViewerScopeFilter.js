'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { ScopeCountry, ScopeState, ScopeDistrict, ScopeCity } from './ui';

/**
 * Viewer-side poll filter. Shown to every non-owner visitor (citizens
 * and anonymous browsers) so they can re-slice poll results across the
 * rep's allowed geographic scopes.
 *
 * Unlike OwnerScopeFilter this only affects poll vote counts. Reaction
 * and comment totals stay country-wide for non-owners; that's enforced
 * server-side to prevent brigade dynamics.
 *
 * Phase 3B: emoji scope glyphs replaced with custom navy SVGs.
 *
 * Props:
 *   scopes    — string[] from PageResponse.allowed_engagement_scopes.
 *               Hidden when <= 1.
 *   labels    — { [scope]: human-label }
 *   value     — currently-selected scope or null when following the
 *               author's default.
 *   ownerName — displayed in the helper text.
 *   onChange(next) — string|null. String = override, null = reset.
 */
const SCOPE_META = {
  country:  { Icon: ScopeCountry,  name: 'Country' },
  state:    { Icon: ScopeState,    name: 'State' },
  district: { Icon: ScopeDistrict, name: 'District' },
  city:     { Icon: ScopeCity,     name: 'City' },
};

export default function ViewerScopeFilter({
  scopes, labels, value, onChange, ownerName,
  // True when the parent feed has scrolled past ~60px. Hides the
  // explanatory eyebrow + description + footer-italic so the rail
  // shrinks to just the chip row, freeing vertical space.
  collapsed = false,
}) {
  if (!scopes || scopes.length <= 1) return null;

  // Visual default: when no override is set, show Country as active.
  // Mirrors OwnerScopeFilter's "value || 'country'" trick — null in
  // state means "no override" (so the backend returns each poll at
  // the author's chosen default), but the user still sees Country
  // highlighted so the rail doesn't read as "nothing selected".
  const displayValue = value || 'country';

  return (
    <div
      style={{
        position: 'sticky', top: 0, zIndex: 5,
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: collapsed ? '6px 14px' : '10px 14px',
        marginBottom: 12,
        boxShadow: 'var(--cl-shadow-sticky)',
        transition: 'padding 0.2s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span className="cl-eyebrow">Your view</span>
            <span style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text-light)' }}>
              Filter poll results across this page
            </span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {scopes.map((s) => {
            const active = s === displayValue;
            const meta = SCOPE_META[s] || { name: s, Icon: null };
            const label = labels?.[s];
            const { Icon } = meta;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onChange(s)}
                title={label ? `${meta.name}: ${label}` : meta.name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  height: 30,
                  borderRadius: 'var(--cl-radius-pill)',
                  border: `1px solid ${active ? 'var(--cl-accent)' : 'var(--cl-border)'}`,
                  background: active ? 'var(--cl-accent)' : 'var(--cl-card)',
                  color: active ? 'var(--cl-text-on-dark)' : 'var(--cl-text)',
                  fontSize: 'var(--cl-text-sm)',
                  fontWeight: active ? 700 : 500,
                  fontFamily: 'var(--cl-font-sans)',
                  cursor: 'pointer',
                  transition:
                    'background var(--cl-duration-fast) var(--cl-ease-standard), border-color var(--cl-duration-fast) var(--cl-ease-standard), color var(--cl-duration-fast) var(--cl-ease-standard)',
                }}
              >
                {Icon && (
                  <Icon
                    size={14}
                    active={active}
                    color={active ? 'onDark' : 'default'}
                  />
                )}
                {meta.name}
                {label && active && (
                  <span
                    style={{
                      fontSize: 'var(--cl-text-2xs)',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 'var(--cl-radius-md)',
                      background: 'rgba(255,255,255,0.22)',
                    }}
                  >
                    {label}
                  </span>
                )}
              </button>
            );
          })}
          {/* Reset button retired — clicking Country IS the new reset
              (PageView wraps onChange so a Country click sets state
              to null, the same "no override" sentinel the backend
              already understood). */}
        </div>
      </div>
      {!collapsed && (
        <div
          style={{
            fontSize: 'var(--cl-text-2xs)',
            color: 'var(--cl-text-light)',
            marginTop: 6,
            fontStyle: 'italic',
          }}
        >
          Filtering slices poll vote counts only.
          Reaction and comment counts stay country-wide for visitors.
        </div>
      )}
    </div>
  );
}
