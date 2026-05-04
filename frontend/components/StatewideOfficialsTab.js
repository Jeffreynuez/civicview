'use client';

import { useEffect, useState } from 'react';
import { fetchStateOfficials } from '@/lib/api';
import FollowButton from './FollowButton';
import CompareButton from './CompareButton';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };

/**
 * Statewide officials — governor + cabinet + state senate/house leadership + members.
 * Fetches on first mount per state code; cached by the API layer.
 */
export default function StatewideOfficialsTab({
  stateCode, stateName, onSelectPerson, onNotify, onCompareToggle, compareIds,
}) {
  // Helper: only expose a click handler when a select callback is wired.
  const handleSelect = (person, roleType, extras) =>
    onSelectPerson
      ? () => onSelectPerson({ ...person, ...(extras || {}) }, roleType)
      : null;

  // Helper: build the member snapshot the Follow store needs — includes the
  // injected role_type + chamber so we can render a meaningful entry in
  // "My Tracked" without another round-trip.
  const followTarget = (person, roleType, extras) => ({
    ...person,
    ...(extras || {}),
    role_type: roleType,
    state: (stateCode || '').toUpperCase() || null,
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notSeeded, setNotSeeded] = useState(false);

  useEffect(() => {
    if (!stateCode) return;
    let cancelled = false;
    setLoading(true);
    setNotSeeded(false);
    (async () => {
      const res = await fetchStateOfficials(stateCode);
      if (cancelled) return;
      if (res.notSeeded) {
        setNotSeeded(true);
        setData(null);
      } else {
        setData(res.data);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [stateCode]);

  if (loading) return <Loading>Loading statewide officials…</Loading>;

  if (notSeeded) {
    return (
      <EmptyState>
        <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--cl-text)' }}>
          Statewide data not yet available for {stateName || stateCode}
        </div>
        <div>We&apos;re curating governor + state legislature data state by state. Florida is live — more states coming.</div>
      </EmptyState>
    );
  }
  if (!data) return null;

  const gov = data.executive?.governor;
  const ltGov = data.executive?.lt_governor;
  const cabinet = data.executive?.cabinet || [];
  const senLeadership = data.state_senate?.leadership || [];
  const senMembers = data.state_senate?.members || [];
  const houseLeadership = data.state_house?.leadership || [];
  const houseMembers = data.state_house?.members || [];

  // Break the cabinet array into individual offices
  const findRole = (re) => cabinet.find((c) => re.test(c.role || ''));
  const ag = findRole(/attorney general/i);
  const cfo = findRole(/chief financial|\bcfo\b/i);
  const agCom = findRole(/commissioner of agriculture|agriculture/i);

  // Judiciary
  const sc = data.judiciary?.supreme_court;
  const scMembers = sc?.members || [];
  const dcas = data.judiciary?.district_courts_of_appeal || [];

  return (
    <div>
      {/* Governor */}
      {gov && (
        <Section title="Governor">
          <OfficialCard
            name={gov.name}
            party={gov.party}
            subtitle={gov.role || 'Governor'}
            meta={[
              gov.serving_since ? `Serving since ${new Date(gov.serving_since).getFullYear()}` : null,
              gov.term_end ? `Term ends ${new Date(gov.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={gov.website}
            selectionMethod={gov.selection_method}
            selectionDetail={gov.selection_detail}
            big
            onClick={handleSelect(gov, 'state_governor', { chamber: 'Executive' })}
            followTarget={followTarget(gov, 'state_governor', { chamber: 'Executive' })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
          {gov.bio && (
            <p style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)', lineHeight: 1.5, padding: '0 6px' }}>
              {gov.bio}
            </p>
          )}
        </Section>
      )}

      {/* Lt. Governor */}
      {ltGov && (
        <Section title="Lieutenant Governor" compact>
          <OfficialCard
            name={ltGov.name}
            party={ltGov.party}
            subtitle={ltGov.role || 'Lieutenant Governor'}
            website={ltGov.website}
            selectionMethod={ltGov.selection_method}
            selectionDetail={ltGov.selection_detail}
            normallyElected={ltGov.normally_elected}
            onClick={handleSelect(ltGov, 'state_cabinet', { chamber: 'Executive' })}
            followTarget={followTarget(ltGov, 'state_cabinet', { chamber: 'Executive' })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </Section>
      )}

      {/* Attorney General — promoted from the Cabinet into its own dropdown */}
      {ag && (
        <Collapsible title="Attorney General">
          <OfficialCard
            name={ag.name}
            party={ag.party}
            subtitle={ag.role}
            meta={[
              ag.serving_since ? `Serving since ${new Date(ag.serving_since).getFullYear()}` : null,
              ag.term_end ? `Term ends ${new Date(ag.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={ag.website}
            selectionMethod={ag.selection_method}
            selectionDetail={ag.selection_detail}
            normallyElected={ag.normally_elected}
            onClick={handleSelect(ag, 'state_cabinet', { chamber: 'Executive' })}
            followTarget={followTarget(ag, 'state_cabinet', { chamber: 'Executive' })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </Collapsible>
      )}

      {/* Chief Financial Officer */}
      {cfo && (
        <Collapsible title="Chief Financial Officer">
          <OfficialCard
            name={cfo.name}
            party={cfo.party}
            subtitle={cfo.role}
            meta={[
              cfo.serving_since ? `Serving since ${new Date(cfo.serving_since).getFullYear()}` : null,
              cfo.term_end ? `Term ends ${new Date(cfo.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={cfo.website}
            selectionMethod={cfo.selection_method}
            selectionDetail={cfo.selection_detail}
            normallyElected={cfo.normally_elected}
            onClick={handleSelect(cfo, 'state_cabinet', { chamber: 'Executive' })}
            followTarget={followTarget(cfo, 'state_cabinet', { chamber: 'Executive' })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </Collapsible>
      )}

      {/* Commissioner of Agriculture */}
      {agCom && (
        <Collapsible title="Commissioner of Agriculture">
          <OfficialCard
            name={agCom.name}
            party={agCom.party}
            subtitle={agCom.role}
            meta={[
              agCom.serving_since ? `Serving since ${new Date(agCom.serving_since).getFullYear()}` : null,
              agCom.term_end ? `Term ends ${new Date(agCom.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={agCom.website}
            selectionMethod={agCom.selection_method}
            selectionDetail={agCom.selection_detail}
            onClick={handleSelect(agCom, 'state_cabinet', { chamber: 'Executive' })}
            followTarget={followTarget(agCom, 'state_cabinet', { chamber: 'Executive' })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </Collapsible>
      )}

      {/* State Senate — leadership + senators as nested collapsibles */}
      {(senLeadership.length > 0 || senMembers.length > 0) && (
        <Collapsible title="State Senate" count={senLeadership.length + senMembers.length}>
          {senLeadership.length > 0 && (
            <NestedCollapsible title="Leadership" count={senLeadership.length} defaultOpen>
              {senLeadership.map((m) => (
                <OfficialCard
                  key={m.id}
                  name={m.name}
                  party={m.party}
                  subtitle={`District ${m.district} · ${m.role}`}
                  website={m.website}
                  onClick={handleSelect(m, 'state_legislator', { chamber: m.chamber || 'State Senate' })}
                  followTarget={followTarget(m, 'state_legislator', { chamber: m.chamber || 'State Senate' })}
                  onNotify={onNotify}
                  onCompareToggle={onCompareToggle}
                  compareIds={compareIds}
                />
              ))}
            </NestedCollapsible>
          )}
          {senMembers.length > 0 && (
            <NestedCollapsible title="Senators" count={senMembers.length}>
              {senMembers.map((m) => (
                <OfficialCard
                  key={m.id}
                  name={m.name}
                  party={m.party}
                  subtitle={`District ${m.district} · ${m.role}`}
                  onClick={handleSelect(m, 'state_legislator', { chamber: m.chamber || 'State Senate' })}
                  followTarget={followTarget(m, 'state_legislator', { chamber: m.chamber || 'State Senate' })}
                  onNotify={onNotify}
                  onCompareToggle={onCompareToggle}
                  compareIds={compareIds}
                />
              ))}
            </NestedCollapsible>
          )}
        </Collapsible>
      )}

      {/* State House */}
      {(houseLeadership.length > 0 || houseMembers.length > 0) && (
        <Collapsible title="State House" count={houseLeadership.length + houseMembers.length}>
          {houseLeadership.length > 0 && (
            <NestedCollapsible title="Leadership" count={houseLeadership.length} defaultOpen>
              {houseLeadership.map((m) => (
                <OfficialCard
                  key={m.id}
                  name={m.name}
                  party={m.party}
                  subtitle={`District ${m.district} · ${m.role}`}
                  onClick={handleSelect(m, 'state_legislator', { chamber: m.chamber || 'State House' })}
                  followTarget={followTarget(m, 'state_legislator', { chamber: m.chamber || 'State House' })}
                  onNotify={onNotify}
                  onCompareToggle={onCompareToggle}
                  compareIds={compareIds}
                />
              ))}
            </NestedCollapsible>
          )}
          {houseMembers.length > 0 && (
            <NestedCollapsible title="Representatives" count={houseMembers.length}>
              {houseMembers.map((m) => (
                <OfficialCard
                  key={m.id}
                  name={m.name}
                  party={m.party}
                  subtitle={`District ${m.district} · ${m.role}`}
                  onClick={handleSelect(m, 'state_legislator', { chamber: m.chamber || 'State House' })}
                  followTarget={followTarget(m, 'state_legislator', { chamber: m.chamber || 'State House' })}
                  onNotify={onNotify}
                  onCompareToggle={onCompareToggle}
                  compareIds={compareIds}
                />
              ))}
            </NestedCollapsible>
          )}
        </Collapsible>
      )}

      {/* Judiciary — Supreme Court */}
      {scMembers.length > 0 && (
        <Collapsible title="Supreme Court" count={scMembers.length}>
          <div style={{
            fontSize: '0.74rem', color: 'var(--cl-text-light)', padding: '2px 8px 8px',
            lineHeight: 1.4,
          }}>
            {sc?.body_name || 'Supreme Court'} · All justices are appointed by the Governor
            from JNC slates, then face merit retention every 6 years.
          </div>
          {scMembers.map((j) => (
            <OfficialCard
              key={j.id}
              name={j.name}
              subtitle={j.role + (j.chief ? ' (presiding)' : '')}
              meta={[
                j.appointed_by ? `Appointed by ${j.appointed_by}` : null,
                j.appointed_on ? new Date(j.appointed_on).getFullYear() : null,
                j.term_end ? `Term ends ${new Date(j.term_end).getFullYear()}` : null,
              ].filter(Boolean)}
              website={j.website}
              selectionMethod={j.selection_method}
              selectionDetail={j.selection_detail}
              onClick={handleSelect(j, 'state_scotus', { chamber: sc?.body_name || 'State Supreme Court' })}
              followTarget={followTarget(j, 'state_scotus', { chamber: sc?.body_name || 'State Supreme Court' })}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          ))}
        </Collapsible>
      )}

      {/* Judiciary — District Courts of Appeal */}
      {dcas.length > 0 && (
        <Collapsible title="District Courts of Appeal" count={dcas.length}>
          <div style={{
            fontSize: '0.74rem', color: 'var(--cl-text-light)', padding: '2px 8px 8px',
            lineHeight: 1.4,
          }}>
            Florida has 6 District Courts of Appeal. DCA judges are appointed by the
            Governor from JNC slates, then face merit retention every 6 years.
          </div>
          {dcas.map((d) => {
            const judges = d.judges_sample || [];
            const totalRemaining = Math.max(0, (d.judges_total || 0) - judges.length - (d.chief_judge ? 1 : 0));
            return (
              <NestedCollapsible
                key={d.id}
                title={`DCA ${d.district} — ${d.seat_city}`}
                count={d.judges_total || null}
              >
                {d.jurisdiction && (
                  <div style={{
                    fontSize: '0.72rem', color: 'var(--cl-text-light)', padding: '4px 8px 8px',
                    lineHeight: 1.5,
                  }}>
                    {d.jurisdiction}
                  </div>
                )}
                {d.chief_judge && (
                  <OfficialCard
                    name={d.chief_judge.name}
                    subtitle={d.chief_judge.role}
                    meta={[
                      d.chief_judge.appointed_by ? `Appointed by ${d.chief_judge.appointed_by}` : null,
                      d.chief_judge.appointed_on ? new Date(d.chief_judge.appointed_on).getFullYear() : null,
                    ].filter(Boolean)}
                    selectionMethod={d.selection_method}
                    selectionDetail={d.selection_detail}
                    onClick={handleSelect(d.chief_judge, 'state_dca', { chamber: `DCA ${d.district || ''}`.trim() })}
                    followTarget={followTarget(d.chief_judge, 'state_dca', { chamber: `DCA ${d.district || ''}`.trim() })}
                    onNotify={onNotify}
                    onCompareToggle={onCompareToggle}
                    compareIds={compareIds}
                  />
                )}
                {judges.map((j) => (
                  <OfficialCard
                    key={j.id}
                    name={j.name}
                    subtitle={j.role || 'Judge'}
                    meta={j.appointed_by ? [`Appointed by ${j.appointed_by}`] : null}
                    selectionMethod={d.selection_method}
                    onClick={handleSelect(j, 'state_dca', { chamber: `DCA ${d.district || ''}`.trim() })}
                    followTarget={followTarget(j, 'state_dca', { chamber: `DCA ${d.district || ''}`.trim() })}
                    onNotify={onNotify}
                    onCompareToggle={onCompareToggle}
                    compareIds={compareIds}
                  />
                ))}
                {totalRemaining > 0 && (
                  <div style={{
                    fontSize: '0.72rem', color: 'var(--cl-text-light)', padding: '6px 8px',
                    fontStyle: 'italic',
                  }}>
                    + {totalRemaining} additional judge{totalRemaining === 1 ? '' : 's'} not shown — full roster at{' '}
                    <a href={d.website} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}>
                      {(d.website || '').replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </NestedCollapsible>
            );
          })}
        </Collapsible>
      )}
    </div>
  );
}

// ─── Collapsible primitives ──────────────────────────────────────────
function Collapsible({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '10px', border: '1px solid var(--cl-border)', borderRadius: '10px', background: 'white', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '10px', padding: '10px 14px', background: open ? 'var(--cl-bg)' : 'white',
          border: 'none', borderBottom: open ? '1px solid var(--cl-border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '0.78rem', color: 'var(--cl-primary)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {title}
          </span>
          {typeof count === 'number' && (
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
              background: 'var(--cl-bg)', color: 'var(--cl-text-light)', borderRadius: '10px',
            }}>
              {count}
            </span>
          )}
        </div>
        <span aria-hidden style={{ fontSize: '0.9rem', color: 'var(--cl-text-light)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
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
          fontSize: '0.7rem', color: 'var(--cl-text-light)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.4px',
        }}>
          {title}{typeof count === 'number' ? ` (${count})` : ''}
        </span>
        <span aria-hidden style={{ fontSize: '0.85rem', color: 'var(--cl-text-light)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          ›
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function Section({ title, children, compact }) {
  return (
    <div style={{ marginBottom: compact ? '10px' : '18px' }}>
      <div style={{
        fontSize: '0.78rem', color: 'var(--cl-text-light)', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.5px', padding: '2px 10px 8px',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Selection-method badge (elected vs. appointed) ──────────────────
// Shared color tokens so the Local tab can mount the same component later.
const SELECTION_STYLES = {
  elected:               { bg: '#e8f5ec', fg: '#1f7a3a', label: 'ELECTED' },
  appointed:             { bg: '#fff3e0', fg: '#a35a00', label: 'APPOINTED' },
  'appointed-then-elected': { bg: '#eef1ff', fg: '#3b44a6', label: 'APPT → ELECTED' },
};

function SelectionBadge({ method, detail, normallyElected }) {
  if (!method) return null;
  const style = SELECTION_STYLES[method] || { bg: 'var(--cl-bg)', fg: 'var(--cl-text-light)', label: method.toUpperCase() };
  return (
    <span
      title={detail || (normallyElected ? 'Office is normally filled by election' : undefined)}
      style={{
        padding: '2px 8px', borderRadius: '10px',
        background: style.bg, color: style.fg,
        fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.4px',
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
      {method === 'appointed' && normallyElected ? '*' : ''}
    </span>
  );
}

function OfficialCard({
  name, party, subtitle, meta, website, big,
  selectionMethod, selectionDetail, normallyElected,
  onClick, followTarget, onNotify, onCompareToggle, compareIds,
}) {
  const partyColor = party ? (PARTY_COLORS[party] || '#666') : null;
  const partyBg = party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : party === 'I' ? '#f0eaff' : '#eef';
  const clickable = typeof onClick === 'function';
  const memberCmpId = followTarget && (followTarget.bioguide_id || followTarget.id);
  const isComparing = Boolean(compareIds && memberCmpId && compareIds.has(memberCmpId));
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
      onMouseOver={clickable ? (e) => (e.currentTarget.style.background = 'var(--cl-bg)') : undefined}
      onMouseOut={clickable ? (e) => (e.currentTarget.style.background = 'white') : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 12px',
        background: 'white', border: '1px solid var(--cl-border)', borderRadius: '10px',
        marginBottom: '6px',
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'background 0.15s' : undefined,
      }}
    >
      <div
        style={{
          width: big ? '48px' : '36px', height: big ? '48px' : '36px',
          borderRadius: '50%', background: partyBg || 'var(--cl-bg)',
          color: partyColor || 'var(--cl-text-light)', fontSize: big ? '1rem' : '0.82rem',
          fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
            {subtitle}
          </div>
        )}
        {meta && meta.length > 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '3px' }}>
            {meta.join(' · ')}
          </div>
        )}
        {selectionDetail && (
          <div style={{
            fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '3px',
            fontStyle: 'italic', lineHeight: 1.4,
          }}>
            {selectionDetail}
          </div>
        )}
        {website && (
          <a
            href={website} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: '0.74rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600, marginTop: '4px', display: 'inline-block' }}
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
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cl-text-light)' }}>
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div style={{
      margin: '20px 10px', padding: '18px 16px', textAlign: 'center',
      background: 'var(--cl-bg)', border: '1px dashed var(--cl-border)', borderRadius: '12px',
      color: 'var(--cl-text-light)', fontSize: '0.84rem', lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}
