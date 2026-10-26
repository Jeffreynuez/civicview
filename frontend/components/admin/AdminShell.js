'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * The admin page's frame (2026-10-26 redesign): how you move between the
 * eight sections, who you are signed in as, and the title and counts of
 * the section you are on.
 *
 *   Desktop (900px and up): a left sidebar with the sections in four
 *   groups and their counts, and your account, the test push and the way
 *   home at its foot.
 *   Phone and tablet: one slim navy bar. Its left button names the
 *   section you are on and opens the same grouped list as a bottom
 *   sheet; the "..." button opens your account, the test push and the
 *   way home.
 *
 * Before this, every section opened on a big title, the signed-in line,
 * the test push button, a scrolling tab strip and three full-width
 * number tiles, which on a phone filled the first screen before any work
 * showed. The counts are now one line under the title.
 *
 * Props:
 *   active     the section id on screen
 *   counts     { [sectionId]: number } shown beside the section names
 *   me         { email, kind } from whoami
 *   onSelect   (sectionId) => void
 *   stats      [{ value, label, tone }] for the line under the title;
 *              tone is open | hidden | resolved | warning | success |
 *              danger | muted
 *   banner     an element shown under the title (errors)
 */

import Link from 'next/link';
import { useState } from 'react';

import AdminTestPush from './AdminTestPush';
import { useAdminDialog } from './adminUi';

export const ADMIN_SECTIONS = [
  {
    group: 'Moderation',
    items: [
      { id: 'queue', label: 'Queue', title: 'Moderation queue', urgent: true },
      { id: 'appeals', label: 'Appeals', title: 'Appeals', urgent: true },
      { id: 'suspended', label: 'Suspended', title: 'Suspended accounts' },
      { id: 'lockouts', label: 'Lockouts', title: 'Account lockouts' },
    ],
  },
  {
    group: 'People',
    items: [{ id: 'accounts', label: 'Accounts', title: 'Account lookup' }],
  },
  {
    group: 'Pages',
    items: [
      { id: 'transitions', label: 'Transitions', title: 'Former officials and candidates' },
      { id: 'reminders', label: 'Election reminders', title: 'Election reminders' },
    ],
  },
  {
    group: 'Record',
    items: [{ id: 'history', label: 'History', title: 'Admin history' }],
  },
];

const ALL_SECTIONS = ADMIN_SECTIONS.flatMap((g) => g.items);

export function sectionFor(id) {
  return ALL_SECTIONS.find((s) => s.id === id) || ALL_SECTIONS[0];
}

function SectionNav({ active, counts, onSelect }) {
  return (
    <nav className="ad-nav" aria-label="Admin sections">
      {ADMIN_SECTIONS.map((g) => (
        <div key={g.group} className="ad-nav__group">
          <div className="ad-nav__label">{g.group}</div>
          <ul>
            {g.items.map((it) => {
              const n = counts?.[it.id] || 0;
              const on = active === it.id;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    className={`ad-nav__item${on ? ' is-active' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    onClick={() => onSelect(it.id)}
                  >
                    <span>{it.label}</span>
                    {n > 0 && (
                      <span className={`ad-nav__count${it.urgent ? ' is-urgent' : ''}`}>
                        {n}
                        <span className="ad-sr"> waiting</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AccountBlock({ me }) {
  return (
    <div className="ad-acct">
      <div className="ad-acct__who">
        <span className="ad-acct__label">Signed in as</span>
        <span className="ad-acct__email">{me?.email}</span>
        <span className="ad-acct__kind">
          {me?.kind === 'citizen' ? 'Citizen' : me?.kind === 'candidate' ? 'Candidate' : 'Rep'} account on the admin list
        </span>
      </div>
      <AdminTestPush />
      <Link className="ad-acct__home" href="/">
        <span aria-hidden="true">←</span> CivicView home
      </Link>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  const { dialogRef, titleId } = useAdminDialog(onClose);
  return (
    <div className="ad-sheet-bg" onClick={onClose}>
      <div
        className="ad-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ad-sheet__hdr">
          <h2 className="ad-sheet__title" id={titleId}>{title}</h2>
          <button type="button" className="ad-sheet__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stats({ stats }) {
  if (!stats || stats.length === 0) return null;
  return (
    <p className="ad-stats">
      {stats.map((s) => (
        <span key={s.label} className="ad-stat">
          <span className={`ad-stat__dot ad-stat__dot--${s.tone || 'muted'}`} aria-hidden="true" />
          <strong className="cl-num">{s.value}</strong> {s.label}
        </span>
      ))}
    </p>
  );
}

export default function AdminShell({ active, counts, me, onSelect, stats, banner, children }) {
  const [sheet, setSheet] = useState(null); // 'sections' | 'menu' | null
  const section = sectionFor(active);
  const count = counts?.[active] || 0;
  const pick = (id) => {
    setSheet(null);
    onSelect(id);
  };

  return (
    <div className="ad-root ad-shell">
      <aside className="ad-side">
        <div className="ad-side__brand">
          <Link href="/" className="ad-side__logo">CivicView</Link>
          <span className="ad-side__tag">Admin</span>
        </div>
        <SectionNav active={active} counts={counts} onSelect={pick} />
        <div className="ad-side__foot">
          <AccountBlock me={me} />
        </div>
      </aside>

      <div className="ad-shell__body">
        <header className="ad-topbar">
          <button
            type="button"
            className="ad-topbar__section"
            onClick={() => setSheet('sections')}
            aria-haspopup="dialog"
            aria-label={`Admin section: ${section.label}. Change section`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <span className="ad-topbar__label">{section.label}</span>
            {count > 0 && <span className={`ad-nav__count${section.urgent ? ' is-urgent' : ''}`}>{count}</span>}
            <svg className="ad-topbar__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <span className="ad-topbar__tag">Admin</span>
          <button
            type="button"
            className="ad-topbar__more"
            onClick={() => setSheet('menu')}
            aria-haspopup="dialog"
            aria-label="Admin account and tools"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        </header>

        <main className="ad-main">
          <div className="ad-head">
            <h1 className="ad-head__title">{section.title}</h1>
            <Stats stats={stats} />
          </div>
          {banner}
          {children}
        </main>
      </div>

      {sheet === 'sections' && (
        <Sheet title="Admin sections" onClose={() => setSheet(null)}>
          <SectionNav active={active} counts={counts} onSelect={pick} />
        </Sheet>
      )}
      {sheet === 'menu' && (
        <Sheet title="Admin" onClose={() => setSheet(null)}>
          <AccountBlock me={me} />
        </Sheet>
      )}
    </div>
  );
}
