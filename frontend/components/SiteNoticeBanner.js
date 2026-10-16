'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * SiteNoticeBanner: a small notice across the top of every page, for
 * announcements such as a change to the privacy policy or the Terms
 * (both promise "a notice on CivicView" at least 30 days before a
 * material change). 2026-10-16.
 *
 * The text and the optional "Read more" link come from the backend's
 * SITE_NOTICE_TEXT and SITE_NOTICE_URL env vars through
 * GET /api/app/notice (backend/app/routers/app_meta.py). No text means
 * no banner. Dismissing it is remembered in this browser for that
 * exact notice; a new text or link shows again.
 *
 * In the page flow (not sticky), so it never covers a page's own
 * sticky header, and flex-shrink 0 because <body> is a fixed-height
 * flex column. Fails quietly: offline or an error renders nothing.
 */

import { useEffect, useState } from 'react';

import { getJson } from '@/lib/http';

const DISMISSED_KEY = 'cv:site-notice-dismissed';

// Which notice was dismissed, without storing the whole text.
function fingerprint(text, url) {
  const s = `${text}\n${url || ''}`;
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length}:${h.toString(36)}`;
}

// Same rule as the backend: a web address or a path on this site.
function safeHref(url) {
  const v = typeof url === 'string' ? url.trim() : '';
  if (!v || /\s/.test(v)) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  return null;
}

export default function SiteNoticeBanner() {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getJson('/api/app/notice')
      .then((n) => {
        const text = typeof n?.text === 'string' ? n.text.trim() : '';
        if (cancelled || !text) return;
        const href = safeHref(n.url);
        const fp = fingerprint(text, href);
        let dismissed = null;
        try { dismissed = window.localStorage.getItem(DISMISSED_KEY); } catch { /* storage blocked */ }
        if (dismissed === fp) return;
        setNotice({ text, href, fp });
      })
      .catch(() => { /* no notice */ });
    return () => { cancelled = true; };
  }, []);

  if (!notice) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISSED_KEY, notice.fp); } catch { /* storage blocked */ }
    setNotice(null);
  };
  const external = notice.href && /^https?:\/\//i.test(notice.href);

  return (
    <div
      role="region"
      aria-label="Notice"
      data-site-notice=""
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px 8px 16px',
        background: 'var(--cl-accent-soft, #e6f4f2)',
        borderBottom: '1px solid var(--cl-border, #d9dee5)',
        color: 'var(--cl-text, #1b263b)',
        fontFamily: 'var(--cl-font-sans)',
        fontSize: 'var(--cl-text-sm, 0.86rem)',
        lineHeight: 1.45,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {notice.text}
        {notice.href && (
          <>
            {' '}
            <a
              href={notice.href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
              style={{ color: 'inherit', fontWeight: 700, textDecoration: 'underline', whiteSpace: 'nowrap' }}
            >
              Read more
            </a>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        title="Dismiss"
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          border: 'none',
          borderRadius: 6,
          background: 'transparent',
          color: 'inherit',
          fontSize: '1.2rem',
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  );
}
