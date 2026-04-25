'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchCommittees, fetchCommitteeDetail } from '@/lib/api';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
const CHAMBER_LABEL = { House: 'House', Senate: 'Senate', Joint: 'Joint' };

export default function CommitteesModal({ open, onClose, onMemberPick }) {
  const [committees, setCommittees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [chamberTab, setChamberTab] = useState('all'); // 'all' | 'House' | 'Senate' | 'Joint'
  const [expanded, setExpanded] = useState({}); // thomas_id → bool (for parents with subs)
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Load committees on first open
  useEffect(() => {
    if (!open || committees.length > 0 || loading) return;
    setLoading(true);
    fetchCommittees()
      .then(({ data }) => setCommittees(data || []))
      .finally(() => setLoading(false));
  }, [open, committees.length, loading]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Load detail whenever selection changes
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    fetchCommitteeDetail(selectedId)
      .then(({ data }) => setDetail(data))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  // Filter + search
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byChamber = chamberTab === 'all'
      ? committees
      : committees.filter((c) => c.chamber === chamberTab);
    if (!q) return byChamber;
    return byChamber
      .map((c) => {
        const parentMatch = (c.name || '').toLowerCase().includes(q);
        const matchedSubs = (c.subcommittees || []).filter((s) =>
          (s.name || '').toLowerCase().includes(q)
        );
        if (parentMatch || matchedSubs.length) {
          return { ...c, _matchedSubs: matchedSubs, _parentMatch: parentMatch };
        }
        return null;
      })
      .filter(Boolean);
  }, [committees, chamberTab, query]);

  // Group filtered by chamber (for display order)
  const grouped = useMemo(() => {
    const g = { House: [], Senate: [], Joint: [] };
    for (const c of filtered) if (g[c.chamber]) g[c.chamber].push(c);
    return g;
  }, [filtered]);

  if (!open) return null;

  const handlePickMember = (m) => {
    onMemberPick?.(m);
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Browse Committees"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1100px, 95vw)', height: 'min(820px, 92vh)',
          margin: 'auto', background: 'white', borderRadius: '14px',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: '12px',
            background: 'var(--bg)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--primary)' }}>
              Browse Committees
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '2px' }}>
              {loading ? 'Loading…' : `${committees.length} committees across House, Senate, and Joint`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: '6px 10px', background: 'white', border: '1px solid var(--border)',
              borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-light)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body: two panes */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left pane — list */}
          <div
            style={{
              width: '360px', borderRight: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', minHeight: 0,
            }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <input
                type="text"
                placeholder="Search committees…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px', fontSize: '0.85rem',
                  border: '1px solid var(--border)', borderRadius: '8px',
                  outline: 'none', background: 'var(--bg)',
                }}
              />
              <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                {['all', 'House', 'Senate', 'Joint'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setChamberTab(t)}
                    style={{
                      flex: 1, padding: '5px 8px', fontSize: '0.73rem', fontWeight: 600,
                      borderRadius: '8px', cursor: 'pointer',
                      border: chamberTab === t ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      background: chamberTab === t ? 'rgba(29, 53, 87, 0.08)' : 'white',
                      color: chamberTab === t ? 'var(--accent)' : 'var(--text-light)',
                    }}
                  >
                    {t === 'all' ? 'All' : t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.85rem' }}>
                  Loading committees…
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-light)', fontSize: '0.85rem' }}>
                  No committees match &ldquo;{query}&rdquo;.
                </div>
              )}
              {!loading && ['House', 'Senate', 'Joint'].map((ch) => (
                grouped[ch].length > 0 && (
                  <div key={ch}>
                    <div
                      style={{
                        padding: '8px 14px 4px', fontSize: '0.7rem',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        color: 'var(--text-light)', fontWeight: 700,
                      }}
                    >
                      {CHAMBER_LABEL[ch]} ({grouped[ch].length})
                    </div>
                    {grouped[ch].map((c) => (
                      <CommitteeRow
                        key={c.thomas_id}
                        committee={c}
                        selectedId={selectedId}
                        expanded={!!expanded[c.thomas_id] || !!query}
                        onSelect={setSelectedId}
                        onToggleExpand={() =>
                          setExpanded((s) => ({ ...s, [c.thomas_id]: !s[c.thomas_id] }))
                        }
                      />
                    ))}
                  </div>
                )
              ))}
            </div>
          </div>

          {/* Right pane — detail */}
          <div style={{ flex: 1, overflowY: 'auto', background: 'white' }}>
            {!selectedId && (
              <div style={{ padding: '60px 40px', color: 'var(--text-light)', textAlign: 'center' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: '12px', opacity: 0.25 }}>⚖️</div>
                <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
                  Select a committee to see its roster
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  Pick a full committee or a subcommittee on the left.
                </div>
              </div>
            )}
            {selectedId && detailLoading && (
              <div style={{ padding: '40px', color: 'var(--text-light)' }}>Loading roster…</div>
            )}
            {selectedId && !detailLoading && detail && (
              <CommitteeDetail detail={detail} onMemberPick={handlePickMember} />
            )}
            {selectedId && !detailLoading && !detail && (
              <div style={{ padding: '40px', color: 'var(--text-light)' }}>
                Couldn&apos;t load committee details.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommitteeRow({ committee, selectedId, expanded, onSelect, onToggleExpand }) {
  const hasSubs = (committee.subcommittees || []).length > 0;
  const isSelected = selectedId === committee.thomas_id;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '0 6px',
        }}
      >
        {hasSubs ? (
          <button
            onClick={onToggleExpand}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            style={{
              width: '22px', height: '22px', border: 'none', background: 'none',
              cursor: 'pointer', color: 'var(--text-light)', fontSize: '0.7rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <div style={{ width: '22px', flexShrink: 0 }} />
        )}
        <button
          onClick={() => onSelect(committee.thomas_id)}
          style={{
            flex: 1, textAlign: 'left', padding: '8px 10px',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
            background: isSelected ? 'rgba(230, 57, 70, 0.08)' : 'transparent',
            color: isSelected ? 'var(--primary)' : 'var(--text)',
            fontSize: '0.86rem', fontWeight: isSelected ? 600 : 500,
          }}
        >
          {committee.name}
          {hasSubs && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginLeft: '6px' }}>
              · {committee.subcommittees.length} sub
            </span>
          )}
        </button>
      </div>
      {hasSubs && expanded && (
        <div style={{ paddingLeft: '28px' }}>
          {committee.subcommittees.map((s) => {
            const subSelected = selectedId === s.thomas_id;
            return (
              <button
                key={s.thomas_id}
                onClick={() => onSelect(s.thomas_id)}
                style={{
                  width: 'calc(100% - 6px)', margin: '0 6px',
                  textAlign: 'left', padding: '6px 10px',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                  background: subSelected ? 'rgba(230, 57, 70, 0.08)' : 'transparent',
                  color: subSelected ? 'var(--primary)' : 'var(--text-light)',
                  fontSize: '0.8rem', fontWeight: subSelected ? 600 : 400,
                  display: 'block',
                }}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CommitteeDetail({ detail, onMemberPick }) {
  const majority = detail.members.filter((m) => m.side === 'majority');
  const minority = detail.members.filter((m) => m.side === 'minority');
  const leadership = detail.members.filter((m) => m.title);

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {detail.parent && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginBottom: '4px' }}>
              {detail.parent.name}
            </div>
          )}
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)', lineHeight: 1.3 }}>
            {detail.name}
          </h2>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '4px' }}>
            {detail.chamber} · {detail.members.length} members
            {detail.subcommittees?.length ? ` · ${detail.subcommittees.length} subcommittees` : ''}
          </div>
        </div>
        {detail.url && (
          <a
            href={detail.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600,
              border: '1px solid var(--border)', borderRadius: '8px',
              color: 'var(--accent)', background: 'white', textDecoration: 'none',
            }}
          >
            Committee site ↗
          </a>
        )}
      </div>

      {detail.jurisdiction && (
        <div
          style={{
            marginTop: '14px', padding: '10px 12px', background: 'var(--bg)',
            border: '1px solid var(--border)', borderRadius: '10px',
            fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            Jurisdiction
          </div>
          {detail.jurisdiction}
        </div>
      )}

      {leadership.length > 0 && (
        <Section title="Leadership">
          {leadership.map((m) => (
            <MemberRow key={m.bioguide_id} m={m} onPick={onMemberPick} showTitle />
          ))}
        </Section>
      )}

      <Section title={`Majority (${majority.length})`}>
        {majority.length === 0 && <EmptyNote />}
        {majority.map((m) => (
          <MemberRow key={m.bioguide_id} m={m} onPick={onMemberPick} />
        ))}
      </Section>

      <Section title={`Minority (${minority.length})`}>
        {minority.length === 0 && <EmptyNote />}
        {minority.map((m) => (
          <MemberRow key={m.bioguide_id} m={m} onPick={onMemberPick} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: '20px' }}>
      <div
        style={{
          fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--text-light)', marginBottom: '8px',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '6px' }}>
        {children}
      </div>
    </div>
  );
}

function MemberRow({ m, onPick, showTitle }) {
  const partyColor = PARTY_COLORS[m.party] || PARTY_COLORS.I;
  return (
    <button
      onClick={() => onPick(m)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 10px', border: '1px solid var(--border)',
        borderRadius: '10px', background: 'white', cursor: 'pointer',
        textAlign: 'left', width: '100%',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = partyColor)}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      {m.photoUrl && (
        <img
          src={m.photoUrl}
          alt=""
          style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover', background: '#e9ecef', flexShrink: 0 }}
          onError={(e) => { e.target.style.visibility = 'hidden'; }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.name}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.state || '—'}
          {showTitle && m.title ? ` · ${m.title}` : ''}
        </div>
      </div>
      <span
        style={{
          padding: '2px 8px', borderRadius: '10px', fontSize: '0.68rem', fontWeight: 700,
          background: m.party === 'R' ? '#fde8e8' : m.party === 'D' ? '#e3f0f7' : '#f0eaff',
          color: partyColor, flexShrink: 0,
        }}
      >
        {m.party || 'I'}
      </span>
    </button>
  );
}

function EmptyNote() {
  return (
    <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', padding: '8px 4px' }}>
      No members listed.
    </div>
  );
}
