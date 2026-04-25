'use client';

import { useEffect, useState } from 'react';
import { fetchFederalOfficials } from '@/lib/api';
import SelectionBadge from './SelectionBadge';
import FollowButton from './FollowButton';
import CompareButton from './CompareButton';
import TrackElectionButton from './TrackElectionButton';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };

/**
 * National landing view — shows while no state is selected.
 * Four tabs mirror the state-level UX (Executive / Judicial / Congress /
 * Elections), powered by /api/federal-officials.
 *
 * Props:
 *   - onSelectPerson(person, roleType): open the given federal official in
 *     the ProfileView. `person` is the raw dict from federal_officials.json
 *     (contains `id`, `contact`, etc.); `roleType` is one of 'president' |
 *     'vice_president' | 'cabinet' | 'scotus' | 'congress_leader'.
 */
export default function NationalOfficialsPanel({ onSelectPerson, onNotify, onCompareToggle, compareIds }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('executive');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchFederalOfficials();
      if (cancelled) return;
      setData(res.data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          marginBottom: '12px',
          background: 'white',
          borderRadius: '10px 10px 0 0',
          overflow: 'hidden',
        }}
      >
        {[
          { key: 'executive', label: 'Executive' },
          { key: 'judicial',  label: 'Judicial' },
          { key: 'congress',  label: 'Congress' },
          { key: 'elections', label: '🗳 Elections' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              flex: 1, padding: '10px', textAlign: 'center',
              fontSize: '0.78rem', fontWeight: 600,
              color: activeTab === key ? 'var(--primary)' : 'var(--text-light)',
              borderBottomStyle: 'solid',
              borderBottomWidth: '2px',
              borderBottomColor: activeTab === key ? 'var(--accent)' : 'transparent',
              cursor: 'pointer', background: 'none', border: 'none',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--bg)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <Loading>Loading federal officials…</Loading>}

      {!loading && !data && (
        <EmptyState>
          <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text)' }}>
            Federal data unavailable
          </div>
          <div>Start the API to load President, Cabinet, Supreme Court, and Congress leadership.</div>
        </EmptyState>
      )}

      {!loading && data && activeTab === 'executive' && (
        <ExecutiveView exec={data.executive} onSelectPerson={onSelectPerson} onNotify={onNotify} onCompareToggle={onCompareToggle} compareIds={compareIds} />
      )}
      {!loading && data && activeTab === 'judicial'  && (
        <JudicialView jud={data.judiciary} onSelectPerson={onSelectPerson} onNotify={onNotify} onCompareToggle={onCompareToggle} compareIds={compareIds} />
      )}
      {!loading && data && activeTab === 'congress'  && (
        <CongressView congress={data.congress} onSelectPerson={onSelectPerson} onNotify={onNotify} onCompareToggle={onCompareToggle} compareIds={compareIds} />
      )}
      {!loading && data && activeTab === 'elections' && <ElectionsView elections={data.elections} onNotify={onNotify} />}
    </div>
  );
}

// ─── Executive ─────────────────────────────────────────────────────────
function ExecutiveView({ exec, onSelectPerson, onNotify, onCompareToggle, compareIds }) {
  if (!exec) return null;
  const pres = exec.president;
  const vp   = exec.vice_president;
  const cabinet = exec.cabinet || [];
  return (
    <div>
      {pres && (
        <Section title="President">
          <OfficialCard
            name={pres.name}
            party={pres.party}
            subtitle={[pres.ordinal, pres.role].filter(Boolean).join(' · ')}
            meta={[
              pres.serving_since ? `Serving since ${new Date(pres.serving_since).getFullYear()}` : null,
              pres.term_end ? `Term ends ${new Date(pres.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={pres.website}
            selectionMethod={pres.selection_method}
            selectionDetail={pres.selection_detail}
            big
            onClick={onSelectPerson ? () => onSelectPerson(pres, 'president') : null}
            followTarget={{ ...pres, role_type: 'president', chamber: 'Executive Branch' }}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </Section>
      )}

      {vp && (
        <Section title="Vice President" compact>
          <OfficialCard
            name={vp.name}
            party={vp.party}
            subtitle={vp.role}
            meta={[
              vp.serving_since ? `Serving since ${new Date(vp.serving_since).getFullYear()}` : null,
              vp.term_end ? `Term ends ${new Date(vp.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={vp.website}
            selectionMethod={vp.selection_method}
            selectionDetail={vp.selection_detail}
            onClick={onSelectPerson ? () => onSelectPerson(vp, 'vice_president') : null}
            followTarget={{ ...vp, role_type: 'vice_president', chamber: 'Executive Branch' }}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </Section>
      )}

      {cabinet.length > 0 && (
        <Collapsible title="Cabinet" count={cabinet.length} defaultOpen>
          <div style={{
            fontSize: '0.74rem', color: 'var(--text-light)', padding: '2px 8px 8px',
            lineHeight: 1.4,
          }}>
            Cabinet secretaries are nominated by the President and confirmed by
            the Senate; they serve at the President&apos;s pleasure.
          </div>
          {cabinet.map((c) => (
            <OfficialCard
              key={c.id}
              name={c.name}
              party={c.party}
              subtitle={c.role}
              meta={[
                c.serving_since ? `Serving since ${new Date(c.serving_since).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}` : null,
                c.predecessor ? `Succeeded ${c.predecessor}` : null,
              ].filter(Boolean)}
              website={c.website}
              selectionMethod={c.selection_method}
              selectionDetail={c.selection_detail}
              onClick={onSelectPerson ? () => onSelectPerson(c, 'cabinet') : null}
              followTarget={{ ...c, role_type: 'cabinet', chamber: c.department || 'Cabinet' }}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          ))}
        </Collapsible>
      )}
    </div>
  );
}

// ─── Judicial ──────────────────────────────────────────────────────────
function JudicialView({ jud, onSelectPerson, onNotify, onCompareToggle, compareIds }) {
  if (!jud) return null;
  const sc = jud.supreme_court || {};
  const justices = sc.members || [];
  return (
    <div>
      <Section title={sc.body_name || 'Supreme Court of the United States'}>
        <div style={{
          fontSize: '0.76rem', color: 'var(--text-light)',
          padding: '0 10px 10px', lineHeight: 1.5,
        }}>
          {sc._note || 'Justices are nominated by the President, confirmed by the Senate, and serve during good behavior.'}
          {sc.website && (
            <>
              {' '}
              <a
                href={sc.website}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
              >
                supremecourt.gov ↗
              </a>
            </>
          )}
        </div>
        {justices.map((j) => (
          <OfficialCard
            key={j.id}
            name={j.name}
            subtitle={j.role + (j.chief ? ' (presiding)' : '')}
            meta={[
              j.appointed_by ? `Appointed by ${j.appointed_by}` : null,
              j.appointed_on ? new Date(j.appointed_on).getFullYear() : null,
            ].filter(Boolean)}
            website={j.website}
            selectionMethod={j.selection_method}
            selectionDetail={j.selection_detail}
            onClick={onSelectPerson ? () => onSelectPerson(j, 'scotus') : null}
            followTarget={{ ...j, role_type: 'scotus', chamber: sc.body_name || 'Supreme Court' }}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        ))}
      </Section>
    </div>
  );
}

// ─── Congress ──────────────────────────────────────────────────────────
function CongressView({ congress, onSelectPerson, onNotify, onCompareToggle, compareIds }) {
  if (!congress) return null;
  const senate = congress.senate || {};
  const house  = congress.house || {};
  return (
    <div>
      <div style={{
        fontSize: '0.76rem', color: 'var(--text-light)',
        padding: '0 8px 12px', lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--text)' }}>
          {congress.congress_number}
          {ordinalSuffix(congress.congress_number)} Congress
        </strong>
        {congress.session ? ` · ${congress.session}` : ''}
        {congress._note ? ` · ${congress._note}` : ''}
      </div>

      {/* Senate */}
      <Collapsible
        title={senate.chamber || 'U.S. Senate'}
        count={senate.seats_total || null}
        defaultOpen
      >
        {senate.party_breakdown && <PartyBreakdown breakdown={senate.party_breakdown} />}
        {senate.leadership?.length > 0 && (
          <NestedCollapsible
            title="Leadership"
            count={senate.leadership.length}
            defaultOpen
          >
            {senate.leadership.map((m) => (
              <OfficialCard
                key={m.id}
                name={m.name}
                party={m.party}
                subtitle={[m.role, m.state].filter(Boolean).join(' · ')}
                selectionMethod={m.selection_method}
                selectionDetail={m.selection_detail}
                onClick={onSelectPerson ? () => onSelectPerson(m, 'congress_leader') : null}
                followTarget={{ ...m, role_type: 'congress_leader', chamber: m.chamber || 'U.S. Senate' }}
                onNotify={onNotify}
                onCompareToggle={onCompareToggle}
                compareIds={compareIds}
              />
            ))}
          </NestedCollapsible>
        )}
      </Collapsible>

      {/* House */}
      <Collapsible
        title={house.chamber || 'U.S. House of Representatives'}
        count={house.seats_total || null}
      >
        {house.party_breakdown && <PartyBreakdown breakdown={house.party_breakdown} />}
        {house.leadership?.length > 0 && (
          <NestedCollapsible
            title="Leadership"
            count={house.leadership.length}
            defaultOpen
          >
            {house.leadership.map((m) => (
              <OfficialCard
                key={m.id}
                name={m.name}
                party={m.party}
                subtitle={[
                  m.role,
                  [m.state, m.district ? `Dist. ${m.district}` : null].filter(Boolean).join('-'),
                ].filter(Boolean).join(' · ')}
                selectionMethod={m.selection_method}
                selectionDetail={m.selection_detail}
                onClick={onSelectPerson ? () => onSelectPerson(m, 'congress_leader') : null}
                followTarget={{ ...m, role_type: 'congress_leader', chamber: m.chamber || 'U.S. House of Representatives' }}
                onNotify={onNotify}
                onCompareToggle={onCompareToggle}
                compareIds={compareIds}
              />
            ))}
          </NestedCollapsible>
        )}
      </Collapsible>

      <div style={{
        fontSize: '0.74rem', color: 'var(--text-light)', fontStyle: 'italic',
        padding: '6px 8px', lineHeight: 1.5,
      }}>
        Click a state on the map to see its senators + representatives.
      </div>
    </div>
  );
}

function PartyBreakdown({ breakdown }) {
  const total = ['R', 'D', 'I'].reduce((s, k) => s + (breakdown[k] || 0), 0);
  if (!total) return null;
  return (
    <div style={{ padding: '0 10px 8px' }}>
      <div style={{
        display: 'flex', borderRadius: '6px', overflow: 'hidden',
        border: '1px solid var(--border)', height: '10px',
      }}>
        {['R', 'D', 'I'].map((k) => {
          const n = breakdown[k] || 0;
          if (!n) return null;
          const pct = (n / total) * 100;
          return (
            <div
              key={k}
              title={`${k === 'R' ? 'Republicans' : k === 'D' ? 'Democrats' : 'Independents'}: ${n}`}
              style={{
                width: `${pct}%`,
                background: PARTY_COLORS[k],
              }}
            />
          );
        })}
      </div>
      <div style={{
        marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap',
        fontSize: '0.74rem', color: 'var(--text-light)',
      }}>
        {['R', 'D', 'I'].map((k) => (breakdown[k] ? (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{
              display: 'inline-block', width: '9px', height: '9px',
              borderRadius: '50%', background: PARTY_COLORS[k],
            }} />
            <strong style={{ color: 'var(--text)' }}>{breakdown[k]}</strong>
            {k === 'R' ? 'Republicans' : k === 'D' ? 'Democrats' : 'Independents'}
          </span>
        ) : null))}
      </div>
      {breakdown._note && (
        <div style={{
          marginTop: '6px', fontSize: '0.7rem',
          color: 'var(--text-light)', fontStyle: 'italic', lineHeight: 1.4,
        }}>
          {breakdown._note}
        </div>
      )}
    </div>
  );
}

// ─── Elections ─────────────────────────────────────────────────────────
function ElectionsView({ elections, onNotify }) {
  const upcoming = elections?.upcoming || [];
  if (!upcoming.length) {
    return (
      <EmptyState>No upcoming federal elections on file.</EmptyState>
    );
  }
  return (
    <div>
      <div style={{
        fontSize: '0.76rem', color: 'var(--text-light)',
        padding: '0 8px 10px', lineHeight: 1.5,
      }}>
        Upcoming federal election cycles. Click a state on the map for state-
        and local-level races on its ballot.
      </div>
      {upcoming.map((e) => (
        <div
          key={e.id}
          style={{
            padding: '12px 14px', marginBottom: '8px', background: 'white',
            border: '1px solid var(--border)', borderRadius: '10px',
            display: 'flex', alignItems: 'flex-start', gap: '10px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.68rem', fontWeight: 800, color: 'var(--accent)',
              letterSpacing: '0.5px', textTransform: 'uppercase',
            }}>
              {e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              }) : 'Date TBA'}
            </div>
            <div style={{
              fontSize: '0.96rem', fontWeight: 700, marginTop: '4px', color: 'var(--text)',
            }}>
              {e.name}
            </div>
            {e.description && (
              <div style={{
                fontSize: '0.82rem', color: 'var(--text-light)',
                marginTop: '4px', lineHeight: 1.5,
              }}>
                {e.description}
              </div>
            )}
          </div>
          <TrackElectionButton
            election={{
              id: e.id,
              name: e.name,
              date: e.date || null,
              state: null,
              type: e.type || 'federal',
              level: 'federal',
              candidates_count: e.candidates_count || 0,
            }}
            size="md"
            onNotify={onNotify}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Primitives (mirrors StatewideOfficialsTab) ────────────────────────
function Section({ title, children, compact }) {
  return (
    <div style={{ marginBottom: compact ? '10px' : '18px' }}>
      <div style={{
        fontSize: '0.78rem', color: 'var(--text-light)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 10px 8px',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Collapsible({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      marginBottom: '10px', border: '1px solid var(--border)', borderRadius: '10px',
      background: 'white', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '10px', padding: '10px 14px', background: open ? 'var(--bg)' : 'white',
          border: 'none', borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {title}
          </span>
          {typeof count === 'number' && (
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
              background: 'var(--bg)', color: 'var(--text-light)', borderRadius: '10px',
            }}>
              {count}
            </span>
          )}
        </div>
        <span aria-hidden style={{
          fontSize: '0.9rem', color: 'var(--text-light)',
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
        }}>
          ›
        </span>
      </button>
      {open && <div style={{ padding: '10px 10px 8px' }}>{children}</div>}
    </div>
  );
}

function NestedCollapsible({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '6px' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 8px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          fontSize: '0.7rem', color: 'var(--text-light)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.4px',
        }}>
          {title}{typeof count === 'number' ? ` (${count})` : ''}
        </span>
        <span aria-hidden style={{
          fontSize: '0.85rem', color: 'var(--text-light)',
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
        }}>
          ›
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function OfficialCard({
  name, party, subtitle, meta, website, big,
  selectionMethod, selectionDetail, normallyElected,
  onClick, followTarget, onNotify, onCompareToggle, compareIds,
}) {
  const memberCmpId = followTarget && (followTarget.bioguide_id || followTarget.id);
  const isComparing = Boolean(compareIds && memberCmpId && compareIds.has(memberCmpId));
  const partyColor = party ? (PARTY_COLORS[party] || '#666') : null;
  const partyBg = party === 'R' ? '#fde8e8'
    : party === 'D' ? '#e3f0f7'
    : party === 'I' ? '#f0eaff' : '#eef';
  const clickable = typeof onClick === 'function';
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      onMouseOver={clickable ? (e) => (e.currentTarget.style.background = 'var(--bg)') : undefined}
      onMouseOut={clickable ? (e) => (e.currentTarget.style.background = 'white') : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 12px',
        background: 'white', border: '1px solid var(--border)', borderRadius: '10px',
        marginBottom: '6px',
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'background 0.15s' : undefined,
      }}
    >
      <div
        style={{
          width: big ? '48px' : '36px', height: big ? '48px' : '36px',
          borderRadius: '50%', background: partyBg || 'var(--bg)',
          color: partyColor || 'var(--text-light)',
          fontSize: big ? '1rem' : '0.82rem', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: big ? '0.98rem' : '0.88rem', fontWeight: 700, lineHeight: 1.2 }}>
          {name}
        </div>
        {subtitle && (
          <div style={{ fontSize: '0.76rem', color: 'var(--text-light)', marginTop: '2px' }}>
            {subtitle}
          </div>
        )}
        {meta && meta.length > 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-light)', marginTop: '3px' }}>
            {meta.join(' · ')}
          </div>
        )}
        {selectionDetail && (
          <div style={{
            fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '3px',
            fontStyle: 'italic', lineHeight: 1.4,
          }}>
            {selectionDetail}
          </div>
        )}
        {website && (
          <a
            href={website} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: '0.74rem', color: 'var(--accent)',
              textDecoration: 'none', fontWeight: 600,
              marginTop: '4px', display: 'inline-block',
            }}
          >
            Official page ↗
          </a>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        {party && (
          <span style={{
            padding: '2px 8px', borderRadius: '10px',
            background: partyBg, color: partyColor,
            fontSize: '0.68rem', fontWeight: 800,
          }}>
            {party}
          </span>
        )}
        <SelectionBadge
          method={selectionMethod}
          detail={selectionDetail}
          normallyElected={normallyElected}
        />
        {followTarget && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <FollowButton member={followTarget} size="sm" onNotify={onNotify} />
            <CompareButton
              member={followTarget}
              size="sm"
              isComparing={isComparing}
              onCompareToggle={onCompareToggle}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Loading({ children }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-light)' }}>
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div style={{
      margin: '20px 10px', padding: '18px 16px', textAlign: 'center',
      background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: '12px',
      color: 'var(--text-light)', fontSize: '0.84rem', lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function ordinalSuffix(n) {
  if (!n) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
