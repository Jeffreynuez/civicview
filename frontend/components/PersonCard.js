'use client';

import { useEffect, useRef } from 'react';
import SelectionBadge from './SelectionBadge';
import FollowButton from './FollowButton';
import CompareButton from './CompareButton';
import PageButton from './PageButton';
import OnBallotBadge from './OnBallotBadge';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent' };
// Short-form tag text. The full party name is kept on the `title`/aria-label
// so screen readers + hover tooltips still get the unabbreviated word.
const PARTY_LETTERS = { R: 'R', D: 'D', I: 'I' };

export default function PersonCard({
  member, onClick, onCompareToggle, isComparing, onNotify,
  // Return-to-list highlighting — when truthy, the card scrolls itself into
  // view and runs a short pulse animation, then calls onHighlightConsumed().
  highlight, onHighlightConsumed,
  // When onBallotClick is supplied and the member has active_candidacy, the
  // "On ballot" badge becomes a button that invokes this callback.
  onBallotClick,
  // Opens the rep/candidate's social-style page view. Per spec the pill is
  // a third button in the Follow/Compare cluster so it never conflicts with
  // the Follow bookmark semantics.
  onOpenPage,
}) {
  const party = member.party || 'I';
  const partyClass = `party-${party}`;
  const partyFull = PARTY_NAMES[party] || 'Independent';

  const initials = member.name
    .split(' ')
    .map((n) => n[0])
    .join('');

  // Return-to-list: on mount (or when highlight becomes true) scroll the
  // row into view and run a brief pulse via a style toggle. Consume the
  // flag so it doesn't re-fire on unrelated re-renders.
  const rowRef = useRef(null);
  useEffect(() => {
    if (!highlight || !rowRef.current) return;
    const node = rowRef.current;
    try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    node.classList.add('civiclens-pulse');
    const t = setTimeout(() => {
      node.classList.remove('civiclens-pulse');
      if (onHighlightConsumed) onHighlightConsumed();
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  return (
    <div
      ref={rowRef}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
        borderRadius: '10px', cursor: 'pointer', transition: 'all 0.15s',
        border: '1px solid transparent', marginBottom: '6px',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = 'var(--cl-bg)';
        e.currentTarget.style.borderColor = 'var(--cl-border)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = 'none';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <style jsx global>{`
        @keyframes civiclens-pulse {
          0%   { background: rgba(255, 196, 64, 0.0); }
          30%  { background: rgba(255, 196, 64, 0.35); }
          100% { background: rgba(255, 196, 64, 0.0); }
        }
        .civiclens-pulse { animation: civiclens-pulse 1.4s ease-out; }
      `}</style>
      {/* Avatar */}
      {member.photoUrl ? (
        <img
          src={member.photoUrl}
          alt={member.name}
          style={{
            width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover',
            border: '2px solid var(--cl-border)', flexShrink: 0, background: '#e9ecef',
          }}
          onError={(e) => {
            e.target.style.display = 'none';
            e.target.nextSibling.style.display = 'flex';
          }}
        />
      ) : null}
      <div
        style={{
          width: '52px', height: '52px', borderRadius: '50%', background: '#e9ecef',
          display: member.photoUrl ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.2rem', fontWeight: 700, color: '#999', flexShrink: 0,
        }}
      >
        {initials}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--cl-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {member.name}
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: '1px' }}>
          {member.title || member.role || ''}
        </div>
      </div>

      {/* Party + Selection + On-ballot badges — stacked vertically so the
          column stays narrow and doesn't crowd the name/title on the left.
          The party pill uses just the single letter (R/D/I) to keep the
          column narrow; the full word is on title/aria-label for a11y. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
        <span
          title={partyFull}
          aria-label={partyFull}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: '22px', padding: '2px 7px', borderRadius: '12px',
            fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.3px',
            background: party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : '#f0eaff',
            color: PARTY_COLORS[party],
          }}
        >
          {PARTY_LETTERS[party] || party}
        </span>
        {member.active_candidacy && (
          <OnBallotBadge
            activeCandidacy={member.active_candidacy}
            size="sm"
            onClick={onBallotClick ? () => onBallotClick(member.active_candidacy) : undefined}
          />
        )}
        {member.selection_method && (
          <SelectionBadge
            method={member.selection_method}
            detail={member.selection_detail}
            normallyElected={member.normally_elected}
            size="sm"
          />
        )}
      </div>

      {/* Action cluster — Follow + Compare on top, Page pill below. The
          pill is visually bigger than the two icons so stacking groups like
          with like rather than letting the Page pill elbow the icons into
          the card's edge. */}
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
          gap: '6px', flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FollowButton member={member} onNotify={onNotify} />
          {onCompareToggle && (
            <CompareButton
              member={member}
              isComparing={isComparing}
              onCompareToggle={onCompareToggle}
            />
          )}
        </div>
        {onOpenPage && (
          <PageButton
            size="sm"
            officialId={member.bioguide_id || member.id}
            onOpen={(id) => onOpenPage(id, {
              displayName: member.name,
              role: member.title || member.role || '',
              photoUrl: member.photoUrl,
            })}
          />
        )}
      </div>
    </div>
  );
}
