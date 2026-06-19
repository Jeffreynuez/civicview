'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect } from 'react';
import { useIsMobile } from '@/lib/useViewport';
import { useTrackedBills } from '@/lib/trackedBills';
import { useTrackedOfficials } from '@/lib/trackedOfficials';
import { useTrackedElections } from '@/lib/trackedElections';
import TrackedManager from './TrackedManager';

/**
 * My Tracked — the navbar quick-glance dialog.
 *
 * Thin shell now: the header (title + count + "Open in dashboard" +
 * close) wraps the shared <TrackedManager> body, which owns the search,
 * category chips, the four capped/scrolling sections, and the per-item
 * alert prefs. The dashboard's "Manage Tracked" tab renders the SAME
 * TrackedManager (variant="page") so the two never diverge.
 *
 * onOpenInDashboard (optional): jumps to the dashboard's Manage Tracked
 * tab — the full surface, where items can also be pinned to the Overview.
 */
export default function MyTrackedModal({ open, onClose, onMemberPick, onNotify, onOpenInDashboard }) {
  const isMobile = useIsMobile();
  const { list: bills } = useTrackedBills();
  const { list: officials } = useTrackedOfficials();
  const { list: elections } = useTrackedElections();
  const totalCount = bills.length + officials.length + elections.length;

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="My tracked"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : '24px',
        zIndex: 1300,
      }}
    >
      <div style={{
        width: isMobile ? '100%' : 'min(860px, 100%)',
        height: isMobile ? '100vh' : undefined,
        maxHeight: isMobile ? undefined : 'calc(100vh - 48px)',
        background: 'white',
        borderRadius: isMobile ? 0 : '12px',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: isMobile ? 'none' : '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--cl-border)',
          background: 'var(--cl-primary)', color: 'white', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>My Tracked</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
              {totalCount === 0
                ? 'You haven’t tracked anything yet.'
                : `${totalCount} tracked · synced to your account`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {onOpenInDashboard && (
              <button
                type="button"
                onClick={onOpenInDashboard}
                title="Manage everything you track on your dashboard"
                style={{
                  padding: isMobile ? '8px 10px' : '7px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.14)', color: 'white',
                  border: '1px solid rgba(255,255,255,0.30)', cursor: 'pointer',
                  fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
                  fontFamily: 'var(--cl-font-sans)',
                }}
              >
                {isMobile ? 'Dashboard →' : 'Open in dashboard →'}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: isMobile ? 44 : 30, height: isMobile ? 44 : 30,
                borderRadius: '8px', flexShrink: 0,
                background: 'rgba(255,255,255,0.12)', color: 'white',
                border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer',
                fontSize: isMobile ? '1.4rem' : '1rem', fontWeight: 700,
              }}
            >×</button>
          </div>
        </div>

        {/* Body — shared TrackedManager (quick-view modal variant). */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 16px', background: 'var(--cl-bg)' }}>
          <TrackedManager
            variant="modal"
            onNotify={onNotify}
            onMemberPick={(m) => { onMemberPick?.(m); onClose?.(); }}
          />
        </div>
      </div>
    </div>
  );
}
