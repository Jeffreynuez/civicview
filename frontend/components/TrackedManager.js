'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
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
import { useFeaturedTracked, setFeatured, isFeatured } from '@/lib/featuredTracked';
import { PREF_SCHEMA, PREF_TYPES, mergePrefs } from '@/lib/notificationPrefs';

/**
 * TrackedManager — the shared "everything you follow" surface.
 *
 * Four accordion sections (Representatives, Candidates, Bills, Elections),
 * each a capped + internally-scrolling list with a per-item "Notify me
 * when…" panel, plus a global search box + category chips. Extracted out
 * of MyTrackedModal so the SAME surface renders in two places without
 * drifting:
 *   • variant="modal"  → inside the navbar My Tracked dialog (quick view)
 *   • variant="page"   → the dashboard's Manage Tracked tab (full)
 *
 * The page variant adds the star "feature" control (pin one item per
 * category to the dashboard Overview) and makes official cards clickable
 * to open their profile. The modal variant stays a lean glance.
 */
const matchesQuery = (fields, q) =>
  !q || fields.some((v) => v && String(v).toLowerCase().includes(q));

export default function TrackedManager({
  variant = 'modal',
  onMemberPick,            // (member) => navigate to a rep/candidate profile
  onNotify,
  showFeature,             // default: page variant only
}) {
  const canFeature = showFeature === undefined ? variant === 'page' : showFeature;
  const { list: bills } = useTrackedBills();
  const { list: officialsAll } = useTrackedOfficials();
  const { list: elections } = useTrackedElections();
  const { featured } = useFeaturedTracked();

  const { representatives, candidates } = useMemo(() => {
    const reps = [], cans = [];
    for (const o of officialsAll) {
      if (o.role_type === 'candidate') cans.push(o);
      else reps.push(o);
    }
    return { representatives: reps, candidates: cans };
  }, [officialsAll]);

  const [openSection, setOpenSection] = useState(null);
  useEffect(() => {
    if (representatives.length) setOpenSection('reps');
    else if (candidates.length) setOpenSection('candidates');
    else if (bills.length) setOpenSection('bills');
    else if (elections.length) setOpenSection('elections');
    else setOpenSection('reps');
  }, [representatives.length, candidates.length, bills.length, elections.length]);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(null);
  const q = query.trim().toLowerCase();
  const isSearching = q.length > 0;
  const fReps = useMemo(
    () => representatives.filter((o) => matchesQuery([o.name, o.title, o.role, o.state, o.party], q)),
    [representatives, q],
  );
  const fCans = useMemo(
    () => candidates.filter((o) => matchesQuery([o.name, o.title, o.role, o.state, o.party], q)),
    [candidates, q],
  );
  const fBills = useMemo(
    () => bills.filter((b) => matchesQuery([b.citation, b.title, b.sponsor_name, b.policy_area], q)),
    [bills, q],
  );
  const fElections = useMemo(
    () => elections.filter((e) => matchesQuery([e.name, e.office, e.state, e.type, e.level], q)),
    [elections, q],
  );
  const sectionVisible = (id) => !categoryFilter || categoryFilter === id;
  const sectionOpenFor = (id, matchCount) => {
    if (categoryFilter === id) return true;
    if (categoryFilter) return false;
    if (isSearching) return matchCount > 0;
    return openSection === id;
  };

  // ── Feature (pin one per category to the dashboard Overview) ──
  const toggleFeature = (category, key, label) => {
    const next = setFeatured(category, key);
    if (onNotify) {
      onNotify(next ? `Pinned ${label || 'this'} to your Overview.` : `Unpinned ${label || 'this'} from your Overview.`);
    }
  };

  // ── Bill refresh (re-check status of all tracked bills) ──
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

  const totalCount = representatives.length + candidates.length + bills.length + elections.length;

  return (
    <div>
      {/* Filter bar — sticky so search/chips stay reachable while the
          sections scroll. Same pattern in modal + page variants. */}
      {totalCount > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          padding: '10px 0', marginBottom: 4, background: 'var(--cl-bg)',
        }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter your tracked items…"
            aria-label="Filter tracked items"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 12px',
              borderRadius: 8, border: '1px solid var(--cl-border)', background: 'white',
              fontSize: '0.85rem', fontFamily: 'var(--cl-font-sans)', color: 'var(--cl-text)',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {[['All', null], ['Reps', 'reps'], ['Candidates', 'candidates'], ['Bills', 'bills'], ['Elections', 'elections']].map(([label, val]) => {
              const active = categoryFilter === val;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setCategoryFilter(val)}
                  style={{
                    padding: '4px 12px', borderRadius: 999, fontSize: '0.74rem', fontWeight: 700,
                    fontFamily: 'inherit', cursor: 'pointer',
                    border: '1px solid ' + (active ? 'var(--cl-accent)' : 'var(--cl-border)'),
                    background: active ? 'var(--cl-accent)' : 'white',
                    color: active ? 'white' : 'var(--cl-text-light)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Section
        id="reps" title="Tracked Representatives" count={representatives.length}
        matchCount={fReps.length} isSearching={isSearching}
        hidden={!sectionVisible('reps')} open={sectionOpenFor('reps', fReps.length)}
        onToggle={() => setOpenSection((s) => (s === 'reps' ? null : 'reps'))}
        emptyHint="Tap the bookmark icon on any representative card to follow them."
      >
        {fReps.map((rep) => (
          <OfficialRow
            key={rep.key} official={rep} category="representative"
            canFeature={canFeature} starred={isFeatured('representative', rep.key) || featured.representative === rep.key}
            onToggleFeature={toggleFeature}
            onCardClick={onMemberPick}
            onUntrack={() => { untrackOfficial(rep); if (onNotify) onNotify(`Stopped following ${rep.name}.`); }}
          />
        ))}
      </Section>

      <Section
        id="candidates" title="Tracked Candidates" count={candidates.length}
        matchCount={fCans.length} isSearching={isSearching}
        hidden={!sectionVisible('candidates')} open={sectionOpenFor('candidates', fCans.length)}
        onToggle={() => setOpenSection((s) => (s === 'candidates' ? null : 'candidates'))}
        emptyHint="Tap the bookmark icon on any candidate card to follow them."
      >
        {fCans.map((can) => (
          <OfficialRow
            key={can.key} official={can} category="candidate"
            canFeature={canFeature} starred={featured.candidate === can.key}
            onToggleFeature={toggleFeature}
            onCardClick={onMemberPick}
            onUntrack={() => { untrackOfficial(can); if (onNotify) onNotify(`Stopped following ${can.name}.`); }}
          />
        ))}
      </Section>

      <Section
        id="bills" title="Tracked Bills" count={bills.length}
        matchCount={fBills.length} isSearching={isSearching}
        hidden={!sectionVisible('bills')} open={sectionOpenFor('bills', fBills.length)}
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
              fontSize: '0.74rem', fontWeight: 700, opacity: refreshing ? 0.7 : 1,
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
        {fBills.map((bill) => (
          <BillRow
            key={bill.key} bill={bill} changed={changedBillKeys.has(bill.key)}
            canFeature={canFeature} starred={featured.bill === bill.key}
            onToggleFeature={toggleFeature}
            onUntrack={() => { untrackBill(bill.key); if (onNotify) onNotify(`Stopped tracking ${bill.citation || bill.title}.`); }}
            onSponsorClick={() => { if (bill.sponsor_bioguide && onMemberPick) onMemberPick({ bioguide_id: bill.sponsor_bioguide }); }}
          />
        ))}
      </Section>

      <Section
        id="elections" title="Tracked Elections" count={elections.length}
        matchCount={fElections.length} isSearching={isSearching}
        hidden={!sectionVisible('elections')} open={sectionOpenFor('elections', fElections.length)}
        onToggle={() => setOpenSection((s) => (s === 'elections' ? null : 'elections'))}
        emptyHint="Tap the bell icon on any election card to track it."
      >
        {fElections.map((el) => (
          <ElectionRow
            key={el.key} election={el}
            canFeature={canFeature} starred={featured.election === el.key}
            onToggleFeature={toggleFeature}
            onUntrack={() => { untrackElection(el); if (onNotify) onNotify(`Stopped tracking ${el.name || el.office}.`); }}
          />
        ))}
      </Section>
    </div>
  );
}

// ─── Section accordion ────────────────────────────────────────────
function Section({ id, title, count, matchCount, isSearching, hidden, open, onToggle, emptyHint, headerExtras, children }) {
  if (hidden) return null;
  const badge = isSearching ? matchCount : count;
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
          }}>{badge}</span>
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
            <div style={{
              padding: '16px 14px', textAlign: 'center', color: 'var(--cl-text-light)',
              fontSize: 'var(--cl-text-sm)', fontFamily: 'var(--cl-font-sans)',
              lineHeight: 'var(--cl-leading-snug)', background: 'var(--cl-bg)',
              border: '1px dashed var(--cl-border)', borderRadius: 'var(--cl-radius-lg)',
            }}>
              {emptyHint}
            </div>
          ) : isSearching && matchCount === 0 ? (
            <div style={{
              padding: '14px', textAlign: 'center', color: 'var(--cl-text-light)',
              fontSize: 'var(--cl-text-sm)', fontFamily: 'var(--cl-font-sans)',
            }}>
              No matches in this section.
            </div>
          ) : (
            <div style={{ maxHeight: 'min(46vh, 520px)', overflowY: 'auto' }}>
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Star "feature" toggle ────────────────────────────────────────
function FeatureStar({ starred, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-pressed={starred}
      title={starred ? 'Featured on your Overview — tap to unpin' : 'Feature on your dashboard Overview'}
      style={{
        width: '26px', height: '26px', borderRadius: '8px',
        background: starred ? '#fff7e0' : 'white',
        color: starred ? '#d9a400' : 'var(--cl-text-light)',
        border: '1px solid ' + (starred ? '#f1c44b' : 'var(--cl-border)'),
        cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {starred ? '★' : '☆'}
    </button>
  );
}

// ─── Shared pref control primitives ───────────────────────────────
function PrefCheckbox({ label, description, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 2px', cursor: 'pointer' }}>
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
        type="range" min={0} max={choices.length - 1} step={1} value={idx}
        onChange={(e) => onChange(choices[Number(e.target.value)])}
        style={{ width: '100%', marginTop: '6px', accentColor: 'var(--cl-accent)', cursor: 'pointer' }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem',
        color: 'var(--cl-text-light)', textTransform: 'capitalize', marginTop: '2px', fontWeight: 600,
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
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: '8px', padding: '8px 10px', borderRadius: '8px',
        background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
      }}
    >
      <div style={{
        fontSize: '0.66rem', fontWeight: 800, color: 'var(--cl-text-light)',
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px',
      }}>
        Notify me when…
      </div>
      {schema.options.map((opt) => (
        <PrefCheckbox
          key={opt.key} label={opt.label} description={opt.description}
          checked={prefs[opt.key]} onChange={(v) => onPatch({ [opt.key]: v })}
        />
      ))}
      {schema.sliders.map((s) => (
        <PrefSlider
          key={s.key} label={s.label} description={s.description}
          choices={s.choices} value={prefs[s.key] || s.default}
          onChange={(v) => onPatch({ [s.key]: v })}
        />
      ))}
    </div>
  );
}

// ─── Row variants ─────────────────────────────────────────────────
function OfficialRow({ official, category, onUntrack, onCardClick, canFeature, starred, onToggleFeature }) {
  const [expanded, setExpanded] = useState(false);
  const type = prefsTypeForMember(official);
  const prefs = useMemo(() => mergePrefs(type, official.prefs || {}), [official, type]);
  const clickable = Boolean(onCardClick);

  return (
    <div
      onClick={clickable ? () => onCardClick(official) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onCardClick(official); } : undefined}
      style={{
        padding: '10px 12px', borderRadius: '10px', marginBottom: '6px',
        background: 'var(--cl-bg)', border: '1px solid transparent',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--cl-primary)', fontWeight: 700, fontSize: '0.9rem' }}>
            {official.name}
          </div>
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
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          {canFeature && (
            <FeatureStar starred={starred} onClick={() => onToggleFeature(category, official.key, official.name)} />
          )}
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
            aria-label="Stop following" title="Stop following"
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
        <PrefsPanel type={type} prefs={prefs} onPatch={(patch) => setOfficialPrefs(official, patch)} />
      )}
    </div>
  );
}

function BillRow({ bill, changed, onUntrack, onSponsorClick, canFeature, starred, onToggleFeature }) {
  const [expanded, setExpanded] = useState(false);
  const citation = bill.citation || (bill.type && bill.number ? `${bill.type} ${bill.number}` : '');
  const prefs = useMemo(() => mergePrefs(PREF_TYPES.bill, bill.prefs || {}), [bill]);
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
              <span style={{ fontWeight: 700, color: 'var(--cl-primary)', fontSize: '0.76rem' }}>{citation}</span>
            )}
            {changed && (
              <span style={{
                fontSize: '0.62rem', fontWeight: 800, padding: '1px 6px',
                borderRadius: '8px', background: '#f4a261', color: 'white', letterSpacing: '0.5px',
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
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--cl-accent)', fontWeight: 600, fontSize: '0.7rem' }}
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
          {canFeature && (
            <FeatureStar starred={starred} onClick={() => onToggleFeature('bill', bill.key, bill.citation || bill.title)} />
          )}
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
            aria-label="Stop tracking" title="Stop tracking"
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
        <PrefsPanel type={PREF_TYPES.bill} prefs={prefs} onPatch={(patch) => setBillPrefs(bill.key, patch)} />
      )}
    </div>
  );
}

function ElectionRow({ election, onUntrack, canFeature, starred, onToggleFeature }) {
  const [expanded, setExpanded] = useState(false);
  const prefs = useMemo(() => mergePrefs(PREF_TYPES.election, election.prefs || {}), [election]);
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
              dateLabel, election.state,
              election.district ? `Dist. ${election.district}` : null,
              election.type, election.level,
              election.candidates_count
                ? `${election.candidates_count} candidate${election.candidates_count === 1 ? '' : 's'}`
                : null,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {canFeature && (
            <FeatureStar starred={starred} onClick={() => onToggleFeature('election', election.key, election.name || election.office)} />
          )}
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
            aria-label="Stop tracking" title="Stop tracking"
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
        <PrefsPanel type={PREF_TYPES.election} prefs={prefs} onPatch={(patch) => setElectionPrefs(election, patch)} />
      )}
    </div>
  );
}
