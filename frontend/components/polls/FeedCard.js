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

import { useState } from 'react';
import {
  voteOnCitizenPoll,
  closeCitizenPoll,
  votePoll,
  reactToPost,
  clearReaction,
} from '../../lib/pagesApi';
import { getVoterToken } from '../../lib/voterToken';
import { useActiveIdentities, pickEngagementIdentity } from '../../lib/activeIdentities';
import IdentityPicker from '../IdentityPicker';
import { ThumbsUp, ThumbsDown, ChatText } from '../ui';
import CommentsThread from './CommentsThread';

export default function FeedCard({
  card,
  kind = 'poll',
  isCommentsOpen,
  onToggleComments,
  onMutated,
  signedIn = false,
  onLoginRequired,
  citizenViewer = null,
}) {
  // Standalone-poll author-only close X (top-right). The viewer is
  // the author when their citizen id matches the poll's
  // viewer.is_author flag the backend set.
  const isStandalone = card.kind === 'standalone';
  const viewer = card.viewer || { voter_choice_id: null, is_author: false };
  const showCloseX = kind === 'poll' && isStandalone && viewer.is_author;

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Post-body collapse — long bodies (>400 chars) show an Expand pill
  // and stay collapsed by default. Same pattern the rep page uses.
  const [expanded, setExpanded] = useState(false);

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
    let err;
    if (card.kind === 'rep' || card.kind === 'candidate') {
      if (!card.official_id) {
        setBusy(false);
        setErrorMsg('Missing page reference for this poll.');
        return;
      }
      const res = await votePoll(card.official_id, card.id, {
        optionId,
        voterToken: getVoterToken(),
        asIdentity,
      });
      err = res.error;
    } else {
      const res = await voteOnCitizenPoll(card.id, optionId, asIdentity);
      err = res.error;
    }
    setBusy(false);
    if (err) {
      setErrorMsg(typeof err === 'string' ? err : 'Could not record vote.');
      return;
    }
    onMutated?.();
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
    setVotePicker({
      optionId,
      identities: decision.showPicker.map((id) => ({
        ...id,
        currentState: viewer.voter_choice_id === optionId ? 'voted' : null,
      })),
    });
  };

  const onVotePick = (asIdentity) => {
    const optionId = votePicker?.optionId;
    setVotePicker(null);
    if (optionId != null) fireVote(optionId, asIdentity);
  };

  const handleConfirmClose = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    const { error: err } = await closeCitizenPoll(card.id);
    setBusy(false);
    setConfirmingClose(false);
    if (err) {
      setErrorMsg(typeof err === 'string' ? err : 'Could not close poll.');
      return;
    }
    onMutated?.();
  };

  // ── Reactions (like / dislike) ─────────────────────────────────
  // Three cases:
  //   • Post card (kind='post')          → reactToPost(card.id)
  //   • Poll w/ parent post (rep polls)  → reactToPost(parent_post_id)
  //   • Citizen / standalone poll         → no-op (PollReaction model
  //                                           not yet wired; future PR)
  // The picker pops when 2+ identities are signed in, identical to
  // the vote pattern above.
  const reactablePostId = kind === 'post'
    ? card.id
    : (card.parent_post_id || null);

  const fireReact = async (rxnKind, asIdentity, currentlyActive) => {
    if (!reactablePostId) {
      // Citizen poll without a parent post — silently no-op for
      // now; CommentsThread surfaces the same constraint with a
      // tooltip for AI filter, react picker stays disabled until
      // PollReaction lands.
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    const res = currentlyActive
      ? await clearReaction(reactablePostId, asIdentity)
      : await reactToPost(reactablePostId, rxnKind, asIdentity);
    setBusy(false);
    if (res.error) {
      setErrorMsg(typeof res.error === 'string' ? res.error : 'Could not record reaction.');
      return;
    }
    onMutated?.();
  };

  const handleReact = (rxnKind) => {
    if (busy) return;
    if (!signedIn) { onLoginRequired?.(); return; }
    if (!reactablePostId) {
      // Citizen-poll like/dislike isn't wired yet. Silently no-op so
      // the click feels responsive but doesn't error.
      return;
    }
    const decision = pickEngagementIdentity({ identities: activeIdentities });
    if (decision.none) {
      onLoginRequired?.();
      return;
    }
    // viewer.my_reaction isn't on the feed item shape yet — best-effort
    // toggle: assume not-currently-active. Server is the source of
    // truth; the response refresh corrects any drift.
    if (decision.single) {
      fireReact(rxnKind, decision.single, false);
      return;
    }
    setReactPicker({
      kind: rxnKind,
      identities: decision.showPicker.map((id) => ({ ...id, currentState: null })),
    });
  };

  const onReactPick = (asIdentity) => {
    const rxnKind = reactPicker?.kind;
    setReactPicker(null);
    if (rxnKind) fireReact(rxnKind, asIdentity, false);
  };

  // ── label / chrome helpers ──────────────────────────────────────
  const kindLabel = ({
    rep: 'REP',
    citizen: 'CITIZEN',
    standalone: 'STANDALONE',
    candidate: 'CANDIDATE',
  })[card.kind] || card.kind.toUpperCase();

  const pageTag = card.page_tag || (isStandalone ? 'Standalone' : '');
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
        <span className={`feed-card__kind feed-card__kind--${card.kind}`}>{kindLabel}</span>
        {pageTag && <span className="feed-card__page-tag">{pageTag}</span>}
        <span className="feed-card__time">{relTime(card.created_at)}</span>
        {showCloseX && (
          <button
            type="button"
            className="feed-card__close"
            aria-label="Close this poll"
            onClick={() => setConfirmingClose(true)}
            disabled={busy}
            title="Close this poll"
          >
            ×
          </button>
        )}
      </header>

      {/* Cross-feed badge — poll item flagged as part of a post.
          parent_post_id is set by the backend (PR #1) for rep polls
          whose parent post lives in the rep's page. The badge tells
          the user this poll was authored as part of a longer post. */}
      {card.parent_post_id && (
        <a
          className="feed-card__crosslink"
          href={card.official_id ? `/?page=${encodeURIComponent(card.official_id)}` : '#'}
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
            <span>{author}</span>
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
                return (
                  <div key={o.id} className="poll-opt2-wrap">
                    <button
                      type="button"
                      className={`poll-opt2 ${mine ? 'is-mine' : ''}`}
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
          </div>
          {errorMsg && <div className="feed-card__error">{errorMsg}</div>}
          {confirmingClose && (
            <div className="feed-card__confirm">
              <p>
                Close this poll? It moves to the archived section of
                your dashboard and frees your standalone-poll slot
                so you can post another.
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
                  {busy ? 'Closing…' : 'Close poll'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Post body — kind='post' on the /posts feed. Long bodies
          collapse to a preview with an Expand affordance; attached
          polls render an inline "+ poll attached" badge that
          deep-links to the page where the poll can be voted. */}
      {kind === 'post' && (
        <div className="feed-card__body">
          <div className={`feed-card__post-body ${expanded ? 'is-expanded' : ''}`}>
            {card.body}
          </div>
          {card.body && card.body.length > 400 && !expanded && (
            <button
              type="button"
              className="feed-card__expand"
              onClick={() => setExpanded(true)}
            >
              Expand
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
        {/* Like — blue thumbs-up, active when the viewer's own
            reaction is 'up'. The feed item shape doesn't include
            the viewer's reaction yet (TODO in a follow-up), so the
            active state is currently driven by count > 0; once the
            backend surfaces my_reaction we'll switch to that. */}
        <div className="feed-act-wrap">
          <button
            type="button"
            className={`feed-act feed-act--like ${(card.likes || 0) > 0 ? 'is-active' : ''}`}
            onClick={() => handleReact('up')}
            disabled={busy}
            aria-label="Like"
            title={reactablePostId ? 'Like' : 'Likes coming soon for citizen polls'}
          >
            <ThumbsUp size={14} />
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
            className={`feed-act feed-act--dislike ${(card.dislikes || 0) > 0 ? 'is-active' : ''}`}
            onClick={() => handleReact('down')}
            disabled={busy}
            aria-label="Dislike"
            title={reactablePostId ? 'Dislike' : 'Dislikes coming soon for citizen polls'}
          >
            <ThumbsDown size={14} />
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
          <span>Comments (<span>{formatCount(card.comments || 0)}</span>)</span>
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
          />
        </div>
      )}
    </article>
  );
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
