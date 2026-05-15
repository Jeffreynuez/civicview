// Composed AdminPage — renders the whole moderation surface in one of several states/variants.
// Used by the design canvas to populate every artboard.

function AdminPage({
  variant = 'desktop',           // 'desktop' | 'tablet' | 'mobile'
  emptyState = null,             // null | 'open' | 'all'
  showError = false,
  modal = null,                  // null | 'hide' | 'suspend'
  modalRowIndex = 0,
  accessState = null,            // null | 'probing' | 'unauthed' | 'denied'
  initialIncludeResolved = true,
  bareNoNav = false,             // hide navbar (for compact artboards)
}) {
  const [includeResolved, setIncludeResolved] = React.useState(initialIncludeResolved);
  const [kind, setKind] = React.useState('all');
  const [reporterKind, setReporterKind] = React.useState('any');
  const [autoOnly, setAutoOnly] = React.useState(false);
  const [errorOpen, setErrorOpen] = React.useState(showError);
  const [activeModal, setActiveModal] = React.useState(modal);
  const [activeRow, setActiveRow] = React.useState(window.AD_REPORTS[modalRowIndex] || null);

  React.useEffect(() => {
    setActiveModal(modal);
    setActiveRow(window.AD_REPORTS[modalRowIndex] || null);
  }, [modal, modalRowIndex]);
  React.useEffect(() => { setErrorOpen(showError); }, [showError]);

  // Filter rows
  let rows = window.AD_REPORTS;
  if (!includeResolved) rows = rows.filter((r) => r.status !== 'resolved');
  if (kind !== 'all') rows = rows.filter((r) => r.type === kind);
  if (reporterKind !== 'any') rows = rows.filter((r) => r.reporterKind === reporterKind);
  if (autoOnly) rows = rows.filter((r) => r.autoFlag);

  // Force empty states
  if (emptyState === 'open') rows = rows.filter((r) => r.status === 'resolved');
  if (emptyState === 'all') rows = [];

  const handleAction = (action, row) => {
    if (action === 'hide') { setActiveModal('hide'); setActiveRow(row); }
    else if (action === 'suspend') { setActiveModal('suspend'); setActiveRow(row); }
    else if (action === 'unhide') { /* would call API */ }
    else if (action === 'dismiss') { /* would call API */ }
    else if (action === 'view') { /* would open hosting page */ }
  };

  // Pure access-state pages
  if (accessState) {
    return (
      <div className={`ad-root ad-root--${variant}`}>
        <AdNavbar variant={variant} />
        <main className={`ad-main ad-main--${variant}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 480 }}>
          <div style={{ background: 'white', border: '1px solid var(--cl-border)', borderRadius: 'var(--cl-radius-2xl)', width: '100%', maxWidth: 560 }}>
            {accessState === 'probing' && <AdProbing />}
            {accessState === 'unauthed' && <AdUnauthed />}
            {accessState === 'denied' && <AdDenied />}
          </div>
        </main>
      </div>
    );
  }

  // Bare modal artboard — modal-only, sits over a dim backdrop. ad-modal-bg
  // is position: absolute inset: 0 so it fills this relatively-positioned wrapper.
  if (bareNoNav && activeModal) {
    return (
      <div className="ad-root" style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--cl-bg)' }}>
        {activeModal === 'hide' && (
          <AdHideModal row={activeRow} onCancel={() => {}} onConfirm={() => {}} />
        )}
        {activeModal === 'suspend' && (
          <AdSuspendModal row={activeRow} onCancel={() => {}} onConfirm={() => {}} />
        )}
      </div>
    );
  }

  const isMobile = variant === 'mobile';
  const isTablet = variant === 'tablet';

  // Queue KPIs — array form for the shared <AdPageHead>.
  const queueKpis = [
    { label: 'Open reports', num: window.AD_KPIS.open, delta: '▲ 3 from yesterday', dotKind: 'open', deltaKind: 'up' },
    { label: 'Hidden content', num: window.AD_KPIS.hidden, delta: '— no change this week', dotKind: 'hidden', deltaKind: 'flat' },
    { label: 'Resolved this week', num: window.AD_KPIS.resolvedWeek, delta: '12% fewer than last week', dotKind: 'resolved', deltaKind: 'flat' },
  ];

  return (
    <div className={`ad-root ad-root--${variant}`} style={{ position: 'relative' }}>
      <AdNavbar variant={variant} />
      <main className={`ad-main ad-main--${variant}`}>
        <AdPageHead
          variant={variant}
          crumb="Admin · Moderation"
          title="Moderation queue"
          subnav="queue"
          subnavCounts={{ queue: 0, appeals: 3, suspended: 2 }}
          kpis={queueKpis}
        />
        <AdFilters
          variant={variant}
          includeResolved={includeResolved} onIncludeResolved={setIncludeResolved}
          kind={kind} onKind={setKind}
          reporterKind={reporterKind} onReporterKind={setReporterKind}
          autoOnly={autoOnly} onAutoOnly={setAutoOnly}
        />
        {errorOpen && (
          <AdErrorBanner
            title="Couldn't hide content"
            detail='POST /admin/reports/14206/hide returned 503 — backend retry queue is backed up. Try again, or use the View link to act on the host page directly.'
            onClose={() => setErrorOpen(false)}
          />
        )}
        {emptyState === 'all' ? (
          <AdEmptyAll />
        ) : emptyState === 'open' ? (
          <AdEmptyOpen />
        ) : isMobile ? (
          <AdQueueCardList rows={rows} onAction={handleAction} />
        ) : (
          <AdQueueTable rows={rows} onAction={handleAction} compact={isTablet} />
        )}
      </main>

      {activeModal === 'hide' && (
        <AdHideModal
          row={activeRow}
          onCancel={() => setActiveModal(null)}
          onConfirm={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'suspend' && (
        <AdSuspendModal
          row={activeRow}
          onCancel={() => setActiveModal(null)}
          onConfirm={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

window.AdminPage = AdminPage;
