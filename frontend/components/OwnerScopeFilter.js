'use client';

import { ScopeCountry, ScopeState, ScopeDistrict, ScopeCity } from './ui';

/**
 * Owner-only filter rail. Lets a logged-in rep who owns this page slice
 * every piece of engagement — poll counts, reactions, comment counts,
 * and the comment list itself — down to one geographic scope at a time
 * (country / state / district / city).
 *
 * The rail is hidden from non-owners to avoid brigade dynamics.
 *
 * Phase 3B: emoji scope glyphs replaced with custom navy SVGs from the
 * Phosphor Duotone family (per design system spec — no emoji on chips).
 *
 * Props:
 *   scopes        — string[] from PageResponse.allowed_engagement_scopes
 *   labels        — { [scope]: human-label }
 *   value         — currently-selected scope
 *   onChange(next) — swap the selected scope
 */
const SCOPE_META = {
  country:  { Icon: ScopeCountry,  name: 'Country' },
  state:    { Icon: ScopeState,    name: 'State' },
  district: { Icon: ScopeDistrict, name: 'District' },
  city:     { Icon: ScopeCity,     name: 'City' },
};

export default function OwnerScopeFilter({
  scopes, labels, value, onChange,
}) {
  if (!scopes || scopes.length <= 1) return null;

  return (
    <div
      style={{
        position: 'sticky', top: 0, zIndex: 5,
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: '10px 14px',
        marginBottom: 12,
        boxShadow: 'var(--cl-shadow-sticky)',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="cl-eyebrow">Your view</span>
          <span style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text-light)' }}>
            Filter constituent feedback across this page
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {scopes.map((s) => {
            const active = s === value;
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
        </div>
      </div>
      <div
        style={{
          fontSize: 'var(--cl-text-2xs)',
          color: 'var(--cl-text-light)',
          marginTop: 6,
          fontStyle: 'italic',
        }}
      >
        Only you can see this filter. Visitors always see country-wide
        engagement on your page.
      </div>
    </div>
  );
}
