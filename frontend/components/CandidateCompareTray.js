'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1', NP: '#666' };
const PARTY_BG = { R: '#fde8e8', D: '#e3f0f7', I: '#f0eaff', NP: '#eef' };

/**
 * Floating compare tray for ballot candidates. Structurally mirrors
 * CompareTray but operates on candidate objects and sits just above the
 * member tray when both are active.
 */
export default function CandidateCompareTray({ candidates, onRemove, onClear, onOpen }) {
  if (!candidates || candidates.length === 0) return null;
  const canCompare = candidates.length >= 2;

  return (
    <div
      style={{
        position: 'fixed', bottom: '84px', left: '50%', transform: 'translateX(-50%)',
        background: 'white', border: '1px solid var(--cl-border)',
        borderRadius: '14px', boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
        padding: '10px 12px', zIndex: 80,
        display: 'flex', alignItems: 'center', gap: '10px',
        maxWidth: 'calc(100vw - 40px)',
      }}
      role="region"
      aria-label="Candidate compare tray"
    >
      <div
        style={{
          fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--cl-accent)',
          padding: '0 6px', flexShrink: 0,
        }}
      >
        🗳 Candidates ({candidates.length}/3)
      </div>

      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', maxWidth: '520px' }}>
        {candidates.map((c) => {
          const party = c.party || 'NP';
          return (
            <div
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '4px 6px 4px 4px', background: 'var(--cl-bg)',
                border: '1px solid var(--cl-border)', borderRadius: '24px',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: PARTY_BG[party] || '#eef',
                  color: PARTY_COLORS[party] || '#666',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '0.7rem', flexShrink: 0,
                }}
              >
                {c.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--cl-text)', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.name}
              </div>
              <span
                style={{
                  padding: '1px 6px', borderRadius: '8px', fontSize: '0.65rem', fontWeight: 700,
                  background: PARTY_BG[party] || '#eef',
                  color: PARTY_COLORS[party] || '#666',
                }}
              >
                {party}
              </span>
              <button
                onClick={() => onRemove(c)}
                aria-label={`Remove ${c.name} from compare`}
                title="Remove"
                style={{
                  width: '20px', height: '20px', border: 'none', background: 'none',
                  color: 'var(--cl-text-light)', cursor: 'pointer', fontSize: '0.9rem',
                  padding: 0, lineHeight: 1, borderRadius: '50%',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#f1f3f5'; e.currentTarget.style.color = '#e63946'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--cl-text-light)'; }}
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
            background: 'white', border: '1px solid var(--cl-border)',
            borderRadius: '8px', color: 'var(--cl-text-light)', cursor: 'pointer',
          }}
        >
          Clear
        </button>
        <button
          onClick={onOpen}
          disabled={!canCompare}
          style={{
            padding: '6px 14px', fontSize: '0.82rem', fontWeight: 700,
            background: canCompare ? 'var(--cl-accent)' : '#cbd2da',
            color: 'white', border: 'none', borderRadius: '8px',
            cursor: canCompare ? 'pointer' : 'not-allowed',
          }}
          title={canCompare ? 'Open side-by-side comparison' : 'Add at least 2 candidates to compare'}
        >
          Compare →
        </button>
      </div>
    </div>
  );
}
