'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
import { fetchBillSnapshot } from '@/lib/api';
import { untrackBill, updateTrackedBill, useTrackedBills } from '@/lib/trackedBills';
import { EmptyState as UIEmptyState, BookmarkSimple } from './ui';

/**
 * Full-screen modal showing every bill the user is currently tracking,
 * with a one-click refresh that re-fetches each snapshot from the API and
 * marks the ones whose status has changed since the user added them.
 */
export default function TrackedBillsModal({ open, onClose, onMemberPick, onNotify }) {
  const { list } = useTrackedBills();

  // changedKeys: keys whose latest_action_date differs from the stored
  // snapshot. Set after a refresh.
  const [changedKeys, setChangedKeys] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);

  // Reset state on open/close
  useEffect(() => {
    if (open) {
      setChangedKeys(new Set());
    }
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sortedList = useMemo(() => {
    // Changed bills first, then by tracked_at desc
    return [...list].sort((a, b) => {
      const aChanged = changedKeys.has(a.key) ? 1 : 0;
      const bChanged = changedKeys.has(b.key) ? 1 : 0;
      if (aChanged !== bChanged) return bChanged - aChanged;
      return (b.tracked_at || '').localeCompare(a.tracked_at || '');
    });
  }, [list, changedKeys]);

  const handleRefresh = async () => {
    if (refreshing || list.length === 0) return;
    setRefreshing(true);
    const newChanged = new Set();
    let succeeded = 0;
    let failed = 0;

    // Limit concurrency to avoid hammering the API
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const bill = queue.shift();
        try {
          const { data } = await fetchBillSnapshot(bill.congress, bill.type, bill.number);
          if (!data) { failed += 1; continue; }
          const changed =
            (data.latest_action_date || '') !== (bill.latest_action_date || '') ||
            (data.latest_action || '') !== (bill.latest_action || '');
          if (changed) {
            newChanged.add(bill.key);
            updateTrackedBill(bill.key, {
              latest_action: data.latest_action,
              latest_action_date: data.latest_action_date,
              policy_area: data.policy_area || bill.policy_area,
              url: data.url || bill.url,
              title: data.title || bill.title,
              last_change_seen_at: new Date().toISOString(),
            });
          }
          succeeded += 1;
        } catch (e) {
          failed += 1;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setChangedKeys(newChanged);
    setLastRefreshAt(new Date());
    setRefreshing(false);
    if (onNotify) {
      if (newChanged.size > 0) {
        onNotify(`${newChanged.size} of your tracked bills had a status change.`);
      } else if (failed === 0) {
        onNotify('No new updates on your tracked bills.');
      }
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="My tracked bills"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', zIndex: 100,
      }}
    >
      <div
        style={{
          width: 'min(820px, 100%)', maxHeight: 'calc(100vh - 48px)',
          background: 'white', borderRadius: '12px', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--cl-border)',
          background: 'var(--cl-primary)', color: 'white',
        }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>My Tracked Bills</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
              {list.length === 0
                ? 'You haven’t tracked any bills yet.'
                : `${list.length} bill${list.length === 1 ? '' : 's'} • stored in this browser only`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {list.length > 0 && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title="Re-check status of all tracked bills"
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px', borderRadius: '8px',
                  background: refreshing ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.18)',
                  color: 'white', border: '1px solid rgba(255,255,255,0.35)',
                  cursor: refreshing ? 'wait' : 'pointer', fontSize: '0.8rem', fontWeight: 600,
                  opacity: refreshing ? 0.7 : 1,
                }}
              >
                {refreshing ? (
                  <>
                    <Spinner /> Checking…
                  </>
                ) : (
                  <>↻ Check for updates</>
                )}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: '30px', height: '30px', borderRadius: '8px',
                background: 'rgba(255,255,255,0.12)', color: 'white',
                border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer',
                fontSize: '1rem', fontWeight: 700,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Banner: refresh result */}
        {lastRefreshAt && !refreshing && (
          <div
            style={{
              padding: '8px 20px', fontSize: '0.78rem',
              background: changedKeys.size > 0 ? '#fff8e6' : '#eef7ee',
              color: changedKeys.size > 0 ? '#7a5a00' : '#1d5a2c',
              borderBottom: '1px solid var(--cl-border)',
            }}
          >
            {changedKeys.size > 0
              ? `${changedKeys.size} bill${changedKeys.size === 1 ? '' : 's'} had a status change since you tracked.`
              : 'All tracked bills are up to date.'}
          </div>
        )}

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {list.length === 0 ? (
            <EmptyState />
          ) : (
            sortedList.map((bill) => (
              <TrackedBillRow
                key={bill.key}
                bill={bill}
                changed={changedKeys.has(bill.key)}
                onUntrack={() => {
                  untrackBill(bill.key);
                  if (onNotify) onNotify(`Stopped tracking ${bill.citation || bill.title}.`);
                }}
                onSponsorClick={() => {
                  if (bill.sponsor_bioguide && onMemberPick) {
                    onMemberPick({ bioguide_id: bill.sponsor_bioguide });
                    onClose?.();
                  }
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TrackedBillRow({ bill, changed, onUntrack, onSponsorClick }) {
  const citation = bill.citation || (bill.type && bill.number ? `${bill.type} ${bill.number}` : '');
  const trackedDate = bill.tracked_at ? new Date(bill.tracked_at).toLocaleDateString() : '';

  return (
    <div
      style={{
        padding: '12px 14px', borderRadius: '10px', marginBottom: '8px',
        background: changed ? '#fff8e6' : 'var(--cl-bg)',
        border: changed ? '1px solid #f4d35e' : '1px solid transparent',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '6px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
            {citation && (
              <span style={{ fontWeight: 700, color: 'var(--cl-primary)', fontSize: '0.78rem' }}>
                {citation}
              </span>
            )}
            {changed && (
              <span style={{
                fontSize: '0.65rem', fontWeight: 800, padding: '2px 6px',
                borderRadius: '8px', background: '#f4a261', color: 'white',
                letterSpacing: '0.5px',
              }}>
                NEW UPDATE
              </span>
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: '1.3', marginBottom: '4px' }}>
            {bill.title || 'Untitled bill'}
          </div>
        </div>
        <button
          onClick={onUntrack}
          aria-label="Stop tracking"
          title="Stop tracking"
          style={{
            width: '26px', height: '26px', borderRadius: '50%',
            background: 'white', color: 'var(--cl-text-light)',
            border: '1px solid var(--cl-border)', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 700, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>

      {bill.latest_action && (
        <div style={{ fontSize: '0.78rem', color: changed ? '#7a5a00' : 'var(--cl-text-light)', marginBottom: '4px', fontStyle: 'italic' }}>
          {bill.latest_action}
          {bill.latest_action_date && ` (${bill.latest_action_date})`}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
        <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', color: 'var(--cl-text-light)', flexWrap: 'wrap' }}>
          {bill.sponsor_name && (
            <span>
              Sponsor:&nbsp;
              {bill.sponsor_bioguide ? (
                <button
                  onClick={onSponsorClick}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--cl-accent)', fontWeight: 600, fontSize: '0.72rem',
                  }}
                >
                  {bill.sponsor_name}
                </button>
              ) : (
                <span>{bill.sponsor_name}</span>
              )}
            </span>
          )}
          {trackedDate && <span>Tracked since {trackedDate}</span>}
        </div>
        {bill.url && (
          <a
            href={bill.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.74rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}
          >
            View on Congress.gov →
          </a>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <UIEmptyState
      icon={<BookmarkSimple size={36} active color="muted" />}
      headline="No tracked bills yet"
      body={
        <>
          Open any representative&rsquo;s profile, jump to the{' '}
          <strong>Bills</strong> tab, and tap <strong>+ Track</strong> on the
          bills you want to follow. We&rsquo;ll let you know when their status
          changes.
        </>
      }
      tone="muted"
    />
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block', width: '12px', height: '12px',
        border: '2px solid rgba(255,255,255,0.4)',
        borderTopColor: 'white', borderRadius: '50%',
        animation: 'civiclens-tracked-spin 0.8s linear infinite',
      }}
    >
      <style jsx>{`
        @keyframes civiclens-tracked-spin { to { transform: rotate(360deg); } }
      `}</style>
    </span>
  );
}
