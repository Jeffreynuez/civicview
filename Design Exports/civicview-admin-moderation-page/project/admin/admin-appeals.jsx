// /admin/appeals view — card list, filters, decision modal, empty state.

function AdAppealsFilters({ includeResolved, onIncludeResolved, type, onType, appellantKind, onAppellantKind, variant = 'desktop' }) {
  const types = [
    { id: 'all', label: 'All', count: 5 },
    { id: 'content', label: 'Content', count: 3 },
    { id: 'suspension', label: 'Account suspension', count: 2 },
  ];
  const kinds = [
    { id: 'any', label: 'Any' },
    { id: 'citizen', label: 'Citizen' },
    { id: 'rep', label: 'Rep' },
  ];
  const isMobile = variant === 'mobile';

  return (
    <div className="ad-filters">
      <label className="ad-toggle">
        <input type="checkbox" checked={includeResolved} onChange={(e) => onIncludeResolved(e.target.checked)} />
        <span className="ad-toggle__track" />
        Include resolved
      </label>

      <div className="ad-filters__divider" />

      {!isMobile && <span className="ad-filters__label">Type</span>}
      <div className="ad-filters__chips">
        {types.map((t) => (
          <button key={t.id} className={`ad-chip ${type === t.id ? 'ad-chip--active' : ''}`} onClick={() => onType(t.id)}>
            {t.label}
            <span className="ad-chip__count">{t.count}</span>
          </button>
        ))}
      </div>

      {!isMobile && (
        <>
          <div className="ad-filters__divider" />
          <span className="ad-filters__label">Appellant</span>
          <div className="ad-filters__chips">
            {kinds.map((k) => (
              <button key={k.id} className={`ad-chip ${appellantKind === k.id ? 'ad-chip--active' : ''}`} onClick={() => onAppellantKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />

      <div className="ad-search">
        <AdGlyph.Search size={14} />
        <input placeholder="Search appeals…" />
        <span className="ad-stub" title="Backend doesn't index appeals yet">Stub</span>
      </div>

      <button className="ad-iconbtn" title="Refresh appeals">
        <AdGlyph.Refresh size={14} />
        {!isMobile && <span>Refresh</span>}
      </button>
    </div>
  );
}

function AdAppealTypeChip({ type }) {
  if (type === 'suspension') {
    return <span className="ad-typechip ad-typechip--suspension">Account suspension</span>;
  }
  return <span className="ad-typechip ad-typechip--content">Content appeal</span>;
}

function AdKindPill({ kind }) {
  return (
    <span className={`ad-kindpill ad-kindpill--${kind}`}>
      {kind === 'rep' ? 'Rep' : 'Citizen'}
    </span>
  );
}

function AdAppealCard({ appeal, onGrant, onDeny }) {
  const stateCls =
    appeal.status === 'granted' ? 'is-granted' :
    appeal.status === 'denied'  ? 'is-denied'  :
    '';
  return (
    <article className={`ad-appeal ${stateCls}`}>
      <header className="ad-appeal__strip">
        <div className="ad-appeal__strip-left">
          <AdAppealTypeChip type={appeal.type} />
          <span className="ad-appeal__id">id={appeal.id}</span>
        </div>
        <div className="ad-appeal__strip-right">
          <span className="ad-appeal__filed">Filed {appeal.filedAt}</span>
          <span className="ad-appeal__filed-abs">{appeal.filedAtAbs}</span>
        </div>
      </header>

      <div className="ad-appeal__appellant">
        <div className={`ad-appeal__avatar ad-appeal__avatar--${appeal.appellantKind}`}>{appeal.appellantInitials}</div>
        <div className="ad-appeal__appellant-meta">
          <div className="ad-appeal__appellant-name">
            {appeal.appellantName}
            <AdKindPill kind={appeal.appellantKind} />
          </div>
          <div className="ad-appeal__appellant-email">{appeal.appellantEmail}</div>
        </div>
      </div>

      <div className="ad-appeal__details">
        <div className="ad-appeal__details-label">
          What was {appeal.type === 'suspension' ? 'suspended' : 'hidden'}
        </div>
        <div className="ad-appeal__details-meta">
          {appeal.type === 'content' && (
            <>
              <span className={`ad-cell-type__icon ad-cell-type__icon--${appeal.targetType}`} style={{ width: 22, height: 22 }}>
                <AdTypeIcon type={appeal.targetType === 'pollcomment' ? 'pollcomment' : appeal.targetType} />
              </span>
              <span className="ad-appeal__details-target">{appeal.targetTypeLabel}</span>
              <span className="ad-appeal__details-sep">·</span>
              <span className="ad-appeal__details-id">{appeal.targetId}</span>
              <span className="ad-appeal__details-sep">·</span>
              <a className="ad-appeal__details-link" href="#" title="Open hosted page in new tab">
                View hosted page <AdGlyph.External size={10} />
              </a>
            </>
          )}
          {appeal.type === 'suspension' && (
            <>
              <span className="ad-typechip ad-typechip--suspension" style={{ alignSelf: 'flex-start' }}>Account</span>
              <span className="ad-appeal__details-id">{appeal.targetId}</span>
              <span className="ad-appeal__details-sep">·</span>
              <span className="ad-appeal__details-target" style={{ fontFamily: 'var(--cl-font-mono)', fontSize: 'var(--cl-text-xs)' }}>{appeal.targetHost}</span>
            </>
          )}
        </div>
        {appeal.targetPreview && (
          <div className="ad-appeal__details-preview">"{appeal.targetPreview}"</div>
        )}
        <div className="ad-appeal__details-action">
          <strong>{appeal.moderationAction}</strong>
          <span className="ad-appeal__details-sep">·</span>
          <span>{appeal.moderationReason}</span>
          <span className="ad-appeal__details-sep">·</span>
          <span style={{ color: 'var(--cl-text-muted)' }}>{appeal.moderationAt}</span>
        </div>
      </div>

      <div className="ad-appeal__rationale">
        <div className="ad-appeal__rationale-label">Appellant rationale</div>
        <div className="ad-appeal__rationale-body">"{appeal.rationale}"</div>
      </div>

      {appeal.status === 'pending' ? (
        <footer className="ad-appeal__footer">
          <button className="ad-btn ad-btn--ghost-danger" onClick={() => onDeny(appeal)}>Deny</button>
          <button className="ad-btn ad-btn--grant" onClick={() => onGrant(appeal)}>Grant</button>
        </footer>
      ) : (
        <footer className="ad-appeal__resolved">
          <span className={`ad-appeal__resolved-badge ad-appeal__resolved-badge--${appeal.resolution.decision}`}>
            {appeal.resolution.decision === 'granted' ? '✓ Granted' : '✕ Denied'}
          </span>
          <span>by {appeal.resolution.by} · {appeal.resolution.at}</span>
          {appeal.resolution.note && (
            <span className="ad-appeal__resolved-note">— "{appeal.resolution.note}"</span>
          )}
        </footer>
      )}
    </article>
  );
}

function AdAppealsList({ appeals, onGrant, onDeny }) {
  return (
    <div className="ad-appeals-list">
      <div className="ad-tablewrap__count" style={{ background: 'var(--cl-card)', border: '1px solid var(--cl-border)', borderRadius: 'var(--cl-radius-xl)', marginBottom: 10, borderBottom: '1px solid var(--cl-border)' }}>
        <span>
          Showing <strong>{appeals.length}</strong> {appeals.length === 1 ? 'appeal' : 'appeals'} ·{' '}
          <strong>{appeals.filter((a) => a.status === 'pending').length}</strong> pending
        </span>
        <span className="ad-tablewrap__count-actions">
          <button className="ad-linkbtn">Sort: Newest first ↓ <span className="ad-stub" style={{ marginLeft: 4 }}>Stub</span></button>
        </span>
      </div>
      {appeals.map((a) => (
        <AdAppealCard key={a.id} appeal={a} onGrant={onGrant} onDeny={onDeny} />
      ))}
    </div>
  );
}

function AdAppealsEmpty() {
  return (
    <div className="ad-empty">
      <svg className="ad-empty__art" viewBox="0 0 180 96" aria-hidden="true">
        {/* Gavel + clear-doc */}
        <rect x="34" y="22" width="80" height="58" rx="8" fill="#ffffff" stroke="#dee2e6" strokeWidth="1.5" />
        <path d="M48 36h54M48 46h44M48 56h36M48 66h24" stroke="#dee2e6" strokeWidth="2" strokeLinecap="round" />
        {/* Gavel */}
        <g transform="translate(118, 30) rotate(-25)">
          <rect x="0" y="8" width="32" height="10" rx="2" fill="#1b263b" />
          <rect x="10" y="0" width="12" height="6" rx="1.5" fill="#1b263b" />
          <rect x="10" y="20" width="12" height="6" rx="1.5" fill="#1b263b" />
          <rect x="32" y="11" width="22" height="4" rx="1" fill="#1b263b" />
        </g>
        <circle cx="158" cy="74" r="6" fill="#e6f3ec" stroke="#27ae60" strokeWidth="1.5" />
        <path d="M155 74 l2.5 2.5 l5 -5" stroke="#1e8048" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <h2 className="ad-empty__title">No appeals waiting.</h2>
      <p className="ad-empty__body">
        Citizens and reps can appeal hidden content or account suspensions; nothing pending right now. New appeals show up here within a minute of being filed.
      </p>
      <div className="ad-empty__hint">
        <AdGlyph.Sparkle size={13} /> 4 granted · 6 denied this week
      </div>
    </div>
  );
}

function AdAppealDecisionModal({ appeal, decision, onCancel, onConfirm }) {
  const [note, setNote] = React.useState('');
  React.useEffect(() => { setNote(''); }, [appeal?.id, decision]);
  if (!appeal || !decision) return null;
  const isGrant = decision === 'grant';
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="ad-modal__hdr">
          <div className={`ad-modal__eyebrow ${isGrant ? 'ad-modal__eyebrow--success' : ''}`}>
            {isGrant ? 'Reversible action' : 'Destructive action'}
          </div>
          <h2 className="ad-modal__title">
            {isGrant ? `Grant appeal from ${appeal.appellantName}?` : `Deny appeal from ${appeal.appellantName}?`}
          </h2>
        </div>
        <div className="ad-modal__body">
          <div>
            {isGrant
              ? appeal.type === 'suspension'
                ? <>The account <strong>{appeal.appellantEmail}</strong> will be unsuspended and can post, comment, and vote again immediately.</>
                : <>The <strong>{appeal.targetTypeLabel.toLowerCase()}</strong> will be reinstated to public view. The original report against it is closed as resolved.</>
              : <>The moderation action stays in place. The appellant sees a "Denied" status and can read the admin note below.</>}
          </div>
          <div className="ad-modal__row">
            <span className="ad-modal__label">
              Admin note on record (optional, visible to other admins)
            </span>
            <textarea
              className="ad-modal__textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isGrant
                ? "Why are you granting this? e.g. 'Reporter retracted', 'Content was within bounds'"
                : "Why are you denying this? e.g. 'Pattern of escalation', 'Auto-detect signals confirmed'"
              }
            />
            <span className="ad-modal__hint">Encouraged — future admins reading the audit log will thank you.</span>
          </div>
        </div>
        <div className="ad-modal__footer">
          <button className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          {isGrant ? (
            <button className="ad-btn ad-btn--grant" onClick={() => onConfirm({ decision: 'grant', note })}>Grant appeal</button>
          ) : (
            <button className="ad-btn ad-btn--danger" onClick={() => onConfirm({ decision: 'deny', note })}>Deny appeal</button>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AdAppealsFilters, AdAppealTypeChip, AdKindPill, AdAppealCard, AdAppealsList, AdAppealsEmpty, AdAppealDecisionModal });
