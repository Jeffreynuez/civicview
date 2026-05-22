/* FeedCard — shared shell used by both PollCard and PostCard on /polls + /posts.

   Visual weight matches the rep-page card (the reference screenshots): larger
   avatar, prominent author row, embedded poll block inside post cards, and a
   like / dislike / Comments(N) action row that opens the inline thread.

   Props:
     card: the poll or post object from seed
     kind: 'poll' | 'post'
     isAuthor: bool — controls the red X close affordance on standalone polls
     isCommentsOpen: bool
     onToggleComments: () => void
     onDelete: () => void
     viewport: 'desktop' | 'tablet' | 'mobile'   (for thread layout tweaks)
*/

function FeedCard({ card, kind, isAuthor, isCommentsOpen, onToggleComments, onDelete, viewport }) {
  const G = window.PollsGlyph;
  const [expanded, setExpanded] = React.useState(false);

  const kindLabel = {
    rep: 'REP', citizen: 'CITIZEN', standalone: 'STANDALONE', candidate: 'CANDIDATE',
  }[card.kind];

  const formatCount = (n) =>
    n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);

  const showDeleteX = kind === 'poll' && card.kind === 'standalone' && isAuthor;
  const hasAttachedPoll = kind === 'post' && card.attachedPollId;
  const isFromPost = kind === 'poll' && card.fromPostId;

  return (
    <article className={`feed-card feed-card--${kind} ${isCommentsOpen ? 'is-thread-open' : ''}`}>
      {/* Top row: kind + page tag + timestamp (left), [close X] (right) */}
      <header className="feed-card__top">
        <span className={`poll-kind poll-kind--${card.kind}`}>{kindLabel}</span>
        <span className="poll-source">{card.source.code}</span>
        <span className="feed-card__time cl-num">{card.time}</span>
        {showDeleteX && (
          <button
            type="button"
            className="feed-card__close"
            aria-label="Close this poll"
            onClick={onDelete}>
            <G.CloseX size={12} />
          </button>
        )}
      </header>

      {/* Author row */}
      <div className="feed-card__author">
        <div className={`feed-card__avatar feed-card__avatar--${card.author.avatarTone}`}>
          {card.author.initials}
        </div>
        <div className="feed-card__author-text">
          <div className="feed-card__name">
            <span>{card.author.name}</span>
            {!card.author.verified && (
              <span className="poll-card__unverified" title="Hasn't been identity-verified yet">
                Unverified
              </span>
            )}
          </div>
          <div className="feed-card__role">{card.author.role}</div>
        </div>
      </div>

      {/* Cross-feed badge — poll-card showing it came from a post */}
      {isFromPost && (
        <a className="feed-card__crosslink" href={`#post-${card.fromPostId}`}>
          <G.PostAttached size={13} />
          <span>From a post</span>
          <span className="feed-card__crosslink-arrow">→ Open page</span>
        </a>
      )}

      {/* Body: post text or poll block */}
      <div className="feed-card__body">
        {kind === 'post' && (
          <>
            {card.summarized && (
              <button type="button" className="feed-card__summarize">
                <G.Sparkle size={13} color="var(--cl-accent)" /> Summarize
              </button>
            )}
            <div className={`feed-card__post-body ${expanded ? 'is-expanded' : ''}`}>
              {card.body}
            </div>
            {card.body && card.body.length > 280 && !expanded && (
              <button type="button" className="feed-card__expand" onClick={() => setExpanded(true)}>
                Expand
              </button>
            )}
            {hasAttachedPoll && (
              <a className="feed-card__crosslink feed-card__crosslink--inline" href={`#poll-${card.attachedPollId}`}>
                <G.PollAttached size={13} />
                <span>+ poll attached</span>
                <span className="feed-card__crosslink-arrow">→ Open page</span>
              </a>
            )}
          </>
        )}

        {kind === 'poll' && (
          <PollBlock poll={card} />
        )}
      </div>

      {/* Action row: like / dislike / comments */}
      <div className="feed-card__actions">
        <button className={`feed-act feed-act--like ${card.likes > 0 ? 'is-active' : ''}`} type="button">
          <G.ThumbUp size={14} />
          <span className="cl-num">{formatCount(card.likes)}</span>
        </button>
        <button className={`feed-act feed-act--dislike ${card.dislikes > 0 ? 'is-active' : ''}`} type="button">
          <G.ThumbDown size={14} />
          <span className="cl-num">{formatCount(card.dislikes)}</span>
        </button>
        <button
          className={`feed-act feed-act--comments ${isCommentsOpen ? 'is-active' : ''}`}
          type="button"
          onClick={onToggleComments}>
          <G.Chat size={14} />
          <span>Comments (<span className="cl-num">{formatCount(card.comments)}</span>)</span>
        </button>
      </div>

      {/* Inline thread (accordion) */}
      {isCommentsOpen && (
        <div className="feed-card__thread">
          <window.CommentsThread
            comments={window.COMMENTS_SEED[card.id] || window.COMMENTS_SEED['p1']}
            viewport={viewport}
          />
        </div>
      )}
    </article>
  );
}

/* PollBlock — the embedded poll content. Used directly inside poll cards;
   the same component renders inside posts that have an inline poll attached
   (we don't currently render attached polls inline — they show as a badge —
   but the component is shared in case that changes). */
function PollBlock({ poll }) {
  const G = window.PollsGlyph;
  const formatCount = (n) =>
    n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);

  return (
    <div className="poll-block">
      <div className="poll-block__head">
        <div className="poll-block__q">{poll.question}</div>
        <span className="poll-block__scope">
          <span className="poll-block__scope-flag">US</span> Showing: United States
        </span>
      </div>

      <div className="poll-block__opts">
        {poll.options.map(o => (
          <button
            key={o.id}
            type="button"
            className={`poll-opt2 ${o.mine ? 'is-mine' : ''} ${o.leading ? 'is-leading' : ''}`}>
            <span className="poll-opt2__fill" style={{ width: `${o.pct}%` }} />
            <span className="poll-opt2__label">
              <strong>{o.label}</strong>
              {o.mine && <span className="poll-opt2__your-vote">✓ your vote</span>}
              {o.mine && poll.author.isMe && <span className="poll-opt2__author-pill">AUTHOR</span>}
            </span>
            <span className="poll-opt2__pct cl-num">{o.pct}% · {formatCount(o.votes)}</span>
          </button>
        ))}
      </div>

      <div className="poll-block__total">
        <span className="cl-num">{formatCount(poll.totalVotes)}</span> votes · Closes in {poll.closesIn}
      </div>
    </div>
  );
}

window.FeedCard = FeedCard;
window.PollBlock = PollBlock;
