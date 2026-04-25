'use client';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1', NP: '#666' };
const PARTY_BG = { R: '#fde8e8', D: '#e3f0f7', I: '#f0eaff', NP: '#eef' };

/**
 * Unified compare tray — renders both officials and candidates from a single
 * list. Each entry is tagged with `_kind: 'official' | 'candidate'` by the
 * parent store, so mixing (e.g. President Trump + a ballot candidate) lands
 * in the same tray instead of spawning a second one.
 */
export default function CompareTray({ items, onRemove, onClear, onOpen }) {
  if (!items || items.length === 0) return null;
  const canCompare = items.length >= 2;

  return (
    <div
      style={{
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        background: 'white', border: '1px solid var(--border)',
        borderRadius: '14px', boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
        padding: '10px 12px', zIndex: 80,
        display: 'flex', alignItems: 'center', gap: '10px',
        maxWidth: 'calc(100vw - 40px)',
      }}
      role="region"
      aria-label="Compare tray"
    >
      <div
        style={{
          fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--text-light)',
          padding: '0 6px', flexShrink: 0,
        }}
      >
        Compare ({items.length}/3)
      </div>

      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', maxWidth: '520px' }}>
        {items.map((m) => {
          const isCandidate = m._kind === 'candidate';
          const party = m.party || (isCandidate ? 'NP' : 'I');
          const key = `${m._kind || 'official'}-${m.bioguide_id || m.id}`;
          return (
            <div
              key={key}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '4px 6px 4px 4px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: '24px',
                flexShrink: 0,
              }}
            >
              {!isCandidate && m.photoUrl ? (
                <img
                  src={m.photoUrl}
                  alt=""
                  style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', background: '#e9ecef', flexShrink: 0 }}
                  onError={(e) => { e.target.style.visibility = 'hidden'; }}
                />
              ) : isCandidate ? (
                <div
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: PARTY_BG[party] || '#eef',
                    color: PARTY_COLORS[party] || '#666',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.7rem', flexShrink: 0,
                  }}
                >
                  {(m.name || '').split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </div>
              ) : (
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#e9ecef', flexShrink: 0 }} />
              )}
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.name}
              </div>
              {/* Kind badge — so mixing candidates + officials stays visually
                  parseable without needing to open the modal. */}
              {isCandidate && (
                <span
                  title="Ballot candidate"
                  style={{
                    padding: '1px 5px', borderRadius: '6px', fontSize: '0.58rem',
                    fontWeight: 700, letterSpacing: '0.4px',
                    background: '#fff7e6', color: '#b36b00', textTransform: 'uppercase',
                  }}
                >
                  🗳
                </span>
              )}
              <span
                style={{
                  padding: '1px 6px', borderRadius: '8px', fontSize: '0.65rem', fontWeight: 700,
                  background: PARTY_BG[party] || '#f0eaff',
                  color: PARTY_COLORS[party] || PARTY_COLORS.I,
                }}
              >
                {party}
              </span>
              <button
                onClick={() => onRemove(m)}
                aria-label={`Remove ${m.name} from compare`}
                title="Remove"
                style={{
                  width: '20px', height: '20px', border: 'none', background: 'none',
                  color: 'var(--text-light)', cursor: 'pointer', fontSize: '0.9rem',
                  padding: 0, lineHeight: 1, borderRadius: '50%',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#f1f3f5'; e.currentTarget.style.color = '#e63946'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-light)'; }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        <button
          onClick={onClear}
          style={{
            padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600,
            background: 'white', border: '1px solid var(--border)',
            borderRadius: '8px', color: 'var(--text-light)', cursor: 'pointer',
          }}
        >
          Clear
        </button>
        <button
          onClick={onOpen}
          disabled={!canCompare}
          style={{
            padding: '6px 14px', fontSize: '0.82rem', fontWeight: 700,
            background: canCompare ? 'var(--accent)' : '#cbd2da',
            color: 'white', border: 'none', borderRadius: '8px',
            cursor: canCompare ? 'pointer' : 'not-allowed',
          }}
          title={canCompare ? 'Open side-by-side comparison' : 'Add at least 2 to compare'}
        >
          Compare →
        </button>
      </div>
    </div>
  );
}
