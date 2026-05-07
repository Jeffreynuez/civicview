'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '@/lib/useViewport';
import { fetchBillSnapshot } from '@/lib/api';
import {
  untrackBill, updateTrackedBill, useTrackedBills, setBillPrefs,
} from '@/lib/trackedBills';
import {
  useTrackedOfficials, untrackOfficial, setOfficialPrefs,
  prefsTypeForMember,
} from '@/lib/trackedOfficials';
import {
  useTrackedElections, untrackElection, setElectionPrefs,
} from '@/lib/trackedElections';
import { PREF_SCHEMA, PREF_TYPES, mergePrefs } from '@/lib/notificationPrefs';

/**
 * My Tracked
 *
 * Full-screen modal with four accordion sections — Representatives, Candidates,
 * Bills, Elections — each listing every subject the user has tracked, with a
 * per-item "Notify me when…" block of checkboxes (and, for elections, a
 * reminder-cadence slider).
 *
 * Replaces the old single-purpose TrackedBillsModal. Retains the bill
 * refresh action on the Bills section header.
 */
export default function MyTrackedModal({ open, onClose, onMemberPick, onNotify }) {
  const isMobile = useIsMobile();
  const { list: bills } = useTrackedBills();
  const { list: officialsAll } = useTrackedOfficials();
  const { list: elections } = useTrackedElections();

  // Split officials into "representatives" (everyone non-candidate) and
  // "candidates" (role_type === 'candidate'). Candidates use a different
  // prefs schema than representatives.
  const { representatives, candidates } = useMemo(() => {
    const reps = [], cans = [];
    for (const o of officialsAll) {
      if (o.role_type === 'candidate') cans.push(o);
      else reps.push(o);
    }
    return { representatives: reps, candidates: cans };
  }, [officialsAll]);

  // Which section is expanded. Default to whichever has items — this keeps
  // first-time visitors from staring at an all-empty panel.
  const [openSection, setOpenSection] = useState(null);
  useEffect(() => {
    if (!open) return;
    if (representatives.length) setOpenSection('reps');
    else if (candidates.length) setOpenSection('candidates');
    else if (bills.length) setOpenSection('bills');
    else if (elections.length) setOpenSection('elections');
    else setOpenSection('reps');
  }, [open, representatives.length, candidates.length, bills.length, elections.length]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ─── Bill refresh (inherited from TrackedBillsModal) ──────────────
  const [changedBillKeys, setChangedBillKeys] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);

  const handleRefreshBills = async () => {
    if (refreshing || bills.length === 0) return;
    setRefreshing(true);
    const newChanged = new Set();
    let failed = 0;
    const queue = [...bills];
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
        } catch (e) { failed += 1; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setChangedBillKeys(newChanged);
    setLastRefreshAt(new Date());
    setRefreshing(false);
    if (onNotify) {
      if (newChanged.size > 0) onNotify(`${newChanged.size} of your tracked bills had a status change.`);
      else if (failed === 0) onNotify('No new updates on your tracked bills.');
    }
  };

  if (!open) return null;

  const totalCount = representatives.length + candidates.length + bills.length + elections.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="My tracked"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        // Mobile: full-bleed sheet (no padding, card fills the screen).
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : '24px',
        zIndex: 100,
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
          background: 'var(--cl-primary)', color: 'white',
        }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>My Tracked</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
              {totalCount === 0
                ? 'You haven’t tracked anything yet.'
                : `${totalCount} tracked · stored in this browser only`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: isMobile ? 44 : 30,
              height: isMobile ? 44 : 30,
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.12)', color: 'white',
              border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer',
              fontSize: isMobile ? '1.4rem' : '1rem',
              fontWeight: 700,
            }}
          >×</button>
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <Section
            id="reps"
            title="Representatives"
            count={representatives.length}
            open={openSection === 'reps'}
            onToggle={() => setOpenSection((s) => (s === 'reps' ? null : 'reps'))}
            emptyHint="Tap the bookmark icon on any representative card to follow them."
          >
            {representatives.map((rep) => (
              <OfficialRow
                key={rep.key}
                official={rep}
                onUntrack={() => {
                  untrackOfficial(rep);
                  if (onNotify) onNotify(`Stopped following ${rep.name}.`);
                }}
                onNameClick={() => {
                  if (onMemberPick) { onMemberPick(rep); onClose?.(); }
                }}
              />
            ))}
          </Section>

          <Section
            id="candidates"
            title="Candidates"
            count={candidates.length}
            open={openSection === 'candidates'}
            onToggle={() => setOpenSection((s) => (s === 'candidates' ? null : 'candidates'))}
            emptyHint="Tap the bookmark icon on any candidate card to follow them."
          >
            {candidates.map((can) => (
              <OfficialRow
                key={can.key}
                official={can}
                onUntrack={() => {
                  untrackOfficial(can);
                  if (onNotify) onNotify(`Stopped following ${can.name}.`);
                }}
                onNameClick={() => {
                  if (onMemberPick) { onMemberPick(can); onClose?.(); }
                }}
              />
            ))}
          </Section>

          <Section
            id="bills"
            title="Bills"
            count={bills.length}
            open={openSection === 'bills'}
            onToggle={() => setOpenSection((s) => (s === 'bills' ? null : 'bills'))}
            emptyHint="Open any bill and tap + Track to follow its status."
            headerExtras={bills.length > 0 ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleRefreshBills(); }}
                disabled={refreshing}
                title="Re-check status of all tracked bills"
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 10px', borderRadius: '8px',
                  background: 'var(--cl-bg)', color: 'var(--cl-primary)',
                  border: '1px solid var(--cl-border)',
                  cursor: refreshing ? 'wait' : 'pointer',
                  fontSize: '0.74rem', fontWeight: 700,
                  opacity: refreshing ? 0.7 : 1,
                }}
              >
                {refreshing ? 'Checking…' : '↻ Check for updates'}
              </button>
            ) : null}
          >
            {lastRefreshAt && !refreshing && (
              <div style={{
                padding: '6px 10px', marginBottom: '6px', fontSize: '0.76rem',
                background: changedBillKeys.size > 0 ? '#fff8e6' : '#eef7ee',
                color: changedBillKeys.size > 0 ? '#7a5a00' : '#1d5a2c',
                border: '1px solid var(--cl-border)', borderRadius: '8px',
              }}>
                {changedBillKeys.size > 0
                  ? `${changedBillKeys.size} bill${changedBillKeys.size === 1 ? '' : 's'} had a status change.`
                  : 'All tracked bills are up to date.'}
              </div>
            )}
            {bills.map((bill) => (
              <BillRow
                key={bill.key}
                bill={bill}
                changed={changedBillKeys.has(bill.key)}
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
            ))}
          </Section>

          <Section
            id="elections"
            title="Elections"
            count={elections.length}
            open={openSection === 'elections'}
            onToggle={() => setOpenSection((s) => (s === 'elections' ? null : 'elections'))}
            emptyHint="Tap the bell icon on any election card to track it."
          >
            {elections.map((el) => (
              <ElectionRow
                key={el.key}
                election={el}
                onUntrack={() => {
                  untrackElection(el);
                  if (onNotify) onNotify(`Stopped tracking ${el.name || el.office}.`);
                }}
              />
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── Section accordion ────────────────────────────────────────────
function Section({ id, title, count, open, onToggle, emptyHint, headerExtras, children }) {
  return (
    <div style={{
      marginBottom: '10px', border: '1px solid var(--cl-border)',
      borderRadius: '12px', background: 'white', overflow: 'hidden',
    }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '10px', padding: '12px 16px',
          background: open ? 'var(--cl-bg)' : 'white',
          border: 'none', borderBottom: open ? '1px solid var(--cl-border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '0.88rem', fontWeight: 800, color: 'var(--cl-primary)',
            textTransform: 'uppercase', letterSpacing: '0.4px',
          }}>{title}</span>
          <span style={{
            fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px',
            background: 'var(--cl-bg)', color: 'var(--cl-text-light)', borderRadius: '10px',
            border: '1px solid var(--cl-border)',
          }}>{count}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {headerExtras}
          <span aria-hidden style={{
            fontSize: '1rem', color: 'var(--cl-text-light)',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
          }}>›</span>
        </div>
      </button>
      {open && (
        <div style={{ padding: '10px 12px' }}>
          {count === 0 ? (
            <div
              style={{
                padding: '16px 14px',
                textAlign: 'center',
                color: 'var(--cl-text-light)',
                fontSize: 'var(--cl-text-sm)',
                fontFamily: 'var(--cl-font-sans)',
                lineHeight: 'var(--cl-leading-snug)',
                background: 'var(--cl-bg)',
                border: '1px dashed var(--cl-border)',
                borderRadius: 'var(--cl-radius-lg)',
              }}
            >
              {emptyHint}
            </div>
          ) : children}
        </div>
      )}
    </div>
  );
}

// ─── Shared pref control primitives ───────────────────────────────
function PrefCheckbox({ label, description, checked, onChange }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      padding: '6px 2px', cursor: 'pointer',
    }}>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: '3px', cursor: 'pointer', accentColor: 'var(--cl-accent)' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--cl-text)' }}>{label}</div>
        {description && (
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '1px', lineHeight: 1.35 }}>
            {description}
          </div>
        )}
      </div>
    </label>
  );
}

function PrefSlider({ label, description, choices, value, onChange }) {
  const idx = Math.max(0, choices.indexOf(value));
  return (
    <div style={{ padding: '6px 2px 10px' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--cl-text)' }}>
        {label}: <span style={{ color: 'var(--cl-accent)', textTransform: 'capitalize' }}>{value}</span>
      </div>
      {description && (
        <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '2px', lineHeight: 1.35 }}>
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
        style={{
          width: '100%', marginTop: '6px', accentColor: 'var(--cl-accent)',
          cursor: 'pointer',
        }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.64rem', color: 'var(--cl-text-light)',
        textTransform: 'capitalize', marginTop: '2px', fontWeight: 600,
      }}>
        {choices.map((c) => <span key={c}>{c}</span>)}
      </div>
    </div>
  );
}

function PrefsPanel({ type, prefs, onPatch }) {
  const schema = PREF_SCHEMA[type];
  if (!schema) return null;
  return (
    <div style={{
      marginTop: '8px', padding: '8px 10px', borderRadius: '8px',
      background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
    }}>
      <div style={{
        fontSize: '0.66rem', fontWeight: 800, color: 'var(--cl-text-light)',
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px',
      }}>
        Notify me when…
      </div>
      {schema.options.map((opt) => (
        <PrefCheckbox
          key={opt.key}
          label={opt.label}
          description={opt.description}
          checked={prefs[opt.key]}
          onChange={(v) => onPatch({ [opt.key]: v })}
        />
      ))}
      {schema.sliders.map((s) => (
        <PrefSlider
          key={s.key}
          label={s.label}
          description={s.description}
          choices={s.choices}
          value={prefs[s.key] || s.default}
          onChange={(v) => onPatch({ [s.key]: v })}
        />
      ))}
    </div>
  );
}

// ─── Row variants ─────────────────────────────────────────────────
function OfficialRow({ official, onUntrack, onNameClick }) {
  const [expanded, setExpanded] = useState(false);
  const type = prefsTypeForMember(official);
  const prefs = useMemo(
    () => mergePrefs(type, official.prefs || {}),
    [official, type]
  );

  return (
    <div style={{
      padding: '10px 12px', borderRadius: '10px', marginBottom: '6px',
      background: 'var(--cl-bg)', border: '1px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={onNameClick}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--cl-primary)', fontWeight: 700,
              fontSize: '0.9rem', cursor: onNameClick ? 'pointer' : 'default',
              textAlign: 'left',
            }}
          >
            {official.name}
          </button>
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
            {[
              official.title || official.role,
              official.chamber,
              official.state,
              official.district ? `Dist. ${official.district}` : null,
              official.party ? `(${official.party})` : null,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              padding: '3px 9px', borderRadius: '8px',
              background: expanded ? 'var(--cl-primary)' : 'white',
              color: expanded ? 'white' : 'var(--cl-primary)',
              border: '1px solid var(--cl-border)', cursor: 'pointer',
              fontSize: '0.72rem', fontWeight: 700,
            }}
          >
            {expanded ? 'Hide alerts' : 'Alerts'}
          </button>
          <button
            onClick={onUntrack}
            aria-label="Stop following"
            title="Stop following"
            style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: 'white', color: 'var(--cl-text-light)',
              border: '1px solid var(--cl-border)', cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
      </div>
      {expanded && (
        <PrefsPanel
          type={type}
          prefs={prefs}
          onPatch={(patch) => setOfficialPrefs(official, patch)}
        />
      )}
    </div>
  );
}

function BillRow({ bill, changed, onUntrack, onSponsorClick }) {
  const [expanded, setExpanded] = useState(false);
  const citation = bill.citation || (bill.type && bill.number ? `${bill.type} ${bill.number}` : '');
  const prefs = useMemo(
    () => mergePrefs(PREF_TYPES.bill, bill.prefs || {}),
    [bill]
  );
  return (
    <div style={{
      padding: '10px 12px', borderRadius: '10px', marginBottom: '6px',
      background: changed ? '#fff8e6' : 'var(--cl-bg)',
      border: changed ? '1px solid #f4d35e' : '1px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px' }}>
            {citation && (
              <span style={{ fontWeight: 700, color: 'var(--cl-primary)', fontSize: '0.76rem' }}>
                {citation}
              </span>
            )}
            {changed && (
              <span style={{
                fontSize: '0.62rem', fontWeight: 800, padding: '1px 6px',
                borderRadius: '8px', background: '#f4a261', color: 'white',
                letterSpacing: '0.5px',
              }}>NEW</span>
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.86rem', lineHeight: 1.3 }}>
            {bill.title || 'Untitled bill'}
          </div>
          {bill.latest_action && (
            <div style={{
              fontSize: '0.72rem', color: changed ? '#7a5a00' : 'var(--cl-text-light)',
              marginTop: '3px', fontStyle: 'italic',
            }}>
              {bill.latest_action}{bill.latest_action_date && ` (${bill.latest_action_date})`}
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px', fontSize: '0.7rem', color: 'var(--cl-text-light)' }}>
            {bill.sponsor_name && (
              <span>
                Sponsor:&nbsp;
                {bill.sponsor_bioguide ? (
                  <button
                    onClick={onSponsorClick}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      color: 'var(--cl-accent)', fontWeight: 600, fontSize: '0.7rem',
                    }}
                  >{bill.sponsor_name}</button>
                ) : (
                  <span>{bill.sponsor_name}</span>
                )}
              </span>
            )}
            {bill.url && (
              <a href={bill.url} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}>
                Congress.gov →
              </a>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              padding: '3px 9px', borderRadius: '8px',
              background: expanded ? 'var(--cl-primary)' : 'white',
              color: expanded ? 'white' : 'var(--cl-primary)',
              border: '1px solid var(--cl-border)', cursor: 'pointer',
              fontSize: '0.72rem', fontWeight: 700,
            }}
          >{expanded ? 'Hide alerts' : 'Alerts'}</button>
          <button
            onClick={onUntrack}
            aria-label="Stop tracking"
            title="Stop tracking"
            style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: 'white', color: 'var(--cl-text-light)',
              border: '1px solid var(--cl-border)', cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
      </div>
      {expanded && (
        <PrefsPanel
          type={PREF_TYPES.bill}
          prefs={prefs}
          onPatch={(patch) => setBillPrefs(bill.key, patch)}
        />
      )}
    </div>
  );
}

function ElectionRow({ election, onUntrack }) {
  const [expanded, setExpanded] = useState(false);
  const prefs = useMemo(
    () => mergePrefs(PREF_TYPES.election, election.prefs || {}),
    [election]
  );
  const dateLabel = election.date
    ? new Date(election.date + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
    : null;
  return (
    <div style={{
      padding: '10px 12px', borderRadius: '10px', marginBottom: '6px',
      background: 'var(--cl-bg)', border: '1px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--cl-text)' }}>
            {election.name || election.office || 'Election'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
            {[
              dateLabel,
              election.state,
              election.district ? `Dist. ${election.district}` : null,
              election.type,
              election.level,
              election.candidates_count
                ? `${election.candidates_count} candidate${election.candidates_count === 1 ? '' : 's'}`
                : null,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              padding: '3px 9px', borderRadius: '8px',
              background: expanded ? 'var(--cl-primary)' : 'white',
              color: expanded ? 'white' : 'var(--cl-primary)',
              border: '1px solid var(--cl-border)', cursor: 'pointer',
              fontSize: '0.72rem', fontWeight: 700,
            }}
          >{expanded ? 'Hide alerts' : 'Alerts'}</button>
          <button
            onClick={onUntrack}
            aria-label="Stop tracking"
            title="Stop tracking"
            style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: 'white', color: 'var(--cl-text-light)',
              border: '1px solid var(--cl-border)', cursor: 'pointer',
              fontSize: '0.82rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
      </div>
      {expanded && (
        <PrefsPanel
          type={PREF_TYPES.election}
          prefs={prefs}
          onPatch={(patch) => setElectionPrefs(election, patch)}
        />
      )}
    </div>
  );
}
