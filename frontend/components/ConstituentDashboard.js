'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsCompact } from '@/lib/useViewport';
import {
  Avatar,
  PartyChip,
  Eyebrow,
  Button,
  EmptyState,
  CheckCircle,
  CalendarCheck,
  Calendar,
  ChatCircleDots,
  Newspaper,
  MapPin,
  ArrowLeft,
  ArrowRight,
} from './ui';
import { getAllTrackedOfficials } from '../lib/trackedOfficials';
import { fetchMyCitizenPolls, closeCitizenPoll, fetchMyHiddenContent, fetchSaved, fetchPollsFeed, fetchPostsFeed } from '../lib/pagesApi';
import FeedCard from './polls/FeedCard';
import AppealModal from './AppealModal';
import Navbar from './Navbar';
import TwoFactorSection from './TwoFactorSection';
import BillingSection from './BillingSection';
import VerificationSection from './VerificationSection';

/**
 * ConstituentDashboard — the personal civic command center for a verified
 * citizen. Built from the dashboard design: welcome header, My Reps grid,
 * Upcoming in district, Recent activity feed, right-rail Your Ballot +
 * engagement stats, Quick links, plus empty states.
 *
 * Phase 3C: ships as a self-contained view component that the parent
 * (page.js) decides when to render — typically right after a citizen logs
 * in, or via a "Dashboard" entry in the navbar. Real data flows in via
 * props; the parent is responsible for wiring data fetching.
 *
 * Data contract:
 *   citizen        — citizen me payload from useCitizenAuth (required).
 *                    Shape: { name, email, district, state, city, ... }
 *   trackedReps    — array of tracked rep objects from trackedOfficials
 *                    store. Empty array → renders "No tracked reps" state.
 *                    Each: { id, name, party, title, scope, last_active_at? }
 *   upcoming       — array of upcoming items. Each:
 *                    { kind: 'vote'|'town-hall'|'poll-closing'|'ballot',
 *                      title, when (iso), meta? (e.g. "in 6 days · 142 cosponsors"),
 *                      onClick? }
 *                    Pass [] for the "nothing scheduled" empty state.
 *   recent         — array of activity-feed items. Each:
 *                    { kind: 'post'|'reply'|'voted', title, body?, author?,
 *                      whenIso, thumbnail? (URL), onClick? }
 *                    Pass [] for the "no recent activity" empty state.
 *   ballot         — { electionName, when (iso), races: { federal, state,
 *                    local, ballot_measures }, onView? }
 *                    Optional — null hides the right-rail ballot card.
 *   onNavigate     — { manageTracked, browseReps, ballot, comparecandidates,
 *                    pollingPlace, accountSettings, viewActivity, ... }
 *                    Each entry is an optional () → void for the parent to
 *                    handle navigation.
 *   onClose        — () → void, optional. Renders the close × in the header.
 */
export default function ConstituentDashboard({
  citizen,
  trackedReps = null,    // null = "load from store"; pass [] to override empty
  upcoming = null,
  recent = null,
  ballot = null,
  onNavigate = {},
  onClose,
  // Navbar props — passed straight through to the embedded compact Navbar
  // at the top of the dashboard. The parent (app/page.js) wires login /
  // logout / tracked / subscribe / help-build / feedback so the user can
  // jump anywhere without backing out of the dashboard first. We
  // deliberately don't accept onCitizenDashboard (we're already here)
  // or onOpenCommittees (deemed out-of-scope per design feedback).
  navbarProps = {},
}) {
  // Lazy-load tracked officials from localStorage if the parent didn't
  // supply them. The store is purely client-side, so we only touch it
  // after mount.
  const [storeReps, setStoreReps] = useState([]);
  useEffect(() => {
    if (trackedReps !== null) return;
    try {
      const items = getAllTrackedOfficials();
      setStoreReps(items || []);
    } catch {
      setStoreReps([]);
    }
  }, [trackedReps]);

  const reps = trackedReps !== null ? trackedReps : storeReps;
  const today = new Date();
  const greeting = greetingFor(today);
  const dateLabel = formatDate(today);
  // Compact viewports (≤1024px) collapse the two-column layout into a
  // single stack — otherwise the right rail's 1fr share becomes too
  // narrow for the 2×2 stats grid in YourActivityCard, which overflows.
  const isCompact = useIsCompact();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--cl-bg)',
        fontFamily: 'var(--cl-font-sans)',
        color: 'var(--cl-text)',
      }}
    >
      {/* Embedded navbar at the top of the dashboard. Uses `compact`
          mode which hides the search bar + committees button per
          design feedback. We deliberately don't forward
          onCitizenDashboard (we're already in the dashboard) or
          onOpenCommittees (omitted). The home/CivicView-logo click
          falls through to onHome → onClose so it doubles as a back
          affordance. */}
      <Navbar compact {...navbarProps} onHome={onClose} />

      {/* Sticky Back pill — pinned to the top of the scroll container
          so the escape hatch stays reachable as the user scrolls
          through tracked reps + activity. The dashboard mounts inside
          a `position: fixed; overflowY: auto` wrapper (app/page.js),
          so `position: sticky; top: 0` here anchors to that scroll
          context. Renamed from "Back to map" to "Back" per design
          feedback — the button returns to whichever surface the user
          opened the dashboard from, not necessarily the map. */}
      {onClose && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            background: 'var(--cl-bg)',
            padding: '12px 24px 6px',
            display: 'flex',
            justifyContent: 'flex-start',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: 'var(--cl-card)',
              border: '1px solid var(--cl-border)',
              borderRadius: 'var(--cl-radius-pill)',
              fontSize: 'var(--cl-text-sm)',
              fontWeight: 600,
              fontFamily: 'var(--cl-font-sans)',
              color: 'var(--cl-accent)',
              cursor: 'pointer',
              boxShadow: 'var(--cl-shadow-sticky)',
              transition:
                'background var(--cl-duration-fast) var(--cl-ease-standard), border-color var(--cl-duration-fast) var(--cl-ease-standard)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'var(--cl-accent-soft)';
              e.currentTarget.style.borderColor = 'var(--cl-accent)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'var(--cl-card)';
              e.currentTarget.style.borderColor = 'var(--cl-border)';
            }}
          >
            <ArrowLeft size={14} color="accent" active />
            Back
          </button>
        </div>
      )}

      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '6px 24px 48px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Welcome header — Close × button removed per design feedback;
            the sticky Back button above + the navbar's home affordance
            cover the same "dismiss this surface" intent. */}
        <WelcomeHeader
          citizen={citizen}
          greeting={greeting}
          dateLabel={dateLabel}
        />

        {/* Mobile: TwoFactor + Verification + Billing sit between the
            greeting and the grid (before MY REPRESENTATIVES). Desktop
            renders the same trio inside the right rail below. Order is
            security → identity → billing so the most-sensitive surface
            sits highest. */}
        {isCompact && <TwoFactorSection />}
        {isCompact && <VerificationSection citizen={citizen} />}
        {isCompact && <BillingSection citizen={citizen} />}

        {/* Two-column layout: left = My Reps + Upcoming + Recent, right
            = TwoFactor + Ballot + Activity stats. Desktop keeps the
            original 2:1 split. Compact viewports (mobile portrait +
            tablet) drop to a single column so the right rail's stats
            grid + ballot card aren't squeezed past their content
            width. */}
        <div
          style={{
            display: 'grid',
            gap: 24,
            gridTemplateColumns: isCompact ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr)',
          }}
        >
          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <MyRepresentatives reps={reps} onManage={onNavigate.manageTracked} onBrowse={onNavigate.browseReps} />
            <UpcomingInDistrict items={upcoming} citizen={citizen} onSeeCalendar={onNavigate.districtCalendar} />
            <RecentActivity items={recent} onSeeAll={onNavigate.viewActivity} />
            <MyPollsSection citizen={citizen} onOpenPage={onNavigate.openPage} />
            <SavedSection citizen={citizen} onOpenPage={onNavigate.openPage} />
            <HiddenByModerationSection citizen={citizen} />
          </div>

          {/* RIGHT RAIL — desktop only. Order: security → identity →
              billing, then ballot/activity/quick-links below. The
              account-management trio sits at the top so users land on
              the most-sensitive surface first. */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {!isCompact && <TwoFactorSection />}
            {!isCompact && <VerificationSection citizen={citizen} />}
            {!isCompact && <BillingSection citizen={citizen} />}
            {ballot && <YourBallotCard ballot={ballot} onView={ballot.onView || onNavigate.ballot} />}
            <YourActivityCard reps={reps} />
            <QuickLinksCard onNavigate={onNavigate} />
          </aside>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Welcome header
// ─────────────────────────────────────────────────────────────────
function WelcomeHeader({ citizen, greeting, dateLabel }) {
  // Accept either the mapped shape ({name, district}) the home mount
  // passes OR the raw citizen object ({display_name,
  // congressional_district}) the /polls mount passes — otherwise the
  // greeting falls back to 'there'/'Citizen'/'—' depending on which
  // surface opened the dashboard.
  const displayName = citizen?.display_name || citizen?.name || '';
  const firstName = displayName.split(' ')[0] || 'there';
  const district = citizen?.congressional_district || citizen?.district || '—';
  const city = citizen?.city || '';
  const state = citizen?.state || '';

  return (
    <header
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-2xl)',
        padding: '28px 28px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        <Avatar name={displayName || undefined} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1
            className="cl-h1"
            style={{
              margin: 0,
              fontSize: 'var(--cl-text-2xl)',
              fontWeight: 700,
              letterSpacing: 'var(--cl-tracking-tight)',
            }}
          >
            Good {greeting},{' '}
            <span style={{ color: 'var(--cl-accent)' }}>{firstName}</span>.
          </h1>
          <div
            style={{
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 'var(--cl-text-sm)',
              color: 'var(--cl-text-light)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--cl-text)' }}>
              {displayName || 'Citizen'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {district}
              {city ? ` · ${city}` : ''}
              {state ? `, ${state}` : ''}
            </span>
            <VerifiedCitizenBadge />
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        justifyContent: 'space-between', gap: 12, alignSelf: 'stretch',
        marginLeft: 'auto',
      }}>
        <div style={{ textAlign: 'right' }}>
          <Eyebrow>Today</Eyebrow>
          <div
            className="cl-num"
            style={{
              marginTop: 2,
              fontSize: 'var(--cl-text-md)',
              fontWeight: 600,
              color: 'var(--cl-text)',
            }}
          >
            {dateLabel}
          </div>
        </div>
        {/* Self-serve account deletion (Task #81) — bottom-right of
            the hero card per design feedback. Red text so the
            destructive intent is unambiguous at a glance, but still
            a subtle dotted-underline link rather than a button.
            The full warnings + email confirmation surface lives on
            /account/delete itself. */}
        <a
          href="/account/delete"
          style={{
            fontSize: 'var(--cl-text-xs)',
            color: '#a3261c',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
            textUnderlineOffset: '3px',
            fontWeight: 600,
          }}
        >
          Delete account
        </a>
      </div>
    </header>
  );
}

function VerifiedCitizenBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        background: 'var(--cl-up-soft)',
        color: 'var(--cl-up-text)',
        border: '1px solid var(--cl-up-border)',
        borderRadius: 'var(--cl-radius-pill)',
        fontSize: 'var(--cl-text-2xs)',
        fontWeight: 700,
      }}
    >
      <CheckCircle size={12} active color="up" />
      Verified citizen
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// My Representatives
// ─────────────────────────────────────────────────────────────────
function MyRepresentatives({ reps, onManage, onBrowse }) {
  const hasReps = reps && reps.length > 0;
  return (
    <section>
      <SectionHeader
        eyebrow="My representatives"
        action={
          onManage && hasReps ? { label: 'Manage tracked reps →', onClick: onManage } : null
        }
      />
      {hasReps ? (
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}
        >
          {reps.slice(0, 6).map((rep) => (
            <DashboardRepCard key={rep.id || rep.bioguide_id || rep.name} rep={rep} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Newspaper size={36} active color="muted" />}
          headline="You're not tracking anyone yet"
          body="Tracking a rep adds their posts to your dashboard and notifies you when they vote, post, or hold a town hall."
          cta={onBrowse ? { label: 'Browse your representatives →', onClick: onBrowse } : null}
          tone="muted"
        />
      )}
    </section>
  );
}

function DashboardRepCard({ rep }) {
  const partyKey = (rep.party || '').toString().slice(0, 1).toUpperCase();
  const lastActive = rep.last_active_at
    ? `Active ${timeAgo(rep.last_active_at)}`
    : 'Following';
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Avatar name={rep.name} party={partyKey || undefined} size="md" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--cl-text-md)',
            fontWeight: 700,
            color: 'var(--cl-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {rep.name}
          {partyKey && <PartyChip party={partyKey} size="xs" />}
        </div>
        <div
          style={{
            fontSize: 'var(--cl-text-xs)',
            color: 'var(--cl-text-light)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {rep.title || rep.role || ''}{rep.scope ? ` · ${rep.scope}` : ''}
        </div>
        <div
          style={{
            fontSize: 'var(--cl-text-2xs)',
            color: 'var(--cl-success-text)',
            marginTop: 4,
            fontWeight: 600,
          }}
        >
          {lastActive}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Upcoming in district
// ─────────────────────────────────────────────────────────────────
const UPCOMING_KIND_META = {
  vote:           { label: 'House vote',    Icon: Newspaper },
  'town-hall':    { label: 'Town hall',     Icon: MapPin    },
  'poll-closing': { label: 'Poll closing',  Icon: CalendarCheck },
  ballot:         { label: 'On your ballot', Icon: CalendarCheck },
};

function UpcomingInDistrict({ items, citizen, onSeeCalendar }) {
  const district = citizen?.district || 'your district';
  const hasItems = items && items.length > 0;
  return (
    <section>
      <SectionHeader
        eyebrow="Upcoming in your district"
        action={
          onSeeCalendar && hasItems
            ? { label: 'See district calendar →', onClick: onSeeCalendar }
            : null
        }
      />
      {hasItems ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.slice(0, 5).map((item, i) => (
            <UpcomingRow key={item.id || `${item.kind}-${i}`} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CalendarCheck size={36} color="default" />}
          headline={`Nothing scheduled in ${district} yet`}
          body="We'll surface votes, town halls, and poll closings here as your tracked reps post them."
          dense
        />
      )}
    </section>
  );
}

function UpcomingRow({ item }) {
  const meta = UPCOMING_KIND_META[item.kind] || { label: item.kind, Icon: Calendar };
  const date = item.when ? new Date(item.when) : null;
  const dayLabel = date ? formatShortDay(date) : null;
  return (
    <div
      role={item.onClick ? 'button' : undefined}
      onClick={item.onClick}
      tabIndex={item.onClick ? 0 : undefined}
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        cursor: item.onClick ? 'pointer' : 'default',
      }}
    >
      {dayLabel && (
        <div
          style={{
            textAlign: 'center',
            minWidth: 56,
            padding: '4px 0',
            borderRight: '1px solid var(--cl-border)',
          }}
        >
          <div
            className="cl-eyebrow"
            style={{ color: 'var(--cl-text-light)' }}
          >
            {dayLabel.month}
          </div>
          <div
            className="cl-num"
            style={{
              fontSize: 'var(--cl-text-xl)',
              fontWeight: 700,
              color: 'var(--cl-text)',
              lineHeight: 1,
              marginTop: 2,
            }}
          >
            {dayLabel.day}
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--cl-text-2xs)',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: 'var(--cl-tracking-wider)',
            color: 'var(--cl-accent)',
          }}
        >
          <meta.Icon size={12} active color="accent" />
          {meta.label}
        </div>
        <div
          style={{
            fontSize: 'var(--cl-text-md)',
            fontWeight: 700,
            color: 'var(--cl-text)',
            marginTop: 2,
          }}
        >
          {item.title}
        </div>
        {item.meta && (
          <div
            style={{
              fontSize: 'var(--cl-text-xs)',
              color: 'var(--cl-text-light)',
              marginTop: 2,
            }}
          >
            {item.meta}
          </div>
        )}
      </div>
      {item.onClick && (
        <Button variant="outline" size="sm" trailingIcon={<ArrowRight size={12} />}>
          View
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Recent activity feed
// ─────────────────────────────────────────────────────────────────
function RecentActivity({ items, onSeeAll }) {
  const hasItems = items && items.length > 0;
  return (
    <section>
      <SectionHeader
        eyebrow="Recent activity"
        rightLabel="Reverse-chronological · last 7 days"
      />
      {hasItems ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.slice(0, 5).map((item, i) => (
              <ActivityRow key={item.id || i} item={item} />
            ))}
          </div>
          {onSeeAll && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                type="button"
                onClick={onSeeAll}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--cl-accent)',
                  fontSize: 'var(--cl-text-sm)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--cl-font-sans)',
                }}
              >
                See all activity →
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<ChatCircleDots size={36} color="default" />}
          headline="No recent activity yet"
          body="When your tracked reps post, when polls you voted on close, or when someone replies to your comments — it'll show up here."
          dense
        />
      )}
    </section>
  );
}

function ActivityRow({ item }) {
  const eyebrowColor =
    item.kind === 'reply'
      ? 'var(--cl-accent)'
      : item.kind === 'voted'
      ? 'var(--cl-warning-text)'
      : 'var(--cl-text-light)';
  const eyebrowText =
    item.kind === 'reply'
      ? 'Reply on your comment'
      : item.kind === 'voted'
      ? 'You voted'
      : item.author
      ? `${item.author} · New post`
      : 'New post';

  return (
    <div
      role={item.onClick ? 'button' : undefined}
      onClick={item.onClick}
      tabIndex={item.onClick ? 0 : undefined}
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 14,
        display: 'flex',
        gap: 12,
        cursor: item.onClick ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          background: 'var(--cl-accent-soft)',
          borderRadius: 'var(--cl-radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {item.kind === 'reply' ? (
          <ChatCircleDots size={18} active color="accent" />
        ) : item.kind === 'voted' ? (
          <CheckCircle size={18} active color="warning" />
        ) : (
          <Newspaper size={18} active color="accent" />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="cl-eyebrow"
          style={{ color: eyebrowColor }}
        >
          {eyebrowText}
        </div>
        <div
          style={{
            fontSize: 'var(--cl-text-md)',
            fontWeight: 600,
            color: 'var(--cl-text)',
            marginTop: 2,
          }}
        >
          {item.title}
        </div>
        {item.body && (
          <div
            style={{
              fontSize: 'var(--cl-text-xs)',
              color: 'var(--cl-text-light)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {item.body}
          </div>
        )}
        {item.whenIso && (
          <div
            style={{
              fontSize: 'var(--cl-text-2xs)',
              color: 'var(--cl-text-muted)',
              marginTop: 4,
            }}
          >
            {timeAgo(item.whenIso)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right-rail: Your Ballot
// ─────────────────────────────────────────────────────────────────
function YourBallotCard({ ballot, onView }) {
  const electionDate = ballot.when ? new Date(ballot.when) : null;
  const days = electionDate ? daysUntil(electionDate) : null;
  return (
    <Card
      title="Your ballot"
      tone="accent"
      icon={<CalendarCheck size={18} active color="accent" />}
    >
      {days != null && (
        <div style={{ marginTop: 4 }}>
          <span
            className="cl-num"
            style={{
              fontSize: 'var(--cl-text-3xl)',
              fontWeight: 800,
              color: 'var(--cl-accent)',
              letterSpacing: 'var(--cl-tracking-tight)',
            }}
          >
            {days}
          </span>
          <span
            style={{
              fontSize: 'var(--cl-text-sm)',
              color: 'var(--cl-text-light)',
              marginLeft: 6,
            }}
          >
            {days === 1 ? 'day' : 'days'} until your next election
          </span>
        </div>
      )}
      <div
        style={{
          fontSize: 'var(--cl-text-md)',
          fontWeight: 700,
          color: 'var(--cl-text)',
          marginTop: 12,
        }}
      >
        {ballot.electionName}
      </div>
      {electionDate && (
        <div
          style={{
            fontSize: 'var(--cl-text-xs)',
            color: 'var(--cl-text-light)',
            marginTop: 2,
          }}
        >
          {formatLongDate(electionDate)}
        </div>
      )}
      {ballot.races && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '14px 0 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {Object.entries(ballot.races).map(([k, v]) => (
            <li
              key={k}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 'var(--cl-text-sm)',
                color: 'var(--cl-text)',
              }}
            >
              <span>{prettyRaceLabel(k)}</span>
              <span className="cl-num" style={{ fontWeight: 700 }}>{v}</span>
            </li>
          ))}
        </ul>
      )}
      {onView && (
        <Button
          variant="primary"
          size="md"
          onClick={onView}
          style={{ width: '100%', marginTop: 16 }}
          trailingIcon={<ArrowRight size={14} color="onDark" active />}
        >
          View your ballot
        </Button>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right-rail: Your Activity stats
// ─────────────────────────────────────────────────────────────────
function YourActivityCard({ reps }) {
  const repsTracked = (reps && reps.length) || 0;
  // Demo metrics — Phase 2 will replace these with a real /citizen/stats
  // endpoint. The right-rail engagement card is part of the design
  // system but Phase 1.5 doesn't have the rollups built. Numbers are
  // honest fallbacks (0s) when no data, not inflated demo values.
  const stats = [
    { label: 'Polls cast',    value: 0 },
    { label: 'Comments left', value: 0 },
    { label: 'Reps tracked',  value: repsTracked },
    { label: 'Reactions',     value: 0 },
  ];
  return (
    <Card
      title={`Your activity · ${currentMonth()}`}
      icon={<CheckCircle size={16} color="muted" />}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginTop: 4,
        }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              background: 'var(--cl-bg-soft)',
              borderRadius: 'var(--cl-radius-md)',
              padding: '10px 12px',
              textAlign: 'center',
            }}
          >
            <div
              className="cl-num"
              style={{
                fontSize: 'var(--cl-text-2xl)',
                fontWeight: 800,
                color: 'var(--cl-text)',
                lineHeight: 1.1,
              }}
            >
              {s.value}
            </div>
            <div
              className="cl-eyebrow"
              style={{ marginTop: 2 }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Right-rail: Quick links
// ─────────────────────────────────────────────────────────────────
function QuickLinksCard({ onNavigate }) {
  const links = [
    { label: 'Compare candidates',   onClick: onNavigate.compareCandidates,  Icon: Newspaper },
    { label: 'Find your polling place', onClick: onNavigate.pollingPlace,    Icon: MapPin    },
    { label: 'Account settings',     onClick: onNavigate.accountSettings,    Icon: CheckCircle },
  ].filter((l) => l.onClick);
  if (!links.length) return null;
  return (
    <Card title="Quick links">
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '4px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {links.map((l) => (
          <li key={l.label}>
            <button
              type="button"
              onClick={l.onClick}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '8px 4px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--cl-text)',
                fontSize: 'var(--cl-text-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--cl-font-sans)',
                textAlign: 'left',
              }}
            >
              <l.Icon size={16} color="muted" />
              <span style={{ flex: 1 }}>{l.label}</span>
              <ArrowRight size={12} color="muted" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Local helpers (not exported)
// ─────────────────────────────────────────────────────────────────

function SectionHeader({ eyebrow, action, rightLabel }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
        gap: 8,
      }}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--cl-accent)',
            fontSize: 'var(--cl-text-xs)',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {action.label}
        </button>
      ) : rightLabel ? (
        <span style={{ fontSize: 'var(--cl-text-2xs)', color: 'var(--cl-text-muted)' }}>
          {rightLabel}
        </span>
      ) : null}
    </div>
  );
}

// Simple Card with header — local to this file because the brand-system
// Card primitive doesn't ship a title/icon slot today. Could be promoted
// to components/ui/ in a future polish pass.
function Card({ title, icon, tone, children }) {
  const tinted = tone === 'accent';
  return (
    <div
      style={{
        background: tinted ? 'var(--cl-accent-soft)' : 'var(--cl-card)',
        border: `1px solid ${tinted ? 'var(--cl-success-border)' : 'var(--cl-border)'}`,
        borderRadius: 'var(--cl-radius-xl)',
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        {icon}
        <span className="cl-eyebrow">{title}</span>
      </div>
      {children}
    </div>
  );
}

function greetingFor(date) {
  const h = date.getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatLongDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShortDay(date) {
  return {
    month: date.toLocaleDateString('en-US', { month: 'short' }),
    day: date.getDate(),
  };
}

function daysUntil(target) {
  const now = new Date();
  const ms = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function currentMonth() {
  return new Date().toLocaleDateString('en-US', { month: 'long' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const now = new Date();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function prettyRaceLabel(key) {
  const map = {
    federal: 'Federal races',
    state: 'State races',
    local: 'Local races',
    ballot_measures: 'Ballot measures',
    measures: 'Ballot measures',
  };
  return map[key] || key.replace(/_/g, ' ');
}

// ─────────────────────────────────────────────────────────────────
// My polls — citizen's own polls authored on unclaimed rep pages.
//
// New tab in the dashboard's left column with two filter pills:
// Active (still on the rep's page, votes still flowing) and Archived
// (auto-archived because the rep claimed the page, the citizen
// closed it, or the per-page cap superseded it).
//
// Renders nothing for anonymous viewers — the parent only mounts
// the dashboard once a citizen is signed in, so we just bail to a
// muted placeholder if the citizen prop arrives null somehow.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// HiddenByModerationSection — the citizen's recourse surface.
// Lists their content currently hidden by admin / auto-moderation
// within the 30-day appeal window. Each row shows preview + when
// hidden + appeal status (or an Appeal button if eligible).
// Hidden when the citizen has no hidden content (the empty state
// is "you have nothing to appeal" which is a happy state — we
// don't surface an empty card cluttering the dashboard).
// ─────────────────────────────────────────────────────────────────
function HiddenByModerationSection({ citizen }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appealTarget, setAppealTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await fetchMyHiddenContent();
    setLoading(false);
    setItems(data?.items || []);
  };
  useEffect(() => { if (citizen) load(); }, [citizen]);

  if (!citizen) return null;
  // Hide the section entirely during the initial fetch AND when
  // the fetch confirms there's nothing — empty state would just
  // say "great, no hidden content!" which is noise on a dashboard
  // that already has plenty of cards. Hiding during load also
  // prevents the .map() below from crashing on items=null, which
  // was the original bug here.
  if (loading) return null;
  if (!items || items.length === 0) return null;

  const onAppealSuccess = (appeal) => {
    setAppealTarget(null);
    // Patch the row in place — newly-pending state — without a
    // refetch round-trip.
    setItems((prev) =>
      (prev || []).map((row) =>
        row.target_kind === appeal.target_kind && row.target_id === appeal.target_id
          ? { ...row, appeal_status: 'pending', appealable: false }
          : row,
      ),
    );
  };

  return (
    <Card title="Hidden by moderation" icon={<ShieldIcon />} tone="warning">
      <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--cl-text-light)', lineHeight: 1.5 }}>
        Content of yours that admins or the community-reports
        threshold removed. You can appeal each item once, within
        30 days of when it was hidden.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((row) => (
          <HiddenContentRow
            key={`${row.target_kind}-${row.target_id}`}
            row={row}
            onAppeal={() => setAppealTarget({
              kind: row.target_kind,
              id: row.target_id,
              preview: row.preview,
              hide_reason: row.hide_reason,
              hidden_at: row.hidden_at,
            })}
          />
        ))}
      </div>
      <AppealModal
        open={!!appealTarget}
        target={appealTarget}
        onClose={() => setAppealTarget(null)}
        onSuccess={onAppealSuccess}
      />
    </Card>
  );
}

const HIDDEN_KIND_LABEL = {
  post: 'Post',
  post_comment: 'Comment',
  poll: 'Poll',
  poll_comment: 'Poll comment',
};

function HiddenContentRow({ row, onAppeal }) {
  const status = row.appeal_status; // null | 'pending' | 'granted' | 'denied'
  const statusChip =
    status === 'pending'
      ? { label: 'Appeal pending', bg: 'var(--cl-accent-soft)', color: 'var(--cl-accent)' }
      : status === 'granted'
      ? { label: 'Appeal granted ✓', bg: 'var(--cl-up-soft)', color: 'var(--cl-up)' }
      : status === 'denied'
      ? { label: 'Appeal denied', bg: 'var(--cl-danger-soft)', color: 'var(--cl-danger-text)' }
      : null;

  return (
    <div
      style={{
        background: 'white',
        border: '1px solid var(--cl-border)',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {HIDDEN_KIND_LABEL[row.target_kind] || row.target_kind}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
          Hidden {timeAgo(row.hidden_at)} · {row.hide_reason === 'auto_hidden' ? 'community reports' : 'admin action'}
        </div>
      </div>
      <div
        style={{
          fontSize: '0.88rem',
          color: 'var(--cl-text)',
          maxHeight: 80,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          background: 'var(--cl-bg-soft)',
          padding: '6px 8px',
          borderRadius: 6,
        }}
      >
        {row.preview || <em style={{ color: 'var(--cl-text-muted)' }}>(empty)</em>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {statusChip ? (
          <span
            style={{
              padding: '3px 10px',
              background: statusChip.bg,
              color: statusChip.color,
              borderRadius: 999,
              fontSize: '0.74rem',
              fontWeight: 700,
            }}
          >
            {statusChip.label}
          </span>
        ) : <span />}
        {row.appealable && (
          <button
            type="button"
            onClick={onAppeal}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--cl-accent)',
              background: 'var(--cl-accent)',
              color: 'white',
              borderRadius: 8,
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Appeal
          </button>
        )}
      </div>
      {status && row.appeal_admin_note && (
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontStyle: 'italic', borderTop: '1px solid var(--cl-border)', paddingTop: 6 }}>
          Admin note: {row.appeal_admin_note}
        </div>
      )}
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

// ── Saved & archived (Task #16 + consolidation) ───────────────
// One bounded module for everything the citizen set aside: saved polls,
// saved posts, and their archived polls. Each tab renders a fixed-height
// "shelf" of compact tiles (no infinite page growth) that scrolls
// internally with a top+bottom fade; a "Show more" button pulls the next
// saved page. Selecting a tile expands that one item inline above the
// shelf as the full interactive card (FeedCard for saved, MyPollRow for
// archived). The citizen's ACTIVE polls stay in their own section above.
//
// Saved data: GET /api/saved returns refs (item_type + item_id) keyset-
// paginated by saved_at; we re-fetch live cards via fetchPollsFeed /
// fetchPostsFeed and re-order to saved order. Archived data: the
// citizen's closed/auto-archived polls from fetchMyCitizenPolls.

const SAVED_TABS = [
  { key: 'poll',     label: 'Polls' },
  { key: 'post',     label: 'Posts' },
  { key: 'archived', label: 'Archived' },
];

const POLL_KIND_LABEL = { rep: 'Rep', candidate: 'Candidate', citizen: 'Citizen', standalone: 'Standalone' };

const SHELF_STYLE = {
  maxHeight: 330,
  overflowY: 'auto',
  paddingRight: 4,
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 44px), transparent 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 44px), transparent 100%)',
};

function CompactTile({ tag, title, author, meta, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8,
        padding: '10px 11px', minHeight: 104,
        background: 'var(--cl-card)', border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)', cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
          padding: '2px 7px', borderRadius: 999,
          background: 'var(--cl-accent-soft, #e6f4ea)', color: 'var(--cl-accent)',
        }}>{tag}</span>
        <span style={{ fontSize: '0.62rem', color: 'var(--cl-text-light)' }}>Open ›</span>
      </div>
      <div style={{
        fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.35, color: 'var(--cl-text)',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{title}</div>
      <div style={{ marginTop: 'auto', fontSize: '0.7rem', color: 'var(--cl-text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {author}{meta ? ` · ${meta}` : ''}
      </div>
    </button>
  );
}

function SavedSection({ citizen, onOpenPage }) {
  const [tab, setTab] = useState('poll');           // 'poll' | 'post' | 'archived'
  // Saved (poll/post) state
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedCursor, setSavedCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Archived state (loaded lazily on first Archived-tab open)
  const [archived, setArchived] = useState(null);
  const [archLoading, setArchLoading] = useState(false);
  const [archError, setArchError] = useState(null);
  // Shared
  const [expandedId, setExpandedId] = useState(null);
  const [openCommentId, setOpenCommentId] = useState(null);

  const isSavedTab = tab === 'poll' || tab === 'post';

  const _cardsForRefs = useCallback(async (refs) => {
    const ids = (refs.items || []).map((r) => r.item_id);
    if (!ids.length) return [];
    const feedFn = tab === 'post' ? fetchPostsFeed : fetchPollsFeed;
    const { data: feed } = await feedFn({ ids, limit: ids.length });
    const byId = new Map((feed?.items || []).map((c) => [c.id, c]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }, [tab]);

  const loadSaved = useCallback(async () => {
    if (!citizen) return;
    setLoading(true); setError(null);
    const { data: refs, error: e } = await fetchSaved({ itemType: tab, limit: 10 });
    if (e || !refs) {
      setError(e || 'Could not load saved items.');
      setItems([]); setHasMore(false); setSavedCursor(null); setLoading(false);
      return;
    }
    setItems(await _cardsForRefs(refs));
    setSavedCursor(refs.next_cursor || null);
    setHasMore(!!refs.has_more);
    setLoading(false);
  }, [citizen?.id, tab, _cardsForRefs]);

  const loadArchived = useCallback(async () => {
    if (!citizen) return;
    setArchLoading(true); setArchError(null);
    const { data, error: e } = await fetchMyCitizenPolls({ status: 'all' });
    if (e) { setArchError(e); setArchLoading(false); return; }
    setArchived(data?.archived || []);
    setArchLoading(false);
  }, [citizen?.id]);

  useEffect(() => {
    setExpandedId(null);
    if (tab === 'archived') { if (archived === null) loadArchived(); }
    else { loadSaved(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, citizen?.id]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore || !savedCursor) return;
    setLoadingMore(true);
    const { data: refs } = await fetchSaved({ itemType: tab, cursor: savedCursor, limit: 10 });
    if (!refs) { setHasMore(false); setLoadingMore(false); return; }
    const cards = await _cardsForRefs(refs);
    setItems((prev) => [...(prev || []), ...cards]);
    setSavedCursor(refs.next_cursor || null);
    setHasMore(!!refs.has_more);
    setLoadingMore(false);
  }, [loadingMore, loading, hasMore, savedCursor, tab, _cardsForRefs]);

  const handleCardUpdated = useCallback((cardId, patch) => {
    if (patch && patch.viewer && patch.viewer.is_saved === false) {
      setItems((prev) => (prev || []).filter((it) => it.id !== cardId));
      setExpandedId((cur) => (cur === cardId ? null : cur));
      return;
    }
    setItems((prev) => (prev || []).map((it) => (
      it.id === cardId
        ? { ...it, ...patch, viewer: { ...(it.viewer || {}), ...(patch.viewer || {}) } }
        : it
    )));
  }, []);

  if (!citizen) return null;

  const expandedCard = isSavedTab && expandedId != null
    ? (items || []).find((c) => c.id === expandedId) : null;
  const expandedArchived = tab === 'archived' && expandedId != null
    ? (archived || []).find((pp) => pp.id === expandedId) : null;
  const archivedCount = archived ? archived.length : null;

  return (
    <section>
      <SectionHeader eyebrow="Saved & archived" rightLabel="Bookmarks and your archived polls" />

      <div style={savedTabRowStyle} role="tablist" aria-label="Saved and archived filter">
        {SAVED_TABS.map((t) => {
          const on = tab === t.key;
          const label = (t.key === 'archived' && archivedCount != null) ? `Archived (${archivedCount})` : t.label;
          return (
            <button
              key={t.key} type="button" role="tab" aria-selected={on}
              onClick={() => { if (t.key !== tab) setTab(t.key); }}
              style={{
                padding: '6px 14px', borderRadius: 'var(--cl-radius-pill)', border: 'none',
                background: on ? 'var(--cl-accent)' : 'transparent',
                color: on ? 'white' : 'var(--cl-text-light)',
                fontSize: 'var(--cl-text-sm)', fontWeight: 700, cursor: 'pointer',
                fontFamily: 'var(--cl-font-sans)',
              }}
            >{label}</button>
          );
        })}
      </div>

      {expandedCard && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <button type="button" onClick={() => setExpandedId(null)} style={savedCloseBtn}>✕ Close</button>
          </div>
          <FeedCard
            card={expandedCard}
            kind={tab}
            isCommentsOpen={openCommentId === expandedCard.id}
            onToggleComments={() => setOpenCommentId((prev) => (prev === expandedCard.id ? null : expandedCard.id))}
            signedIn={!!citizen}
            onLoginRequired={() => {}}
            onCardUpdated={handleCardUpdated}
            onMutated={loadSaved}
            citizenViewer={citizen}
          />
        </div>
      )}
      {expandedArchived && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <button type="button" onClick={() => setExpandedId(null)} style={savedCloseBtn}>✕ Close</button>
          </div>
          <MyPollRow poll={expandedArchived} filter="archived" busy={false} onClose={() => {}} onOpenPage={onOpenPage} />
        </div>
      )}

      {isSavedTab && (
        <>
          {loading && <div style={savedMutedStyle}>Loading your saved {tab === 'post' ? 'posts' : 'polls'}…</div>}
          {error && !loading && <div style={{ color: '#c33333', fontSize: 'var(--cl-text-sm)' }}>Couldn't load: {error}</div>}
          {!loading && !error && items && items.length === 0 && (
            <EmptyState
              icon={<ChatCircleDots size={36} color="default" />}
              headline={tab === 'post' ? 'No saved posts yet' : 'No saved polls yet'}
              body={'Tap the ⋮ menu on any post or poll and choose Save. Your bookmarks collect here so you can find them later.'}
              dense
            />
          )}
          {!loading && !error && items && items.length > 0 && (
            <>
              <div style={SHELF_STYLE}>
                <div style={savedGridStyle}>
                  {items.map((card) => (
                    <CompactTile
                      key={card.id}
                      tag={POLL_KIND_LABEL[card.kind] || (tab === 'post' ? 'Post' : 'Poll')}
                      title={tab === 'post' ? (card.body || '(no text)') : (card.question || '(no question)')}
                      author={card.author || 'Citizen'}
                      meta={tab === 'post'
                        ? `${card.comment_count || 0} comment${card.comment_count === 1 ? '' : 's'}`
                        : `${card.total_votes || 0} vote${card.total_votes === 1 ? '' : 's'}`}
                      onClick={() => setExpandedId((prev) => (prev === card.id ? null : card.id))}
                    />
                  ))}
                </div>
              </div>
              {hasMore && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                  <button type="button" onClick={loadMore} disabled={loadingMore} style={savedShowMoreBtn}>
                    {loadingMore ? 'Loading…' : 'Show more'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'archived' && (
        <>
          {archLoading && <div style={savedMutedStyle}>Loading your archived polls…</div>}
          {archError && !archLoading && <div style={{ color: '#c33333', fontSize: 'var(--cl-text-sm)' }}>Couldn't load: {archError}</div>}
          {!archLoading && !archError && archived && archived.length === 0 && (
            <EmptyState
              icon={<ChatCircleDots size={36} color="default" />}
              headline="Nothing in the archive"
              body="When you close a poll — or a rep claims the page where you posted one — it shows up here."
              dense
            />
          )}
          {!archLoading && !archError && archived && archived.length > 0 && (
            <div style={SHELF_STYLE}>
              <div style={savedGridStyle}>
                {archived.map((poll) => {
                  const inner = poll.poll || {};
                  return (
                    <CompactTile
                      key={poll.id}
                      tag="Archived"
                      title={inner.question || '(no question)'}
                      author={poll.target_official_id || 'rep page'}
                      meta={`${inner.total_votes || 0} vote${inner.total_votes === 1 ? '' : 's'}`}
                      onClick={() => setExpandedId((prev) => (prev === poll.id ? null : poll.id))}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const savedTabRowStyle = {
  display: 'inline-flex', gap: 4, padding: 4,
  background: 'var(--cl-card)', border: '1px solid var(--cl-border)',
  borderRadius: 'var(--cl-radius-pill)', marginBottom: 12,
};
const savedGridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, padding: 2,
};
const savedMutedStyle = { color: 'var(--cl-text-light)', fontSize: 'var(--cl-text-sm)' };
const savedShowMoreBtn = {
  padding: '6px 16px', border: '1px solid var(--cl-border)', background: 'var(--cl-card)',
  color: 'var(--cl-text)', borderRadius: 'var(--cl-radius-pill)', fontSize: '0.8rem',
  fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--cl-font-sans)',
};
const savedCloseBtn = {
  padding: '4px 12px', border: '1px solid var(--cl-border)', background: 'var(--cl-card)',
  color: 'var(--cl-text-light)', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
  cursor: 'pointer', fontFamily: 'var(--cl-font-sans)',
};


function MyPollsSection({ citizen, onOpenPage }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingClose, setPendingClose] = useState(null); // poll id

  const reload = async () => {
    setLoading(true);
    setError(null);
    const { data: d, error: e } = await fetchMyCitizenPolls({ status: 'all' });
    if (e) {
      setError(e);
      setLoading(false);
      return;
    }
    setData(d);
    setLoading(false);
  };

  useEffect(() => {
    if (!citizen) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citizen?.id]);

  if (!citizen) return null;

  const active = data?.active || [];
  const visible = active;

  const handleClose = async (poll) => {
    if (!window.confirm("Close this poll? It'll move to your Archived list and you can post a new poll on this page.")) return;
    setPendingClose(poll.id);
    const { error: e } = await closeCitizenPoll(poll.id);
    setPendingClose(null);
    if (e) {
      window.alert(`Couldn't close: ${e}`);
      return;
    }
    reload();
  };

  return (
    <section>
      <SectionHeader
        eyebrow="My polls"
        rightLabel="Your active polls on rep pages"
      />

      {loading && (
        <div style={{ color: 'var(--cl-text-light)', fontSize: 'var(--cl-text-sm)' }}>
          Loading your polls…
        </div>
      )}
      {error && !loading && (
        <div style={{ color: '#c33333', fontSize: 'var(--cl-text-sm)' }}>
          Couldn't load: {error}
        </div>
      )}
      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon={<ChatCircleDots size={36} color="default" />}
          headline="You haven't started a poll yet"
          body="Find a rep whose page is unclaimed and start a poll on it. Your polls live there until the rep joins CivicView. Closed and archived polls move to your Saved & archived section below."
          dense
        />
      )}
      {!loading && !error && visible.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map((poll) => (
            <MyPollRow
              key={poll.id}
              poll={poll}
              filter="active"
              busy={pendingClose === poll.id}
              onClose={() => handleClose(poll)}
              onOpenPage={onOpenPage}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MyPollRow({ poll, filter, busy, onClose, onOpenPage }) {
  const inner = poll.poll || {};
  const target = poll.target_official_id;
  const archiveLabel = (() => {
    switch (poll.archived_reason) {
      case 'rep_claimed':    return 'Rep claimed page';
      case 'citizen_closed': return 'You closed it';
      case 'superseded':     return 'Auto-archived (page at cap)';
      case 'reported':       return 'Removed by moderation';
      default:               return 'Archived';
    }
  })();
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 700 }}>
            {filter === 'active' ? 'Active on page' : archiveLabel}
            {target && ` · ${target}`}
          </div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--cl-text)', marginTop: 4, lineHeight: 1.3 }}>
            {inner.question || '(no question)'}
          </div>
        </div>
      </div>
      {/* Top option summary */}
      {inner.options && inner.options.length > 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
          {(() => {
            const total = inner.total_votes || 0;
            const top = [...inner.options].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))[0];
            const pct = total > 0 ? Math.round((100 * (top.vote_count || 0)) / total) : 0;
            return total > 0
              ? `Leading: "${top.text}" · ${pct}% (${total} vote${total === 1 ? '' : 's'})`
              : 'No votes yet';
          })()}
          {' · '}
          {poll.comment_count || 0} comment{poll.comment_count === 1 ? '' : 's'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {filter === 'active' && (
          <>
            {onOpenPage && target && (
              <button
                type="button"
                onClick={() => onOpenPage(target)}
                style={myPollPrimaryBtn}
              >
                View on page →
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={myPollSecondaryBtn}
            >
              {busy ? 'Closing…' : 'Close poll'}
            </button>
          </>
        )}
        {filter === 'archived' && poll.archived_reason !== 'rep_claimed' && onOpenPage && target && (
          // Pre-claim archives keep the "View on page" link until the
          // rep claims; once rep_claimed, the link doesn't carry the
          // user to the right place anymore (the page surface no
          // longer shows citizen polls).
          <button
            type="button"
            onClick={() => onOpenPage(target)}
            style={myPollSecondaryBtn}
          >
            View on page →
          </button>
        )}
      </div>
    </div>
  );
}

const myPollPrimaryBtn = {
  padding: '6px 14px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--cl-accent)',
  color: 'white',
  fontWeight: 700,
  fontSize: '0.78rem',
  cursor: 'pointer',
  fontFamily: 'var(--cl-font-sans)',
};

const myPollSecondaryBtn = {
  padding: '6px 14px',
  border: '1px solid var(--cl-border)',
  borderRadius: 8,
  background: 'white',
  color: 'var(--cl-text)',
  fontWeight: 600,
  fontSize: '0.78rem',
  cursor: 'pointer',
  fontFamily: 'var(--cl-font-sans)',
};
