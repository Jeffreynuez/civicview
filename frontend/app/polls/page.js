'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /polls — global polls feed.
 *
 * The user-engagement safety net: when every rep page is unclaimed
 * and no rep has posted anything, citizens can still drive
 * meaningful civic-engagement here. Shows every active poll across
 * the entire app — rep-authored, citizen-led on unclaimed pages, and
 * citizen standalone polls (no specific target). Filter chips switch
 * between branches; an AI filter row offers preset tone chips and a
 * free-form semantic-search input; a "Start a poll" affordance lets
 * signed-in citizens post a standalone poll (per-citizen cap of 1
 * active).
 *
 * Voting / commenting / detailed engagement still happens on the
 * source rep page (clicking a citizen-or-rep poll card jumps there).
 * Standalone polls have no source page; they live and die here.
 *
 * Page chrome:
 *   • Existing global Navbar at the top (citizen wires routed to
 *     local modal state on this page so /polls doesn't depend on
 *     the home orchestrator).
 *   • Dark "grassroots" hero band with eyebrow + title + sub + 3
 *     headline stats.
 *   • Sticky two-row filter bar (branch chips + Start CTA, then
 *     AI filter row with preset chips + free-form input).
 *   • Auto-fill card grid (320px min) with two empty states:
 *     full-empty for "no polls match the branch filter" and
 *     in-grid compact empty for "AI filter returned 0".
 *   • Bottom "Start a poll" CTA + mobile-only sticky FAB.
 *
 * Class names match the Claude Design export at
 * /Design Exports/civicview-polls-page/. Styles live in ./polls.css.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchPollsFeed,
  fetchPostsFeed,
  createStandalonePoll,
  aiHealth,
  filterPolls,
} from '@/lib/pagesApi';
import FeedCard from '@/components/polls/FeedCard';
import BranchChipV2 from '@/components/polls/BranchChip';
import StateDropdown from '@/components/polls/StateDropdown';
import { TabStrip, TabContent } from '@/components/polls/TabStrip';
import { useCitizenAuth, logoutCitizen } from '@/lib/citizenAuth';
import { useAuth as useRepAuth } from '@/lib/auth';
import { useCandidateAuth } from '@/lib/candidateAuth';
import Navbar from '@/components/Navbar';
import CitizenLoginModal from '@/components/CitizenLoginModal';
import CitizenWaitlistModal from '@/components/CitizenWaitlistModal';
import MyTrackedModal from '@/components/MyTrackedModal';
import ConstituentDashboard from '@/components/ConstituentDashboard';
import HelpBuildThisView from '@/components/HelpBuildThisView';
import FeedbackView from '@/components/FeedbackView';
import './polls.css';

// Branch filters — replaces the old kind enum. Standalone is a
// distinct visual tier (dashed border + warning dot prefix);
// "From candidates" surfaces polls targeting candidate pages
// (citizens asking candidates questions). Once candidate accounts
// ship in Phase 3+, this chip will also include candidate-authored
// polls — same backend filter, broader meaning.
// Branch chip taxonomy after the PR #2 redesign.
//   • 'bill'      → 'states'    (renamed — clicking opens a state dropdown)
//   • 'committee' → 'congress'  (covers both House + Senate)
//   • All other ids unchanged so existing code that maps by id keeps
//     working without further edits.
const BRANCH_FILTERS = [
  { id: 'all',        label: 'All polls',        glyph: 'AllPolls',       tier: 'normal' },
  { id: 'states',     label: 'States',           glyph: 'Bill',           tier: 'normal' },
  { id: 'congress',   label: 'Congress',         glyph: 'Committee',      tier: 'normal' },
  { id: 'executive',  label: 'Executive',        glyph: 'Executive',      tier: 'normal' },
  { id: 'judicial',   label: 'Judicial',         glyph: 'Judicial',       tier: 'normal' },
  { id: 'standalone', label: 'Standalone',       glyph: 'Standalone',     tier: 'standalone' },
  { id: 'candidate',  label: 'From candidates',  glyph: 'FromCandidates', tier: 'normal' },
];

// AI filter preset chips. Each label maps to a backend prompt that
// the existing /api/polls/filter semantic endpoint can interpret.
const AI_PRESETS = [
  { id: 'positive',    label: 'Positive',    prompt: 'positive polls' },
  { id: 'critical',    label: 'Critical',    prompt: 'critical polls' },
  { id: 'funny',       label: 'Funny',       prompt: 'funny polls' },
  { id: 'supportive',  label: 'Supportive',  prompt: 'supportive polls' },
  { id: 'skeptical',   label: 'Skeptical',   prompt: 'skeptical polls questioning the data' },
  { id: 'informative', label: 'Informative', prompt: 'informative polls' },
];

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatCount(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

// Map a poll's server-side `kind` to the design's branch enum.
// `kind` is 'rep' | 'citizen' | 'candidate' | 'standalone'. Branch
// metadata (Bill / Executive / etc.) ships per-poll once that
// taxonomy is wired into the backend; until then rep / citizen
// polls share the "all" bucket and Standalone + Candidate are the
// distinct branches we can filter against today.
function pollBranch(poll) {
  if (poll.kind === 'standalone') return 'standalone';
  if (poll.kind === 'candidate') return 'candidate';
  // Forward-compatible: if the backend later starts emitting a
  // `branch` field on rep/citizen polls, prefer it. For now they
  // count toward "all" only.
  if (poll.branch) return poll.branch;
  return null;
}

// Shared shell for both /polls (tab='polls') and /posts (tab='posts').
// /posts/page.js mounts this component with the other tab; tab
// changes triggered by the TabStrip push a new URL via router.push
// so the back button works and a deep-link to /posts opens the
// right tab on first paint.
export function GrassrootsFeed({ tab = 'polls' }) {
  const router = useRouter();
  const { citizen } = useCitizenAuth();
  const { me: repMe } = useRepAuth();
  const { candidate } = useCandidateAuth();
  // signedIn is the engagement gate for FeedCard + CommentsThread —
  // any signed-in identity (citizen / rep / candidate) can react,
  // vote, comment, etc. on the /polls + /posts feed. PR #11 fix:
  // the prior gate was citizen-only, which sent rep + candidate
  // users to the citizen-login modal when they tried to interact.
  const signedIn = !!citizen || !!repMe || !!candidate;
  // Citizen-only gate kept separate for the Start a poll button —
  // posts only get created from the rep/candidate's own page.
  const citizenSignedIn = !!citizen;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Branch chips are now ADDITIVE multi-select per the brief.
  // The array always contains at least one id; 'all' acts as the
  // deactivator (clicking it clears every other chip).
  const [branches, setBranches] = useState(['all']);
  const [stateFilter, setStateFilter] = useState(null);          // 2-letter code | null
  const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
  // Singleton accordion — only one comment thread is open at a time.
  const [openCommentId, setOpenCommentId] = useState(null);

  // Additive chip toggler.
  //   • Clicking 'all' clears every other chip and shows everything.
  //   • Clicking any other chip:
  //       - if it's already active, remove it (if that leaves nothing,
  //         fall back to ['all']);
  //       - otherwise add it (and drop 'all' from the set so the
  //         filter actually narrows).
  const toggleBranch = (id) => {
    if (id === 'all') {
      setBranches(['all']);
      return;
    }
    setBranches((prev) => {
      const next = prev.filter((b) => b !== 'all');
      if (next.includes(id)) {
        const after = next.filter((b) => b !== id);
        return after.length === 0 ? ['all'] : after;
      }
      return [...next, id];
    });
  };

  // Comment-accordion toggler. Opening a card's thread instantly
  // collapses any previously-open thread on the page (singleton).
  const toggleComments = (cardId) => {
    setOpenCommentId((prev) => (prev === cardId ? null : cardId));
  };

  // Tab toggle — pushes the URL so /polls ↔ /posts is bookmarkable
  // and the back button works. The actual data swap happens inside
  // GrassrootsFeed (the component re-renders with the new `tab`
  // prop on the new route).
  const handleTabChange = (next) => {
    if (next === tab) return;
    router.push(next === 'posts' ? '/posts' : '/polls');
  };

  // Per-tab branch chips. Posts tab drops 'standalone' because
  // citizens can't author posts. All other chips stay.
  const activeBranchFilters = tab === 'posts'
    ? BRANCH_FILTERS.filter((f) => f.id !== 'standalone')
    : BRANCH_FILTERS;
  const [composerOpen, setComposerOpen] = useState(false);

  // Local modal state — /polls doesn't share the home orchestrator's
  // store, so the Navbar's citizen / Subscribe / My Tracked / Dashboard
  // callbacks all route to local state here.
  const [citizenLoginOpen, setCitizenLoginOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [trackedOpen, setTrackedOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [helpBuildOpen, setHelpBuildOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // AI filter state.
  const [aiAvailable, setAiAvailable] = useState(false);
  const [activeTags, setActiveTags] = useState([]); // preset chip ids
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiFilterIds, setAiFilterIds] = useState(null); // Set<id> | null
  const [aiFilterLabel, setAiFilterLabel] = useState('');
  const [aiFilterBusy, setAiFilterBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    aiHealth().then(({ data }) => {
      if (!cancelled && data) setAiAvailable(Boolean(data.configured));
    });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Map the active chip set to server-side filter kinds. The
    // back-end knows 'rep' / 'citizen' / 'standalone' / 'candidate';
    // page-branch chips (states / congress / executive / judicial)
    // are narrowed client-side from the wider response.
    const SERVER_KINDS = new Set(['rep', 'citizen', 'standalone', 'candidate']);
    const kinds = branches.includes('all')
      ? undefined
      : branches.filter((b) => SERVER_KINDS.has(b));
    const feedFn = tab === 'posts' ? fetchPostsFeed : fetchPollsFeed;
    // The posts feed only knows 'rep' | 'candidate'. Strip the kinds
    // that don't apply so we don't ask the backend to filter on a
    // value it doesn't recognize (and so the union doesn't collapse
    // to empty on the first chip toggle).
    const POSTS_KINDS = new Set(['rep', 'candidate']);
    const effectiveKinds = tab === 'posts' && kinds
      ? kinds.filter((k) => POSTS_KINDS.has(k))
      : kinds;
    const { data, error: err } = await feedFn({
      kinds: effectiveKinds && effectiveKinds.length ? effectiveKinds : undefined,
      state: stateFilter || undefined,
    });
    setLoading(false);
    if (err || !data) {
      setError(err || 'Could not load polls.');
      setItems([]);
      return;
    }
    setItems(data.items || []);
    // Clear any active AI filter — matched_ids may reference polls
    // that fell out of the new server response.
    setAiFilterIds(null);
    setAiFilterLabel('');
    setActiveTags([]);
  }, [branches, stateFilter, tab]);

  useEffect(() => { load(); }, [load]);

  // Branch counts driven from the loaded items. Standalone counts
  // are exact; the page-bound branches (Bill/Committee/Executive/
  // Judicial) all read 0 today since the backend doesn't yet emit
  // a branch field. The chips render anyway so the visual taxonomy
  // is in place for when those counts go live.
  //
  // We additionally tally by author kind (rep / citizen / candidate /
  // standalone) directly from item.kind — that's what the hero stats
  // use. pollBranch() intentionally returns null for rep + citizen
  // (they're forward-compat to a future branch field), so without
  // this extra pass the hero's "From reps" stat would always read 0.
  const branchCounts = useMemo(() => {
    const counts = {
      all: items.length,
      bill: 0, committee: 0, executive: 0, judicial: 0,
      standalone: 0, candidate: 0,
      // Author-kind tallies for the hero stat row.
      rep: 0, citizen: 0,
    };
    for (const p of items) {
      const b = pollBranch(p);
      if (b && counts[b] != null) counts[b] += 1;
      // Author-kind pass for rep + citizen only — pollBranch already
      // tallies standalone + candidate via the b!=null branch above,
      // so re-counting them here would double them.
      const k = p && p.kind;
      if (k === 'rep' || k === 'citizen') counts[k] += 1;
    }
    return counts;
  }, [items]);

  // Branch-filter pipeline. Multi-select additive: the result is the
  // union of every active branch's matches, plus an optional state
  // narrow. The 'all' chip short-circuits to the full set (it lives
  // in the array but acts as the deactivator).
  const branchFiltered = useMemo(() => {
    let pool = items;
    if (stateFilter) {
      pool = pool.filter((p) => p.state ? p.state === stateFilter : true);
      // The backend already narrows when ?state= is sent on load();
      // this is a belt-and-suspenders client-side pass so that
      // toggling the dropdown without a refetch still feels right
      // for items that came back from a wider load.
    }
    if (branches.includes('all') || branches.length === 0) return pool;
    const active = new Set(branches);
    return pool.filter((p) => active.has(pollBranch(p)));
  }, [items, branches, stateFilter]);

  const visibleItems = useMemo(() => {
    if (aiFilterIds === null) return branchFiltered;
    return branchFiltered.filter((p) => aiFilterIds.has(p.id));
  }, [branchFiltered, aiFilterIds]);

  const aiActive = aiFilterIds !== null;
  const showActiveBanner = aiActive && visibleItems.length > 0;

  // Two empty states — see polls.css comments. Branch filter alone
  // returning zero shows the FULL empty state; AI filter returning
  // zero (with a non-empty branch result behind it) shows the
  // compact in-grid empty.
  const isFullEmpty   = !loading && branchFiltered.length === 0;
  const isInlineEmpty = !loading && !isFullEmpty && aiActive && visibleItems.length === 0;

  const runAiFilter = async (promptOverride) => {
    const finalPrompt = (promptOverride ?? aiPrompt).trim();
    if (!finalPrompt) return;
    setAiFilterBusy(true);
    const { data, error: err } = await filterPolls({
      prompt: finalPrompt,
      kind: undefined,
    });
    setAiFilterBusy(false);
    if (err || !data) {
      setError(err || 'AI filter failed.');
      return;
    }
    setAiFilterIds(new Set(data.matched_ids || []));
    setAiFilterLabel(data.explanation || `Filtered: ${finalPrompt}`);
    if (promptOverride !== undefined) setAiPrompt(promptOverride);
  };

  const togglePresetTag = (presetId) => {
    const preset = AI_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    if (aiFilterBusy) return;
    if (activeTags.includes(presetId)) {
      // Toggling off → clear the filter entirely (we only support
      // one preset chip active at a time today; toggling switches
      // between presets rather than ANDing them).
      setActiveTags([]);
      clearAiFilter();
      return;
    }
    setActiveTags([presetId]);
    runAiFilter(preset.prompt);
  };

  const clearAiFilter = () => {
    setAiFilterIds(null);
    setAiFilterLabel('');
    setAiPrompt('');
    setActiveTags([]);
  };

  const clearAllFilters = () => {
    clearAiFilter();
    setBranches(['all']);
    setStateFilter(null);
  };

  const onCreated = (poll) => {
    setComposerOpen(false);
    if (poll) {
      setItems((prev) => [normalizeCreatedPoll(poll, citizen), ...prev]);
    }
    load();
  };

  // Navbar handlers. Citizen modals live on this page so /polls
  // works as a standalone destination, not just a deep-link from home.
  const handleStartPoll = () => {
    // Start a poll is citizen-only — rep + candidate users get pushed
    // through citizen login if they want a standalone poll on this
    // feed (or they can use their own page's composer).
    if (citizenSignedIn) setComposerOpen(true);
    else setCitizenLoginOpen(true);
  };
  const handleHome = () => router.push('/');
  const handleMemberPick = (m) => {
    if (m?.bioguide_id) router.push(`/?member=${encodeURIComponent(m.bioguide_id)}`);
    else router.push('/');
  };
  const handleCandidatePick = (c) => {
    if (c?.id) router.push(`/?candidate=${encodeURIComponent(c.id)}`);
    else router.push('/');
  };
  const handleCitizenLogout = async () => {
    await logoutCitizen();
    setDashboardOpen(false);
  };

  return (
    <div className="polls-page">
      {/* Sticky navbar wrapper — the design's filter bar sticks at
          top: 56px assuming a 56px-tall navbar pinned above it. The
          shared Navbar component is position:relative by default; the
          wrapper here promotes it to sticky so the filter bar's sticky
          offset lines up with what's actually on screen.
          `compact` drops the global search bar (this page is itself a
          full-screen destination, search would compete with the polls
          feed) and `hidePollsLink` suppresses the redundant Polls
          self-link in the right cluster + hamburger. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <Navbar
          compact
          hidePollsLink
          onMemberPick={handleMemberPick}
          onCandidatePick={handleCandidatePick}
          onOpenTracked={() => setTrackedOpen(true)}
          onSubscribe={() => setWaitlistOpen(true)}
          citizen={citizen}
          onCitizenLogin={() => setCitizenLoginOpen(true)}
          onCitizenLogout={handleCitizenLogout}
          onCitizenDashboard={() => setDashboardOpen(true)}
          /* IdentitySwitcher dashboard-jump handlers — same pattern as
             app/page.js. /polls is its own Next.js route so it can't
             call the home page's local state setters directly; we
             navigate home with the page slug in the query string and
             the URL-restore branch on app/page.js opens the matching
             rep/candidate page. The Dashboard tab is reached by
             clicking it once the page loads (a sessionStorage signal
             would pre-select it; deferred until needed). */
          onOpenRepDashboard={(r) => {
            if (r?.official_id) {
              router.push(`/?page=${encodeURIComponent(r.official_id)}`);
            }
          }}
          onOpenCandidateDashboard={(c) => {
            if (c?.candidate_id) {
              router.push(`/?page=${encodeURIComponent(c.candidate_id)}`);
            }
          }}
          onOpenHelpBuild={() => setHelpBuildOpen(true)}
          onOpenFeedback={() => setFeedbackOpen(true)}
          onHome={handleHome}
        />
      </div>

      {/* Page-level top bar — back to home. Sits between the navbar
          and the hero so the user always has a one-tap escape regardless
          of whether they arrived from the home map, a deep link, or a
          bookmark. */}
      <div className="polls-topbar">
        <button
          type="button"
          className="polls-topbar__back"
          onClick={handleHome}
          aria-label="Back to CivicView home"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 6 L8 12 L14 18" />
          </svg>
          <span>Back to map</span>
        </button>
      </div>

      <PollsHero counts={branchCounts} tab={tab} />

      {/* TabStrip — Polls / Posts segmented control. Lives between
          the hero and the filter row per the design brief. */}
      <div className="polls-tabstrip-wrap polls-wrap">
        <TabStrip active={tab} onChange={handleTabChange} />
      </div>

      <div className="polls-filters">
        <div className="polls-wrap">
          <div className="polls-filters__inner">
            <div className="polls-kindrow">
              <div className="polls-kindrow__chips">
                {activeBranchFilters.map((f) => (
                  <div key={f.id} className={f.id === 'states' ? 'polls-kindrow__states-wrap' : ''}>
                    <BranchChipV2
                      filter={f}
                      active={branches.includes(f.id)}
                      count={branchCounts[f.id] || 0}
                      stateBadge={f.id === 'states' ? stateFilter : null}
                      onClick={() => {
                        if (f.id === 'states') {
                          // Toggle the dropdown AND the chip in one
                          // gesture — first click opens the dropdown
                          // and activates the chip; second click
                          // closes it.
                          if (!branches.includes('states')) toggleBranch('states');
                          setStateDropdownOpen((open) => !open);
                        } else {
                          toggleBranch(f.id);
                        }
                      }}
                      onStateBadgeClick={() => {
                        // Inline "× state" affordance only clears the
                        // state narrow — leaves the chip itself active.
                        setStateFilter(null);
                      }}
                    />
                    {f.id === 'states' && stateDropdownOpen && (
                      <StateDropdown
                        selected={stateFilter}
                        onSelect={setStateFilter}
                        onClose={() => {
                          setStateDropdownOpen(false);
                          // If the user closed the dropdown without
                          // picking a state, deactivate the States
                          // chip too — a state-less States chip is
                          // meaningless (all states are in the pool
                          // by default). Falls back to ['all'] if
                          // that was the only active chip.
                          if (!stateFilter) {
                            setBranches((prev) => {
                              const next = prev.filter((b) => b !== 'states');
                              return next.length === 0 ? ['all'] : next;
                            });
                          }
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="polls-kindrow__cta">
                <StartButton signedIn={citizenSignedIn} onClick={handleStartPoll} />
              </div>
            </div>

            {aiAvailable && (
              <AIFilterRow
                presets={AI_PRESETS}
                activeTags={activeTags}
                onToggleTag={togglePresetTag}
                query={aiPrompt}
                setQuery={setAiPrompt}
                onApply={() => runAiFilter()}
                busy={aiFilterBusy}
              />
            )}
          </div>
        </div>
      </div>

      <div className="polls-wrap">
        {error && (
          <div
            role="alert"
            style={{
              background: 'var(--cl-danger-soft)',
              color: 'var(--cl-danger-text)',
              border: '1px solid var(--cl-danger-border)',
              padding: '10px 14px',
              borderRadius: 8,
              margin: '16px 0 0',
              fontSize: '0.86rem',
            }}
          >
            {error}
          </div>
        )}

        {showActiveBanner && (
          <ActiveFilterBanner
            label={aiFilterLabel}
            shown={visibleItems.length}
            total={branchFiltered.length}
            onClear={clearAiFilter}
          />
        )}

        <TabContent tabKey={tab}>
        <div className="polls-grid">
          {loading && items.length === 0 && (
            <>
              <PollSkeleton optCount={3} />
              <PollSkeleton optCount={4} />
              <PollSkeleton optCount={3} />
              <PollSkeleton optCount={2} />
              <PollSkeleton optCount={4} />
              <PollSkeleton optCount={3} />
            </>
          )}

          {!loading && isFullEmpty && (
            <FullEmpty
              branch={branches.length === 1 ? branches[0] : 'all'}
              onClearFilters={clearAllFilters}
              onStartPoll={handleStartPoll}
              signedIn={citizenSignedIn}
            />
          )}

          {!loading && isInlineEmpty && (
            <InlineEmpty
              query={aiPrompt}
              tags={activeTags}
              onClear={clearAiFilter}
              onStartMatching={handleStartPoll}
              signedIn={citizenSignedIn}
            />
          )}

          {!loading && !isFullEmpty && !isInlineEmpty && visibleItems.map((p) => (
            <FeedCard
              key={p.id}
              card={p}
              kind={tab === "posts" ? "post" : "poll"}
              isCommentsOpen={openCommentId === p.id}
              onToggleComments={() => toggleComments(p.id)}
              signedIn={signedIn}
              onLoginRequired={() => setCitizenLoginOpen(true)}
              // Preferred: shallow-merge the patch into the matching
              // item so React re-renders ONE card. No scroll jump.
              onCardUpdated={(cardId, patch) => {
                setItems((prev) => prev.map((it) => (
                  it.id === cardId
                    ? { ...it, ...patch, viewer: { ...(it.viewer || {}), ...(patch.viewer || {}) } }
                    : it
                )));
              }}
              // Legacy fallback for destructive actions (close-poll
              // removes the row entirely; cheapest to refetch).
              onMutated={load}
              citizenViewer={citizen}
            />
          ))}
        </div>
        </TabContent>

        {!loading && !isFullEmpty && !isInlineEmpty && visibleItems.length > 0 && tab !== 'posts' && (
          <BottomStartCTA signedIn={citizenSignedIn} onClick={handleStartPoll} />
        )}
      </div>

      {/* Mobile-only sticky FAB. CSS scopes it to ≤600px container. */}
      <button
        type="button"
        className={`polls-fab ${citizenSignedIn ? '' : 'is-muted'}`}
        onClick={handleStartPoll}
      >
        {citizenSignedIn ? <PlusGlyph size={14} color="white" /> : <LockGlyph size={13} />}
        {citizenSignedIn ? 'Start a poll' : 'Sign in to start'}
      </button>

      {composerOpen && (
        <StandaloneComposer
          onCancel={() => setComposerOpen(false)}
          onCreated={onCreated}
        />
      )}

      <CitizenLoginModal
        open={citizenLoginOpen}
        onClose={() => setCitizenLoginOpen(false)}
        onSuccess={() => setCitizenLoginOpen(false)}
      />
      <CitizenWaitlistModal
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        clickedFrom="subscribe"
      />
      <MyTrackedModal
        open={trackedOpen}
        onClose={() => setTrackedOpen(false)}
        onMemberPick={handleMemberPick}
      />
      {/* ConstituentDashboard — wrapped in a fixed-position scroll
          container per the home page pattern so it doesn't inherit
          the polls page's existing scroll offset (which caused the
          dashboard to open partway down the page). */}
      {dashboardOpen && citizen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'var(--cl-bg)',
            overflowY: 'auto',
          }}
        >
          <ConstituentDashboard
            citizen={citizen}
            onClose={() => setDashboardOpen(false)}
            navbarProps={{
              citizen,
              onCitizenLogin: () => setCitizenLoginOpen(true),
              onCitizenLogout: handleCitizenLogout,
              onOpenTracked: () => {
                setDashboardOpen(false);
                setTrackedOpen(true);
              },
              onSubscribe: () => {
                setDashboardOpen(false);
                setWaitlistOpen(true);
              },
              onOpenHelpBuild: () => {
                setDashboardOpen(false);
                setHelpBuildOpen(true);
              },
              onOpenFeedback: () => {
                setDashboardOpen(false);
                setFeedbackOpen(true);
              },
            }}
          />
        </div>
      )}

      {/* Help-build overlay — surfaced via the navbar hamburger and
          forwarded through from the dashboard's embedded navbar. */}
      {helpBuildOpen && (
        <HelpBuildThisView
          onClose={() => setHelpBuildOpen(false)}
          compactNavbarProps={{
            citizen,
            onCitizenLogin: () => setCitizenLoginOpen(true),
            onCitizenLogout: handleCitizenLogout,
            onCitizenDashboard: () => {
              setHelpBuildOpen(false);
              setDashboardOpen(true);
            },
            onOpenTracked: () => {
              setHelpBuildOpen(false);
              setTrackedOpen(true);
            },
            onSubscribe: () => {
              setHelpBuildOpen(false);
              setWaitlistOpen(true);
            },
            onOpenFeedback: () => {
              setHelpBuildOpen(false);
              setFeedbackOpen(true);
            },
          }}
        />
      )}

      {/* Feedback overlay — embedded Google Form. */}
      {feedbackOpen && (
        <FeedbackView
          onClose={() => setFeedbackOpen(false)}
          compactNavbarProps={{
            citizen,
            onCitizenLogin: () => setCitizenLoginOpen(true),
            onCitizenLogout: handleCitizenLogout,
            onCitizenDashboard: () => {
              setFeedbackOpen(false);
              setDashboardOpen(true);
            },
            onOpenTracked: () => {
              setFeedbackOpen(false);
              setTrackedOpen(true);
            },
            onSubscribe: () => {
              setFeedbackOpen(false);
              setWaitlistOpen(true);
            },
            onOpenHelpBuild: () => {
              setFeedbackOpen(false);
              setHelpBuildOpen(true);
            },
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hero block — dark navy band with eyebrow + title + sub + three
// headline stats. The stats are computed from the loaded item list:
// live polls = total in feed; votes / states are derived. Numbers
// are ballpark — the feed endpoint doesn't return aggregate site
// totals today, so we display branch-derived counts that adapt as
// the feed grows.
// ─────────────────────────────────────────────────────────────────────
function PollsHero({ counts, tab = 'polls' }) {
  // Hero copy + stats swap per tab. Stats labels stay generic because
  // the per-tab semantics differ (live polls vs total posts) and the
  // backend numbers we have today are the same shape either way.
  const isPosts = tab === 'posts';
  const eyebrow = isPosts ? 'Posts · grassroots feed' : 'Civic polls · grassroots feed';
  const title = isPosts ? 'Posts' : 'Polls';
  const sub = isPosts
    ? "Every post from verified reps and candidates — see what they're saying without scrolling each page individually."
    : 'Every active poll on CivicView — what reps are asking constituents, what citizens are asking each other and the officials who serve them, and standalone polls on civic topics that don\u2019t belong to any single page.';
  const stat1Label = isPosts ? 'Total posts' : 'Live polls';
  const stat2Label = 'From reps';
  const stat3Label = 'From candidates';
  // Posts tab keeps the original 3-stat layout (citizens can't author
  // posts). Polls tab adds a 4th stat — 'From citizens' rolls citizen
  // polls (kind='citizen', citizen-targeting-a-page) AND standalone
  // polls (citizen-authored, no page) into a single citizen bucket so
  // the breakdown reads cleanly as author-kind.
  const stat4Label = isPosts ? null : 'From citizens';
  const stat1 = counts.all || 0;
  const stat2 = counts.rep || 0;
  // Candidate-authored counts on both tabs — Posts surfaces candidate
  // post counts, Polls surfaces candidate poll counts. branchCounts
  // tallies p.kind === 'candidate' on either feed shape, so the same
  // bucket works for both.
  const stat3 = counts.candidate || 0;
  const stat4 = isPosts ? null : ((counts.citizen || 0) + (counts.standalone || 0));
  return (
    <section className="polls-hero" aria-label={`${title} hero`}>
      <div className="polls-wrap">
        <div className="polls-hero__inner">
          <div>
            <div className="polls-hero__eyebrow">{eyebrow}</div>
            <h1 className="polls-hero__title">{title}</h1>
            <p className="polls-hero__sub">{sub}</p>
          </div>
          <div className="polls-hero__stats">
            <div className="polls-hero__stat">
              <span className="polls-hero__stat-num cl-num">{formatCount(stat1)}</span>
              <span className="polls-hero__stat-label">{stat1Label}</span>
            </div>
            <div className="polls-hero__stat">
              <span className="polls-hero__stat-num cl-num">{formatCount(stat2)}</span>
              <span className="polls-hero__stat-label">{stat2Label}</span>
            </div>
            <div className="polls-hero__stat">
              <span className="polls-hero__stat-num cl-num">{formatCount(stat3)}</span>
              <span className="polls-hero__stat-label">{stat3Label}</span>
            </div>
            {stat4Label && (
              <div className="polls-hero__stat">
                <span className="polls-hero__stat-num cl-num">{formatCount(stat4)}</span>
                <span className="polls-hero__stat-label">{stat4Label}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Branch chip — kind-row filter pill. Three tiers:
//   normal     → white, accent-green when active
//   standalone → dashed border + warning dot prefix
//   disabled   → reduced-opacity, "Soon" badge, non-clickable
// ─────────────────────────────────────────────────────────────────────
function BranchChip({ filter, active, count, onClick }) {
  const Glyph = BRANCH_GLYPHS[filter.glyph];
  const tierClass = filter.tier === 'standalone' ? 'polls-chip--standalone' : '';
  const disabledClass = filter.disabled ? 'is-disabled' : '';
  return (
    <button
      type="button"
      className={`polls-chip ${tierClass} ${active ? 'is-active' : ''} ${disabledClass}`}
      onClick={filter.disabled ? undefined : onClick}
      aria-pressed={active}
      aria-disabled={filter.disabled || undefined}
      title={filter.disabled ? 'Available when candidates launch' : undefined}
    >
      {Glyph && (
        <span className="polls-chip__glyph"><Glyph size={15} /></span>
      )}
      <span>{filter.label}</span>
      {filter.disabled
        ? <span className="polls-chip__soon">Soon</span>
        : <span className="polls-chip__count cl-num">{count}</span>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Start-a-poll button. Two states: signed in → primary green; signed
// out → muted white with a lock glyph that opens the citizen login
// modal on click.
// ─────────────────────────────────────────────────────────────────────
function StartButton({ signedIn, onClick }) {
  // Start a poll is a citizen-only affordance on the /polls feed. Reps
  // + candidates create polls only from their own page (where the
  // existing post-with-poll composer lives), so this button is muted
  // unless a citizen is specifically signed in.
  return (
    <button
      type="button"
      className={`polls-start-btn ${signedIn ? '' : 'is-muted'}`}
      onClick={onClick}
      title={signedIn
        ? 'Start a standalone poll'
        : 'Citizen sign-in required — reps and candidates create polls from their own page'}
    >
      {signedIn ? <PlusGlyph size={14} color="white" /> : <LockGlyph size={13} />}
      {signedIn ? 'Start a poll' : 'Citizen sign-in to start a poll'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AI filter row — preset tone chips on the left, free-form input on
// the right. Free-form Apply hits the same /api/polls/filter endpoint
// the chips do.
// ─────────────────────────────────────────────────────────────────────
function AIFilterRow({ presets, activeTags, onToggleTag, query, setQuery, onApply, busy }) {
  return (
    <div className="polls-airow" role="group" aria-label="AI-powered filters">
      <div className="polls-airow__inner">
        <span className="polls-airow__label">
          <SparkleGlyph size={13} /> AI tone filters
        </span>
        <div className="polls-airow__chips">
          {presets.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`polls-aichip ${activeTags.includes(t.id) ? 'is-active' : ''}`}
              onClick={() => onToggleTag(t.id)}
              aria-pressed={activeTags.includes(t.id)}
              disabled={busy}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="polls-airow__field">
          <span className="polls-airow__sparkle"><SparkleGlyph size={14} /></span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 300))}
            placeholder="Filter polls… (e.g. 'about taxes' or 'from @Fred')"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onApply(); } }}
            disabled={busy}
          />
          <button
            type="button"
            className="polls-airow__apply"
            onClick={onApply}
            disabled={busy || (!query.trim() && activeTags.length === 0)}
          >
            {busy ? '…' : 'Apply'}
          </button>
        </label>
      </div>
    </div>
  );
}

function ActiveFilterBanner({ label, shown, total, onClear }) {
  return (
    <div className="polls-active-banner" role="status">
      <span className="polls-active-banner__sparkle"><SparkleGlyph size={14} /></span>
      <span className="polls-active-banner__text">
        AI-filtered: <strong>{label}</strong>{' '}
        <span className="polls-active-banner__count">— showing {shown} of {total}</span>
      </span>
      <button type="button" className="polls-active-banner__clear" onClick={onClear}>
        Clear <CloseGlyph size={11} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty states.
//   FullEmpty   — used when the branch filter alone returns zero.
//                 Big card, megaphone glyph, primary "Start a poll" CTA.
//                 Rare in production but right for first-load.
//   InlineEmpty — the common case. Compact, sits inside the grid as
//                 one full-width row, echoes the filter text back, pairs
//                 Clear filter + Start a poll matching this. Reads as
//                 part of the feed, not a takeover.
// ─────────────────────────────────────────────────────────────────────
function FullEmpty({ branch, onClearFilters, onStartPoll, signedIn }) {
  const branchLabel = BRANCH_FILTERS.find((b) => b.id === branch)?.label || 'this branch';
  const isAll = branch === 'all';
  return (
    <div className="polls-empty">
      <div className="polls-empty__glyph"><MegaphoneGlyph size={28} /></div>
      <div className="polls-empty__title">
        {isAll ? 'No polls live yet.' : `No ${branchLabel.toLowerCase()} polls match.`}
      </div>
      <div className="polls-empty__body">
        {isAll
          ? 'When reps and citizens start posting polls, they appear here. The feed is grassroots — what citizens ask is what other citizens see next.'
          : 'Try clearing your filter — or start a poll yourself. The feed is grassroots: what citizens ask here is what other citizens see next.'}
      </div>
      <div className="polls-empty__actions">
        {!isAll && (
          <button className="polls-empty__btn polls-empty__btn--ghost" onClick={onClearFilters}>
            Clear filters
          </button>
        )}
        <button
          className={`polls-empty__btn ${signedIn ? 'polls-empty__btn--primary' : 'polls-empty__btn--ghost'}`}
          onClick={onStartPoll}
        >
          {signedIn
            ? <><PlusGlyph size={13} color="white" /> Start a poll</>
            : <><LockGlyph size={12} /> Sign in to start a poll</>}
        </button>
      </div>
    </div>
  );
}

function InlineEmpty({ query, tags, onClear, onStartMatching, signedIn }) {
  const tagLabels = tags
    .map((id) => AI_PRESETS.find((p) => p.id === id)?.label)
    .filter(Boolean);
  const filterStr = query?.trim() || tagLabels.join(' + ') || 'your filter';
  return (
    <div className="polls-empty polls-empty--inline">
      <div className="polls-empty__glyph"><SparkleGlyph size={20} /></div>
      <div className="polls-empty__body-wrap">
        <div className="polls-empty__title">Nothing matches your AI filter yet.</div>
        <div className="polls-empty__filter">
          Filtered for <strong>&ldquo;{filterStr}&rdquo;</strong> — no polls in the current
          feed match. Try a different angle, clear the filter, or start one yourself.
        </div>
      </div>
      <div className="polls-empty__actions">
        <button className="polls-empty__btn polls-empty__btn--ghost" onClick={onClear}>
          Clear filter
        </button>
        <button
          className={`polls-empty__btn ${signedIn ? 'polls-empty__btn--primary' : 'polls-empty__btn--ghost'}`}
          onClick={onStartMatching}
        >
          {signedIn
            ? <><PlusGlyph size={13} color="white" /> Start a poll matching this</>
            : <><LockGlyph size={12} /> Sign in to start one</>}
        </button>
      </div>
    </div>
  );
}

function BottomStartCTA({ signedIn, onClick }) {
  return (
    <div className="polls-bottom-cta">
      <div className="polls-bottom-cta__text">
        <span className="polls-bottom-cta__title">Don&rsquo;t see your question?</span>
        <span className="polls-bottom-cta__sub">
          Start a poll — verified citizens can ask the rest of CivicView directly from this page.
        </span>
      </div>
      <StartButton signedIn={signedIn} onClick={onClick} />
    </div>
  );
}
// Skeleton card — shown during initial load.
function PollSkeleton({ optCount = 3 }) {
  const widths = [78, 56, 42, 34, 28];
  return (
    <div className="poll-skel" aria-hidden="true">
      <div className="skel-row">
        <div className="skel-bar" style={{ width: 38, height: 16 }} />
        <div className="skel-bar" style={{ width: 68, height: 14 }} />
        <div className="skel-bar" style={{ width: 44, height: 12, marginLeft: 'auto' }} />
      </div>
      <div className="skel-row">
        <div className="skel-bar skel-circle" style={{ width: 36, height: 36 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="skel-bar" style={{ width: '60%', height: 12 }} />
          <div className="skel-bar" style={{ width: '40%', height: 10 }} />
        </div>
      </div>
      <div className="skel-bar" style={{ width: '92%', height: 14 }} />
      <div className="skel-bar" style={{ width: '74%', height: 14 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
        {Array.from({ length: optCount }).map((_, i) => (
          <div key={i} className="skel-opt" style={{ ['--w']: `${widths[i]}%` }} />
        ))}
      </div>
      <div className="skel-row" style={{ paddingTop: 10, borderTop: '1px solid var(--cl-divider)' }}>
        <div className="skel-bar" style={{ width: 110, height: 11 }} />
        <div className="skel-bar" style={{ width: 70, height: 11, marginLeft: 'auto' }} />
      </div>
    </div>
  );
}

// Helper to shape a freshly-created standalone poll into the same
// row shape the feed endpoint emits, so the optimistic prepend
// doesn't break the card render.
function normalizeCreatedPoll(citizenPollRead, citizen) {
  const inner = citizenPollRead.poll || {};
  return {
    id: citizenPollRead.id,
    kind: 'standalone',
    author: citizen?.display_name || 'You',
    role: citizen?.state ? `${citizen.state}${citizen.city ? ` · ${citizen.city}` : ''}` : null,
    party: null,
    official_id: null,
    page_tag: null,
    created_at: inner.created_at || new Date().toISOString(),
    question: inner.question,
    options: (inner.options || []).map((o) => ({ label: o.text, percent: 0, count: 0 })),
    votes: 0,
    comments: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Standalone poll composer modal — question + 2-8 options + close
// timing + presentation mode. Mirrors the on-page citizen-poll
// composer (CreateCitizenPollModal in CitizenPollsSection.js) so a
// citizen authoring a standalone poll gets the same control surface
// as authoring one on a rep / candidate page.
// ─────────────────────────────────────────────────────────────────────
function StandaloneComposer({ onCancel, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  // Close timing — 'none' = stays open indefinitely; 'duration' =
  // closes N minutes/hours/days from now; 'date' = closes at an
  // explicit datetime the user picks.
  const [timing, setTiming] = useState('none');
  const [durationValue, setDurationValue] = useState('1');
  const [durationUnit, setDurationUnit] = useState('days');
  const [dateValue, setDateValue] = useState('');
  // Result-display — same three modes the backend accepts:
  //   'full'                 — counts visible from the moment the
  //                            first vote lands.
  //   'hidden'               — viewer toggles "show results" manually.
  //   'reveal_after_close'   — counts are blacked out until close,
  //                            then revealed to everyone. Requires a
  //                            close time (the close radio is disabled
  //                            when timing === 'none').
  const [presentation, setPresentation] = useState('full');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  // Resolve the chosen timing to an ISO string the backend expects.
  // Returns null when timing is 'none' OR when the user picked a
  // mode but hasn't entered a valid value yet.
  const closesAtIso = useMemo(() => {
    if (timing === 'none') return null;
    if (timing === 'duration') {
      const n = parseFloat(durationValue);
      if (!Number.isFinite(n) || n <= 0) return null;
      const unitMs = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[durationUnit] || 0;
      return new Date(Date.now() + n * unitMs).toISOString();
    }
    if (timing === 'date') {
      if (!dateValue) return null;
      const t = new Date(dateValue).getTime();
      if (Number.isNaN(t) || t <= Date.now()) return null;
      return new Date(t).toISOString();
    }
    return null;
  }, [timing, durationValue, durationUnit, dateValue]);

  // Submit gate — question + ≥2 options always required; if the
  // user picked a timing mode (not 'none'), the resolved ISO has to
  // be valid (future + parseable) before they can publish.
  const canSubmit =
    question.trim().length > 0 &&
    options.filter((o) => o.trim()).length >= 2 &&
    !submitting &&
    (timing === 'none' || !!closesAtIso);

  const setOption = (i, value) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  };
  const addOption = () => {
    if (options.length >= 8) return;
    setOptions((prev) => [...prev, '']);
  };
  const removeOption = (i) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    const { data, error } = await createStandalonePoll({
      question: question.trim(),
      options: cleanOptions,
      closesAt: closesAtIso,
      presentationMode: presentation,
    });
    setSubmitting(false);
    if (error || !data) {
      setErr(error || 'Could not create poll.');
      return;
    }
    onCreated(data);
  };

  return (
    <div
      role="dialog"
      aria-label="Start a standalone poll"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          padding: 20,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Start a standalone poll</h2>
          <button type="button" onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--cl-text-light)', fontSize: '0.9rem' }}>
            Cancel
          </button>
        </div>
        <p style={{ fontSize: '0.84rem', color: 'var(--cl-text-light)', margin: 0, lineHeight: 1.5 }}>
          Standalone polls aren&rsquo;t tied to any single rep&rsquo;s page.
          Use this for federal-policy questions, cross-jurisdictional issues,
          or anything that affects everyone. You can have one active standalone
          poll at a time — close it to start another.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Question</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
            placeholder="What do you want to ask?"
            rows={3}
            maxLength={500}
            style={{
              padding: '8px 10px',
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              fontSize: '0.92rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', alignSelf: 'flex-end' }}>{question.length}/500</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Options (2–8)</span>
          {options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={opt}
                onChange={(e) => setOption(i, e.target.value.slice(0, 255))}
                placeholder={`Option ${i + 1}`}
                maxLength={255}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 8,
                  fontSize: '0.88rem',
                  fontFamily: 'inherit',
                }}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  style={{
                    padding: '0 10px',
                    border: '1px solid var(--cl-border)',
                    background: 'white',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: 'var(--cl-text-light)',
                    fontSize: '0.78rem',
                  }}
                  title="Remove this option"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 8 && (
            <button
              type="button"
              onClick={addOption}
              style={{
                alignSelf: 'flex-start',
                padding: '4px 10px',
                border: '1px dashed var(--cl-border)',
                background: 'transparent',
                borderRadius: 8,
                cursor: 'pointer',
                color: 'var(--cl-accent)',
                fontSize: '0.82rem',
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              + Add option
            </button>
          )}
        </div>

        {/* Close timing — parallel to CreateCitizenPollModal so a
            citizen authoring a standalone poll sees the same set of
            close-time choices they'd see authoring one on a rep page. */}
        <div style={{ paddingTop: 12, borderTop: '1px dashed var(--cl-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>When does this poll close?</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="radio" name="sp-timing" checked={timing === 'none'} onChange={() => setTiming('none')} />
            <span>No close time — stays open</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', flexWrap: 'wrap' }}>
            <input type="radio" name="sp-timing" checked={timing === 'duration'} onChange={() => setTiming('duration')} />
            <span>After</span>
            <input
              type="number"
              min="1"
              value={durationValue}
              onChange={(e) => { setTiming('duration'); setDurationValue(e.target.value); }}
              style={{ width: 70, padding: '5px 8px', border: '1px solid var(--cl-border)', borderRadius: 6, fontSize: '0.85rem', fontFamily: 'inherit' }}
            />
            <select
              value={durationUnit}
              onChange={(e) => { setTiming('duration'); setDurationUnit(e.target.value); }}
              style={{ padding: '5px 8px', border: '1px solid var(--cl-border)', borderRadius: 6, fontSize: '0.85rem', fontFamily: 'inherit' }}
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', flexWrap: 'wrap' }}>
            <input type="radio" name="sp-timing" checked={timing === 'date'} onChange={() => setTiming('date')} />
            <span>On</span>
            <input
              type="datetime-local"
              value={dateValue}
              onChange={(e) => { setTiming('date'); setDateValue(e.target.value); }}
              style={{ padding: '5px 8px', border: '1px solid var(--cl-border)', borderRadius: 6, fontSize: '0.85rem', fontFamily: 'inherit' }}
            />
          </label>
          {timing !== 'none' && closesAtIso && (
            <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
              Closes {new Date(closesAtIso).toLocaleString()}
            </span>
          )}
          {timing !== 'none' && !closesAtIso && (
            <span style={{ fontSize: '0.72rem', color: '#c33333', fontStyle: 'italic' }}>
              Pick a moment in the future.
            </span>
          )}
        </div>

        {/* Result-display mode. reveal_after_close is disabled when
            timing is 'none' — backend rejects it without a close
            time, and the disabled state surfaces that constraint
            up front instead of as a form error after submit. */}
        <div style={{ paddingTop: 12, borderTop: '1px dashed var(--cl-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Show results?</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="radio" name="sp-pres" checked={presentation === 'full'} onChange={() => setPresentation('full')} />
            <span>Show vote percentages right away</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="radio" name="sp-pres" checked={presentation === 'hidden'} onChange={() => setPresentation('hidden')} />
            <span>Hide results until viewer chooses to see them</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', opacity: timing === 'none' ? 0.4 : 1 }}>
            <input
              type="radio"
              name="sp-pres"
              checked={presentation === 'reveal_after_close'}
              disabled={timing === 'none'}
              onChange={() => setPresentation('reveal_after_close')}
            />
            <span>Hide until poll closes (requires a close time)</span>
          </label>
        </div>

        {err && (
          <div role="alert" style={{ color: '#d63031', fontSize: '0.82rem', background: 'var(--cl-danger-soft)', padding: '6px 10px', borderRadius: 6 }}>
            {err}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 14px',
              background: 'white',
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: '8px 16px',
              background: canSubmit ? 'var(--cl-accent)' : 'var(--cl-border)',
              color: canSubmit ? 'white' : 'var(--cl-text-light)',
              border: '1px solid var(--cl-accent)',
              borderRadius: 8,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Posting…' : 'Post poll'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Glyphs — Phosphor-duotone-style icons, 24x24 viewBox, navy stroke
// + 28% accent fill on duotone shapes. Lifted from the design export
// at /Design Exports/civicview-polls-page/project/polls-glyphs.jsx.
// Inlined here so the page is self-contained and doesn't pull in
// another file across an import boundary.
// ─────────────────────────────────────────────────────────────────────
const AllPollsGlyph = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="3.2" rx="1" fill={color} opacity="0.28" />
    <rect x="3" y="10.4" width="18" height="3.2" rx="1" fill={color} opacity="0.28" />
    <rect x="3" y="16.8" width="18" height="3.2" rx="1" fill={color} opacity="0.28" />
    <rect x="3" y="4" width="18" height="3.2" rx="1" stroke={color} strokeWidth="1.6" />
    <rect x="3" y="10.4" width="18" height="3.2" rx="1" stroke={color} strokeWidth="1.6" />
    <rect x="3" y="16.8" width="18" height="3.2" rx="1" stroke={color} strokeWidth="1.6" />
  </svg>
);
const BillGlyph = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 3 H15 L19 7 V21 H6 Z" fill={color} opacity="0.28" stroke={color} strokeWidth="1.6" strokeLinejoin="miter" />
    <path d="M15 3 V7 H19" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="miter" />
    <path d="M9 11 H16 M9 14 H16 M9 17 H13" stroke={color} strokeWidth="1.4" strokeLinecap="butt" />
  </svg>
);
const CommitteeGlyph = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="5" fill={color} opacity="0.28" stroke={color} strokeWidth="1.6" />
    <circle cx="12" cy="4" r="1.6" fill={color} />
    <circle cx="12" cy="20" r="1.6" fill={color} />
    <circle cx="4" cy="12" r="1.6" fill={color} />
    <circle cx="20" cy="12" r="1.6" fill={color} />
  </svg>
);
const ExecutiveGlyph = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 9 L12 4 L21 9 Z" fill={color} opacity="0.28" stroke={color} strokeWidth="1.6" strokeLinejoin="miter" />
    <rect x="4" y="9" width="16" height="2" fill={color} opacity="0.4" />
    <rect x="6" y="11" width="2" height="8" fill={color} opacity="0.28" stroke={color} strokeWidth="1.4" />
    <rect x="11" y="11" width="2" height="8" fill={color} opacity="0.28" stroke={color} strokeWidth="1.4" />
    <rect x="16" y="11" width="2" height="8" fill={color} opacity="0.28" stroke={color} strokeWidth="1.4" />
    <path d="M3 20 H21" stroke={color} strokeWidth="1.6" strokeLinecap="butt" />
  </svg>
);
const JudicialGlyph = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 4 V20" stroke={color} strokeWidth="1.6" strokeLinecap="butt" />
    <path d="M5 8 H19" stroke={color} strokeWidth="1.6" strokeLinecap="butt" />
    <path d="M5 8 L3 13 H7 Z" fill={color} opacity="0.28" stroke={color} strokeWidth="1.4" strokeLinejoin="miter" />
    <path d="M19 8 L17 13 H21 Z" fill={color} opacity="0.28" stroke={color} strokeWidth="1.4" strokeLinejoin="miter" />
    <path d="M8 20 H16" stroke={color} strokeWidth="1.6" strokeLinecap="butt" />
  </svg>
);
const StandaloneGlyph = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 5 H20 V16 H10 L6 20 V16 H4 Z" fill={color} opacity="0.28" stroke={color} strokeWidth="1.6" strokeLinejoin="miter" />
    <circle cx="8.5" cy="10.5" r="1" fill={color} />
    <circle cx="12" cy="10.5" r="1" fill={color} />
    <circle cx="15.5" cy="10.5" r="1" fill={color} />
  </svg>
);
const FromCandidatesGlyph = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="9" cy="8" r="2.8" fill={color} opacity="0.28" stroke={color} strokeWidth="1.6" />
    <path d="M3 20c0-3 2.7-5.4 6-5.4s6 2.4 6 5.4" stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.22" strokeLinecap="butt" />
    <path d="M18 5 L19 8 L22 8.5 L19.5 10.5 L20.5 13.5 L18 12 L15.5 13.5 L16.5 10.5 L14 8.5 L17 8 Z" fill={color} opacity="0.85" />
  </svg>
);
const PlusGlyph = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 4 L12 20 M4 12 L20 12" stroke={color} strokeWidth="2.2" strokeLinecap="butt" />
  </svg>
);
const SparkleGlyph = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3 L13.8 9.6 L20.4 11.4 L13.8 13.2 L12 19.8 L10.2 13.2 L3.6 11.4 L10.2 9.6 Z"
          fill={color} opacity="0.28" stroke={color} strokeWidth="1.6" strokeLinejoin="miter" />
    <path d="M19 4 L19.6 6 L21.6 6.6 L19.6 7.2 L19 9.2 L18.4 7.2 L16.4 6.6 L18.4 6 Z" fill={color} />
  </svg>
);
const CloseGlyph = ({ size = 12, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 5 L19 19 M19 5 L5 19" stroke={color} strokeWidth="2.2" strokeLinecap="butt" />
  </svg>
);
const ChatGlyph = ({ size = 12, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 5 H20 V16 H10 L6 20 V16 H4 Z" stroke={color} strokeWidth="1.8" fill={color} fillOpacity="0.22" strokeLinejoin="miter" />
  </svg>
);
const VoteGlyph = ({ size = 12, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 10 L4 20 L20 20 L20 10" stroke={color} strokeWidth="1.8" fill={color} fillOpacity="0.22" strokeLinejoin="miter" strokeLinecap="butt" />
    <path d="M8 10 L8 6 L16 6 L16 10" stroke={color} strokeWidth="1.8" fill="none" />
    <path d="M9 14 L11.5 16.5 L16 12" stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="butt" />
  </svg>
);
const ArrowGlyph = ({ size = 12, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12 L19 12 M13 6 L19 12 L13 18" stroke={color} strokeWidth="2" strokeLinecap="butt" strokeLinejoin="miter" fill="none" />
  </svg>
);
const LockGlyph = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="1" fill={color} opacity="0.28" stroke={color} strokeWidth="1.6" />
    <path d="M8 11 V8 a4 4 0 0 1 8 0 V11" stroke={color} strokeWidth="1.6" fill="none" />
  </svg>
);
const MegaphoneGlyph = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 9 L3 15 L8 15 L18 20 L18 4 Z" fill={color} opacity="0.28" stroke={color} strokeWidth="1.8" strokeLinejoin="miter" />
    <path d="M21 9 L21 15" stroke={color} strokeWidth="1.8" strokeLinecap="butt" />
    <path d="M8 15 L9 21 L12 21 L11 15" stroke={color} strokeWidth="1.8" fill={color} fillOpacity="0.28" />
  </svg>
);

// Glyph lookup keyed by the BRANCH_FILTERS `glyph` field.
const BRANCH_GLYPHS = {
  AllPolls: AllPollsGlyph,
  Bill: BillGlyph,
  Committee: CommitteeGlyph,
  Executive: ExecutiveGlyph,
  Judicial: JudicialGlyph,
  Standalone: StandaloneGlyph,
  FromCandidates: FromCandidatesGlyph,
};

// Default export — /polls/page.js routes here. /posts/page.js
// imports GrassrootsFeed directly and passes tab='posts'.
export default function PollsPage() {
  return <GrassrootsFeed tab="polls" />;
}
