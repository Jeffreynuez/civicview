// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * FeedCard — shared card shell used on the redesigned /polls + /posts
 * pages. This PR (#2) only wires the POLL variant; the POST variant
 * lands in PR #3 along with the /posts route. The shared shell is
 * here so both PRs touch the same file rather than duplicating the
 * top-row + author-row + action-row layout.
 *
 * Visual weight matches the rep-page card (the reference for the
 * redesign). Per-card mandatory pieces:
 *
 *   • Top row:    kind chip → page tag → timestamp → [close X if
 *                 standalone-poll + viewer is the author]
 *   • Author row: avatar + name + "Unverified" pill + role
 *   • Body:       poll question + clickable option rows + closes-in
 *                 (poll variant), or post body + Expand (post variant)
 *   • Footer:     like / dislike / Comments(N) — clicking the
 *                 comments pill fires onToggleComments so the parent
 *                 can manage the singleton-accordion behavior.
 *   • Accordion:  CommentsThread mounts beneath the card when
 *                 isCommentsOpen is true (lazy — parent unmounts when
 *                 the user opens a different card's thread).
 *
 * Props:
 *   card             — feed item from /api/feed/polls (or /posts)
 *   kind             — 'poll'                (PR #3 adds 'post')
 *   isCommentsOpen   — bool                  parent owns the singleton
 *   onToggleComments — () => void
 *   onMutated        — () => void            tell parent to refetch
 *   signedIn         — bool
 *   onLoginRequired  — () => void
 *   citizenViewer    — citizen | null        used for Delete affordance
 */

import { useEffect, useState } from 'react';
// Co-located stylesheet. FeedCard.css contains every .feed-card__*,
// .feed-act, .poll-block, .poll-opt2, and .thread__ rule that this
// component (and its CommentsThread child) need. Extracted from
// app/polls/polls.css in Task #74 so the styles travel with the
// component anywhere it renders — the home page National activity
// section, /polls, /posts. The /polls page-route still imports its
// own polls.css for page-chrome styles (hero, tabstrip, branch
// chips, etc.).
import './FeedCard.css';
import {
  voteOnCitizenPoll,
  closeCitizenPoll,
  votePoll,
  reactToPost,
  clearReaction,
  reactToCitizenPoll,
  clearCitizenPollReaction,
  deletePost,
  updatePost,
  reportPost,
  summarizePost,
  aiHealth,
  saveItem,
  unsaveItem,
} from '../../lib/pagesApi';
import { useAuth as useRepAuth } from '../../lib/auth';
import { useCandidateAuth } from '../../lib/candidateAuth';
import { getVoterToken } from '../../lib/voterToken';
import { useActiveIdentities, pickEngagementIdentity } from '../../lib/activeIdentities';
import IdentityPicker from '../IdentityPicker';
import { ThumbsUp, ThumbsDown, ChatText } from '../ui';
import PostActionsMenu from '../PostActionsMenu';
import CommentsThread from './CommentsThread';
import PollResultsModal from './PollResultsModal';
import PollDemographicsForm from './PollDemographicsForm';

export default function FeedCard({
  card,
  kind = 'poll',
  isCommentsOpen,
  onToggleComments,
  // onCardUpdated(cardId, patch) — preferred: merge patched fields
  // into one card in place; no full feed reload, no scroll jump.
  onCardUpdated,
  // onMutated() — legacy: triggers a full feed reload. Kept as a
  // fallback for callers that haven't switched to onCardUpdated yet,
  // and used after destructive actions (close-poll) where the row
  // disappears entirely.
  onMutated,
  signedIn = false,
  onLoginRequired,
  citizenViewer = null,
}) {
  // Self-delete X (top-right). Three ownership paths:
  //   • Standalone poll authored by the viewing citizen (existing)
  //   • Rep-authored post / poll viewed by that rep
  //   • Candidate-authored post / poll viewed by that candidate
  // The backend rejects requests from the wrong identity, so the UI
  // gate is a hint — but rendering the X only when ownership is
  // plausible keeps it out of view for non-authors.
  const isStandalone = card.kind === 'standalone';
  const viewer = card.viewer || { voter_choice_id: null, is_author: false };
  // Like/dislike active state. Backend ships viewer.my_reactions as a
  // per-identity map ({citizen: 'up', rep: 'down', ...}) — the button
  // is "active" when ANY of the viewer's identities has reacted with
  // that kind. Falls back to the legacy single viewer.my_reaction for
  // freshly-merged responses (mergeViewerReactionSummary sets the
  // legacy field; this OR covers both pre-click and post-click state).
  const _myRxns = viewer.my_reactions || {};
  const _rxnValues = Object.values(_myRxns);
  const upActive = _rxnValues.includes('up') || viewer.my_reaction === 'up';
  const downActive = _rxnValues.includes('down') || viewer.my_reaction === 'down';
  const { me: rep } = useRepAuth();
  const { candidate } = useCandidateAuth();
  const isCitizenAuthor = kind === 'poll' && isStandalone && viewer.is_author;
  const isRepAuthor = !!(
    rep && card.official_id && rep.official_id === card.official_id
  );
  const isCandidateAuthor = !!(
    candidate && card.official_id && candidate.candidate_id === card.official_id
  );
  // The card itself dictates whether deletion uses closeCitizenPoll
  // (standalone) or deletePost (rep / candidate posts + polls — rep
  // polls cascade-delete with their parent post). Compute once.
  const deletionTarget = (() => {
    if (isCitizenAuthor) return { kind: 'citizen-poll' };
    if (kind === 'post' && (isRepAuthor || isCandidateAuthor)) {
      return { kind: 'post', id: card.id };
    }
    // Rep / candidate polls attach to a parent post — delete the post
    // and the poll goes with it.
    if (kind === 'poll' && (isRepAuthor || isCandidateAuthor) && card.parent_post_id) {
      return { kind: 'post', id: card.parent_post_id };
    }
    return null;
  })();
  const showCloseX = !!deletionTarget;

  const [busy, setBusy] = useState(false);
  const [savingBusy, setSavingBusy] = useState(false);
  // Save / unsave this card to the viewing citizen's dashboard
  // (Task #16). Optimistic: patch viewer.is_saved immediately and
  // revert on error. Only verified citizens get the action (the
  // kebab item is gated on citizenViewer below).
  const handleToggleSave = async () => {
    if (savingBusy) return;
    const currentlySaved = !!viewer.is_saved;
    const args = { itemType: kind === 'post' ? 'post' : 'poll', itemId: card.id };
    setSavingBusy(true);
    if (typeof onCardUpdated === 'function') {
      onCardUpdated(card.id, { viewer: { is_saved: !currentlySaved } });
    }
    const { error } = await (currentlySaved ? unsaveItem(args) : saveItem(args));
    setSavingBusy(false);
    if (error && typeof onCardUpdated === 'function') {
      onCardUpdated(card.id, { viewer: { is_saved: currentlySaved } });
    }
  };
  const [errorMsg, setErrorMsg] = useState(null);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [demoVote, setDemoVote] = useState(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Post-body collapse — long bodies (>400 chars) show an Expand pill
  // and stay collapsed by default. Same pattern the rep page uses.
  const [expanded, setExpanded] = useState(false);
  // Edit-post state (Task #68). Mirrors PostCard's pattern. Uses
  // onCardUpdated() to bubble the new body + edited_at back to the
  // parent feed's card list if the parent wires that callback;
  // falls back to a local override otherwise (defensive — without
  // the override, the textarea closes after save but the body
  // re-renders from the stale card.body and the edit appears to
  // vanish).
  const [editingPostBody, setEditingPostBody] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [postEditErr, setPostEditErr] = useState(null);
  const [postBodyOverride, setPostBodyOverride] = useState(null);
  const [postEditedAtOverride, setPostEditedAtOverride] = useState(null);

  // AI summarize — long posts only. Mirrors PostCard.js:283-311 so the
  // /posts feed exposes the same TL;DR affordance as the rep page.
  // Probe aiHealth once per FeedCard mount; the answer is cheap and
  // stable for the session.
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummaryErr, setAiSummaryErr] = useState(null);
  useEffect(() => {
    if (kind !== 'post') return undefined;
    let cancelled = false;
    aiHealth().then(({ data }) => {
      if (!cancelled && data) setAiAvailable(Boolean(data.configured));
    });
    return () => { cancelled = true; };
  }, [kind]);
  const _bodyWordCount = ((card.body || '').trim().match(/\S+/g) || []).length;
  const _showSummarize = aiAvailable && kind === 'post' && _bodyWordCount >= 300;
  const _handleSummarize = async () => {
    if (aiSummaryBusy) return;
    setAiSummaryBusy(true);
    setAiSummaryErr(null);
    const { data, error } = await summarizePost(card.id);
    setAiSummaryBusy(false);
    if (error || !data) {
      setAiSummaryErr(error || 'Summary failed');
      return;
    }
    setAiSummary(data);
  };

  // ── Edit-post handlers (Task #68) ───────────────────────────────
  const _canEditPost = kind === 'post' && (isRepAuthor || isCandidateAuthor);
  const beginEditPost = () => {
    setEditingPostBody(postBodyOverride ?? card.body ?? '');
    setPostEditErr(null);
  };
  const cancelEditPost = () => {
    setEditingPostBody(null);
    setPostEditErr(null);
  };
  const handleSavePost = async () => {
    const draft = (editingPostBody || '').trim();
    if (!draft) {
      setPostEditErr('Post body cannot be empty.');
      return;
    }
    setPostEditErr(null);
    setEditBusy(true);
    const { data, error } = await updatePost(card.id, draft);
    setEditBusy(false);
    if (error) {
      setPostEditErr(error);
      return;
    }
    const newBody = data?.body ?? draft;
    const newEditedAt = data?.edited_at ?? new Date().toISOString();
    setPostBodyOverride(newBody);
    setPostEditedAtOverride(newEditedAt);
    setEditingPostBody(null);
    if (typeof onCardUpdated === 'function') {
      onCardUpdated(card.id, { body: newBody, edited_at: newEditedAt });
    } else if (typeof onMutated === 'function') {
      onMutated();
    }
  };

  // ── Report-post handlers (Task #76) ─────────────────────────────
  // Mirrors PostCard.handleReportPost. A signed-in viewer who is NOT
  // the author can flag a post; the backend dedupes against the
  // citizen identity so a re-flag returns already_reported, which we
  // treat as success (the visual state lands at "Reported ✓" either
  // way). Anonymous viewers route through onLoginRequired instead —
  // mirrors the like/dislike behavior so Report fits the same gate.
  const [postReported, setPostReported] = useState(false);
  const [postReportBusy, setPostReportBusy] = useState(false);
  const _isPostOwner = isRepAuthor || isCandidateAuthor || isCitizenAuthor;
  const _canReportPost = !_isPostOwner && kind === 'post';
  const handleReportPost = async () => {
    if (postReportBusy || postReported) return;
    if (!signedIn) {
      if (typeof onLoginRequired === 'function') onLoginRequired();
      return;
    }
    setPostReportBusy(true);
    const { error } = await reportPost(card.id);
    setPostReportBusy(false);
    if (error) {
      setErrorMsg(error);
      return;
    }
    setPostReported(true);
  };

  // Multi-identity picker state. The /polls + /posts feed treats
  // every viewer as the "owner" for picker purposes — when 2+
  // identities are signed in, every engagement action (vote, like,
  // dislike, comment) routes through the picker so the user is
  // explicit about which identity is acting. The backend rejects
  // invalid combinations (e.g. rep self-engaging on another rep's
  // post) and we surface the error inline.
  const activeIdentities = useActiveIdentities({ isOwner: true });
  // votePicker = { optionId, identities } when open, null otherwise.
  // reactPicker = { kind: 'up'|'down', identities } when open.
  const [votePicker, setVotePicker] = useState(null);
  const [reactPicker, setReactPicker] = useState(null);

  // ── handlers ────────────────────────────────────────────────────
  // Fire the actual vote against the right backend endpoint for the
  // card kind. Rep + candidate polls live under the page's poll
  // endpoint; citizen + standalone polls live under /api/citizen-polls.
  const fireVote = async (optionId, asIdentity) => {
    setBusy(true);
    setErrorMsg(null);
    let res;
    if (card.kind === 'rep' || card.kind === 'candidate') {
      if (!card.official_id) {
        setBusy(false);
        setErrorMsg('Missing page reference for this poll.');
        return;
      }
      res = await votePoll(card.official_id, card.id, {
        optionId,
        voterToken: getVoterToken(),
        asIdentity,
      });
    } else {
      res = await voteOnCitizenPoll(card.id, optionId, asIdentity);
    }
    setBusy(false);
    if (res?.error) {
      setErrorMsg(typeof res.error === 'string' ? res.error : 'Could not record vote.');
      return;
    }
    // Local-merge path: build a patch from the response without a
    // full feed reload, so the page doesn't scroll-jump back to the
    // top of the grid on every click.
    if (res?.data && onCardUpdated) {
      const updated = res.data;
      // votePoll → full PollRead; voteOnCitizenPoll → CitizenPollRead.
      // Both expose the same vote-relevant fields under slightly
      // different keys, so reach for what's present.
      const patch = _votePatch(card, updated);
      onCardUpdated(card.id, patch);
    } else {
      // Fallback when caller hasn't wired onCardUpdated yet.
      onMutated?.();
    }
    // Offer the optional demographics step to citizen voters (the form
    // self-hides when the poll has no attached form).
    if (!res?.error && (!asIdentity || asIdentity === 'citizen')) {
      setDemoVote({ optionId, asIdentity });
    }
  };

  const handleVote = (optionId) => {
    if (busy) return;
    if (!signedIn) { onLoginRequired?.(); return; }
    const decision = pickEngagementIdentity({ identities: activeIdentities });
    if (decision.none) {
      onLoginRequired?.();
      return;
    }
    if (decision.single) {
      // Single identity — fire directly, no picker needed.
      fireVote(optionId, decision.single);
      return;
    }
    // Multi-identity — pop the picker. The user picks who's casting.
    // Mark each identity row '✓ Voted' only when THAT specific
    // identity has voted for THIS specific option — read from the
    // backend's per-identity map. Falls back to the legacy single
    // voter_choice_id only if the per-identity map is absent (older
    // backend response shape).
    const choicesByIdentity = (viewer && viewer.voter_choices) || {};
    setVotePicker({
      optionId,
      identities: decision.showPicker.map((id) => ({
        ...id,
        currentState: choicesByIdentity[id.kind] === optionId ? 'voted' : null,
      })),
    });
  };

  const onVotePick = (asIdentity) => {
    const optionId = votePicker?.optionId;
    setVotePicker(null);
    if (optionId != null) fireVote(optionId, asIdentity);
  };

  const handleConfirmClose = async () => {
    if (busy || !deletionTarget) return;
    setBusy(true);
    setErrorMsg(null);
    let res;
    if (deletionTarget.kind === 'citizen-poll') {
      res = await closeCitizenPoll(card.id);
    } else {
      // 'post' — covers rep/candidate post cards AND rep/candidate
      // polls (whose parent post is the target).
      res = await deletePost(deletionTarget.id);
    }
    setBusy(false);
    setConfirmingClose(false);
    if (res?.error) {
      setErrorMsg(
        typeof res.error === 'string'
          ? res.error
          : (deletionTarget.kind === 'citizen-poll' ? 'Could not close poll.' : 'Could not delete this.')
      );
      return;
    }
    // Destructive — the row disappears entirely; a full feed reload
    // is the cheapest path. (onCardUpdated can't express "remove me".)
    onMutated?.();
  };

  // ── Reactions (like / dislike) ─────────────────────────────────
  // Dispatch per card kind:
  //   • Post card (kind='post')                → reactToPost(card.id)
  //   • Poll card whose parent is a Post       → reactToPost(parent_post_id)
  //     (i.e. rep polls — every rep poll attaches to a post)
  //   • Citizen / standalone poll               → reactToCitizenPoll(card.id)
  //     (Phase 7 — PollReaction model + endpoint now live, mirrors
  //      the post-side surface)
  // The picker pops when 2+ identities are signed in.
  //
  // reactableTarget is the (endpointKind, id) tuple — 'post' uses
  // the post endpoints, 'poll' uses the citizen-poll endpoints.
  const reactableTarget = (() => {
    if (kind === 'post') return { kind: 'post', id: card.id };
    if (card.parent_post_id) return { kind: 'post', id: card.parent_post_id };
    // Citizen + standalone polls — react against the poll itself.
    if (kind === 'poll') return { kind: 'poll', id: card.id };
    return null;
  })();

  const fireReact = async (rxnKind, asIdentity, currentlyActive) => {
    if (!reactableTarget) return;
    setBusy(true);
    setErrorMsg(null);
    let res;
    if (reactableTarget.kind === 'post') {
      res = currentlyActive
        ? await clearReaction(reactableTarget.id, asIdentity)
        : await reactToPost(reactableTarget.id, rxnKind, asIdentity);
    } else {
      res = currentlyActive
        ? await clearCitizenPollReaction(reactableTarget.id, asIdentity)
        : await reactToCitizenPoll(reactableTarget.id, rxnKind, asIdentity);
    }
    setBusy(false);
    if (res?.error) {
      setErrorMsg(typeof res.error === 'string' ? res.error : 'Could not record reaction.');
      return;
    }
    if (res?.data && onCardUpdated) {
      onCardUpdated(card.id, _reactPatch(card, res.data));
    } else {
      onMutated?.();
    }
  };

  const handleReact = (rxnKind) => {
    if (busy) return;
    if (!signedIn) { onLoginRequired?.(); return; }
    if (!reactableTarget) {
      // Unrecognized card shape — nothing to react to.
      return;
    }
    const decision = pickEngagementIdentity({ identities: activeIdentities });
    if (decision.none) {
      onLoginRequired?.();
      return;
    }
    const myReactions = (viewer && viewer.my_reactions) || {};
    if (decision.single) {
      // Single-identity: toggle off when the same identity already
      // reacted with the same kind. Backend's DELETE clears its
      // reaction; POST upserts.
      const already = myReactions[decision.single] === rxnKind;
      fireReact(rxnKind, decision.single, already);
      return;
    }
    setReactPicker({
      kind: rxnKind,
      identities: decision.showPicker.map((id) => ({
        ...id,
        // ✓ marker only when this identity has reacted with THIS
        // specific kind. Different-kind reactions don't qualify.
        currentState: myReactions[id.kind] === rxnKind ? rxnKind : null,
      })),
    });
  };

  const onReactPick = (asIdentity) => {
    const rxnKind = reactPicker?.kind;
    setReactPicker(null);
    if (!rxnKind) return;
    const myReactions = (viewer && viewer.my_reactions) || {};
    const already = myReactions[asIdentity] === rxnKind;
    fireReact(rxnKind, asIdentity, already);
  };

  // ── label / chrome helpers ──────────────────────────────────────
  const kindLabel = ({
    rep: 'REP',
    citizen: 'CITIZEN',
    standalone: 'STANDALONE',
    candidate: 'CANDIDATE',
  })[card.kind] || card.kind.toUpperCase();

  // Standalone polls used to render the page-tag chip as "Standalone",
  // which read as a redundant copy of the red STANDALONE kind chip
  // sitting right next to it. "Citizen" is the more useful label —
  // the kind chip signals "this poll has no page", and the page-tag
  // chip signals "the author is a citizen".
  const pageTag = card.page_tag || (isStandalone ? 'Citizen' : '');
  const author = card.author || 'Citizen';
  const initials = (author
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('') || '?').toUpperCase();
  const avatarTone = card.kind === 'rep' ? 'rep'
    : card.kind === 'candidate' ? 'candidate'
    : isStandalone ? 'standalone'
    : 'citizen';

  // ── render ──────────────────────────────────────────────────────
  return (
    <article className={`feed-card feed-card--${kind} ${isCommentsOpen ? 'is-thread-open' : ''}`}>
      <header className="feed-card__top">
        {/* Tag chip is a link to the author's page for rep + candidate
            cards. Citizen + standalone cards stay as plain text — the
            citizen author doesn't have a profile page. */}
        {(card.kind === 'rep' || card.kind === 'candidate') && card.official_id ? (
          <a
            className={`feed-card__kind feed-card__kind--${card.kind} feed-card__kind--link`}
            href={`/?page=${encodeURIComponent(card.official_id)}`}
          >{kindLabel}</a>
        ) : (
          <span className={`feed-card__kind feed-card__kind--${card.kind}`}>{kindLabel}</span>
        )}
        {pageTag && <span className="feed-card__page-tag">{pageTag}</span>}
        <span className="feed-card__time">{relTime(card.created_at)}</span>
        {(card.edited_at || postEditedAtOverride) && (
          <span
            className="feed-card__edited"
            title={`Edited ${relTime(postEditedAtOverride || card.edited_at)}`}
            style={{
              marginLeft: '4px', fontSize: '0.7rem', fontStyle: 'italic',
              color: 'var(--cl-text-light)',
            }}
          >
            · edited
          </span>
        )}
        {/* Kebab actions menu (Task #76). Consolidates Edit + Delete
            (for the author) + Report (for non-authors) into one
            top-right trigger so the card top-row stays clean. The
            "Reported ✓" indicator stays inline next to the kebab so
            a viewer who already flagged the post sees the receipt
            without having to re-open the menu. */}
        <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {postReported && (
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--cl-text-muted)',
                fontStyle: 'italic',
              }}
            >
              Reported ✓
            </span>
          )}
          <PostActionsMenu
            ariaLabel="Post actions"
            items={[
              citizenViewer && {
                id: 'save',
                label: viewer.is_saved ? 'Saved ✓ · Remove' : 'Save',
                onClick: handleToggleSave,
                disabled: savingBusy,
              },
              _canEditPost && editingPostBody == null && {
                id: 'edit',
                label: 'Edit',
                onClick: beginEditPost,
                disabled: busy || editBusy,
              },
              showCloseX && {
                id: 'delete',
                // "Close" reads more naturally for a citizen-authored
                // standalone poll (which stays in the feed as a closed
                // result); "Delete" for everything else. Same handler
                // either way — setConfirmingClose triggers the inline
                // confirmation row below.
                label: isStandalone ? 'Close poll' : 'Delete',
                onClick: () => setConfirmingClose(true),
                disabled: busy,
                destructive: true,
              },
              _canReportPost && !postReported && {
                id: 'report',
                label: postReportBusy ? 'Reporting…' : 'Report',
                onClick: handleReportPost,
                disabled: postReportBusy,
              },
            ]}
          />
        </div>
      </header>

      {/* Cross-feed badge — poll item flagged as part of a post.
          parent_post_id is set by the backend (PR #1) for rep polls
          whose parent post lives in the rep's page. The badge tells
          the user this poll was authored as part of a longer post. */}
      {card.parent_post_id && (
        <a
          className="feed-card__crosslink"
          /* Deep-link to the parent post within the rep/candidate page.
             PageView can scroll to the #post-<id> anchor on arrival;
             if it doesn't (yet), the URL stays well-formed and the
             scroll behavior is a deferred polish. */
          href={card.official_id
            ? `/?page=${encodeURIComponent(card.official_id)}#post-${card.parent_post_id}`
            : '#'}
        >
          <span className="feed-card__crosslink-dot" aria-hidden="true">●</span>
          <span>From a post</span>
          <span className="feed-card__crosslink-arrow">→ Open page</span>
        </a>
      )}

      <div className="feed-card__author">
        <div className={`feed-card__avatar feed-card__avatar--${avatarTone}`}>
          {initials}
        </div>
        <div className="feed-card__author-text">
          <div className="feed-card__name">
            {/* Author name links to the author's page for rep + candidate.
                Citizen + standalone keep plain text (no profile page). */}
            {(card.kind === 'rep' || card.kind === 'candidate') && card.official_id ? (
              <a
                className="feed-card__name-link"
                href={`/?page=${encodeURIComponent(card.official_id)}`}
              >{author}</a>
            ) : (
              <span>{author}</span>
            )}
            {/* Citizen + candidate polls flag unverified authors.
                Rep polls don't show the pill (reps are verified by
                claim). The backend doesn't surface a per-item
                verified flag yet; we infer from card.kind. */}
            {(card.kind === 'citizen' || isStandalone) && (
              <span
                className="feed-card__unverified"
                title="Citizen hasn't been identity-verified yet"
              >
                Unverified
              </span>
            )}
          </div>
          {card.role && <div className="feed-card__role">{card.role}</div>}
        </div>
      </div>

      {/* Poll body */}
      {kind === 'poll' && (
        <div className="feed-card__body">
          <div className="poll-block">
            <div className="poll-block__q">{card.question}</div>
            <div className="poll-block__opts">
              {(card.options || []).map((o) => {
                const mine = viewer.voter_choice_id === o.id;
                // Leader = the option with the highest share
                // (excluding the viewer's own vote — that already gets
                // its own treatment). Mirrors PollCard.js:67 (maxVotes)
                // so /polls bars match the rep/candidate treatment:
                // own vote = blue strong, leader = blue soft, loser = gray.
                // NOTE: we compare on `percent` (not `count`) because the
                // /api/polls/feed payload returns {label, percent} only —
                // see backend/app/routers/feed.py:332. The percent field
                // is populated for every kind (rep / candidate / citizen /
                // standalone) so this works uniformly across the feed.
                const _maxPct = (card.options || []).reduce(
                  (m, x) => Math.max(m, x.percent || 0), 0,
                );
                const isLeader = !mine
                  && _maxPct > 0
                  && (o.percent || 0) === _maxPct;
                return (
                  <div key={o.id} className="poll-opt2-wrap">
                    <button
                      type="button"
                      className={`poll-opt2 ${mine ? 'is-mine' : ''} ${isLeader ? 'is-leader' : ''}`}
                      onClick={() => handleVote(o.id)}
                      disabled={busy}
                    >
                      <span className="poll-opt2__fill" style={{ width: `${o.percent || 0}%` }} />
                      <span className="poll-opt2__label">
                        <strong>{o.label}</strong>
                        {mine && <span className="poll-opt2__your-vote">✓ your vote</span>}
                      </span>
                      <span className="poll-opt2__pct">{o.percent || 0}% · {formatCount(o.count || 0)}</span>
                    </button>
                    <IdentityPicker
                      open={votePicker?.optionId === o.id}
                      identities={votePicker?.optionId === o.id ? votePicker.identities : []}
                      onPick={onVotePick}
                      onClose={() => setVotePicker(null)}
                    />
                  </div>
                );
              })}
            </div>
            <div className="poll-block__total">
              <span>{formatCount(card.votes || 0)}</span> votes
            </div>
            <button
              type="button"
              onClick={() => setExploreOpen(true)}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0,
                       cursor: 'pointer', color: 'var(--cl-primary)', fontWeight: 600,
                       fontSize: '0.74rem' }}
            >
              📊 Explore results
            </button>
            <PollResultsModal
              pollId={card.id}
              question={card.question}
              open={exploreOpen}
              onClose={() => setExploreOpen(false)}
            />
            {demoVote && (
              <PollDemographicsForm
                pollId={card.id}
                onSubmit={async (demo) => {
                  if (card.kind === 'rep' || card.kind === 'candidate') {
                    await votePoll(card.official_id, card.id, { optionId: demoVote.optionId, voterToken: getVoterToken(), asIdentity: demoVote.asIdentity, demographics: demo });
                  } else {
                    await voteOnCitizenPoll(card.id, demoVote.optionId, demoVote.asIdentity, demo);
                  }
                  setDemoVote(null);
                }}
                onDismiss={() => setDemoVote(null)}
              />
            )}
          </div>
          {errorMsg && <div className="feed-card__error">{errorMsg}</div>}
          {confirmingClose && (
            <div className="feed-card__confirm">
              <p>
                {deletionTarget?.kind === 'citizen-poll'
                  ? 'Close this poll? It moves to the archived section of your dashboard and frees your standalone-poll slot so you can post another.'
                  : (kind === 'post'
                      ? 'Delete this post? This action cannot be undone — the post and any attached poll will be removed for everyone.'
                      : 'Delete this poll? The poll and its parent post will be removed for everyone.')
                }
              </p>
              <div className="feed-card__confirm-row">
                <button
                  type="button"
                  className="feed-card__confirm-cancel"
                  onClick={() => setConfirmingClose(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="feed-card__confirm-go"
                  onClick={handleConfirmClose}
                  disabled={busy}
                >
                  {busy
                    ? (deletionTarget?.kind === 'citizen-poll' ? 'Closing…' : 'Deleting…')
                    : (deletionTarget?.kind === 'citizen-poll' ? 'Close poll' : 'Delete')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Post body — kind='post' on the /posts feed. Long bodies
          collapse to a preview with an Expand affordance; attached
          polls render an inline "+ poll attached" badge that
          deep-links to the page where the poll can be voted.
          Long posts also surface an AI Summarize affordance,
          mirroring PostCard.js:646 on the rep/candidate pages. */}
      {kind === 'post' && (
        <div className="feed-card__body">
          {/* AI Summarize button — visible only when AI is configured,
              the post is long enough (>=300 words), and a summary
              hasn't been fetched yet. */}
          {_showSummarize && !aiSummary && (
            <div className="feed-card__ai-summarize-row">
              <button
                type="button"
                className="feed-card__ai-summarize-btn"
                onClick={_handleSummarize}
                disabled={aiSummaryBusy}
                title={`Summarize this ${_bodyWordCount}-word post into a quick TL;DR`}
              >
                ✨ {aiSummaryBusy ? 'Summarizing…' : 'Summarize'}
              </button>
              {aiSummaryErr && (
                <span className="feed-card__ai-summarize-err">{aiSummaryErr}</span>
              )}
            </div>
          )}
          {/* AI summary card — sits above the body with a dismiss
              affordance, so the user always has access to the full
              text underneath. */}
          {aiSummary && (
            <div className="feed-card__ai-summary">
              <div className="feed-card__ai-summary-head">
                <span className="feed-card__ai-summary-label">✨ AI summary</span>
                <button
                  type="button"
                  className="feed-card__ai-summary-dismiss"
                  onClick={() => { setAiSummary(null); setAiSummaryErr(null); }}
                >
                  Dismiss
                </button>
              </div>
              <div className="feed-card__ai-summary-text">
                {typeof aiSummary === 'string' ? aiSummary : (aiSummary.summary || '')}
              </div>
            </div>
          )}
          {editingPostBody != null ? (
            <div className="feed-card__post-body" style={{ paddingTop: 4 }}>
              <textarea
                value={editingPostBody}
                onChange={(e) => setEditingPostBody(e.target.value)}
                rows={6}
                disabled={editBusy}
                style={{
                  width: '100%', padding: '8px', borderRadius: '6px',
                  border: '1px solid var(--cl-border)',
                  fontFamily: 'inherit', fontSize: '0.95rem',
                  resize: 'vertical', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={handleSavePost}
                  disabled={editBusy || !(editingPostBody || '').trim()}
                  style={{
                    padding: '6px 14px', borderRadius: '6px',
                    border: '1px solid var(--cl-accent)',
                    background: 'var(--cl-accent)', color: 'white',
                    fontSize: '0.78rem', fontWeight: 600,
                    cursor: editBusy ? 'wait' : 'pointer',
                  }}
                >
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditPost}
                  disabled={editBusy}
                  style={{
                    padding: '6px 14px', borderRadius: '6px',
                    border: '1px solid var(--cl-border)',
                    background: 'white', color: 'var(--cl-text)',
                    fontSize: '0.78rem', fontWeight: 600,
                    cursor: editBusy ? 'wait' : 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
              {postEditErr && (
                <div
                  role="alert"
                  style={{
                    marginTop: '6px', padding: '6px 8px',
                    color: '#d63031', fontSize: '0.78rem',
                    background: '#fef2f2', border: '1px solid #fecaca',
                    borderRadius: '6px',
                  }}
                >
                  {postEditErr}
                </div>
              )}
            </div>
          ) : (
            <div className={`feed-card__post-body ${expanded ? 'is-expanded' : ''}`}>
              {postBodyOverride ?? card.body}
            </div>
          )}
          {card.body && card.body.length > 400 && (
            <button
              type="button"
              className="feed-card__expand feed-card__expand--pill"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show less' : 'Expand'}
            </button>
          )}
          {card.has_attached_poll && (
            <a
              className="feed-card__crosslink feed-card__crosslink--inline"
              href={card.official_id ? `/?page=${encodeURIComponent(card.official_id)}` : '#'}
            >
              <span className="feed-card__crosslink-dot" aria-hidden="true">●</span>
              <span>+ poll attached</span>
              <span className="feed-card__crosslink-arrow">→ Open page</span>
            </a>
          )}
        </div>
      )}

      <div className="feed-card__actions">
        {/* Like — blue thumbs-up. Active when the VIEWER has reacted
            'up' (not when the count is > 0). Mirrors PostCard.js:782
            (active={myReaction === 'up'}). The icon flips to fully-
            filled blue via PhosphorIcon's active prop. */}
        <div className="feed-act-wrap">
          <button
            type="button"
            className={`feed-act feed-act--like ${upActive ? 'is-active' : ''}`}
            onClick={() => handleReact('up')}
            disabled={busy}
            aria-label="Like"
            title="Like"
          >
            <ThumbsUp size={14} active={upActive} color="up" />
            <span>{formatCount(card.likes || 0)}</span>
          </button>
          <IdentityPicker
            open={reactPicker?.kind === 'up'}
            identities={reactPicker?.kind === 'up' ? reactPicker.identities : []}
            onPick={onReactPick}
            onClose={() => setReactPicker(null)}
          />
        </div>
        <div className="feed-act-wrap">
          <button
            type="button"
            className={`feed-act feed-act--dislike ${downActive ? 'is-active' : ''}`}
            onClick={() => handleReact('down')}
            disabled={busy}
            aria-label="Dislike"
            title="Dislike"
          >
            <ThumbsDown size={14} active={downActive} color="down" />
            <span>{formatCount(card.dislikes || 0)}</span>
          </button>
          <IdentityPicker
            open={reactPicker?.kind === 'down'}
            identities={reactPicker?.kind === 'down' ? reactPicker.identities : []}
            onPick={onReactPick}
            onClose={() => setReactPicker(null)}
          />
        </div>
        <button
          type="button"
          className={`feed-act feed-act--comments ${isCommentsOpen ? 'is-active' : ''}`}
          onClick={onToggleComments}
          aria-expanded={isCommentsOpen}
        >
          <ChatText size={14} />
          {/* Toggle label matches PostCard.js:846 — when the thread is
              expanded, the button reads 'Hide (N)' instead of
              'Comments (N)' so the action's semantics are explicit. */}
          <span>{isCommentsOpen ? 'Hide' : 'Comments'} (<span>{formatCount(card.comments || 0)}</span>)</span>
        </button>
      </div>

      {isCommentsOpen && (
        <div className="feed-card__thread">
          <CommentsThread
            // Three cases:
            //   • post card               → comments live on the post directly
            //   • poll card w/ parent post → comments live on the parent post
            //   • citizen-/standalone-poll → comments live on the poll
            mode={kind === 'post' || card.parent_post_id ? 'post' : 'poll'}
            postId={
              kind === 'post'
                ? card.id
                : card.parent_post_id || undefined
            }
            pollId={
              kind === 'post' || card.parent_post_id ? undefined : card.id
            }
            signedIn={signedIn}
            onLoginRequired={onLoginRequired}
            onMutated={onMutated}
            // Two-party reply gate inputs (FeedCard knows the
            // page-owner context the thread itself doesn't have).
            ownerOfficialId={card.official_id || null}
            ownerKind={card.kind || null}
          />
        </div>
      )}
    </article>
  );
}

// Patch helper — map a votePoll / voteOnCitizenPoll response into
// the feed-item shape so onCardUpdated can merge cleanly. We only
// touch the vote-affected fields and the viewer block so other
// metadata (author, page_tag, parent_post_id, etc.) is preserved.
function _votePatch(prevCard, updated) {
  if (!updated) return {};
  // The response shape differs by endpoint:
  //   • votePoll (rep / candidate polls)   → PollRead directly
  //   • voteOnCitizenPoll (citizen polls)  → CitizenPollRead with the
  //                                          poll nested under .poll
  // Unwrap so the rest of this function reads one consistent shape.
  const poll = updated.poll && updated.poll.options ? updated.poll : updated;
  const totalVotes = poll.total_votes != null
    ? poll.total_votes
    : (poll.options || []).reduce((sum, o) => sum + (o.vote_count || 0), 0);
  const opts = (poll.options || []).map((o) => {
    // PollOptionRead exposes `text` + `vote_count`. Percent isn't
    // shipped — compute locally so the bars render at their new width
    // without waiting for a full feed reload.
    const count = o.vote_count != null
      ? o.vote_count
      : (o.count != null ? o.count : (o.votes != null ? o.votes : 0));
    const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    return {
      id: o.id,
      label: o.text != null ? o.text : (o.label || ''),
      count,
      percent,
    };
  });
  const prevViewer = prevCard.viewer || {};
  return {
    options: opts,
    votes: totalVotes,
    viewer: {
      ...prevViewer,
      voter_choice_id: poll.voter_choice_id != null
        ? poll.voter_choice_id
        : prevViewer.voter_choice_id,
      voter_choices: poll.voter_choices || prevViewer.voter_choices || {},
    },
  };
}

// Same idea for reactions — map a ReactionSummary response into the
// feed-item viewer block + top-level likes/dislikes counts.
function _reactPatch(prevCard, summary) {
  if (!summary) return {};
  const prevViewer = prevCard.viewer || {};
  return {
    likes: summary.up_count != null ? summary.up_count : prevCard.likes,
    dislikes: summary.down_count != null ? summary.down_count : prevCard.dislikes,
    viewer: {
      ...prevViewer,
      my_reaction: summary.my_reaction != null
        ? summary.my_reaction
        : prevViewer.my_reaction,
      my_reactions: summary.my_reactions || prevViewer.my_reactions || {},
    },
  };
}

// Tiny inline formatters — kept local so this file has zero shared-
// helper dependencies beyond the API + thread imports.
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString();
}

function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000) {
    return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  }
  return String(v);
}
