'use client';

import { useEffect, useMemo, useState } from 'react';
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
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '24px 24px 48px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Top-left back-to-map pill — primary escape hatch. The Close ×
            in the welcome header is preserved as a secondary affordance,
            but this pill is much more obvious. Mirrors the design system
            "ambient floating chrome" treatment used on MapView. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              alignSelf: 'flex-start',
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
            Back to map
          </button>
        )}

        {/* Welcome header */}
        <WelcomeHeader
          citizen={citizen}
          greeting={greeting}
          dateLabel={dateLabel}
          onClose={onClose}
        />

        {/* Two-column layout: left = My Reps + Upcoming + Recent, right
            = Ballot + Activity stats. Desktop keeps the original 2:1
            split. Compact viewports (mobile portrait + tablet) drop to
            a single column so the right rail's stats grid + ballot
            card aren't squeezed past their content width. */}
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
          </div>

          {/* RIGHT RAIL */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
function WelcomeHeader({ citizen, greeting, dateLabel, onClose }) {
  const firstName = (citizen?.name || '').split(' ')[0] || 'there';
  const district = citizen?.district || '—';
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
        <Avatar name={citizen?.name} size="lg" />
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
              {citizen?.name || 'Citizen'}
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
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dashboard"
            style={{
              marginTop: 10,
              background: 'transparent',
              border: 'none',
              color: 'var(--cl-text-light)',
              fontSize: 'var(--cl-text-xs)',
              cursor: 'pointer',
              fontFamily: 'var(--cl-font-sans)',
            }}
          >
            Close ×
          </button>
        )}
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
