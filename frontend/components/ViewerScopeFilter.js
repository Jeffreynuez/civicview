'use client';

/**
 * Viewer-side poll filter. Shown to every non-owner visitor (citizens
 * and anonymous browsers) so they can re-slice poll results across the
 * rep's allowed geographic scopes — see what their fellow district
 * thinks, vs. statewide, vs. nationwide.
 *
 * Unlike OwnerScopeFilter this only affects poll vote counts. Reaction
 * and comment totals stay country-wide for non-owners; that's enforced
 * server-side to prevent brigade dynamics.
 *
 * UX contract:
 *   • No scope picked → backend returns each poll at its author's
 *     default_visibility_scope (the "base view" the rep set). The
 *     filter UI reflects this by leaving no chip active and showing a
 *     small note explaining what's happening.
 *   • Scope picked → all polls on the page render at that scope. A
 *     "Reset" link appears that clears the override.
 *   • Chip set is driven entirely by payload.allowed_engagement_scopes
 *     — a senator's viewers only see Country + State because
 *     "District" doesn't map to anything for a statewide office.
 *
 * Props:
 *   scopes    — string[] from PageResponse.allowed_engagement_scopes.
 *               Hidden when <= 1 (country-only pages have nothing to
 *               slice).
 *   labels    — { [scope]: human-label } from PageResponse.engagement_scope_labels.
 *   value     — currently-selected scope ('country'/'state'/'district'/'city')
 *               or null when following the author's default.
 *   ownerName — displayed in the helper text so the viewer knows whose
 *               defaults they're looking at.
 *   onChange(next) — string|null. String = override, null = reset to
 *                    author's default.
 */
const SCOPE_META = {
  country:  { icon: '🇺🇸', name: 'Country' },
  state:    { icon: '📍', name: 'State' },
  district: { icon: '🎯', name: 'District' },
  city:     { icon: '🏙',  name: 'City' },
};

export default function ViewerScopeFilter({
  scopes, labels, value, onChange, ownerName,
}) {
  if (!scopes || scopes.length <= 1) return null;

  const overriding = value !== null && value !== undefined;

  return (
    <div
      style={{
        // Pin to the top of the scrolling feed column so the filter
        // stays reachable as the viewer reads down the post list —
        // same behavior as OwnerScopeFilter. `top: 0` anchors it to
        // the top of the nearest scroll container (PageView's inner
        // content div), and z-index sits above post cards.
        position: 'sticky', top: 0, zIndex: 5,
        background: 'white',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '10px 14px',
        marginBottom: '12px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span
            style={{
              fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em',
              color: 'var(--text-light)', textTransform: 'uppercase',
            }}
          >
            Poll view
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>
            See how the poll looks at each level of {ownerName ? ownerName + "'s" : 'the rep\u2019s'} jurisdiction
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {scopes.map((s) => {
            const active = overriding && s === value;
            const meta = SCOPE_META[s] || { icon: '•', name: s };
            const label = labels?.[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => onChange(s)}
                title={label ? `${meta.name}: ${label}` : meta.name}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '999px',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent)' : 'white',
                  color: active ? 'white' : 'var(--text)',
                  fontSize: '0.78rem',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                }}
              >
                <span aria-hidden="true">{meta.icon}</span>
                {meta.name}
                {label && active && (
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700,
                    padding: '1px 6px', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.22)',
                  }}>
                    {label}
                  </span>
                )}
              </button>
            );
          })}
          {overriding && (
            <button
              type="button"
              onClick={() => onChange(null)}
              title="Go back to the view the author chose"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--accent)', fontSize: '0.74rem', fontWeight: 600,
                cursor: 'pointer', padding: '4px 6px',
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div
        style={{
          fontSize: '0.7rem', color: 'var(--text-light)',
          marginTop: '6px', fontStyle: 'italic',
        }}
      >
        {overriding
          ? `Overriding the author's default — all polls on this page now showing ${labels?.[value] || value}.`
          : `Polls are showing the author's default view. Pick a level above to re-slice them.`}
      </div>
    </div>
  );
}
