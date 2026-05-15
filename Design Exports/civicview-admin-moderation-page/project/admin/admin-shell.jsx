// Admin shell: Navbar, PageHeaderBand, KPIStrip, FilterRow, SubNav, ErrorBanner.
// Page-specific config (crumb / title / KPIs / active tab) is passed in
// as props — the shell is reused by Queue, Appeals, and Suspended.

function AdNavbar({ variant = 'desktop' }) {
  const isMobile = variant === 'mobile';
  return (
    <header className="ad-nav">
      {/* Left: US flag + wordmark */}
      <div className="ad-nav__logo">
        <AdGlyph.Logo size={28} />
        <span>CivicView</span>
      </div>

      <div className="ad-nav__spacer" />

      {/* Right cluster — order matches live /polls navbar:
          identity → Sign out → Subscribe → Polls → My Tracked → bell → hamburger.
          On mobile, Sign out moves into the hamburger menu. */}
      <div className="ad-nav__identity">
        <span className="ad-nav__identity-badge">
          <AdGlyph.Person size={13} /> CivicView Admin
        </span>
      </div>
      {!isMobile && <button className="ad-nav__signout-text">Sign out</button>}

      {!isMobile && (
        <>
          <button className="ad-nav__pill ad-nav__pill--subscribe">Subscribe</button>
          <button className="ad-nav__btn">
            <AdGlyph.Polls size={14} />
            <span>Polls</span>
          </button>
          <button className="ad-nav__btn">
            <AdGlyph.Bookmark size={13} />
            <span>My Tracked</span>
            <span className="ad-nav__count">7</span>
          </button>
          <button className="ad-nav__bell" aria-label="Notifications, 3 unread">
            <AdGlyph.Bell size={16} />
            <span className="ad-nav__dot">3</span>
          </button>
        </>
      )}

      <button className="ad-nav__hamburger" aria-label="Menu">
        <AdGlyph.Menu size={16} />
      </button>
    </header>
  );
}

// SubNav — pill tabs with optional numeric badges. Badge counts come from
// the global system state so each tab shows the same pending count regardless
// of which tab is active.
function AdSubNav({ active = 'queue', counts = {}, variant = 'desktop' }) {
  const items = [
    { id: 'queue', label: 'Queue', badge: counts.queue },
    { id: 'appeals', label: 'Appeals', badge: counts.appeals },
    { id: 'suspended', label: 'Suspended users', badge: counts.suspended },
  ];
  const isMobile = variant === 'mobile';

  return (
    <div className={`ad-subnav-row ${isMobile ? 'ad-subnav-row--mobile' : ''}`}>
      <nav className={`ad-subnav ${isMobile ? 'ad-subnav--scroll' : ''}`} aria-label="Admin sections">
        {items.map((it) => (
          <button
            key={it.id}
            className={`ad-subnav__item ${active === it.id ? 'ad-subnav__item--active' : ''}`}
          >
            {it.label}
            {it.badge > 0 ? <span className="ad-subnav__badge">{it.badge}</span> : null}
          </button>
        ))}
      </nav>
      <a className="ad-subnav__home" href="#">
        <span aria-hidden="true">←</span> CivicView home
      </a>
    </div>
  );
}

// AdKpi — single KPI tile. `dotKind` controls the colored dot
// ('open'|'hidden'|'resolved'|'success'|'danger'|'warning').
// `deltaKind` styles the delta line ('up'|'down'|'flat').
function AdKpi({ label, num, delta, dotKind = 'open', deltaKind = 'flat', mobile = false }) {
  const dotCls = `ad-kpi__dot ad-kpi__dot--${dotKind}`;
  return (
    <div className={`ad-kpi ${mobile ? 'ad-kpi--mobile' : ''}`}>
      <div className="ad-kpi__label"><span className={dotCls}></span>{label}</div>
      <div className="ad-kpi__num">{num}</div>
      {delta && <div className={`ad-kpi__delta ad-kpi__delta--${deltaKind}`}>{delta}</div>}
    </div>
  );
}

// AdPageHead — fully configurable. kpis is an array of {label, num, delta, dotKind, deltaKind}.
function AdPageHead({
  crumb = 'Admin · Moderation',
  title = 'Moderation queue',
  email = 'jeff@example.com',
  subnav = 'queue',
  subnavCounts = { queue: 0, appeals: 3, suspended: 2 },
  kpis = [],
  variant = 'desktop',
}) {
  const isMobile = variant === 'mobile';
  return (
    <div className="ad-pagehead">
      <div className="ad-pagehead__top">
        <div className="ad-pagehead__crumb">{crumb}</div>
        <h1 className="ad-pagehead__title">{title}</h1>
        <div className="ad-pagehead__subline">
          Signed in as <span className="ad-pagehead__subline-mono">{email}</span> · citizen account on ADMIN_EMAILS allowlist
        </div>
      </div>

      <AdSubNav active={subnav} counts={subnavCounts} variant={variant} />

      <div className={`ad-kpis ${isMobile ? 'ad-kpis--mobile' : ''}`}>
        {kpis.map((k, i) => <AdKpi key={i} {...k} mobile={isMobile} />)}
      </div>
    </div>
  );
}

// AdFilters — Queue-specific filters. Appeals and Suspended each ship their
// own filter component since their controls differ (the shell pattern stays
// the same: white card, rounded-xl, padded, chips + toggles + search + refresh).
function AdFilters({ includeResolved, onIncludeResolved, kind, onKind, reporterKind, onReporterKind, autoOnly, onAutoOnly, variant = 'desktop' }) {
  const kinds = [
    { id: 'all', label: 'All', count: 8 },
    { id: 'post', label: 'Rep post', count: 2 },
    { id: 'comment', label: 'Comment', count: 3 },
    { id: 'poll', label: 'Poll', count: 1 },
    { id: 'pollcomment', label: 'Poll comment', count: 2 },
  ];
  const reporters = [
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

      {!isMobile && <span className="ad-filters__label">Kind</span>}
      <div className="ad-filters__chips">
        {kinds.map((k) => (
          <button key={k.id} className={`ad-chip ${kind === k.id ? 'ad-chip--active' : ''}`} onClick={() => onKind(k.id)}>
            {k.label}
            <span className="ad-chip__count">{k.count}</span>
          </button>
        ))}
      </div>

      {!isMobile && (
        <>
          <div className="ad-filters__divider" />
          <span className="ad-filters__label">Reporter</span>
          <div className="ad-filters__chips">
            {reporters.map((r) => (
              <button key={r.id} className={`ad-chip ${reporterKind === r.id ? 'ad-chip--active' : ''}`} onClick={() => onReporterKind(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="ad-toggle">
        <input type="checkbox" checked={autoOnly} onChange={(e) => onAutoOnly(e.target.checked)} />
        <span className="ad-toggle__track" />
        Auto-flagged only
      </label>

      <div style={{ flex: 1 }} />

      <div className="ad-search">
        <AdGlyph.Search size={14} />
        <input placeholder="Search reports…" />
        <span className="ad-stub" title="Backend doesn't index reports yet">Stub</span>
      </div>

      <button className="ad-iconbtn" title="Refresh queue">
        <AdGlyph.Refresh size={14} />
        {!isMobile && <span>Refresh</span>}
      </button>
    </div>
  );
}

function AdErrorBanner({ title, detail, onClose }) {
  return (
    <div className="ad-banner" role="alert">
      <div className="ad-banner__icon">!</div>
      <div className="ad-banner__body">
        <div className="ad-banner__title">{title}</div>
        {detail && <div className="ad-banner__detail">{detail}</div>}
      </div>
      <button className="ad-banner__close" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}

Object.assign(window, { AdNavbar, AdSubNav, AdPageHead, AdKpi, AdFilters, AdErrorBanner });
