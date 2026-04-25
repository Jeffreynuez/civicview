'use client';

/**
 * Owner-only filter rail. Lets a logged-in rep who owns this page slice
 * every piece of engagement — poll counts, reactions, comment counts,
 * and the comment list itself — down to one geographic scope at a time
 * (country / state / district / city).
 *
 * The rail is hidden from non-owners to avoid brigade dynamics (it'd be
 * weird for a random viewer to see "Florida says X" counts broken out
 * on someone else's constituents).
 *
 * Props:
 *   scopes        — string[] from PageResponse.allowed_engagement_scopes
 *                   (e.g. ['country','state','district'] for a House rep)
 *   labels        — { [scope]: human-label } from PageResponse.engagement_scope_labels
 *   value         — currently-selected scope
 *   onChange(next) — swap the selected scope
 *   citizenCount  — total verified citizen accounts in the demo pool,
 *                   shown as a soft denominator context ("12 of 60 reporting")
 */
const SCOPE_META = {
  country:  { icon: '🇺🇸', name: 'Country' },
  state:    { icon: '📍', name: 'State' },
  district: { icon: '🎯', name: 'District' },
  city:     { icon: '🏙',  name: 'City' },
};

export default function OwnerScopeFilter({
  scopes, labels, value, onChange,
}) {
  if (!scopes || scopes.length <= 1) return null;

  return (
    <div
      style={{
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
            Your view
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>
            Filter constituent feedback across this page
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {scopes.map((s) => {
            const active = s === value;
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
        </div>
      </div>
      <div
        style={{
          fontSize: '0.7rem', color: 'var(--text-light)',
          marginTop: '6px', fontStyle: 'italic',
        }}
      >
        Only you can see this filter. Visitors always see country-wide
        engagement on your page.
      </div>
    </div>
  );
}
