'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPage } from '../lib/pagesApi';
import { useAuth } from '../lib/auth';
import { getVoterToken } from '../lib/voterToken';
import PostCard from './PostCard';
import PostComposer from './PostComposer';
import RepEventComposer from './RepEventComposer';
import OwnerScopeFilter from './OwnerScopeFilter';
import ViewerScopeFilter from './ViewerScopeFilter';
import Dashboard from './Dashboard';
import CitizenPollsSection from './CitizenPollsSection';
import Navbar from './Navbar';
import { Skeleton, EmptyState, ErrorState, Newspaper } from './ui';
import { useIsCompact } from '@/lib/useViewport';

/**
 * Full-viewport page view for a single rep or candidate.
 *
 * Layout (covers everything below the Navbar):
 *   ┌───────────────────────────────────────────┐
 *   │  ←  Back    Byron Donalds  [Rep login]    │   ← header strip
 *   ├───────────────────────────────────────────┤
 *   │  Page header: avatar • name • role •       │
 *   │  Claim status / "This page is unclaimed"   │
 *   │                                            │
 *   │  [Composer — owner only]                   │
 *   │                                            │
 *   │  Posts feed (newest first)                 │
 *   │  Upcoming Events (rep-created) — side col  │
 *   └───────────────────────────────────────────┘
 *
 * Props:
 *   officialId — the target page id
 *   displayName — string; shown in header while the payload loads
 *   role        — string; optional
 *   photoUrl    — string; optional
 *   onClose()   — user pressed Back / ×
 *   onRequestLogin() — user clicked "Rep login" (opens modal)
 *   onRequestClaim() — user clicked "Claim this page" (unclaimed flow)
 *   onRequestCitizenWaitlist() — comment CTA (citizen waitlist modal)
 *   me          — { id, official_id, display_name, role } | null (from auth hook)
 *   onLogout()  — user clicked sign-out in the header strip
 */
export default function PageView({
  officialId,
  displayName,
  role,
  photoUrl,
  onClose,
  onRequestLogin,
  onRequestClaim,
  onRequestCitizenWaitlist,
  me,
  onLogout,
  // Phase 1.5 — citizen-auth. When non-null, the current citizen can
  // like, dislike, comment, and vote in polls. When null, any
  // engagement action routes to onCitizenLoginRequired().
  citizen,
  onCitizenLoginRequired,
  // Compact-navbar wires (citizen-poll feature, Phase 2). Forwarded
  // to the slim Navbar shown at the top of the PageView overlay so
  // a user looking at a rep page can sign in / out, jump to their
  // dashboard, open their tracked list, or hit Subscribe without
  // having to back out of the page first. All optional — if a
  // handler is missing the corresponding button is inert (or just
  // doesn't render).
  onCitizenLogout,
  onCitizenDashboard,
  onOpenTracked,
  onSubscribe,
  // Help-build + Feedback overlays — same progressive-rollout pattern;
  // forwarded to the embedded Navbar's hamburger so a user reading a
  // rep page can hit "Help build this" or "Feedback" without backing
  // out first. Both optional — if not wired, the items don't render.
  onOpenHelpBuild,
  onOpenFeedback,
}) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);
  // Two scope states — only one is visible at a time depending on who's
  // looking. `ownerScope` drives the OwnerScopeFilter and affects
  // polls + reactions + comment_count (the engagement filter is
  // owner-only server-side). `viewerScope` drives the ViewerScopeFilter
  // shown to everyone else, and affects polls only. We send at most one
  // to the backend per request; see `effectiveScope` below.
  const [ownerScope, setOwnerScope] = useState(null);
  const [viewerScope, setViewerScope] = useState(null);
  // Top-level view tab for the page main column. Three states:
  //   'feed'      — composer (owner) + posts + citizen polls (default)
  //   'events'    — upcoming events list + RepEventComposer (owner)
  //   'dashboard' — engagement rollup (owner-only — citizens can't pick it)
  // Feed/Events are visible to everyone; Dashboard is gated to the
  // page owner in the tab strip render. 'feed' stays the default so
  // citizens and unclaimed pages keep their current first impression.
  const [activeView, setActiveView] = useState('feed');
  // When the owner clicks a post in the dashboard, we flip back to
  // the feed and tag the post id so PostCard highlighting can pulse
  // it into view. Cleared after highlight consumed.
  const [highlightPostId, setHighlightPostId] = useState(null);
  const feedScrollRef = useRef(null);
  // Compact viewports (mobile + tablet) drop the right-side Upcoming
  // Events sticky sidebar to a single inline section after the main
  // column. The sticky sidebar overlapped the main content on narrow
  // viewports because the 300px reserved column was wider than the
  // remaining horizontal room.
  const isCompact = useIsCompact();
  // Scroll-driven collapse for the OwnerScopeFilter / ViewerScopeFilter
  // so the "POLL VIEW" / "FILTER constituent feedback" copy hides once
  // the user has started reading the feed. The chip row stays visible.
  const [scopeFilterCollapsed, setScopeFilterCollapsed] = useState(false);

  // Pick which scope to send with the page fetch. `is_owner` isn't
  // known here (it comes back in the payload), so we optimistically
  // prefer ownerScope when set — if the caller turns out not to be
  // the owner the backend just ignores engagement-scope filtering and
  // still applies the scope to polls, which is the correct viewer
  // behavior anyway. In practice only the relevant filter is rendered
  // at any one time, so only one of these is non-null.
  const effectiveScope = ownerScope || viewerScope || null;

  const loadPage = useCallback(async () => {
    if (!officialId) return;
    const rid = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchPage(officialId, {
      voterToken: getVoterToken(),
      scope: effectiveScope || undefined,
    });
    if (rid !== reqIdRef.current) return; // stale
    setLoading(false);
    if (err) {
      setError(err);
      setPayload(null);
      return;
    }
    setPayload(data);
  }, [officialId, effectiveScope]);

  // Jump-to-post effect — triggered by the dashboard when the owner
  // clicks a top-engaged post. We're guaranteed to be back in the
  // feed view by the click handler, so just find the element by id
  // and scroll it into view with a soft highlight pulse. The pulse
  // uses the same CSS keyframe PostCard's return-to-list highlight
  // uses (defined in global CSS) — here we toggle it via class.
  useEffect(() => {
    if (!highlightPostId || activeView !== 'feed') return undefined;
    // next tick so the feed render has mounted the article.
    const t = setTimeout(() => {
      const el = typeof document !== 'undefined'
        ? document.getElementById(`post-${highlightPostId}`)
        : null;
      if (el) {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        el.style.boxShadow = '0 0 0 3px rgba(255, 196, 64, 0.55)';
        setTimeout(() => { el.style.boxShadow = ''; }, 1500);
      }
      setHighlightPostId(null);
    }, 80);
    return () => clearTimeout(t);
  }, [highlightPostId, activeView]);

  // Re-fetch whenever the page id OR the signed-in rep id OR the
  // signed-in citizen id changes. `is_owner` + reaction summary (my
  // reaction) + poll voter_choice_id are all computed server-side from
  // session cookies; without these deps the payload would stay stale
  // after a mid-flow sign-in and the composer / "your vote" / "your
  // like" badges would all be wrong.
  useEffect(() => {
    loadPage();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [loadPage, me?.id, citizen?.id]);

  // ── Optimistic mutations keep the feed snappy ─────────────────────
  const handlePostCreated = useCallback((post) => {
    setPayload((p) => (p ? { ...p, posts: [post, ...p.posts] } : p));
  }, []);

  const handlePostDeleted = useCallback((postId) => {
    setPayload((p) => (p ? { ...p, posts: p.posts.filter((x) => x.id !== postId) } : p));
  }, []);

  const handlePollUpdated = useCallback((postId, updatedPoll) => {
    setPayload((p) => {
      if (!p) return p;
      return {
        ...p,
        posts: p.posts.map((x) => (x.id === postId ? { ...x, poll: updatedPoll } : x)),
      };
    });
  }, []);

  const handleEventCreated = useCallback((evt) => {
    setPayload((p) => {
      if (!p) return p;
      // Keep the sidebar list sorted by start_at ascending so the nearest
      // event floats to the top regardless of creation order.
      const next = [...(p.upcoming_events || []), evt].sort((a, b) => {
        const ta = a?.start_at ? new Date(a.start_at).getTime() : 0;
        const tb = b?.start_at ? new Date(b.start_at).getTime() : 0;
        return ta - tb;
      });
      return { ...p, upcoming_events: next };
    });
  }, []);

  const handleEventDeleted = useCallback((eventId) => {
    setPayload((p) => (
      p ? { ...p, upcoming_events: (p.upcoming_events || []).filter((x) => x.id !== eventId) } : p
    ));
  }, []);

  // Reaction summary comes back from POST /reactions — merge it into the
  // matching post so the counts + "my reaction" badge refresh without a
  // full page reload.
  const handleReactionChanged = useCallback((postId, summary) => {
    setPayload((p) => {
      if (!p) return p;
      return {
        ...p,
        posts: p.posts.map((x) => (x.id === postId ? { ...x, reactions: summary } : x)),
      };
    });
  }, []);

  // Lightweight comment_count bookkeeping so the "(N)" label on the
  // Comments toggle stays in sync without re-fetching the whole list.
  const handleCommentCountChanged = useCallback((postId, delta) => {
    setPayload((p) => {
      if (!p) return p;
      return {
        ...p,
        posts: p.posts.map((x) => (
          x.id === postId
            ? { ...x, comment_count: Math.max(0, (x.comment_count || 0) + delta) }
            : x
        )),
      };
    });
  }, []);

  // ── Derived ───────────────────────────────────────────────────────
  // Defensive owner gate: the backend reports is_owner=true whenever
  // the rep session validates against the page owner, BUT if the
  // browser carries a stale rep token from a previous session (e.g.
  // user signed out of the citizen flow but the rep token never got
  // cleared in some pre-mutually-exclusive-sessions state), the
  // backend will still happily report is_owner=true and the UI would
  // surface rep-only affordances (post composer, comment Delete) to
  // someone the user-facing app doesn't consider signed-in.
  // We double-check against useAuth() so the UI gates strictly on
  // the active client-side rep session.
  const { me: repMe } = useAuth();
  const isOwner = !!payload?.is_owner
    && !!repMe
    && repMe.official_id === officialId;
  const claimed = !!payload?.claimed;
  const ownerName = payload?.owner?.display_name || displayName || 'This official';
  const ownerRole = payload?.owner?.role || role || '';
  const initials = useMemo(() => (
    (ownerName || '').split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('')
  ), [ownerName]);

  const events = payload?.upcoming_events || [];
  const posts = payload?.posts || [];
  // Allowed composer scopes derive from the first post's allowed_scopes
  // — server-computed per the page owner's role. Fall back to country
  // until the first post comes back. For a fresh page with no posts
  // we use a reasonable default based on owner_district presence in
  // the owner summary (Phase 2 can expose this explicitly on the page
  // payload).
  const composerAllowedScopes = useMemo(() => {
    const fromPost = posts.find((p) => p?.poll?.allowed_scopes?.length)?.poll?.allowed_scopes;
    if (fromPost && fromPost.length) return fromPost;
    // No poll posted yet — fall back to a safe minimum. The backend
    // clamps on save anyway.
    return ['country'];
  }, [posts]);

  // Prevent background scroll while the overlay is up
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      role="dialog"
      aria-label={`Page for ${ownerName}`}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1200,
        background: 'var(--cl-bg)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Compact app navbar — same chrome as the home page minus
          the rep search and the Committees button (the user has
          already drilled into a specific rep, so global rep search
          + browse-by-committee aren't useful here). Citizen identity,
          Subscribe, My Tracked stay reachable so a citizen can sign
          in / out without backing out of the page first. The logo
          click also calls onClose so it doubles as a "go home"
          escape hatch. */}
      <div style={{ flex: '0 0 auto' }}>
        <Navbar
          compact
          citizen={citizen}
          onCitizenLogin={onCitizenLoginRequired}
          onCitizenLogout={onCitizenLogout}
          onCitizenDashboard={onCitizenDashboard}
          onOpenTracked={onOpenTracked}
          onSubscribe={onSubscribe}
          onOpenHelpBuild={onOpenHelpBuild}
          onOpenFeedback={onOpenFeedback}
          onHome={onClose}
        />
      </div>

      {/* Page-level top bar — back to map, current rep name, Rep login. */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '10px', padding: '10px 18px',
          background: 'white',
          borderBottom: '1px solid var(--cl-border)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '6px 10px', borderRadius: '8px',
            border: '1px solid var(--cl-border)', background: 'white',
            color: 'var(--cl-text)', fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div
          style={{
            fontSize: '0.9rem', fontWeight: 700, color: 'var(--cl-text)',
            textAlign: 'center', flex: 1, minWidth: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {ownerName}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {me ? (
            <>
              <span
                style={{
                  fontSize: '0.78rem', color: 'var(--cl-text-light)',
                  padding: '6px 10px', border: '1px solid var(--cl-border)',
                  borderRadius: '8px', background: 'white',
                }}
                title={`Signed in as ${me.display_name}`}
              >
                {me.display_name}
              </span>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  style={{
                    padding: '6px 10px', borderRadius: '8px',
                    border: '1px solid var(--cl-border)', background: 'white',
                    color: 'var(--cl-text-light)', fontSize: '0.78rem', fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={onRequestLogin}
              style={{
                padding: '6px 12px', borderRadius: '8px',
                border: '1px solid var(--cl-accent)', background: 'white',
                color: 'var(--cl-accent)', fontSize: '0.82rem', fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Rep login
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        ref={feedScrollRef}
        onScroll={(e) => {
          // Collapse the scope filter once the user has scrolled past
          // 60px in the feed. Restores when scrolled back near the
          // top. Single listener, no rAF — this runs cheap (couple
          // setState calls per tick) and React batches the no-op
          // updates when the threshold isn't crossed.
          const top = e.currentTarget.scrollTop;
          setScopeFilterCollapsed(top > 60);
        }}
        style={{
          flex: '1 1 auto', overflowY: 'auto',
          padding: '24px 18px',
        }}
      >
        <div
          style={{
            maxWidth: '980px', margin: '0 auto',
            // Compact viewports stack to a single column - the 300px
            // sidebar was overlapping the main column when there
            // wasn't horizontal room for both. The events block
            // renders inline at the bottom of the main column on
            // compact (see "Events inline" further below) instead of
            // as a sticky sidebar.
            display: 'grid',
            gridTemplateColumns: isCompact ? '1fr' : 'minmax(0, 1fr) 300px',
            gap: '24px',
          }}
        >
          {/* Main column */}
          <main style={{ minWidth: 0 }}>
            {/* Owner header card */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '18px',
                background: 'white',
                border: '1px solid var(--cl-border)',
                borderRadius: '14px',
                marginBottom: '16px',
              }}
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl}
                  alt={ownerName}
                  style={{
                    width: '72px', height: '72px', borderRadius: '50%',
                    objectFit: 'cover', border: '2px solid var(--cl-border)',
                    flexShrink: 0, background: 'var(--cl-bg)',
                  }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{
                    width: '72px', height: '72px', borderRadius: '50%',
                    background: 'var(--cl-bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.6rem', fontWeight: 700, color: 'var(--cl-accent)',
                    border: '2px solid var(--cl-border)', flexShrink: 0,
                  }}
                >
                  {initials || '•'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '1.25rem', fontWeight: 700, color: 'var(--cl-text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {ownerName}
                </div>
                {ownerRole && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
                    {ownerRole}
                  </div>
                )}
                <div
                  style={{
                    fontSize: '0.72rem', marginTop: '6px',
                    color: claimed ? '#27ae60' : 'var(--cl-text-light)',
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  {claimed ? (
                    <>
                      <span aria-hidden="true">●</span> Claimed page — posts are from {ownerName}
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">○</span> This page isn&rsquo;t claimed yet
                    </>
                  )}
                </div>
              </div>
              {!claimed && (
                <button
                  type="button"
                  onClick={onRequestClaim}
                  style={{
                    padding: '8px 14px', borderRadius: '8px',
                    border: '1px solid var(--cl-accent)', background: 'var(--cl-accent)',
                    color: 'white', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  Claim this page
                </button>
              )}
            </div>

            {/* Contact-us line for real reps. Visible on every
                unclaimed page so a rep / staffer / comms director
                who lands on their own page has a direct path to
                claim it manually while the automated verified-rep
                flow is still pre-launch. Hidden once the page is
                claimed (the rep is already onboard). */}
            {!claimed && (
              <div
                style={{
                  marginTop: 10,
                  marginBottom: 6,
                  padding: '8px 12px',
                  background: 'var(--cl-bg-soft)',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 'var(--cl-radius-md)',
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  color: 'var(--cl-text-light)',
                }}
              >
                Are you{' '}
                <strong style={{ color: 'var(--cl-text)' }}>
                  {ownerName}
                </strong>{' '}
                (or working with their office)? Email{' '}
                <a
                  href={`mailto:civicview@civicview.app?subject=Claim%20${encodeURIComponent(
                    ownerName,
                  )}'s%20CivicView%20page`}
                  style={{
                    color: 'var(--cl-accent)',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  civicview@civicview.app
                </a>{' '}
                to claim this page until automated verified-rep
                sign-in ships.
              </div>
            )}

            {/* Page view selector — always rendered for everyone.
                Feed and Events are visible to all visitors; Dashboard
                is appended only for the page owner (engagement rollup
                across all posts). Moving Events into the tab strip
                meant the events section no longer sits below an
                ever-growing post list on mobile — selecting Events
                swaps the main column to the events list instead. */}
            <div
              style={{
                display: 'flex', gap: '6px', marginBottom: '10px',
                padding: '4px',
                background: 'white', border: '1px solid var(--cl-border)',
                borderRadius: '999px',
                width: 'fit-content',
              }}
              role="tablist"
              aria-label="Page view"
            >
              {[
                { key: 'feed',   label: 'Feed' },
                { key: 'events', label: 'Events' },
                ...(isOwner ? [{ key: 'dashboard', label: 'Dashboard' }] : []),
              ].map(({ key, label }) => {
                const active = activeView === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveView(key)}
                    style={{
                      padding: '5px 14px', borderRadius: '999px',
                      border: 'none',
                      background: active ? 'var(--cl-accent)' : 'transparent',
                      color: active ? 'white' : 'var(--cl-text-light)',
                      fontSize: '0.8rem', fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Owner-only scope filter rail. Feed-view only — scope
                filters drive engagement-metric slicing, which only
                applies to the feed / dashboard views. Sits above the
                composer so it's the first thing an owner sees —
                filter state changes trigger a page refetch, which
                recomputes poll counts + reactions + comment_count
                server-side. */}
            {isOwner && activeView === 'feed' && (
              <OwnerScopeFilter
                scopes={payload?.allowed_engagement_scopes || []}
                labels={payload?.engagement_scope_labels || {}}
                value={ownerScope || 'country'}
                onChange={(next) => setOwnerScope(next === 'country' ? null : next)}
                collapsed={scopeFilterCollapsed}
              />
            )}

            {/* Dashboard takes over the main column when the owner
                toggles into it. Feed content (composer + posts) is
                hidden but not unmounted below the dashboard — we just
                branch on activeView to render one or the other. */}
            {isOwner && activeView === 'dashboard' && (
              <Dashboard
                officialId={officialId}
                scope={ownerScope}
                onJumpToPost={(postId) => {
                  setActiveView('feed');
                  setHighlightPostId(postId);
                }}
              />
            )}

            {/* Composer — owner only, feed view only */}
            {isOwner && activeView === 'feed' && (
              <PostComposer
                officialId={officialId}
                onCreated={handlePostCreated}
                allowedScopes={composerAllowedScopes}
              />
            )}

            {/* Viewer-side poll filter — shown to everyone who ISN'T
                the page owner (owners get OwnerScopeFilter instead,
                which is strictly more powerful). Feed-view only —
                same reasoning as OwnerScopeFilter. Lets citizens and
                anonymous viewers re-slice poll counts to their fellow
                constituents' level without touching reactions or
                comment counts. */}
            {!isOwner && activeView === 'feed' && (
              <ViewerScopeFilter
                scopes={payload?.allowed_engagement_scopes || []}
                labels={payload?.engagement_scope_labels || {}}
                value={viewerScope}
                onChange={setViewerScope}
                ownerName={ownerName}
                collapsed={scopeFilterCollapsed}
              />
            )}

            {/* Events panel — shown when the user picks the Events
                tab. Renders the full list (no "show first 2" preview)
                since clicking the tab signals the user wants to see
                events; for the owner it also surfaces RepEventComposer
                so they can add upcoming events without leaving this
                view. Replaces the old bottom-of-feed inline events
                section on mobile, which used to get buried below an
                ever-growing post list. */}
            {activeView === 'events' && (
              <div
                style={{
                  background: 'white',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    color: 'var(--cl-text-light)',
                    marginBottom: 10,
                  }}
                >
                  Upcoming Events
                </div>
                {events.length === 0 ? (
                  <div style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)' }}>
                    No upcoming events posted.
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {events.map((evt) => {
                      const d = evt.start_at ? new Date(evt.start_at.replace('Z', '')) : null;
                      const when = d && !Number.isNaN(d.getTime())
                        ? d.toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                          })
                        : evt.start_at;
                      return (
                        <li
                          key={evt.id}
                          style={{
                            padding: '10px 0',
                            borderBottom: '1px solid var(--cl-border)',
                          }}
                        >
                          <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--cl-text)' }}>
                            {evt.title}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
                            {when}
                            {evt.location ? ` · ${evt.location}` : ''}
                          </div>
                          {evt.url && (
                            <a
                              href={evt.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: '0.76rem',
                                color: 'var(--cl-accent)',
                                textDecoration: 'none',
                                marginTop: '4px',
                                display: 'inline-block',
                              }}
                            >
                              RSVP →
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {isOwner && (
                  <RepEventComposer
                    officialId={officialId}
                    events={events.filter((e) => e?.source === 'rep')}
                    onCreated={handleEventCreated}
                    onDeleted={handleEventDeleted}
                  />
                )}
              </div>
            )}

            {/* Feed — only when activeView === 'feed' (for everyone). */}
            {activeView === 'feed' && (
              <>
                {loading && (
                  <div style={{ padding: '8px 0' }}>
                    <Skeleton variant="list" count={3} />
                  </div>
                )}
                {error && !loading && (
                  <ErrorState
                    kind="network"
                    headline="Couldn't load this page"
                    body={error}
                    cta={{ label: 'Retry', onClick: () => window.location.reload() }}
                  />
                )}
                {!loading && !error && posts.length === 0 && (
                  <EmptyState
                    icon={<Newspaper size={36} active color="muted" />}
                    headline={
                      isOwner
                        ? 'No posts yet'
                        : `${ownerName} hasn't posted yet`
                    }
                    body={
                      isOwner
                        ? 'Write your first one above. Posts appear here as soon as you publish.'
                        : "We'll surface their first post here. Track this rep to get notified."
                    }
                    tone="muted"
                  />
                )}
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    officialId={officialId}
                    isOwner={isOwner}
                    citizen={citizen}
                    onCitizenLoginRequired={onCitizenLoginRequired}
                    onDeleted={handlePostDeleted}
                    onPollUpdated={handlePollUpdated}
                    onReactionChanged={handleReactionChanged}
                    onCommentCountChanged={handleCommentCountChanged}
                    commentScope={isOwner ? ownerScope : null}
                  />
                ))}

                {/* Citizen-led polls. Component decides on its own
                    whether to render based on claim status + caller
                    role: full feed on unclaimed pages, "Pre-claim
                    discussion" archive on claimed pages for the rep
                    owner, hidden once the owner has dismissed the
                    archive. Sits below the rep posts so a claimed
                    page reads top-down: rep's own content first,
                    pre-claim history at the bottom. */}
                {!loading && !error && (
                  <CitizenPollsSection
                    officialId={officialId}
                    ownerName={ownerName}
                    citizen={citizen}
                    isOwner={isOwner}
                    pageClaimed={claimed}
                    onCitizenLoginRequired={onCitizenLoginRequired}
                  />
                )}
              </>
            )}

            {/* (Mobile inline events section removed — events now live
                in the top-of-page Events tab, which surfaces them
                without burying them below an ever-growing post list.
                Desktop sidebar version still renders below for ambient
                reference at wider viewports.) */}
          </main>

          {/* Side column — upcoming events. Hidden on compact (mobile +
              tablet); the inline version above takes its place to avoid
              the 300px sidebar overlapping the main column. */}
          {!isCompact && (
          <aside
            style={{
              background: 'white',
              border: '1px solid var(--cl-border)',
              borderRadius: '14px',
              padding: '16px',
              alignSelf: 'start',
              position: 'sticky',
              top: '8px',
              maxHeight: 'calc(100vh - 140px)',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                color: 'var(--cl-text-light)',
                marginBottom: '10px',
              }}
            >
              Upcoming Events
            </div>
            {events.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--cl-text-light)' }}>
                No upcoming events posted.
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {events.map((evt) => {
                  const d = evt.start_at ? new Date(evt.start_at.replace('Z', '')) : null;
                  const when = d && !Number.isNaN(d.getTime())
                    ? d.toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })
                    : evt.start_at;
                  return (
                    <li
                      key={evt.id}
                      style={{
                        padding: '10px 0',
                        borderBottom: '1px solid var(--cl-border)',
                      }}
                    >
                      <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--cl-text)' }}>
                        {evt.title}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
                        {when}
                        {evt.location ? ` · ${evt.location}` : ''}
                      </div>
                      {evt.url && (
                        <a
                          href={evt.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '0.76rem',
                            color: 'var(--cl-accent)',
                            textDecoration: 'none',
                            marginTop: '4px',
                            display: 'inline-block',
                          }}
                        >
                          RSVP →
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {/* Owner composer — pass only rep-created events so the
                remove list doesn't show curated seed events they
                can't actually delete. Rep-created events are marked
                source === 'rep' on the backend. */}
            {isOwner && (
              <RepEventComposer
                officialId={officialId}
                events={events.filter((e) => e?.source === 'rep')}
                onCreated={handleEventCreated}
                onDeleted={handleEventDeleted}
              />
            )}
          </aside>
          )}
        </div>
      </div>
    </div>
  );
}
