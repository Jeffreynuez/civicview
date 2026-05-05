'use client';

import { useEffect, useState } from 'react';
import { fetchCandidate } from '@/lib/api';
import {
  isOfficialTracked,
  toggleOfficial,
  useTrackedOfficials,
} from '../lib/trackedOfficials';
import PageButton from './PageButton';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1', NP: '#666' };
const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent', NP: 'Non-partisan' };

/**
 * Candidate profile — mirrors the shape of ProfileView but for candidates running
 * in a 2026 race. Supports a full detail payload or a lightweight stub
 * (falls back to fetchCandidate by id).
 */
export default function CandidateProfile({
  candidate,
  onBack,
  onClose,
  backLabel,
  onNotify,
  onCompareToggle,
  isComparing,
  onMemberPick,
  onStatePersonPick,
  // Pages layer: open this candidate's public page. Wired through from page.js.
  onOpenPage,
  width = 380,
  // True on viewports ≤768px. When set, the profile takes 100% width
  // (sits below the map in the vertical mobile stack) and the width
  // prop is ignored.
  isMobile = false,
}) {
  const [full, setFull] = useState(candidate);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    // If the candidate entry is thin (e.g. only id), fetch full detail.
    if (candidate?.id && !candidate.top_issues) {
      (async () => {
        const { data } = await fetchCandidate(candidate.id);
        if (data) setFull(data);
      })();
    } else {
      setFull(candidate);
    }
  }, [candidate?.id, candidate?.top_issues, candidate]);

  // Subscribe so the Follow button re-renders when the tracked store changes.
  useTrackedOfficials();

  if (!full) return null;
  const c = full;
  const party = c.party || 'NP';

  // Candidate follow target — match the member shape FollowButton / store expect.
  const followMember = {
    id: c.id,
    bioguide_id: c.bioguide_id || null,
    name: c.name,
    party: c.party || null,
    title: c.seeking_office || 'Candidate',
    role: 'candidate',
    role_type: 'candidate',
    chamber: null,
    state: c.state || null,
    district: c.district || null,
    photoUrl: c.photo_url || null,
  };
  const isFollowing = isOfficialTracked(followMember);
  const toggleFollow = () => {
    const nowFollowing = toggleOfficial(followMember);
    if (onNotify) {
      onNotify(
        nowFollowing
          ? `Now following ${c.name}. You'll see them in My Tracked.`
          : `Stopped following ${c.name}.`
      );
    }
  };

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'issues', label: 'Issues' },
    { key: 'endorsements', label: 'Endorsements' },
    { key: 'experience', label: 'Experience' },
    { key: 'fundraising', label: 'Fundraising' },
  ];

  return (
    <div
      className="flex flex-col overflow-hidden bg-white"
      style={
        isMobile
          ? { width: '100%', flex: 1, minHeight: 0 }
          : { width: `${width}px`, flexShrink: 0 }
      }
    >
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--cl-border)', background: 'var(--cl-primary)', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <button
            onClick={onBack}
            style={{
              background: 'rgba(255,255,255,0.18)', color: 'white', border: '1px solid rgba(255,255,255,0.35)',
              padding: '4px 10px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ← {backLabel || 'Back'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close profile"
              title="Close"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.8)', padding: '2px 6px',
                fontSize: '1.25rem', lineHeight: 1,
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'white')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
            >
              ×
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
          <div
            style={{
              width: '72px', height: '72px', borderRadius: '50%',
              background: c.photo_url ? `url(${c.photo_url}) center/cover` : 'rgba(255,255,255,0.22)',
              border: '2px solid rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.4rem', fontWeight: 700, flexShrink: 0,
            }}
          >
            {!c.photo_url && c.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 1.2 }}>{c.name}</div>
            <div style={{ fontSize: '0.82rem', opacity: 0.88, marginTop: '2px' }}>
              Candidate for {c.seeking_office}
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
                borderRadius: '10px', background: 'rgba(255,255,255,0.22)',
              }}>
                {PARTY_NAMES[party] || party}
              </span>
              {c.incumbent && (
                <span style={{
                  fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
                  borderRadius: '10px', background: '#f4a261', color: 'white',
                }}>
                  INCUMBENT
                </span>
              )}
              {c.hometown && (
                <span style={{
                  fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px',
                  borderRadius: '10px', background: 'rgba(255,255,255,0.12)',
                }}>
                  {c.hometown}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={toggleFollow}
            style={{
              padding: '6px 12px', fontSize: '0.76rem', fontWeight: 700,
              borderRadius: '8px', cursor: 'pointer',
              background: isFollowing ? '#1d5a2c' : 'rgba(255,255,255,0.22)',
              color: 'white', border: '1px solid rgba(255,255,255,0.35)',
            }}
          >
            {isFollowing ? '✓ Following' : '+ Follow'}
          </button>
          {onCompareToggle && (
            <button
              onClick={() => onCompareToggle(c)}
              style={{
                padding: '6px 12px', fontSize: '0.76rem', fontWeight: 700,
                borderRadius: '8px', cursor: 'pointer',
                background: isComparing ? '#f4a261' : 'rgba(255,255,255,0.22)',
                color: 'white', border: '1px solid rgba(255,255,255,0.35)',
              }}
            >
              {isComparing ? '✓ In Compare' : '+ Compare'}
            </button>
          )}
          {c.website && (
            <a
              href={c.website}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '6px 12px', fontSize: '0.76rem', fontWeight: 700,
                borderRadius: '8px', background: 'rgba(255,255,255,0.22)',
                color: 'white', border: '1px solid rgba(255,255,255,0.35)',
                textDecoration: 'none',
              }}
            >
              Campaign Site ↗
            </a>
          )}
          {/* Cross-nav: jump to this candidate's sitting-office profile. The
              candidate is also a sitting Congress member (bioguide_id) or a
              sitting state official (official_id + state scope). One simple
              label — "View Rep." — for both, since the user just wants to
              flip to the other view. */}
          {((c.bioguide_id && onMemberPick)
            || (c.official_id && (c.official_scope || '').toLowerCase() === 'state' && onStatePersonPick)) && (
            <button
              onClick={() => {
                if (c.bioguide_id && onMemberPick) {
                  onMemberPick({ bioguide_id: c.bioguide_id });
                } else if (c.official_id && onStatePersonPick) {
                  onStatePersonPick({ state: c.state, id: c.official_id });
                }
              }}
              title="Open this candidate's current-office profile"
              style={{
                padding: '6px 12px', fontSize: '0.76rem', fontWeight: 700,
                borderRadius: '8px', cursor: 'pointer',
                background: 'rgba(255,255,255,0.22)', color: 'white',
                border: '1px solid rgba(255,255,255,0.35)',
              }}
            >
              View Rep.
            </button>
          )}
          {onOpenPage && (
            <PageButton
              size="sm"
              officialId={c.id}
              onOpen={(id) => onOpenPage(id, {
                displayName: c.name,
                role: c.seeking_office ? `Candidate for ${c.seeking_office}` : 'Candidate',
                photoUrl: c.photo_url,
              })}
            />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--cl-border)', background: 'white', overflowX: 'auto' }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '10px 14px', textAlign: 'center', fontSize: '0.76rem', fontWeight: 600,
              color: activeTab === key ? 'var(--cl-primary)' : 'var(--cl-text-light)',
              borderBottom: activeTab === key ? '2px solid var(--cl-accent)' : '2px solid transparent',
              cursor: 'pointer', background: 'none', border: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {activeTab === 'overview' && (
          <div>
            {/* Skeleton-record disclosure. CivicLens tries to give every
                filed candidate equal footing on the ballot, which means
                listing minor / NPA / write-in candidates that don't have
                public bios or campaign sites. We surface that gap
                honestly rather than padding the profile with filler. */}
            {c.data_status === 'skeleton' && (
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--cl-text-light)',
                  background: 'var(--cl-bg-soft)',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 'var(--cl-radius-md, 8px)',
                  padding: '10px 12px',
                  marginBottom: '14px',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--cl-text)', marginBottom: 2 }}>
                  Limited information on file
                </div>
                Confirmed as an active filer with the {c.data_source || 'state Division of Elections'}.
                We don&apos;t have a curated bio, issue stances, endorsements, or fundraising
                data on this candidate yet — we&apos;ll fill those in as the campaign publishes
                a website or files the next required disclosure.
              </div>
            )}
            {c.bio && (
              <p style={{ fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--cl-text)', marginBottom: '14px' }}>
                {c.bio}
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {c.current_office && (
                <StatCard label="Currently" value={c.current_office} />
              )}
              {c.age && <StatCard label="Age" value={c.age} />}
              {c.hometown && <StatCard label="Hometown" value={c.hometown} />}
              {c.fundraising?.total_raised != null && (
                <StatCard label="Raised" value={`$${formatMoney(c.fundraising.total_raised)}`} />
              )}
            </div>
            {c.top_issues && c.top_issues.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <SectionTitle>Top Issues</SectionTitle>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {c.top_issues.slice(0, 6).map((i, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px',
                        borderRadius: '14px', background: 'var(--cl-bg)',
                        color: 'var(--cl-primary)', border: '1px solid var(--cl-border)',
                      }}
                    >
                      {i.name || i}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {c.social && Object.keys(c.social).length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <SectionTitle>Social</SectionTitle>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {Object.entries(c.social).map(([platform, handle]) => (
                    <span
                      key={platform}
                      style={{
                        fontSize: '0.72rem', padding: '4px 10px', borderRadius: '10px',
                        background: 'var(--cl-bg)', color: 'var(--cl-text-light)',
                      }}
                    >
                      {platform}: @{handle}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'issues' && (
          <div>
            {(c.top_issues || []).map((issue, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: '10px', padding: '12px 14px',
                  background: 'var(--cl-bg)', borderRadius: '10px',
                  border: '1px solid var(--cl-border)',
                }}
              >
                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--cl-primary)', marginBottom: '4px' }}>
                  {issue.name}
                </div>
                {issue.stance && (
                  <div style={{ fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--cl-text)' }}>
                    {issue.stance}
                  </div>
                )}
              </div>
            ))}
            {(!c.top_issues || c.top_issues.length === 0) && (
              <EmptyState>No issue positions listed yet.</EmptyState>
            )}
          </div>
        )}

        {activeTab === 'endorsements' && (
          <div>
            {(c.endorsements || []).map((e, idx) => (
              <div
                key={idx}
                style={{
                  padding: '10px 12px', background: 'var(--cl-bg)', borderRadius: '8px',
                  marginBottom: '6px', fontSize: '0.85rem',
                }}
              >
                <div style={{ fontWeight: 600 }}>{e.name}</div>
                {e.org && <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)' }}>{e.org}</div>}
              </div>
            ))}
            {(!c.endorsements || c.endorsements.length === 0) && (
              <EmptyState>No endorsements listed yet.</EmptyState>
            )}
          </div>
        )}

        {activeTab === 'experience' && (
          <div>
            {(c.experience || []).map((x, idx) => (
              <div
                key={idx}
                style={{
                  position: 'relative', paddingLeft: '20px', paddingBottom: '12px',
                  borderLeft: '2px solid var(--cl-border)', marginLeft: '4px',
                }}
              >
                <span style={{
                  position: 'absolute', left: '-6px', top: '4px', width: '10px', height: '10px',
                  background: 'var(--cl-accent)', borderRadius: '50%', border: '2px solid white',
                }} />
                <div style={{ fontSize: '0.75rem', color: 'var(--cl-text-light)', fontWeight: 600 }}>
                  {x.from}{x.to == null ? ' – Present' : (x.to !== x.from ? `–${x.to}` : '')}
                </div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, marginTop: '2px' }}>{x.role}</div>
                {x.note && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
                    {x.note}
                  </div>
                )}
              </div>
            ))}
            {(!c.experience || c.experience.length === 0) && (
              <EmptyState>No experience listed yet.</EmptyState>
            )}
          </div>
        )}

        {activeTab === 'fundraising' && (
          <div>
            {c.fundraising ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <StatCard label="Total Raised" value={`$${formatMoney(c.fundraising.total_raised)}`} big />
                  <StatCard label="Cash on Hand" value={`$${formatMoney(c.fundraising.cash_on_hand)}`} big />
                  <StatCard label="Total Spent" value={`$${formatMoney(c.fundraising.total_spent)}`} />
                  <StatCard label="Burn Rate" value={
                    c.fundraising.total_raised
                      ? `${Math.round((c.fundraising.total_spent / c.fundraising.total_raised) * 100)}%`
                      : '—'
                  } />
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '10px', textAlign: 'center' }}>
                  As of {c.fundraising.as_of || 'latest filing'}
                </div>
              </>
            ) : (
              <EmptyState>No fundraising data available.</EmptyState>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, big }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: '10px',
      background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
    }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: big ? '1.1rem' : '0.88rem', fontWeight: 700, color: 'var(--cl-primary)', marginTop: '3px', wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.5px', color: 'var(--cl-text-light)',
    }}>
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  // Tab-internal placeholder. Kept dense + body-only because the surrounding
  // tab already provides the heading context (Issues / Endorsements /
  // Experience / etc.); a second headline here would feel redundant.
  return (
    <div
      style={{
        padding: '20px',
        textAlign: 'center',
        color: 'var(--cl-text-light)',
        fontSize: 'var(--cl-text-sm)',
        fontFamily: 'var(--cl-font-sans)',
      }}
    >
      {children}
    </div>
  );
}

function formatMoney(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}
