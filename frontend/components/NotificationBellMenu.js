'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';
import { useChannelPrefs, setChannelPrefs } from '@/lib/channelPrefs';

/**
 * Navbar bell button that opens a dropdown of global delivery channel
 * preferences (in-app toasts, desktop push, email, SMS, mobile push) plus
 * quiet-hours and digest cadence sliders.
 *
 * Channels marked `available: false` in CHANNEL_SCHEMA render as disabled
 * "coming soon" toggles so users can see what's on the roadmap.
 */
export default function NotificationBellMenu() {
  const { prefs, schema } = useChannelPrefs();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const enabledCount = schema.options.filter((o) => o.available && prefs[o.key]).length;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notification preferences"
        aria-expanded={open}
        className="p-2 text-white hover:bg-white hover:bg-opacity-10 rounded-lg transition"
        style={{ position: 'relative' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {enabledCount > 0 && (
          <span style={{
            position: 'absolute', top: '4px', right: '4px',
            width: '8px', height: '8px', borderRadius: '50%',
            background: '#ffba08', border: '2px solid var(--cl-primary)',
          }} />
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '320px', maxHeight: '70vh', overflowY: 'auto',
            background: 'white', color: 'var(--cl-text)',
            border: '1px solid var(--cl-border)', borderRadius: '12px',
            boxShadow: '0 12px 28px rgba(0,0,0,0.22)',
            zIndex: 200, padding: '10px 12px',
          }}
        >
          <div style={{
            fontSize: '0.82rem', fontWeight: 800, color: 'var(--cl-primary)',
            textTransform: 'uppercase', letterSpacing: '0.4px', padding: '4px 2px 8px',
          }}>
            Notifications
          </div>

          <div style={{
            fontSize: '0.68rem', fontWeight: 800, color: 'var(--cl-text-light)',
            textTransform: 'uppercase', letterSpacing: '0.5px', margin: '4px 2px',
          }}>
            Delivery channels
          </div>
          {schema.options.map((opt) => (
            <ChannelToggle
              key={opt.key}
              label={opt.label}
              description={opt.description}
              checked={Boolean(prefs[opt.key])}
              disabled={!opt.available}
              onChange={(v) => setChannelPrefs({ [opt.key]: v })}
            />
          ))}

          <div style={{
            fontSize: '0.68rem', fontWeight: 800, color: 'var(--cl-text-light)',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            margin: '10px 2px 4px',
          }}>
            Cadence
          </div>
          {schema.sliders.map((s) => (
            <Slider
              key={s.key}
              label={s.label}
              description={s.description}
              choices={s.choices}
              value={prefs[s.key] || s.default}
              onChange={(v) => setChannelPrefs({ [s.key]: v })}
            />
          ))}

          <div style={{
            fontSize: '0.68rem', color: 'var(--cl-text-light)',
            padding: '8px 2px 2px', lineHeight: 1.4, borderTop: '1px solid var(--cl-border)',
            marginTop: '6px',
          }}>
            In-app toasts are live today. Desktop, email, SMS, and mobile push
            are on the roadmap — toggle them now to opt-in when they ship.
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelToggle({ label, description, checked, disabled, onChange }) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '6px 2px', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          marginTop: '3px', accentColor: 'var(--cl-accent)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {label}
          {disabled && (
            <span style={{
              fontSize: '0.58rem', fontWeight: 800, padding: '1px 6px',
              borderRadius: '8px', background: 'var(--cl-bg)',
              color: 'var(--cl-text-light)', border: '1px solid var(--cl-border)',
              letterSpacing: '0.4px',
            }}>
              SOON
            </span>
          )}
        </div>
        {description && (
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
            {description}
          </div>
        )}
      </div>
    </label>
  );
}

function Slider({ label, description, choices, value, onChange }) {
  const idx = Math.max(0, choices.indexOf(value));
  return (
    <div style={{ padding: '6px 2px' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>
        {label}: <span style={{ color: 'var(--cl-accent)', textTransform: 'capitalize' }}>
          {String(value).replace(/_/g, ' ')}
        </span>
      </div>
      {description && (
        <div style={{ fontSize: '0.68rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
          {description}
        </div>
      )}
      <input
        type="range"
        min={0}
        max={choices.length - 1}
        step={1}
        value={idx}
        onChange={(e) => onChange(choices[Number(e.target.value)])}
        style={{ width: '100%', marginTop: '4px', accentColor: 'var(--cl-accent)', cursor: 'pointer' }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.62rem', color: 'var(--cl-text-light)',
        textTransform: 'capitalize', marginTop: '2px', fontWeight: 600,
      }}>
        {choices.map((c) => <span key={c}>{String(c).replace(/_/g, ' ')}</span>)}
      </div>
    </div>
  );
}
