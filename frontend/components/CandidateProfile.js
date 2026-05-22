'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronDown, Heart, ArrowLeftRight, Landmark, FileText } from 'lucide-react';
import { fetchCandidate } from '@/lib/api';
import {
  isOfficialTracked,
  toggleOfficial,
  useTrackedOfficials,
} from '../lib/trackedOfficials';
import PageButton from './PageButton';
import TabStrip from './TabStrip';

const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent', NP: 'Non-partisan' };

// Compact icon button used in the collapsed-hero row. Mirrors the
// rep ProfileView treatment but tinted for the candidate's dark
// header — transparent fill over the dark hero, light icon strokes,
// translucent white border. The `active` prop swaps to a brighter
// fill so on/off states read at a glance.
function CompactIconButton({ title, ariaLabel, onClick, children, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
      style={{
        width: 28,
        height: 28,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
        color: 'white',
        border: active ? '1px solid white' : '1px solid rgba(255,255,255,0.35)',
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
        flexShrink: 0,
      }}
      onMouseOver={(e) => {
        if (active) return;
        e.currentTarget.style.background = 'rgba(255,255,255,0.22)';
      }}
      onMouseOut={(e) => {
        if (active) return;
        e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
      }}
    >
      {children}
    </button>
  );
}

/**
 * Candidate profile — mirrors the shape of ProfileView but for candidates running
 * in a 2026 race. Supports a full detail payload or a lightweight stub
 * (falls back to fetchCandidate by id).
 *
 * Hero treatment ports the rep ProfileView pattern: centered avatar /
 * name / title / chips with a chevron pill that toggles between a full
 * hero and a single-row compact hero. The candidate variant intentionally
 * keeps the dark `var(--cl-primary)` background on both the back/close
 * row and the hero itself so it stays visually distinct from the rep's
 * light/white profile chrome.
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

  // Hero collapse state — when true, the dark hero is condensed to a
  // single row (small avatar + name + Follow / Compare / View Rep /
  // Page icons + party chip). Frees vertical space so the tabs and
  // tab content stay reachable on shorter viewports. Always defaults
  // to collapsed; the user taps the chevron pill to expand. We do
  // NOT persist this to localStorage so the default never gets
  // overridden by a prior session's preference.
  const [heroCollapsed, setHeroCollapsed] = useState(true);
  const toggleHero = () => setHeroCollapsed((v) => !v);

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

  // Reset tab + hero collapse whenever the active candidate changes,
  // so navigating between candidates always starts on Overview with
  // the compact hero (mirrors the rep ProfileView reset).
  useEffect(() => {
    setActiveTab('overview');
    setHeroCollapsed(true);
  }, [candidate?.id]);

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

  // Cross-nav availability — the candidate is also a sitting Congress
  // member (bioguide_id) or a sitting state official (official_id +
  // state scope). One simple label — "View Rep." — for both, since
  // the user just wants to flip to the other view.
  const hasRepCrossNav =
    (c.bioguide_id && onMemberPick) ||
    (c.official_id &&
      (c.official_scope || '').toLowerCase() === 'state' &&
      onStatePersonPick);
  const goToRep = () => {
    if (c.bioguide_id && onMemberPick) {
      onMemberPick({ bioguide_id: c.bioguide_id });
    } else if (c.official_id && onStatePersonPick) {
      onStatePersonPick({ state: c.state, id: c.official_id });
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
        // Mobile: full-viewport takeover below the navbar (matches the
        // ProfileView pattern from M2). The 60vh panel area would crush
        // the candidate's content; reading a profile is a takeover
        // interaction.  z-index 45 sits below the navbar (z:50) so the
        // navbar logo / search / menu stay reachable.
        isMobile
          ? {
              position: 'fixed',
              top: 56, left: 0, right: 0, bottom: 0,
              background: 'white',
              zIndex: 45,
            }
          : { width: `${width}px`, flexShrink: 0 }
      }
    >
      {/* Back + Collapse + Close row — sits at the top of the dark
          header so the candidate's signature color extends edge-to-edge
          and visually distinguishes the panel from the rep profile.
          The middle chevron toggles the hero between compact and full. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--cl-primary)',
          borderBottom: '1px solid rgba(255,255,255,0.18)',
          minHeight: isMobile ? 48 : undefined,
        }}
      >
        <div
          onClick={onBack}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBack?.(); }}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: isMobile ? '14px 16px' : '10px 16px',
            fontSize: isMobile ? '0.95rem' : '0.85rem',
            color: 'white', cursor: 'pointer',
            fontWeight: 500,
            minHeight: isMobile ? 44 : undefined,
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.10)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <ChevronLeft size={isMobile ? 18 : 16} strokeWidth={2} />
          {backLabel || 'Back'}
        </div>
        {/* Hero collapse toggle — chevron in a translucent-white pill
            so it reads as a discoverable affordance against the dark
            header (matches the rep profile's green pill treatment but
            uses white-on-primary instead). Sits between Back and × so
            it's always reachable. */}
        <button
          type="button"
          onClick={toggleHero}
          aria-label={heroCollapsed ? 'Expand profile header' : 'Collapse profile header'}
          aria-expanded={!heroCollapsed}
          title={heroCollapsed ? 'Expand profile header' : 'Collapse profile header'}
          style={{
            background: 'rgba(255,255,255,0.18)',
            border: '1px solid rgba(255,255,255,0.45)',
            borderRadius: '50%',
            cursor: 'pointer',
            color: 'white',
            width: isMobile ? 36 : 30,
            height: isMobile ? 36 : 30,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            margin: isMobile ? '0 4px' : '0 2px',
            flexShrink: 0,
            transition: 'background 0.15s ease',
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.30)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
        >
          <ChevronDown size={14} strokeWidth={1.8} />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close profile"
            title="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.85)',
              padding: isMobile ? '12px 18px' : '8px 14px',
              fontSize: isMobile ? '1.4rem' : '1.15rem',
              lineHeight: 1,
              minWidth: isMobile ? 44 : undefined,
              minHeight: isMobile ? 44 : undefined,
            }}
            onMouseOver={(e) => (e.currentTarget.style.color = 'white')}
            onMouseOut={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
          >
            ×
          </button>
        )}
      </div>

      {/* Compact hero — visible when the user has collapsed the full
          hero. Single dark row: avatar + name/office + action icons
          (Follow / Compare / View Rep / Page) + party chip. The icons
          mirror the full-hero buttons so users don't lose access to
          Follow/etc when collapsed. Tab strip and tab content land
          right below. */}
      {heroCollapsed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'var(--cl-primary)',
            color: 'white',
            borderBottom: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <div
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: c.photo_url ? `url(${c.photo_url}) center/cover` : 'rgba(255,255,255,0.22)',
              border: '2px solid rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.78rem', fontWeight: 700, flexShrink: 0,
            }}
          >
            {!c.photo_url && c.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.95rem', fontWeight: 700, color: 'white',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {c.name}
            </div>
            <div style={{
              fontSize: '0.72rem', color: 'rgba(255,255,255,0.85)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {c.seeking_office ? `Candidate for ${c.seeking_office}` : 'Candidate'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            <CompactIconButton
              title={isFollowing ? 'Following — click to unfollow' : 'Follow'}
              ariaLabel={isFollowing ? 'Unfollow' : 'Follow'}
              onClick={toggleFollow}
              active={isFollowing}
            >
              <Heart size={14} strokeWidth={1.5} fill={isFollowing ? 'currentColor' : 'none'} />
            </CompactIconButton>
            {onCompareToggle && (
              <CompactIconButton
                title={isComparing ? 'In compare — click to remove' : 'Add to compare'}
                ariaLabel={isComparing ? 'Remove from compare' : 'Add to compare'}
                onClick={() => onCompareToggle(c)}
                active={isComparing}
              >
                <ArrowLeftRight size={14} strokeWidth={1.4} />
              </CompactIconButton>
            )}
            {hasRepCrossNav && (
              <CompactIconButton
                title="View Rep."
                ariaLabel="Open this candidate's current-office profile"
                onClick={goToRep}
              >
                {/* Capitol-dome silhouette stand-in: outlined building. */}
                <Landmark size={14} strokeWidth={1.3} />
              </CompactIconButton>
            )}
            {onOpenPage && (
              <CompactIconButton
                title="Open Page"
                ariaLabel="Open candidate's Page"
                onClick={() => onOpenPage(c.id, {
                  displayName: c.name,
                  role: c.seeking_office ? `Candidate for ${c.seeking_office}` : 'Candidate',
                  photoUrl: c.photo_url,
                })}
              >
                <FileText size={14} strokeWidth={1.4} />
              </CompactIconButton>
            )}
          </div>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
            fontSize: '0.7rem', fontWeight: 700,
            background: 'rgba(255,255,255,0.22)',
            color: 'white',
            flexShrink: 0,
          }}>
            {party}
          </span>
        </div>
      )}

      {/* Hero — full version. Hidden when collapsed. Centered avatar /
          name / office / chips / action row, all on the dark
          candidate-signature background. Mirrors the rep ProfileView's
          centered hero layout while keeping the candidate's color
          identity. */}
      {!heroCollapsed && (
        <div
          style={{
            textAlign: 'center',
            padding: '20px 20px 14px',
            background: 'var(--cl-primary)',
            color: 'white',
            borderBottom: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          {c.photo_url ? (
            <img
              src={c.photo_url}
              alt={c.name}
              // display:block + margin auto so the avatar reliably centers
              // in the textAlign:center hero (same fix as ProfileView).
              style={{
                display: 'block', width: '88px', height: '88px',
                borderRadius: '50%', objectFit: 'cover',
                border: '3px solid rgba(255,255,255,0.35)',
                margin: '0 auto 10px',
                background: 'rgba(255,255,255,0.18)',
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div style={{
              width: '88px', height: '88px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.22)',
              border: '3px solid rgba(255,255,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.75rem', fontWeight: 700, color: 'white',
              margin: '0 auto 10px',
            }}>
              {c.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </div>
          )}
          <h2 style={{ fontSize: '1.2rem', marginBottom: '4px', fontWeight: 700, color: 'white' }}>
            {c.name}
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
            Candidate for {c.seeking_office}
          </p>
          {/* Chip row — party + INCUMBENT + hometown. Centered to match
              the avatar/name above. */}
          <div style={{
            display: 'flex', justifyContent: 'center',
            gap: '6px', flexWrap: 'wrap', marginTop: '8px',
          }}>
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

          {/* Action row — Follow / Compare / Campaign Site / View Rep
              / Page. Centered like the rep hero. Mobile bumps padding so
              each button hits the 44px minimum tap target. */}
          <div
            style={{
              marginTop: '14px',
              display: 'flex',
              justifyContent: 'center',
              gap: isMobile ? 8 : 6,
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={toggleFollow}
              style={{
                padding: isMobile ? '11px 22px' : '7px 18px',
                fontSize: isMobile ? '0.92rem' : '0.82rem',
                fontWeight: 700,
                borderRadius: '8px', cursor: 'pointer',
                background: isFollowing ? '#1d5a2c' : 'rgba(255,255,255,0.22)',
                color: 'white', border: '1px solid rgba(255,255,255,0.35)',
                minHeight: isMobile ? 44 : undefined,
              }}
            >
              {isFollowing ? '✓ Following' : '+ Follow'}
            </button>
            {onCompareToggle && (
              <button
                onClick={() => onCompareToggle(c)}
                style={{
                  padding: isMobile ? '11px 18px' : '7px 14px',
                  fontSize: isMobile ? '0.9rem' : '0.82rem',
                  fontWeight: 700,
                  borderRadius: '8px', cursor: 'pointer',
                  background: isComparing ? '#f4a261' : 'rgba(255,255,255,0.22)',
                  color: 'white', border: '1px solid rgba(255,255,255,0.35)',
                  minHeight: isMobile ? 44 : undefined,
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
                  padding: isMobile ? '11px 18px' : '7px 14px',
                  fontSize: isMobile ? '0.9rem' : '0.82rem',
                  fontWeight: 700,
                  borderRadius: '8px', background: 'rgba(255,255,255,0.22)',
                  color: 'white', border: '1px solid rgba(255,255,255,0.35)',
                  textDecoration: 'none',
                  minHeight: isMobile ? 44 : undefined,
                  display: 'inline-flex', alignItems: 'center',
                }}
              >
                Campaign Site ↗
              </a>
            )}
            {hasRepCrossNav && (
              <button
                onClick={goToRep}
                title="Open this candidate's current-office profile"
                style={{
                  padding: isMobile ? '11px 18px' : '7px 14px',
                  fontSize: isMobile ? '0.9rem' : '0.82rem',
                  fontWeight: 700,
                  borderRadius: '8px', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.22)', color: 'white',
                  border: '1px solid rgba(255,255,255,0.35)',
                  minHeight: isMobile ? 44 : undefined,
                }}
              >
                View Rep.
              </button>
            )}
            {onOpenPage && (
              <PageButton
                size={isMobile ? 'md' : 'sm'}
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
      )}

      {/* Tabs — uses the shared TabStrip with horizontal-overflow fade
          indicators. tabs.map normalizes `key` → `id` at the call
          site since the rest of this file uses `key`. */}
      <TabStrip
        isMobile={isMobile}
        tabs={tabs.map((t) => ({ id: t.key, label: t.label }))}
        activeId={activeTab}
        onSelect={setActiveTab}
      />

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
