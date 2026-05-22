/* CommentsThread — inline expanded thread under poll + post cards.

   Mirrors the rep-page thread:
     - Identity picker (multi-identity sign-in)
     - Composer textarea + Post button
     - Sort dropdown + AI tone filter chips + AI semantic filter input + Apply
     - Comment items: Unverified pill / district / body / like / dislike /
       Delete (if own) | Report + Reply

   `comments` is the seed array (window.COMMENTS_SEED[cardId]).
   Lazy-loaded: parent doesn't render this until the thread is opened.
*/

function CommentsThread({ comments, identityName = 'CivicView Test Rep', identityRole = 'rep', viewport = 'desktop' }) {
  const G = window.PollsGlyph;
  const [sort, setSort] = React.useState('Latest');
  const [aiTags, setAiTags] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const [shown, setShown] = React.useState(5);

  const toggleTag = (id) =>
    setAiTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const visible = comments.slice(0, shown);

  return (
    <div className="thread">
      {/* Identity picker — looks like a rep badge dropdown */}
      <div className="thread__identity">
        <span className={`thread__identity-badge thread__identity-badge--${identityRole}`}>
          {identityRole === 'rep' ? 'REP' : identityRole === 'candidate' ? 'CAND' : 'CITIZEN'}
        </span>
        <span className="thread__identity-name">{identityName}</span>
        <G.Chevron size={11} color="var(--cl-text-muted)" />
      </div>

      <div className="thread__composer">
        <textarea
          rows="2"
          className="thread__textarea"
          placeholder="Add a comment (as the post author)…"
        />
        <button type="button" className="thread__post-btn">Post</button>
      </div>

      <div className="thread__controls">
        <div className="thread__sort">
          <span className="thread__sort-label">Sort</span>
          <button type="button" className="thread__sort-btn">
            {sort} <G.Chevron size={10} color="var(--cl-text-muted)" />
          </button>
        </div>
      </div>

      <div className="thread__filters">
        <div className="thread__tone-chips">
          {window.AI_FILTER_TAGS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`thread__tone-chip ${aiTags.includes(t.id) ? 'is-active' : ''}`}
              onClick={() => toggleTag(t.id)}
              aria-pressed={aiTags.includes(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="thread__sem-field">
          <span className="thread__sem-sparkle"><G.Sparkle size={13} /></span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter comments… (e.g. 'about sunset clause')"
          />
        </label>
        <button type="button" className="thread__apply">Apply</button>
      </div>

      <div className="thread__list">
        {visible.map(c => (
          <div key={c.id} className="thread__comment">
            <div className="thread__c-head">
              <span className="thread__c-name">{c.author}</span>
              {!c.verified && <span className="poll-card__unverified">Unverified</span>}
              <span className="thread__c-date cl-num">{c.time}</span>
            </div>
            <div className="thread__c-body">{c.body}</div>
            <div className="thread__c-actions">
              <button className={`thread__c-react ${c.likes > 0 ? 'is-active up' : ''}`}>
                <G.ThumbUp size={12} /> <span className="cl-num">{c.likes}</span>
              </button>
              <button className={`thread__c-react ${c.dislikes > 0 ? 'is-active down' : ''}`}>
                <G.ThumbDown size={12} /> <span className="cl-num">{c.dislikes}</span>
              </button>
              <span className="thread__c-location">{c.location}</span>
              <span className="thread__c-spacer" />
              {c.isMe ? (
                <button className="thread__c-link thread__c-link--del">Delete</button>
              ) : (
                <button className="thread__c-link">Report</button>
              )}
              <button className="thread__c-link thread__c-link--accent">Reply</button>
            </div>
          </div>
        ))}
      </div>

      {comments.length > shown && (
        <button
          type="button"
          className="thread__more"
          onClick={() => setShown(comments.length)}>
          View all ({comments.length}) comments
        </button>
      )}
    </div>
  );
}

window.CommentsThread = CommentsThread;
