'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import './LifecycleBanner.css';

/**
 * The banner on a page whose official has left office, whose campaign
 * has ended, or whose candidate won (2026-10-15). Reads the backend's
 * lifecycle block (services/page_lifecycle.py) and says, in the same
 * words for everyone, what changed, when, and what still works.
 *
 *   farewell   left office, days 0 to 30: the owner can still post
 *   read_only  the farewell window has closed; citizens can still
 *              comment, like and vote until the archive
 *   archived   frozen, out of search, the map, feeds and tracked
 *              lists, readable by link, reports still work
 *   elect      won, not sworn in yet
 *
 * Props: lifecycle (the block), isOwner (the page's own account is
 * viewing), compact (one line, for profile heroes).
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function formatLongDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const STAGE_LABELS = {
  farewell: 'Farewell window',
  read_only: 'Read-only',
  archived: 'Archived',
  elect: 'Official-elect',
};

function pageHref(id) {
  return `/?page=${encodeURIComponent(id)}`;
}

function bodyLines(lc, isOwner) {
  const lines = [];
  const official = lc.page_kind === 'official';
  const archive = formatLongDate(lc.archive_on);
  const farewellEnd = formatLongDate(lc.farewell_ends_on);
  const start = formatLongDate(lc.event_on || lc.recorded_on);
  if (lc.event === 'won') {
    if (lc.stage === 'elect' && lc.sworn_in_on) {
      lines.push(`Takes office on ${formatLongDate(lc.sworn_in_on)}.`);
    }
    if ((lc.stage === 'read_only' || lc.stage === 'archived') && lc.linked_page_id) {
      lines.push('This campaign has ended. Follow the official page to keep up.');
    }
    if (lc.stage === 'archived') {
      lines.push(`This campaign page was archived on ${archive}. It is kept as a record. Nothing on it was deleted.`);
    }
    return lines;
  }
  const acting = official ? 'as the official' : 'as a candidate';
  if (lc.stage === 'farewell') {
    if (isOwner) {
      lines.push(`Polls, events, comments, likes and votes ${acting} ended on ${start}. You can still publish posts until ${farewellEnd}.`);
    } else if (archive) {
      lines.push(`Comments, likes and votes on this page stay open until it is archived on ${archive}.`);
    }
  } else if (lc.stage === 'read_only') {
    if (isOwner && farewellEnd) {
      lines.push(`The window for farewell posts closed on ${farewellEnd}, so the page is read-only.`);
    }
    if (archive) {
      lines.push(isOwner
        ? `It will be archived on ${archive}.`
        : `Comments, likes and votes on this page stay open until it is archived on ${archive}.`);
    }
  } else if (lc.stage === 'archived') {
    lines.push(`This page was archived on ${archive}. It is kept as a record and no longer appears in search, the map, feeds or tracked lists. Nothing on it was deleted. Content can still be reported.`);
  }
  return lines;
}

export default function LifecycleBanner({ lifecycle: lc, isOwner = false, compact = false }) {
  if (!lc) return null;
  const quietLink = lc.stage === 'active' && lc.linked_page_id;
  if (!lc.title && !quietLink && lc.stage !== 'archived') return null;

  if (quietLink) {
    return (
      <p className="lifecycle-note">
        <a href={pageHref(lc.linked_page_id)}>
          {lc.page_kind === 'official' ? 'Campaign page (archived)' : 'Official page'}
        </a>
      </p>
    );
  }

  const label = STAGE_LABELS[lc.stage];
  if (compact) {
    return (
      <p className={`lifecycle-compact lifecycle-compact--${lc.stage}`}>
        {lc.title}
        {lc.stage === 'archived' && <span className="lifecycle-chip">Archived</span>}
      </p>
    );
  }

  const lines = bodyLines(lc, isOwner);
  const successors = (lc.successor_ids || []).filter(Boolean);
  return (
    <section className={`lifecycle-banner lifecycle-banner--${lc.stage}`} aria-label="Page status">
      <div className="lifecycle-banner__head">
        {lc.title && <strong className="lifecycle-banner__title">{lc.title}</strong>}
        {label && <span className="lifecycle-chip">{label}</span>}
      </div>
      {lc.date_line && <p className="lifecycle-banner__date">{lc.date_line}.</p>}
      {lines.map((line) => <p key={line} className="lifecycle-banner__line">{line}</p>)}
      {(successors.length > 0 || lc.linked_page_id || lc.source_url) && (
        <p className="lifecycle-banner__links">
          {lc.page_kind === 'official' && successors.map((id, i) => (
            <a key={id} href={pageHref(id)}>
              {successors.length > 1 ? `Current officeholder ${i + 1}` : 'Current officeholder'}
            </a>
          ))}
          {lc.linked_page_id && (
            <a href={pageHref(lc.linked_page_id)}>
              {lc.page_kind === 'candidate' ? 'Official page' : 'Campaign page'}
            </a>
          )}
          {lc.source_url && (
            <a href={lc.source_url} target="_blank" rel="noopener noreferrer">Source</a>
          )}
        </p>
      )}
    </section>
  );
}
