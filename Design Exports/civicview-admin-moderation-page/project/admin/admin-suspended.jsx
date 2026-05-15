// /admin/users — suspended accounts: table (desktop/tablet), mobile cards,
// filter row, unsuspend confirmation modal, empty state.

function AdSuspendedFilters({ kind, onKind, sort, onSort, variant = 'desktop' }) {
  const kinds = [
    { id: 'all', label: 'All', count: 14 },
    { id: 'citizen', label: 'Citizen', count: 12 },
    { id: 'rep', label: 'Rep', count: 2 },
  ];
  const sorts = [
    { id: 'newest', label: 'Newest first' },
    { id: 'oldest', label: 'Oldest first' },
    { id: 'reports', label: 'Most reports' },
  ];
  const isMobile = variant === 'mobile';

  return (
    <div className="ad-filters">
      {!isMobile && <span className="ad-filters__label">Kind</span>}
      <div className="ad-filters__chips">
        {kinds.map((k) => (
          <button key={k.id} className={`ad-chip ${kind === k.id ? 'ad-chip--active' : ''}`} onClick={() => onKind(k.id)}>
            {k.label}
            <span className="ad-chip__count">{k.count}</span>
          </button>
        ))}
      </div>

      <div className="ad-filters__divider" />

      <div className="ad-sortselect">
        <span className="ad-filters__label" style={{ marginRight: 6 }}>Sort</span>
        <select className="ad-select" value={sort} onChange={(e) => onSort(e.target.value)}>
          {sorts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div style={{ flex: 1 }} />

      <div className="ad-search">
        <AdGlyph.Search size={14} />
        <input placeholder="Search by name or email…" />
        <span className="ad-stub" title="Backend doesn't index user records yet">Stub</span>
      </div>

      <button className="ad-iconbtn" title="Refresh">
        <AdGlyph.Refresh size={14} />
        {!isMobile && <span>Refresh</span>}
      </button>
    </div>
  );
}

function AdAccountAvatar({ user, size = 32 }) {
  const cls = `ad-account-avatar ad-account-avatar--${user.kind}`;
  return (
    <div className={cls} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {user.initials}
    </div>
  );
}

function AdSuspendedTable({ rows, onUnsuspend, onViewActivity, compact = false }) {
  return (
    <div className="ad-tablewrap">
      <div className="ad-tablewrap__count">
        <span>
          Showing <strong>{rows.length}</strong> {rows.length === 1 ? 'account' : 'accounts'}
        </span>
        <span className="ad-tablewrap__count-actions">
          <button className="ad-linkbtn">Density: Compact <span className="ad-stub" style={{ marginLeft: 4 }}>Stub</span></button>
        </span>
      </div>
      <div className="ad-tablewrap__scroll">
        <table className="ad-table" style={{ minWidth: compact ? 920 : undefined }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Kind</th>
              <th style={{ width: 220 }}>Display name</th>
              {!compact && <th style={{ width: 220 }}>Email</th>}
              <th style={{ width: 130 }}>Suspended</th>
              <th>Reason</th>
              <th style={{ width: 80 }}>Reports</th>
              <th style={{ width: 220 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.hasAppeal ? 'is-appeal' : ''}>
                <td>
                  <AdKindPill kind={u.kind} />
                </td>
                <td>
                  <div className="ad-cell-account">
                    <AdAccountAvatar user={u} size={32} />
                    <div>
                      <div className="ad-cell-account__name">{u.name}</div>
                      <div className="ad-cell-account__id">{u.id}</div>
                    </div>
                  </div>
                </td>
                {!compact && (
                  <td>
                    <div className="ad-cell-email">{u.email}</div>
                  </td>
                )}
                <td>
                  <div className="ad-cell-when">
                    <span className="ad-cell-when__rel">{u.suspendedRel}</span>
                    <span>{u.suspendedAt}</span>
                    <span style={{ fontSize: '0.62rem', color: 'var(--cl-text-muted)' }}>by {u.suspendedBy}</span>
                  </div>
                </td>
                <td>
                  <div className="ad-cell-reason">
                    <div className="ad-cell-reason-text" title={u.reason} style={{ maxWidth: 340 }}>
                      {u.reasonShort}
                    </div>
                    {u.hasAppeal && (
                      <a className="ad-appeal-link" href="#" title="Open Appeals tab">
                        <span className="ad-appeal-link__dot" /> Appeal pending →
                      </a>
                    )}
                  </div>
                </td>
                <td>
                  <span className="ad-reportcount">{u.reportCount}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="ad-actions">
                    <button className="ad-actbtn" onClick={() => onViewActivity(u)} title="Open content history in new tab" aria-label="View activity">
                      <AdGlyph.External size={11} />
                    </button>
                    <span className="ad-act-sep" />
                    <button className="ad-actbtn ad-actbtn--grant-solid" onClick={() => onUnsuspend(u)}>
                      <AdGlyph.Unhide size={12} />
                      <span>Unsuspend</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdSuspendedCardList({ rows, onUnsuspend, onViewActivity }) {
  return (
    <div className="ad-cardlist">
      {rows.map((u) => (
        <div key={u.id} className={`ad-card ${u.hasAppeal ? 'is-appeal' : ''}`}>
          <div className="ad-card__hdr">
            <div className="ad-card__type" style={{ gap: 10 }}>
              <AdAccountAvatar user={u} size={36} />
              <div className="ad-card__type-text">
                <div className="ad-card__type-main">{u.name}</div>
                <div className="ad-card__type-id" style={{ fontFamily: 'inherit', fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>{u.email}</div>
              </div>
            </div>
            <AdKindPill kind={u.kind} />
          </div>

          {u.hasAppeal && (
            <a className="ad-appeal-link" href="#" style={{ alignSelf: 'flex-start' }}>
              <span className="ad-appeal-link__dot" /> Appeal pending →
            </a>
          )}

          <div className="ad-card__meta">
            <div>
              <span className="ad-card__metalabel">Suspended</span>
              <div style={{ fontSize: 'var(--cl-text-sm)', fontWeight: 600 }}>{u.suspendedRel}</div>
              <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>{u.suspendedAt}</div>
            </div>
            <div>
              <span className="ad-card__metalabel">Reports against</span>
              <div style={{ fontSize: 'var(--cl-text-lg)', fontWeight: 700 }}>{u.reportCount}</div>
            </div>
          </div>

          <div>
            <span className="ad-card__metalabel">Reason</span>
            <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text)', lineHeight: 1.45 }}>{u.reasonShort}</div>
          </div>

          <div className="ad-card__actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <button className="ad-btn ad-btn--grant" style={{ width: '100%' }} onClick={() => onUnsuspend(u)}>
              <AdGlyph.Unhide size={13} /> Unsuspend
            </button>
            <button className="ad-actbtn" style={{ alignSelf: 'center', marginTop: 2 }} onClick={() => onViewActivity(u)}>
              <AdGlyph.External size={11} /> <span>View activity</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdSuspendedEmpty() {
  return (
    <div className="ad-empty">
      <svg className="ad-empty__art" viewBox="0 0 180 96" aria-hidden="true">
        <circle cx="90" cy="48" r="34" fill="none" stroke="#dee2e6" strokeWidth="1.5" strokeDasharray="3 5" />
        <circle cx="90" cy="40" r="14" fill="#e6f3ec" stroke="#27ae60" strokeWidth="1.8" />
        <path d="M82 40l6 6 10-12" stroke="#1e8048" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="68" y="60" width="44" height="14" rx="7" fill="#ffffff" stroke="#dee2e6" strokeWidth="1.5" />
        <path d="M76 67h28" stroke="#dee2e6" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <h2 className="ad-empty__title">No suspended accounts.</h2>
      <p className="ad-empty__body">
        Nobody is suspended right now. When you suspend a citizen or rep from the moderation queue, they show up here with the suspension reason and a one-click unsuspend.
      </p>
      <div className="ad-empty__hint">
        <AdGlyph.Sparkle size={13} /> 2 unsuspended this week · 0 outstanding appeals
      </div>
    </div>
  );
}

function AdUnsuspendModal({ user, onCancel, onConfirm }) {
  if (!user) return null;
  return (
    <div className="ad-modal-bg" onClick={onCancel}>
      <div className="ad-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="ad-modal__hdr">
          <div className="ad-modal__eyebrow ad-modal__eyebrow--success">Reversible action</div>
          <h2 className="ad-modal__title">Unsuspend {user.name}?</h2>
        </div>
        <div className="ad-modal__body">
          <div>
            They'll regain the ability to post, comment, and vote immediately. The suspension record stays on the audit log; you can re-suspend at any time.
          </div>
          <div className="ad-modal__contentblock" style={{ borderLeftColor: 'var(--cl-success)' }}>
            <div className="ad-modal__contentmeta">
              <AdKindPill kind={user.kind} />
              <span>·</span>
              <span style={{ fontFamily: 'var(--cl-font-mono)', textTransform: 'none', letterSpacing: 0 }}>{user.email}</span>
            </div>
            <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>
              Suspended <strong>{user.suspendedRel}</strong> by {user.suspendedBy}
            </div>
            <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text)' }}>
              "{user.reason}"
            </div>
          </div>
          {user.hasAppeal && (
            <div className="ad-modal__notice" style={{
              fontSize: 'var(--cl-text-xs)',
              padding: '10px 12px',
              background: 'var(--cl-warning-soft)',
              color: 'var(--cl-warning-text)',
              border: '1px solid var(--cl-warning-border)',
              borderRadius: 'var(--cl-radius-md)',
              lineHeight: 1.5,
            }}>
              <strong>Note:</strong> this account has an open appeal. Unsuspending here will also resolve the appeal as <em>granted</em>.
            </div>
          )}
        </div>
        <div className="ad-modal__footer">
          <button className="ad-btn ad-btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="ad-btn ad-btn--grant" onClick={() => onConfirm(user)} autoFocus>
            <AdGlyph.Unhide size={13} /> Unsuspend
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AdSuspendedFilters, AdAccountAvatar, AdSuspendedTable, AdSuspendedCardList, AdSuspendedEmpty, AdUnsuspendModal });
