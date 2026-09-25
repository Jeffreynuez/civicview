'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * PhotoCredit: the credit line under a large profile photo (audit P2).
 *
 * Renders only for Wikimedia Commons photos. Most are official portraits
 * in the public domain, but some are CC BY or CC BY-SA, which require
 * the author, the license and a link wherever the photo appears, so
 * every Commons photo gets the same line:
 *
 *   Photo: Gage Skidmore, CC BY-SA 3.0, via Wikimedia Commons
 *
 * The author and "Wikimedia Commons" link to the file page, the license
 * to its deed. Smaller thumbnails elsewhere in the app are covered by
 * the full list on /photo-credits, linked from the footer.
 *
 * Props:
 *   url    the photo URL shown above this line
 *   tone   'light' (dark text, default) or 'dark' (light text on a
 *          colored hero)
 */

import { useEffect, useState } from 'react';

import { commonsFilePage, creditForPhoto, isWikimediaPhoto } from '@/lib/photoCredits';

export default function PhotoCredit({ url, tone = 'light', style }) {
  const [credit, setCredit] = useState(null);

  useEffect(() => {
    let alive = true;
    setCredit(null);
    if (isWikimediaPhoto(url)) {
      creditForPhoto(url).then((c) => { if (alive) setCredit(c); });
    }
    return () => { alive = false; };
  }, [url]);

  if (!isWikimediaPhoto(url)) return null;

  const color = tone === 'dark' ? 'rgba(255,255,255,0.72)' : 'var(--cl-text-light)';
  const linkStyle = { color: 'inherit', textDecoration: 'underline' };
  const filePage = (credit && credit.file_page) || commonsFilePage(url);
  const parts = [];
  if (credit && credit.author) {
    parts.push(
      <a key="author" href={filePage} target="_blank" rel="noopener noreferrer" style={linkStyle}>
        {credit.author}
      </a>,
    );
  }
  if (credit && credit.license) {
    parts.push(
      credit.license_url ? (
        <a key="license" href={credit.license_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          {credit.license}
        </a>
      ) : (
        <span key="license">{credit.license}</span>
      ),
    );
  }

  return (
    <div style={{ fontSize: '0.66rem', lineHeight: 1.4, color, margin: '-4px auto 8px', maxWidth: '40ch', ...style }}>
      Photo:{' '}
      {parts.map((p, i) => (
        <span key={i}>{p}, </span>
      ))}
      via{' '}
      <a href={filePage} target="_blank" rel="noopener noreferrer" style={linkStyle}>
        Wikimedia Commons
      </a>
    </div>
  );
}
