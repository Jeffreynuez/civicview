'use client';

import { useState } from 'react';
import { useIsMobile } from '@/lib/useViewport';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1', NP: '#666' };
const PARTY_BG = { R: '#fde8e8', D: '#e3f0f7', I: '#f0eaff', NP: '#eef' };

/**
 * Unified compare tray — renders both officials and candidates from a single
 * list. Each entry is tagged with `_kind: 'official' | 'candidate'` by the
 * parent store, so mixing (e.g. President Trump + a ballot candidate) lands
 * in the same tray instead of spawning a second one.
 *
 * Mobile mini-mode: on phone-sized viewports the tray collapses to a
 * compact pill (count badge + Compare button) until the user taps the
 * chevron to expand. The full tray with chips is too tall (~80px) on
 * a 360px-tall landscape viewport and was eating the bottom 1/3 of
 * the visible area.
 */
export default function CompareTray({ items, onRemove, onClear, onOpen }) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(true);
  if (!items || items.length === 0) return null;
  const canCompare = items.length >= 2;
  const showMini = isMobile && collapsed;

  // Compact mini-bar for mobile. Shows just the count + Compare CTA
  // + an expand chevron. Full tray inflates when the user taps the
  // expand button or anywhere on the badge.
  if (showMini) {
    return (
      <div
        role="region"
        aria-label="Compare tray (collapsed)"
        style={{
          position: 'fixed', bottom: 16, right: 16,
          background: 'white', border: '1px solid var(--cl-border)',
          borderRadius: 999, boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
          padding: '6px 8px', zIndex: 80,
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={`Expand compare tray — ${items.length} item${items.length === 1 ? '' : 's'}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '4px 8px', borderRadius: 999,
            fontSize: '0.78rem', fontWeight: 700, color: 'var(--cl-text)',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 22, height: 22, borderRadius: 999,
              background: 'var(--cl-accent)', color: 'white',
              fontSize: '0.74rem', fontWeight: 800, padding: '0 6px',
            }}
          >
            {items.length}
          </span>
          <span>Compare</span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {/* Chevron up — expand back to full tray */}
            <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onOpen}
          disabled={!canCompare}
          aria-label="Open side-by-side comparison"
          title={canCompare ? 'Open side-by-side comparison' : 'Add at least 2 to compare'}
          style={{
            padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700,
            background: canCompare ? 'var(--cl-accent)' : '#cbd2da',
            color: 'white', border: 'none', borderRadius: 999,
            cursor: canCompare ? 'pointer' : 'not-allowed',
          }}
        >
          →
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        background: 'white', border: '1px solid var(--cl-border)',
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
          letterSpacing: '0.5px', color: 'var(--cl-text-light)',
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
                padding: '4px 6px 4px 4px', background: 'var(--cl-bg)',
                border: '1px solid var(--cl-border)', borderRadius: '24px',
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
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--cl-text)', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
          title={canCompare ? 'Open side-by-side comparison' : 'Add at least 2 to compare'}
        >
          Compare →
        </button>
        {/* Minimize chevron — only on mobile, where the tray's
            ~80px height eats the bottom of the viewport. Tucks the
            tray back into the compact pill above. */}
        {isMobile && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Minimize compare tray"
            title="Minimize"
            style={{
              width: 32, height: 32, padding: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'white', border: '1px solid var(--cl-border)',
              borderRadius: 8, color: 'var(--cl-text-light)', cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              {/* Chevron down — collapse back to mini pill */}
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
