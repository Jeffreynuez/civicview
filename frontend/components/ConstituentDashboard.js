'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { partyInfo } from '@/lib/party';
import {
  Avatar,
  PartyChip,
  Button,
  CheckCircle,
  CalendarCheck,
  Calendar,
  ChatCircleDots,
  Newspaper,
  MapPin,
  ArrowRight,
} from './ui';
import { useTrackedOfficials } from '../lib/trackedOfficials';
import { useTrackedBills } from '../lib/trackedBills';
import { useTrackedElections } from '../lib/trackedElections';
import { useFeaturedTracked } from '../lib/featuredTracked';
import TrackedManager from './TrackedManager';
import BillReactions from './bills/BillReactions';
import { useViewerGeo } from './bills/BillScope';
import ActivityArchive from './ActivityArchive';
import { fetchMyCitizenPolls, closeCitizenPoll, fetchSaved, fetchPollsFeed, fetchPostsFeed, fetchPagePosts, saveStartPage, fetchDigestPreview, saveContactEmail, dismissContactEmailPrompt, fetchCitizenDashboard } from '../lib/pagesApi';
import { notificationLink, openDeepLink, pollDeepLink, postDeepLink } from '../lib/deepLinks';
import { refreshCitizenAuth } from '../lib/citizenAuth';
import FeedCard from './polls/FeedCard';
import HiddenByModeration from './HiddenByModeration';
import Navbar from './Navbar';
import './ConstituentDashboard.css';
import TwoFactorSection from './TwoFactorSection';
import BillingSection from './BillingSection';
import DemographicProfileSection from './DemographicProfileSection';
import VerificationSection from './VerificationSection';
import LocationSection from './account/LocationSection';
import { formatDistrict } from '../lib/usStates';
import ServedAsSection from './ServedAsSection';
import NotificationSettings from './NotificationSettings';
import { asUtc, serverDate } from '@/lib/serverTime';

/**
 * ConstituentDashboard: the signed-in citizen's own page.
 *
 * Layout (2026-10-26 redesign; Jeffrey asked for the same treatment as
 * the admin page, as the dashboard "needs a UI overhaul"):
 *   - pinned at the top: the compact navbar, then one slim bar with Back
 *     and four underlined tabs (Overview, Following, Activity, Settings)
 *     that stays on one row on a phone;
 *   - a compact greeting: avatar, greeting, district and the Verified or
 *     Demo badge; on the Overview also one line of counts (following,
 *     and this month's comments and poll votes) and the quick links;
 *   - Overview, time-sensitive first: Coming up, then the four starred
 *     picks as compact cards (two across on desktop) under one Manage
 *     link, then Recent activity, then My polls and Saved, each one
 *     line when empty;
 *   - Settings in five groups (Sign-in and security, Your area,
 *     Notifications, Subscription and profile, Moderation) with a pinned
 *     list of them on desktop, and Delete account in its own card at the
 *     very bottom.
 * Before this, a tall greeting card held the date and the Delete account
 * link, the tabs were pills that turned into circles on a phone, and the
 * Overview repeated "Manage tracked" four times above Coming up.
 *
 * The Overview loads its own data from GET /api/activity/dashboard
 * (2026-10-19) when the parent passes no `upcoming` or `recent`: this
 * month's counts, Recent activity (the last 7 days of the citizen's
 * notifications) and Coming up (their state's voting deadlines, events
 * from officials they track, polls they voted in that close soon).
 *
 * Data contract:
 *   citizen        citizen me payload from useCitizenAuth (required).
 *                  Shape: { name, email, district, state, city, ... }
 *   trackedReps    optional array overriding the tracked officials in
 *                  the "following" count (tests).
 *   upcoming       array of upcoming items. Each:
 *                  { kind: 'vote'|'town-hall'|'event'|'poll-closing'|'ballot',
 *                    title, when (iso), meta?, onClick? }
 *                  Pass [] for the "nothing coming up" note.
 *   recent         array of activity-feed items. Each:
 *                  { kind: 'post'|'event'|'reply'|'voted'|'bill'|'election'|
 *                    'moderation'|'page', title, body?, author?, whenIso,
 *                    onClick? }
 *                  Pass [] for the "no recent activity" note.
 *   ballot         { electionName, when (iso), races, onView? }
 *                  Optional; null hides the ballot card.
 *   onNavigate     { openOfficial, openPage, compareCandidates,
 *                    pollingPlace, ballot, viewActivity, ... }
 *                  Each entry is an optional handler from the parent.
 *   onClose        () => void, optional. Shows Back in the tab bar.
 *   initialView    'overview' | 'tracked' | 'activity' | 'settings'
 *   navbarProps    passed to the embedded compact Navbar.
 */
const DASHBOARD_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tracked', label: 'Following' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

export default function ConstituentDashboard({
  citizen,
  trackedReps = null,    // null = "load from store"; pass [] to override empty
  upcoming = null,
  recent = null,
  ballot = null,
  onNavigate = {},
  onClose,
  // Which view to open on. The parent uses 'settings' to deep-link
  // straight to Settings (a /?open=settings URL, reminder emails).
  initialView = 'overview',
  // Navbar props, passed straight through to the embedded compact
  // Navbar. The parent (app/page.js) wires login / logout / tracked /
  // subscribe / help-build / feedback so the user can jump anywhere
  // without backing out of the dashboard first. We deliberately don't
  // accept onCitizenDashboard (we're already here) or onOpenCommittees.
  navbarProps = {},
}) {
  // Everything the citizen follows, from the reactive, server-backed
  // stores: the "following" count in the greeting.
  const { list: trackedAll } = useTrackedOfficials();
  const { list: trackedBillList } = useTrackedBills();
  const { list: trackedElectionList } = useTrackedElections();
  const followingCount = (trackedReps !== null ? trackedReps.length : (trackedAll || []).length)
    + (trackedBillList || []).length + (trackedElectionList || []).length;
  const greeting = greetingFor(new Date());

  const [view, setView] = useState(
    DASHBOARD_TABS.some((t) => t.id === initialView) ? initialView : 'overview',
  );

  // The Overview's own data (2026-10-19). Loaded when the Overview is
  // shown, again each time it is reopened, so a new vote or reply shows
  // up without a reload. Keyed on who is signed in rather than the
  // citizen object, which the home page rebuilds on every render.
  const citizenKey = citizen ? String(citizen.id || citizen.email || 'me') : null;
  const [dash, setDash] = useState(null);
  useEffect(() => {
    if (view !== 'overview' || !citizenKey) return undefined;
    let cancelled = false;
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    fetchCitizenDashboard({ since }).then(({ data }) => {
      if (!cancelled && data) setDash(data);
    });
    return () => { cancelled = true; };
  }, [view, citizenKey]);
  const upcomingItems = useMemo(
    () => (upcoming !== null ? upcoming : dash ? (dash.upcoming || []).map(upcomingItemFromApi) : null),
    [upcoming, dash],
  );
  const recentItems = useMemo(
    () => (recent !== null ? recent : dash ? (dash.recent || []).map(recentItemFromNotification).filter(Boolean) : null),
    [recent, dash],
  );

  // The pinned header's height (navbar plus tab bar), so sticky parts
  // and scroll targets sit just below it on every screen size.
  const headRef = useRef(null);
  const [pinHeight, setPinHeight] = useState(100);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return undefined;
    const measure = () => setPinHeight(Math.round(el.getBoundingClientRect().height) || 100);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Switching tabs from the pinned bar after scrolling down brings the
  // new tab's top into view instead of leaving you partway down it.
  const panelRef = useRef(null);
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    const el = panelRef.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < pinHeight) el.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const tabRefs = useRef({});
  // Arrow keys, Home and End move between the tabs (selection follows
  // focus), counted from the tab that has focus.
  const onTabKey = (e) => {
    const focused = DASHBOARD_TABS.findIndex((t) => tabRefs.current[t.id] === e.target);
    const i = focused >= 0 ? focused : DASHBOARD_TABS.findIndex((t) => t.id === view);
    let next = null;
    if (e.key === 'ArrowRight') next = DASHBOARD_TABS[(i + 1) % DASHBOARD_TABS.length];
    else if (e.key === 'ArrowLeft') next = DASHBOARD_TABS[(i - 1 + DASHBOARD_TABS.length) % DASHBOARD_TABS.length];
    else if (e.key === 'Home') next = DASHBOARD_TABS[0];
    else if (e.key === 'End') next = DASHBOARD_TABS[DASHBOARD_TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    setView(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const quickLinks = [
    { label: 'Compare candidates', onClick: onNavigate.compareCandidates, Icon: Newspaper },
    { label: 'Your polling place', onClick: onNavigate.pollingPlace, Icon: MapPin },
  ].filter((l) => l.onClick);

  return (
    <div className="cvd" style={{ '--cvd-pin': `${pinHeight}px` }}>
      {/* Navbar and tab bar pinned together. The dashboard mounts inside
          a `position: fixed; overflowY: auto` wrapper (app/page.js,
          /polls, PageChrome), so sticky anchors to that scroll context.
          Back returns to whichever surface opened the dashboard; the
          navbar's logo does the same through onHome. */}
      <div className="cvd-head" ref={headRef}>
        <Navbar compact {...navbarProps} onHome={onClose} />
        <div className="cvd-bar">
          <div className="cvd-bar__inner">
            {onClose && (
              <>
                <button type="button" className="cvd-back" onClick={onClose} aria-label="Back">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  <span className="cvd-back__label">Back</span>
                </button>
                <span className="cvd-back__sep" aria-hidden="true" />
              </>
            )}
            <div className="cvd-tabs" role="tablist" aria-label="Dashboard sections" onKeyDown={onTabKey}>
              {DASHBOARD_TABS.map((t) => {
                const on = view === t.id;
                return (
                  <button
                    key={t.id}
                    ref={(el) => { tabRefs.current[t.id] = el; }}
                    type="button"
                    role="tab"
                    id={`cvd-tab-${t.id}`}
                    aria-selected={on}
                    aria-controls="cvd-panel"
                    tabIndex={on ? 0 : -1}
                    className={`cvd-tab${on ? ' is-active' : ''}`}
                    onClick={() => setView(t.id)}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="cvd-body">
        <WelcomeHeader
          citizen={citizen}
          greeting={greeting}
          following={followingCount}
          counts={dash ? dash.counts : null}
          links={quickLinks}
          full={view === 'overview'}
        />

        {/* Demo-sunset contact ask (PRD §4, increment 2). Sits above the
            tabs' content so it is reachable from every view, and hides
            itself the moment it is answered either way. */}
        <ContactEmailPrompt citizen={citizen} />

        <div
          ref={panelRef}
          className="cvd-panel"
          role="tabpanel"
          id="cvd-panel"
          aria-labelledby={`cvd-tab-${view}`}
        >
          {view === 'overview' && (
            <OverviewPanel
              citizen={citizen}
              upcomingItems={upcomingItems}
              recentItems={recentItems}
              ballot={ballot}
              onNavigate={onNavigate}
              onManage={() => setView('tracked')}
              onSeeAllActivity={onNavigate.viewActivity || (() => setView('activity'))}
            />
          )}

          {view === 'tracked' && (
            <section style={{ maxWidth: 860 }} aria-labelledby="cvd-tracked-title">
              <SectionHeader
                id="cvd-tracked-title"
                title="Following"
                note="Everything you follow. Star one in each group to feature it on your Overview."
              />
              <TrackedManager variant="page" onMemberPick={onNavigate.openOfficial} />
            </section>
          )}

          {view === 'activity' && (
            <section style={{ maxWidth: 720 }} aria-labelledby="cvd-activity-title">
              <SectionHeader
                id="cvd-activity-title"
                title="Activity"
                note="Your comments and the replies to them, kept even after you clear the bell."
              />
              <ActivityArchive identity="citizen" />
            </section>
          )}

          {view === 'settings' && <SettingsPanel citizen={citizen} pin={pinHeight} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Overview: Coming up, Following, Recent activity, My polls, Saved
// ─────────────────────────────────────────────────────────────────
function OverviewPanel({ citizen, upcomingItems, recentItems, ballot, onNavigate, onManage, onSeeAllActivity }) {
  const myPolls = useMyCitizenPolls(Boolean(citizen));
  return (
    <div className="cvd-overview">
      {/* No "See district calendar" link (2026-10-19): the parent's
          handler only closed the dashboard. */}
      <UpcomingInDistrict items={upcomingItems} />
      {ballot && <YourBallotCard ballot={ballot} onView={ballot.onView || onNavigate.ballot} />}
      <FollowedGrid onManage={onManage} onOpenOfficial={onNavigate.openOfficial} />
      <RecentActivity items={recentItems} onSeeAll={onSeeAllActivity} />
      <div className="cvd-lines">
        <MyPollsSection citizen={citizen} onOpenPage={onNavigate.openPage} myPolls={myPolls} />
        <SavedSection citizen={citizen} onOpenPage={onNavigate.openPage} myPolls={myPolls} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Settings: five groups under one heading style, a pinned list of them
// on desktop (stacked on a phone), and Delete account at the very
// bottom in its own card (2026-10-26).
// ─────────────────────────────────────────────────────────────────
const SETTINGS_GROUPS = [
  { id: 'security', label: 'Sign-in and security', note: 'Two-factor sign-in and identity verification.' },
  { id: 'area', label: 'Your area', note: 'Where your likes, votes and comments are counted.' },
  { id: 'notifications', label: 'Notifications', note: 'What reaches you, and when.' },
  { id: 'profile', label: 'Subscription and profile', note: 'Your plan, your start page and optional profile details.' },
  { id: 'moderation', label: 'Moderation', note: 'Anything of yours that moderation hid, with a way to appeal.' },
];

function SettingsPanel({ citizen, pin }) {
  const [active, setActive] = useState(SETTINGS_GROUPS[0].id);

  // Highlight the group in view in the desktop list.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const els = SETTINGS_GROUPS.map((g) => document.getElementById(`set-${g.id}`)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (seen.length) setActive(seen[0].target.id.replace(/^set-/, ''));
    }, { rootMargin: `-${pin + 16}px 0px -55% 0px` });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pin]);

  const jump = (id) => {
    setActive(id);
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const body = {
    security: (
      <>
        <TwoFactorSection />
        <VerificationSection citizen={citizen} />
      </>
    ),
    area: <LocationSection />,
    notifications: <NotificationsSection />,
    profile: (
      <>
        <BillingSection citizen={citizen} />
        <StartPageSection citizen={citizen} />
        <ServedAsSection />
        <DemographicProfileSection />
      </>
    ),
    moderation: <HiddenByModerationSection citizen={citizen} />,
  };

  return (
    <div className="cvd-settings">
      <nav className="cvd-jump" aria-label="Settings groups">
        <p className="cvd-jump__label">Settings</p>
        <ul>
          {SETTINGS_GROUPS.map((g) => (
            <li key={g.id}>
              <button type="button" aria-current={active === g.id ? 'true' : undefined} onClick={() => jump(g.id)}>
                {g.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="cvd-groups">
        {SETTINGS_GROUPS.map((g) => (
          <section key={g.id} id={`set-${g.id}`} className="cvd-group" aria-labelledby={`set-${g.id}-title`}>
            <SectionHeader id={`set-${g.id}-title`} title={g.label} note={g.note} />
            <div className="cvd-group__body">{body[g.id]}</div>
          </section>
        ))}
        <DeleteAccountCard />
      </div>
    </div>
  );
}

// Self-serve account deletion (Task #81). The full warnings, the choice
// between archiving and deleting, and the email confirmation live on
// /account/delete itself; this card only leads there.
function DeleteAccountCard() {
  return (
    <section className="cvd-danger" aria-labelledby="set-delete-title">
      <h2 className="cvd-danger__title" id="set-delete-title">Delete account</h2>
      <p className="cvd-danger__text">
        Close your CivicView account. The next page lists what is removed and
        lets you choose between archiving the account for 30 days and deleting
        it right away.
      </p>
      <a className="cvd-danger__btn" href="/account/delete">Delete account</a>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Greeting (2026-10-26 redesign): avatar, greeting, district and the
// Verified or Demo badge on one line. On the Overview (`full`) it adds
// one line of counts and the quick links. The old card also held
// today's date and the Delete account link, which now sits at the
// bottom of Settings.
// ─────────────────────────────────────────────────────────────────
function WelcomeHeader({ citizen, greeting, following, counts, links, full }) {
  // Accept either the mapped shape ({name, district}) the home mount
  // passes OR the raw citizen object ({display_name,
  // congressional_district}) the /polls mount passes; otherwise the
  // greeting falls back to 'there'/'Citizen' depending on which
  // surface opened the dashboard.
  const displayName = citizen?.display_name || citizen?.name || '';
  const firstName = displayName.split(' ')[0] || 'there';
  const district = formatDistrict(citizen?.congressional_district || citizen?.district) || '';
  const city = citizen?.city || '';
  const state = citizen?.state || '';
  const place = [city, state].filter(Boolean).join(', ');
  // Until the counts load they read as an ellipsis, never a made-up 0.
  const show = (v) => (counts ? (Number(v) || 0) : '…');
  const comments = show(counts?.comments_left);
  const votes = show(counts?.polls_cast);

  return (
    <header className="cvd-hello">
      <Avatar name={displayName || undefined} size="md" />
      <div className="cvd-hello__text">
        <h1 className="cvd-hello__title">
          Good {greeting}, <span>{firstName}</span>.
        </h1>
        <div className="cvd-hello__meta">
          {(district || place) && (
            <span>{[district, place].filter(Boolean).join(' · ')}</span>
          )}
          {/* "Verified citizen" only for a real verification (ID.me),
              read from the server's verified_person rule; every other
              account is a demo account today, and is called one
              (2026-10-16). Revisit if non-demo sign-ups open without
              verification. */}
          {citizen?.verified_person ? <VerifiedCitizenBadge /> : <DemoAccountBadge />}
        </div>
        {full && (
          <p className="cvd-hello__stats">
            <strong className="cl-num">{following}</strong> following
            {' · '}
            <strong className="cl-num">{comments}</strong> {comments === 1 ? 'comment' : 'comments'} and{' '}
            <strong className="cl-num">{votes}</strong> poll {votes === 1 ? 'vote' : 'votes'} in {currentMonth()}
          </p>
        )}
      </div>
      {full && links.length > 0 && (
        <nav className="cvd-hello__links" aria-label="Quick links">
          {links.map((l) => (
            <button key={l.label} type="button" className="cvd-link" onClick={l.onClick}>
              <l.Icon size={14} color="muted" />
              {l.label}
            </button>
          ))}
        </nav>
      )}
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
      <CheckCircle size={12} color="up" />
      Verified citizen
    </span>
  );
}

// Neutral on purpose: a demo account is not a warning, just not verified.
function DemoAccountBadge() {
  return (
    <span
      title="Demo accounts are self-attested and not identity-verified"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        background: 'var(--cl-bg-soft, #f4f6f8)',
        color: 'var(--cl-text-light)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-pill)',
        fontSize: 'var(--cl-text-2xs)',
        fontWeight: 700,
      }}
    >
      Demo account
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Party helpers for the Following cards
// ─────────────────────────────────────────────────────────────────

// The PartyChip key for an official's party: a known code as is (so
// "NP" stays Nonpartisan, lib/party.js), else the first letter of a
// full name such as "Republican". No party, no chip.
function dashboardPartyKey(party) {
  const raw = String(party || '').trim();
  if (!raw) return '';
  const meta = partyInfo(raw);
  if (meta && meta.label !== meta.code) return meta.code;
  return raw.slice(0, 1).toUpperCase();
}

// Avatar tints exist for R, D and I; every other label uses I's, as
// everywhere else.
function avatarParty(key) {
  if (!key) return undefined;
  return key === 'R' || key === 'D' ? key : 'I';
}

// ─────────────────────────────────────────────────────────────────
// Upcoming in district
// ─────────────────────────────────────────────────────────────────
const UPCOMING_KIND_META = {
  vote:           { label: 'House vote',    Icon: Newspaper },
  'town-hall':    { label: 'Town hall',     Icon: MapPin    },
  event:          { label: 'Event',         Icon: MapPin    },
  'poll-closing': { label: 'Poll closing',  Icon: CalendarCheck },
  ballot:         { label: 'Voting deadline', Icon: CalendarCheck },
};

// One row of GET /api/activity/dashboard's `upcoming` (2026-10-19).
// A voting deadline opens the state's own election site; an event its
// RSVP link, else its page; a poll that is about to close opens the
// poll.
function upcomingItemFromApi(u) {
  let onClick;
  if (u.kind === 'ballot' && u.url) {
    onClick = () => { try { window.open(u.url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ } };
  } else if (u.kind === 'event') {
    onClick = u.url
      ? () => { try { window.open(u.url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ } }
      : (u.official_id ? () => openDeepLink(postDeepLink(u.official_id)) : undefined);
  } else if (u.kind === 'poll-closing') {
    onClick = () => openDeepLink(pollDeepLink(u.official_id, u.poll_id, u.post_id));
  }
  return { id: u.id, kind: u.kind, title: u.title, when: u.when, meta: u.meta, onClick };
}

// One notification row (the same rows the bell shows) as a Recent
// activity item, worded like the bell (2026-10-19).
function recentItemFromNotification(n) {
  const p = n.payload || {};
  const open = () => openDeepLink(notificationLink(n.kind, p));
  const whenIso = asUtc(n.created_at);
  const base = { id: n.id, whenIso, onClick: notificationLink(n.kind, p) ? open : undefined };
  switch (n.kind) {
    case 'tracked_post':
      return { ...base, kind: 'post', author: p.official_name || null,
        title: p.has_poll ? 'Posted a new update with a poll' : 'Posted a new update',
        body: p.preview || p.question || null };
    case 'tracked_event':
      return { ...base, kind: 'event', author: p.official_name || null,
        title: 'Scheduled an upcoming event', body: p.title || p.preview || null };
    case 'reply':
      return { ...base, kind: 'reply',
        title: `${p.replier_name || 'Someone'} replied to your comment`, body: p.preview || null };
    case 'poll_results':
      return { ...base, kind: 'voted', title: 'Results are in for a poll you voted in',
        body: p.question || null };
    case 'bill_update':
      return { ...base, kind: 'bill',
        title: `${p.citation || 'A bill you track'}${p.change_kind === 'status' ? ' had a status change'
          : p.change_kind === 'vote' ? ' had a recorded vote' : ' has a new action'}`,
        body: p.action || null };
    case 'election_reminder':
      return { ...base, kind: 'election', title: p.title || 'Election reminder', body: p.body || null };
    // Its own kind (2026-10-26): it used to borrow 'page' and read
    // "Page change" in Recent activity.
    case 'moderation_hidden':
      return { ...base, kind: 'moderation',
        title: p.hide_reason === 'auto_hidden'
          ? 'Something of yours was hidden after community reports'
          : 'Something of yours was hidden by a moderator',
        body: p.preview || null };
    default:
      if (p.text || p.title) {
        return { ...base, kind: 'page', title: p.title || p.text, body: p.title && p.text ? p.text : null };
      }
      return null;
  }
}


// Coming up leads the Overview (2026-10-26): the time-sensitive things
// first, as rows in one card.
function UpcomingInDistrict({ items }) {
  const hasItems = items && items.length > 0;
  return (
    <section aria-labelledby="cvd-upcoming-title">
      <SectionHeader id="cvd-upcoming-title" title="Coming up" />
      {items === null ? (
        <div className="cvd-empty">Loading…</div>
      ) : hasItems ? (
        <div className="cvd-list">
          {items.slice(0, 5).map((item, i) => (
            <UpcomingRow key={item.id || `${item.kind}-${i}`} item={item} />
          ))}
        </div>
      ) : (
        <div className="cvd-empty">
          <CalendarCheck size={18} color="muted" />
          <span>
            Nothing coming up yet. Voting deadlines for your state, events from
            officials you follow and polls you voted in that are about to close show up here.
          </span>
        </div>
      )}
    </section>
  );
}

function UpcomingRow({ item }) {
  const meta = UPCOMING_KIND_META[item.kind] || { label: item.kind, Icon: Calendar };
  const date = item.when ? new Date(item.when) : null;
  const dayLabel = date ? formatShortDay(date) : null;
  const Tag = item.onClick ? 'button' : 'div';
  return (
    <Tag
      className={`cvd-row${item.onClick ? ' is-link' : ''}`}
      {...(item.onClick ? { type: 'button', onClick: item.onClick } : {})}
    >
      {dayLabel && (
        <span className="cvd-date" aria-hidden="true">
          <span className="cvd-date__m" style={{ display: 'block' }}>{dayLabel.month}</span>
          <span className="cvd-date__d cl-num" style={{ display: 'block' }}>{dayLabel.day}</span>
        </span>
      )}
      <span className="cvd-row__main">
        <span className="cvd-row__kicker is-accent">
          <meta.Icon size={12} color="accent" />
          {meta.label}
          {date ? <span style={srOnly}>, {date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span> : null}
        </span>
        <span className="cvd-row__title" style={{ display: 'block' }}>{item.title}</span>
        {item.meta && <span className="cvd-row__body" style={{ display: 'block' }}>{item.meta}</span>}
      </span>
      {item.onClick && <span className="cvd-row__chev"><ArrowRight size={14} color="muted" /></span>}
    </Tag>
  );
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
};

// ─────────────────────────────────────────────────────────────────
// Recent activity feed
// ─────────────────────────────────────────────────────────────────
function RecentActivity({ items, onSeeAll }) {
  const hasItems = items && items.length > 0;
  return (
    <section aria-labelledby="cvd-recent-title">
      <SectionHeader
        id="cvd-recent-title"
        title="Recent activity"
        meta="Last 7 days"
        action={onSeeAll && hasItems ? { label: 'See all', onClick: onSeeAll } : null}
      />
      {items === null ? (
        <div className="cvd-empty">Loading…</div>
      ) : hasItems ? (
        <div className="cvd-list">
          {items.slice(0, 5).map((item, i) => (
            <ActivityRow key={item.id || i} item={item} />
          ))}
        </div>
      ) : (
        <div className="cvd-empty">
          <ChatCircleDots size={18} color="muted" />
          <span>
            No recent activity yet. Posts and events from people you follow,
            results of polls you voted in, replies to your comments and election
            reminders from the last 7 days show up here.
          </span>
        </div>
      )}
    </section>
  );
}

const ACTIVITY_KICKER = {
  reply: 'Reply on your comment',
  voted: 'Poll results',
  bill: 'Bill update',
  election: 'Election reminder',
  moderation: 'Moderation',
  page: 'Page change',
};

function ActivityRow({ item }) {
  const kicker = ACTIVITY_KICKER[item.kind]
    || (item.kind === 'event'
      ? (item.author ? `${item.author} · New event` : 'New event')
      : (item.author ? `${item.author} · New post` : 'New post'));
  const tone = item.kind === 'reply' ? ' is-accent'
    : (item.kind === 'voted' || item.kind === 'moderation') ? ' is-warning' : '';
  const Tag = item.onClick ? 'button' : 'div';
  return (
    <Tag
      className={`cvd-row${item.onClick ? ' is-link' : ''}`}
      {...(item.onClick ? { type: 'button', onClick: item.onClick } : {})}
    >
      <span className={`cvd-row__icon${tone === ' is-warning' ? ' is-warning' : ''}`} aria-hidden="true">
        {item.kind === 'reply' ? (
          <ChatCircleDots size={16} color="accent" />
        ) : item.kind === 'voted' ? (
          <CheckCircle size={16} color="warning" />
        ) : item.kind === 'moderation' ? (
          <ShieldIcon />
        ) : item.kind === 'event' ? (
          <MapPin size={16} color="accent" />
        ) : item.kind === 'election' ? (
          <CalendarCheck size={16} color="accent" />
        ) : (
          <Newspaper size={16} color="accent" />
        )}
      </span>
      <span className="cvd-row__main">
        <span className={`cvd-row__kicker${tone}`}>{kicker}</span>
        <span className="cvd-row__title" style={{ display: 'block' }}>{item.title}</span>
        {item.body && <span className="cvd-row__body" style={{ display: 'block' }}>{item.body}</span>}
      </span>
      {item.whenIso && <span className="cvd-row__when">{timeAgo(item.whenIso)}</span>}
    </Tag>
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
      icon={<CalendarCheck size={18} color="accent" />}
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
// Start-page preference (Task #102)
// ─────────────────────────────────────────────────────────────────

const START_PAGE_OPTIONS = [
  { value: 'home',      label: 'Home — map & officials' },
  { value: 'polls',     label: 'Polls feed' },
  { value: 'posts',     label: 'Posts feed' },
  { value: 'bills',     label: 'Bills & votes' },
  { value: 'dashboard', label: 'My dashboard' },
  { value: 'stats',     label: 'Stats' },
];

function StartPageSection({ citizen }) {
  const [value, setValue] = useState(citizen?.start_page || 'home');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone: 'ok'|'err', text }

  async function save(next) {
    const prev = value;
    setValue(next);
    setBusy(true);
    setNote(null);
    try {
      await saveStartPage(next === 'home' ? null : next);
      setNote({ tone: 'ok', text: 'Saved — applies the next time you open CivicView.' });
    } catch (err) {
      setValue(prev);
      setNote({ tone: 'err', text: 'Could not save your preference. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Start page">
      <p
        style={{
          margin: '0 0 10px',
          fontSize: 'var(--cl-text-sm)',
          color: 'var(--cl-text-muted)',
          lineHeight: 1.5,
        }}
      >
        Choose which page CivicView opens on when you arrive.
      </p>
      <select
        value={value}
        disabled={busy}
        onChange={(e) => save(e.target.value)}
        aria-label="Start page"
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--cl-border)',
          background: 'var(--cl-card)',
          color: 'var(--cl-text)',
          fontSize: 'var(--cl-text-sm)',
          fontFamily: 'var(--cl-font-sans)',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {START_PAGE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {note && (
        <p
          role="status"
          style={{
            margin: '8px 0 0',
            fontSize: 'var(--cl-text-xs)',
            color: note.tone === 'ok' ? 'var(--cl-success, #16a34a)' : 'var(--cl-danger, #dc2626)',
          }}
        >
          {note.text}
        </p>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Weekly civic digest opt-in (Task #104)
// ─────────────────────────────────────────────────────────────────

function ContactEmailPrompt({ citizen }) {
  // Demo-sunset contact ask (PRD §4, increment 2).
  //
  // WHY A CARD AND NOT A MODAL: this is a courtesy channel, not a
  // required step. A modal would interrupt someone who came here to do
  // something else, and interruption is how you teach people to dismiss
  // without reading — which is precisely the behavior that would leave
  // them unnotified when the sunset email actually matters.
  //
  // WHO SEES IT: unverified (i.e. demo) accounts that have no address on
  // file and have not already said no. Verified accounts are excluded
  // because their login email already reaches them; the whole problem is
  // the synthetic @demo-citizens.civicview.app login.
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null); // null | 'saved' | 'dismissed'

  const eligible = !!citizen
    && citizen.verified === false
    && !citizen.contact_email
    && !citizen.contact_email_prompt_dismissed_at;

  // `done` keeps the card mounted for one beat after a save so the user
  // gets a confirmation instead of a component that vanishes — the
  // refreshed /me makes `eligible` false on the next render pass.
  if (!eligible && done !== 'saved') return null;

  async function save(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setErr('Enter an email address first.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { error } = await saveContactEmail(trimmed);
      if (error) throw new Error(error);
      setDone('saved');
      // Refresh the shared auth store so every other consumer of the
      // citizen payload sees the new address without a page reload.
      refreshCitizenAuth();
    } catch {
      setErr('That doesn’t look like an email address. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await dismissContactEmailPrompt();
      setDone('dismissed');
      refreshCitizenAuth();
    } catch {
      // A failed dismissal is not worth an error message — the card
      // simply reappears next visit, which is the safe direction to
      // fail for a notice channel.
      setDone('dismissed');
    } finally {
      setBusy(false);
    }
  }

  if (done === 'saved') {
    return (
      <div
        role="status"
        style={{
          border: '1px solid var(--cl-border)',
          background: 'var(--cl-accent-soft, rgba(37, 99, 235, 0.08))',
          borderRadius: 'var(--cl-radius-md)',
          padding: '12px 16px',
          fontSize: 'var(--cl-text-sm)',
          color: 'var(--cl-text)',
        }}
      >
        Saved. We&rsquo;ll email you once, when it&rsquo;s time to move your
        account over, and you can use this address with Forgot password
        if you lose your sign-in.
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--cl-border)',
        background: 'var(--cl-card)',
        borderRadius: 'var(--cl-radius-md)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text)' }}>
            Where should we reach you?
          </div>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 'var(--cl-text-sm)',
              color: 'var(--cl-text-muted)',
              lineHeight: 1.5,
              maxWidth: '62ch',
            }}
          >
            Your demo account was created with a placeholder address that
            doesn&rsquo;t reach anyone. When identity verification opens, demo
            accounts get a limited window to move their comments, votes and
            reactions to a verified account. Add an email and we&rsquo;ll send
            you that one notice, and you can use it with Forgot password if
            you lose your sign-in. No newsletters, no marketing, and we
            don&rsquo;t share it.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          aria-label="Dismiss this reminder"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--cl-text-muted)',
            fontSize: 'var(--cl-text-lg)',
            lineHeight: 1,
            cursor: busy ? 'wait' : 'pointer',
            padding: '2px 4px',
          }}
        >
          ×
        </button>
      </div>
      <form onSubmit={save} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="email"
          value={value}
          onChange={(e) => { setValue(e.target.value); setErr(null); }}
          placeholder="you@example.com"
          disabled={busy}
          autoComplete="email"
          style={{
            flex: '1 1 240px',
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: 'var(--cl-radius-sm, 8px)',
            border: '1px solid ' + (err ? 'var(--cl-danger, #dc2626)' : 'var(--cl-border)'),
            fontSize: 'var(--cl-text-sm)',
            fontFamily: 'var(--cl-font-sans)',
            background: 'var(--cl-bg)',
            color: 'var(--cl-text)',
          }}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save email'}
        </Button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--cl-text-muted)',
            fontSize: 'var(--cl-text-sm)',
            textDecoration: 'underline',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          No thanks
        </button>
      </form>
      {err && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--cl-text-xs)', color: 'var(--cl-danger, #dc2626)' }}>
          {err}
        </p>
      )}
    </div>
  );
}


// Notification settings (2026-10-17): the same list as the bell's
// Settings, so it reads the same everywhere: what reaches you for each
// kind of alert, the weekly email digest, quiet hours and push timing.
// Reminder emails link here (/?open=settings). The digest's preview
// stays here, under the list.
function NotificationsSection() {
  const [preview, setPreview] = useState(null); // null | 'loading' | {empty,subject,html,reason}

  async function loadPreview() {
    setPreview('loading');
    try {
      const { data, error } = await fetchDigestPreview();
      if (error || !data) throw new Error('preview failed');
      setPreview(data);
    } catch {
      setPreview({ empty: true, reason: 'Couldn\u2019t load the preview. Try again.' });
    }
  }

  return (
    <Card title="Bell, push and email">
      <NotificationSettings variant="dashboard" />
      <button
        type="button"
        onClick={loadPreview}
        disabled={preview === 'loading'}
        style={{
          marginTop: 12,
          background: 'transparent',
          border: '1px solid var(--cl-border)',
          borderRadius: 8,
          padding: '6px 14px',
          color: 'var(--cl-text)',
          fontSize: 'var(--cl-text-sm)',
          fontFamily: 'var(--cl-font-sans)',
          cursor: 'pointer',
        }}
      >
        {preview === 'loading' ? 'Building preview\u2026' : 'Preview this week\u2019s digest'}
      </button>
      {preview && preview !== 'loading' && (
        preview.empty ? (
          <p style={{ margin: '10px 0 0', fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-muted)' }}>
            {preview.reason}
          </p>
        ) : (
          <div
            style={{
              marginTop: 12,
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              padding: '4px 12px',
              maxHeight: 320,
              overflowY: 'auto',
              background: '#fff',
            }}
            // Server-rendered digest HTML — same generator that feeds
            // Postmark, built exclusively from CivicView's own data
            // and HTML-escaped server-side.
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        )
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Local helpers (not exported)
// ─────────────────────────────────────────────────────────────────

// One heading style for every section of the dashboard (2026-10-26):
// the Overview sections, the Following and Activity tabs and the
// Settings groups. `meta` is a short muted note beside the title,
// `note` a sentence under it, `action` one link on the right.
function SectionHeader({ id, title, meta, note, action }) {
  return (
    <div className="cvd-sec__head">
      <div style={{ minWidth: 0 }}>
        <h2 className="cvd-sec__title" id={id}>
          {title}
          {meta ? <span className="cvd-sec__meta">{meta}</span> : null}
        </h2>
        {note ? <p className="cvd-sec__note">{note}</p> : null}
      </div>
      {action ? (
        <button type="button" className="cvd-link cvd-link--plain" onClick={action.onClick}>
          {action.label} <ArrowRight size={12} color="accent" />
        </button>
      ) : null}
    </div>
  );
}

// Simple Card with a title, local to this file because the brand-system
// Card primitive has no title slot. The title matches the other
// Settings cards (Identity verification, Subscription).
function Card({ title, icon, tone, children }) {
  const tinted = tone === 'accent';
  return (
    <div
      style={{
        background: tinted ? 'var(--cl-accent-soft)' : 'var(--cl-card)',
        border: `1px solid ${tinted ? 'var(--cl-success-border)' : 'var(--cl-border)'}`,
        borderRadius: 'var(--cl-radius-xl)',
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {icon}
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--cl-text)' }}>{title}</h3>
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
  const then = serverDate(iso);
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
// HiddenByModerationSection: the citizen's recourse surface. The list
// itself is components/HiddenByModeration.js (shared with the rep and
// candidate page dashboard since 2026-10-26); this wraps it in the
// dashboard's warning card. Asks for the citizen's own items, so a
// browser also signed in as a rep doesn't show the rep's here.
// ─────────────────────────────────────────────────────────────────
function HiddenByModerationSection({ citizen }) {
  if (!citizen) return null;
  // Settings has a Moderation group (2026-10-26), so an empty list says
  // so in a line rather than leaving the group blank.
  return (
    <HiddenByModeration
      asKind="citizen"
      empty={(
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          Nothing of yours is hidden. If moderators or community reports ever
          hide a post, comment or poll of yours, it shows here with a way to appeal.
        </p>
      )}
      frame={(list) => (
        <Card title="Hidden by moderation" icon={<ShieldIcon />}>
          {list}
        </Card>
      )}
    />
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

// Saved shrinks to one line when there is nothing saved and nothing
// archived (2026-10-26 redesign): two light checks (one saved poll, one
// saved post) and the archived list the Overview already loaded for My
// polls. Otherwise the full shelf opens on the first tab that has
// something.
function SavedSection({ citizen, onOpenPage, myPolls }) {
  const [probe, setProbe] = useState(null); // null | { poll, post, failed }
  useEffect(() => {
    if (!citizen) return undefined;
    let cancelled = false;
    Promise.all([
      fetchSaved({ itemType: 'poll', limit: 1 }),
      fetchSaved({ itemType: 'post', limit: 1 }),
    ]).then(([polls, posts]) => {
      if (cancelled) return;
      setProbe({
        poll: polls?.data?.items?.length || 0,
        post: posts?.data?.items?.length || 0,
        failed: Boolean(polls?.error || posts?.error),
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citizen?.id]);

  if (!citizen) return null;
  const archived = myPolls?.data ? (myPolls.data.archived || []) : null;
  if (!probe || (archived === null && !myPolls?.error)) {
    return <OneLine title="Saved">Loading…</OneLine>;
  }
  const nothing = !probe.failed && probe.poll === 0 && probe.post === 0 && archived && archived.length === 0;
  if (nothing) {
    return (
      <OneLine title="Saved">
        Nothing saved yet. Choose Save from the ⋮ menu on any post or poll to keep it here.
      </OneLine>
    );
  }
  const initialTab = probe.poll > 0 ? 'poll' : probe.post > 0 ? 'post' : (archived && archived.length ? 'archived' : 'poll');
  return (
    <SavedShelf
      citizen={citizen}
      onOpenPage={onOpenPage}
      initialTab={initialTab}
      archived={archived}
      archError={myPolls?.error || null}
    />
  );
}

function SavedShelf({ citizen, onOpenPage, initialTab, archived, archError }) {
  const [tab, setTab] = useState(initialTab);           // 'poll' | 'post' | 'archived'
  // Saved (poll/post) state
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedCursor, setSavedCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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

  useEffect(() => {
    setExpandedId(null);
    if (tab !== 'archived') loadSaved();
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
    <section aria-labelledby="cvd-saved-title">
      <SectionHeader id="cvd-saved-title" title="Saved" meta="Bookmarks and your archived polls" />

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
            <div className="cvd-empty">
              {tab === 'post' ? 'No saved posts yet.' : 'No saved polls yet.'} Choose Save from the ⋮ menu on any post or poll.
            </div>
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
          {archived === null && !archError && <div style={savedMutedStyle}>Loading your archived polls…</div>}
          {archError && <div style={{ color: '#c33333', fontSize: 'var(--cl-text-sm)' }}>Couldn't load: {archError}</div>}
          {!archError && archived && archived.length === 0 && (
            <div className="cvd-empty">
              Nothing in the archive. When you close a poll, or a rep claims the page where you posted one, it shows up here.
            </div>
          )}
          {!archError && archived && archived.length > 0 && (
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


// The citizen's own polls are loaded once for the Overview (2026-10-26):
// My polls lists the active ones and Saved's Archived tab the archived
// ones, so the two no longer fetch the same list separately.
function useMyCitizenPolls(enabled) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const { data, error } = await fetchMyCitizenPolls({ status: 'all' });
    setState({ data: error ? null : (data || { active: [], archived: [] }), error: error || null, loading: false });
  }, []);
  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);
  return { ...state, reload };
}

// My polls shrinks to one line when there is no active poll (2026-10-26).
function MyPollsSection({ citizen, onOpenPage, myPolls }) {
  const [pendingClose, setPendingClose] = useState(null); // poll id

  if (!citizen) return null;

  const { data, error, loading, reload } = myPolls || {};
  if (!data && !error) {
    return <OneLine title="My polls">Loading…</OneLine>;
  }
  if (error && !data) {
    return <OneLine title="My polls">Couldn&rsquo;t load your polls: {error}</OneLine>;
  }

  const active = data?.active || [];
  if (active.length === 0) {
    return (
      <OneLine title="My polls">
        No active polls. You can start one on any rep page that hasn&rsquo;t been claimed yet.
      </OneLine>
    );
  }

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
    <section aria-labelledby="cvd-mypolls-title">
      <SectionHeader
        id="cvd-mypolls-title"
        title="My polls"
        meta={loading ? 'Updating…' : 'Your active polls on rep pages'}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {active.map((poll) => (
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
    </section>
  );
}

function OneLine({ title, children }) {
  return (
    <div className="cvd-line">
      <span className="cvd-line__title">{title}</span>
      <span>{children}</span>
    </div>
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

// ─────────────────────────────────────────────────────────────────
// Following (Overview): the one representative, candidate, election and
// bill starred on the Following tab, as compact cards, two across on
// desktop, under one Manage link (2026-10-26 redesign; before, each was
// a full-width block with its own "Manage tracked" link). Picks come
// from the account-synced featuredTracked store. No pick, a short note
// that points to the Following tab.
// ─────────────────────────────────────────────────────────────────
function FollowedGrid({ onManage, onOpenOfficial }) {
  const { list: officials } = useTrackedOfficials();
  const { list: bills } = useTrackedBills();
  const { list: elections } = useTrackedElections();
  const { featured } = useFeaturedTracked();

  const find = (list, key) => (key ? (list || []).find((x) => x.key === key) || null : null);
  const repRaw = find(officials, featured.representative);
  const canRaw = find(officials, featured.candidate);
  // Guard against a stale featured key whose item changed role buckets.
  const rep = repRaw && repRaw.role_type !== 'candidate' ? repRaw : null;
  const can = canRaw && canRaw.role_type === 'candidate' ? canRaw : null;
  const bill = find(bills, featured.bill);
  const election = find(elections, featured.election);

  return (
    <section aria-labelledby="cvd-following-title">
      <SectionHeader
        id="cvd-following-title"
        title="Following"
        meta="Your starred picks"
        action={onManage ? { label: 'Manage', onClick: onManage } : null}
      />
      <div className="cvd-follow">
        <OfficialCard kind="representative" official={rep} onOpen={onOpenOfficial} />
        <OfficialCard kind="candidate" official={can} onOpen={onOpenOfficial} />
        <ElectionCard election={election} />
        <BillCard bill={bill} />
      </div>
    </section>
  );
}

const FOLLOW_KIND_LABEL = {
  representative: 'Representative',
  candidate: 'Candidate',
  election: 'Election',
  bill: 'Bill',
};

function FollowEmpty({ kind }) {
  const what = kind === 'election' ? 'an election' : `a ${kind}`;
  return (
    <div className="cvd-fcard is-empty">
      <div className="cvd-fcard__kind">{FOLLOW_KIND_LABEL[kind]}</div>
      <p className="cvd-fcard__text">
        Nothing featured yet. Star {what} on the Following tab to see
        {kind === 'bill' ? ' its latest status' : kind === 'election' ? ' its countdown' : ' their latest posts'} here.
      </p>
    </div>
  );
}

function OfficialCard({ kind, official, onOpen }) {
  const [posts, setPosts] = useState(null);

  useEffect(() => {
    if (!official) { setPosts(null); return undefined; }
    const id = official.id || official.bioguide_id || official.key;
    if (!id) { setPosts([]); return undefined; }
    let cancelled = false;
    setPosts(null);
    fetchPagePosts(id, { limit: 2 })
      .then(({ data }) => { if (!cancelled) setPosts((data?.items || []).slice(0, 2)); })
      .catch(() => { if (!cancelled) setPosts([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [official ? official.key : null]);

  if (!official) return <FollowEmpty kind={kind} />;

  const partyKey = dashboardPartyKey(official.party);
  const open = onOpen ? () => onOpen(official) : null;
  const sub = [
    official.title || official.role || '',
    official.state || '',
    official.district ? `Dist. ${official.district}` : '',
  ].filter(Boolean).join(' · ');
  const Who = open ? 'button' : 'div';

  return (
    <div className="cvd-fcard">
      <div className="cvd-fcard__kind">{FOLLOW_KIND_LABEL[kind]}</div>
      <Who
        className="cvd-fcard__who"
        {...(open ? { type: 'button', onClick: open, 'aria-label': `Open ${official.name}'s page` } : {})}
      >
        <Avatar name={official.name} party={avatarParty(partyKey)} size="md" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="cvd-fcard__name">
            <span>{official.name}</span>
            {partyKey && <PartyChip party={partyKey} size="xs" />}
          </div>
          {sub && <div className="cvd-fcard__sub">{sub}</div>}
        </div>
        {open && <ArrowRight size={14} color="muted" />}
      </Who>
      {posts === null && <p className="cvd-fcard__text">Loading latest posts…</p>}
      {posts && posts.length === 0 && (
        <p className="cvd-fcard__text">No recent posts yet. Open their page for the latest.</p>
      )}
      {posts && posts.length > 0 && (
        <div className="cvd-posts">
          {posts.map((p) => {
            const Tag = open ? 'button' : 'div';
            return (
              <Tag key={p.id} className="cvd-post" {...(open ? { type: 'button', onClick: open } : {})}>
                <div className="cvd-post__text">{p.body || p.question || '(no text)'}</div>
                {p.created_at && <div className="cvd-post__when">{timeAgo(p.created_at)}</div>}
              </Tag>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BillCard({ bill }) {
  // Likes by state / district use the viewer's own geography.
  const viewerGeo = useViewerGeo();
  if (!bill) return <FollowEmpty kind="bill" />;
  return (
    <div className="cvd-fcard">
      <div className="cvd-fcard__kind">{FOLLOW_KIND_LABEL.bill}</div>
      <div className="cvd-fcard__name" style={{ display: 'block' }}>
        <span className="cvd-clamp2" style={{ whiteSpace: 'normal' }}>
          {bill.citation ? <span style={{ color: 'var(--cl-accent)' }}>{bill.citation} · </span> : null}
          {bill.title || 'Untitled bill'}
        </span>
      </div>
      <p className="cvd-fcard__text">
        {bill.latest_action ? (
          <>
            <strong>Latest action:</strong> {bill.latest_action}
            {bill.latest_action_date ? ` (${bill.latest_action_date})` : ''}
          </>
        ) : (
          'No recent action recorded. Use "Check for updates" on the Following tab.'
        )}
      </p>
      {bill.sponsor_name && (
        <p className="cvd-fcard__text"><strong>Sponsor:</strong> {bill.sponsor_name}</p>
      )}
      <div className="cvd-fcard__foot">
        {bill.url ? (
          <a className="cvd-link cvd-link--plain" href={bill.url} target="_blank" rel="noopener noreferrer">
            View on Congress.gov <ArrowRight size={12} color="accent" />
          </a>
        ) : <span />}
        <BillReactions billKey={bill.key} geo={viewerGeo} scopeSwitch />
      </div>
    </div>
  );
}

function ElectionCard({ election }) {
  if (!election) return <FollowEmpty kind="election" />;
  const date = election.date ? new Date(election.date + 'T00:00:00') : null;
  const days = date ? daysUntil(date) : null;
  const where = [election.state, election.district ? `Dist. ${election.district}` : null].filter(Boolean).join(' · ');
  return (
    <div className="cvd-fcard">
      <div className="cvd-fcard__kind">{FOLLOW_KIND_LABEL.election}</div>
      <div className="cvd-fcard__who">
        <span className="cvd-row__icon"><CalendarCheck size={18} color="accent" /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="cvd-fcard__name" style={{ display: 'block' }}>
            <span className="cvd-clamp2" style={{ whiteSpace: 'normal' }}>
              {election.name || election.office || 'Election'}
            </span>
          </div>
          {date && (
            <div className="cvd-fcard__sub">
              {formatLongDate(date)}{days != null ? ` · ${days} ${days === 1 ? 'day' : 'days'} away` : ''}
            </div>
          )}
        </div>
      </div>
      {(election.office || where || election.candidates_count) ? (
        <p className="cvd-fcard__text">
          {[
            election.office ? <span key="o"><strong>Office:</strong> {election.office}</span> : null,
            where ? <span key="w"><strong>Where:</strong> {where}</span> : null,
            election.candidates_count ? <span key="c"><strong>Candidates:</strong> {election.candidates_count}</span> : null,
          ].filter(Boolean).reduce((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}
        </p>
      ) : null}
    </div>
  );
}
