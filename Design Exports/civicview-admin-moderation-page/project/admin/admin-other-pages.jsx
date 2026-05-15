// AppealsPage — composes the Appeals view at any variant + state.

function AppealsPage({
  variant = 'desktop',
  emptyState = false,
  showError = false,
  modal = null,                // null | 'grant' | 'deny'
  modalRowIndex = 0,
  accessState = null,
  bareNoNav = false,
  initialIncludeResolved = true,
}) {
  const [includeResolved, setIncludeResolved] = React.useState(initialIncludeResolved);
  const [type, setType] = React.useState('all');
  const [appellantKind, setAppellantKind] = React.useState('any');
  const [errorOpen, setErrorOpen] = React.useState(showError);
  const [activeModal, setActiveModal] = React.useState(modal);
  const [activeRow, setActiveRow] = React.useState(window.AD_APPEALS[modalRowIndex] || null);

  React.useEffect(() => {
    setActiveModal(modal);
    setActiveRow(window.AD_APPEALS[modalRowIndex] || null);
  }, [modal, modalRowIndex]);
  React.useEffect(() => { setErrorOpen(showError); }, [showError]);

  let appeals = window.AD_APPEALS;
  if (!includeResolved) appeals = appeals.filter((a) => a.status === 'pending');
  if (type !== 'all') appeals = appeals.filter((a) => a.type === type);
  if (appellantKind !== 'any') appeals = appeals.filter((a) => a.appellantKind === appellantKind);
  if (emptyState) appeals = [];

  const onGrant = (a) => { setActiveRow(a); setActiveModal('grant'); };
  const onDeny  = (a) => { setActiveRow(a); setActiveModal('deny');  };

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

  if (bareNoNav && activeModal) {
    return (
      <div className="ad-root" style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--cl-bg)' }}>
        <AdAppealDecisionModal appeal={activeRow} decision={activeModal} onCancel={() => {}} onConfirm={() => {}} />
      </div>
    );
  }

  const kpis = [
    { label: 'Open appeals', num: window.AD_APPEALS_KPIS.open, delta: '▲ 1 from yesterday', dotKind: 'warning', deltaKind: 'up' },
    { label: 'Granted this week', num: window.AD_APPEALS_KPIS.grantedWeek, delta: 'Median time-to-decide: 2h 14m', dotKind: 'success', deltaKind: 'flat' },
    { label: 'Denied this week', num: window.AD_APPEALS_KPIS.deniedWeek, delta: 'Roughly even with last week', dotKind: 'danger', deltaKind: 'flat' },
  ];

  return (
    <div className={`ad-root ad-root--${variant}`} style={{ position: 'relative' }}>
      <AdNavbar variant={variant} />
      <main className={`ad-main ad-main--${variant}`}>
        <AdPageHead
          variant={variant}
          crumb="Admin · Appeals"
          title="Appeals queue"
          subnav="appeals"
          subnavCounts={{ queue: 0, appeals: 3, suspended: 2 }}
          kpis={kpis}
        />
        <AdAppealsFilters
          variant={variant}
          includeResolved={includeResolved} onIncludeResolved={setIncludeResolved}
          type={type} onType={setType}
          appellantKind={appellantKind} onAppellantKind={setAppellantKind}
        />
        {errorOpen && (
          <AdErrorBanner
            title="Couldn't load appeal #8821"
            detail="GET /admin/appeals/8821 returned 503. The list still loaded — try again, or refresh to retry the failed row."
            onClose={() => setErrorOpen(false)}
          />
        )}
        {emptyState ? (
          <AdAppealsEmpty />
        ) : (
          <AdAppealsList appeals={appeals} onGrant={onGrant} onDeny={onDeny} />
        )}
      </main>

      {activeModal && (
        <AdAppealDecisionModal
          appeal={activeRow}
          decision={activeModal}
          onCancel={() => setActiveModal(null)}
          onConfirm={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

// SuspendedPage — composes the Suspended Accounts view at any variant + state.
function SuspendedPage({
  variant = 'desktop',
  emptyState = false,
  showError = false,
  modal = null,                // null | 'unsuspend'
  modalRowIndex = 0,
  accessState = null,
  bareNoNav = false,
}) {
  const [kind, setKind] = React.useState('all');
  const [sort, setSort] = React.useState('newest');
  const [errorOpen, setErrorOpen] = React.useState(showError);
  const [activeModal, setActiveModal] = React.useState(modal);
  const [activeRow, setActiveRow] = React.useState(window.AD_SUSPENDED[modalRowIndex] || null);

  React.useEffect(() => {
    setActiveModal(modal);
    setActiveRow(window.AD_SUSPENDED[modalRowIndex] || null);
  }, [modal, modalRowIndex]);
  React.useEffect(() => { setErrorOpen(showError); }, [showError]);

  let rows = window.AD_SUSPENDED;
  if (kind !== 'all') rows = rows.filter((u) => u.kind === kind);
  if (emptyState) rows = [];

  const onUnsuspend = (u) => { setActiveRow(u); setActiveModal('unsuspend'); };
  const onViewActivity = (u) => { /* opens user's content history */ };

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

  if (bareNoNav && activeModal) {
    return (
      <div className="ad-root" style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--cl-bg)' }}>
        <AdUnsuspendModal user={activeRow} onCancel={() => {}} onConfirm={() => {}} />
      </div>
    );
  }

  const isMobile = variant === 'mobile';
  const isTablet = variant === 'tablet';
  const kpis = [
    { label: 'Currently suspended', num: window.AD_SUSPENDED_KPIS.current, delta: '▲ 3 over the past two weeks', dotKind: 'danger', deltaKind: 'flat' },
    { label: 'Suspended this week', num: window.AD_SUSPENDED_KPIS.suspendedWeek, delta: 'Spam-cluster bump on Mon', dotKind: 'warning', deltaKind: 'flat' },
    { label: 'Unsuspended this week', num: window.AD_SUSPENDED_KPIS.unsuspendedWeek, delta: '1 via appeal · 1 admin override', dotKind: 'success', deltaKind: 'flat' },
  ];

  return (
    <div className={`ad-root ad-root--${variant}`} style={{ position: 'relative' }}>
      <AdNavbar variant={variant} />
      <main className={`ad-main ad-main--${variant}`}>
        <AdPageHead
          variant={variant}
          crumb="Admin · Suspended users"
          title="Suspended accounts"
          subnav="suspended"
          subnavCounts={{ queue: 0, appeals: 3, suspended: 2 }}
          kpis={kpis}
        />
        <AdSuspendedFilters
          variant={variant}
          kind={kind} onKind={setKind}
          sort={sort} onSort={setSort}
        />
        {errorOpen && (
          <AdErrorBanner
            title="Couldn't unsuspend user#4421"
            detail="POST /admin/users/4421/unsuspend returned 503. Try again — the suspension record is unchanged."
            onClose={() => setErrorOpen(false)}
          />
        )}
        {emptyState ? (
          <AdSuspendedEmpty />
        ) : isMobile ? (
          <AdSuspendedCardList rows={rows} onUnsuspend={onUnsuspend} onViewActivity={onViewActivity} />
        ) : (
          <AdSuspendedTable rows={rows} onUnsuspend={onUnsuspend} onViewActivity={onViewActivity} compact={isTablet} />
        )}
      </main>

      {activeModal === 'unsuspend' && (
        <AdUnsuspendModal
          user={activeRow}
          onCancel={() => setActiveModal(null)}
          onConfirm={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

Object.assign(window, { AppealsPage, SuspendedPage });
