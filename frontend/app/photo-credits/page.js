'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /photo-credits: every Wikimedia Commons photo CivicView shows, with its
 * author, license and a link to the file (audit P2). Large profile photos
 * carry the same credit directly underneath; this page covers the small
 * thumbnails in lists, where a credit line under each image would not fit.
 * The list comes from /api/photo-credits, built from the Wikimedia
 * Commons API by backend/scripts/build_photo_credits.py.
 */

import { useEffect, useState } from 'react';

import LegalPageLayout from '@/components/LegalPageLayout';
import { fetchPhotoCredits } from '@/lib/photoCredits';

const cell = { padding: '8px 10px', borderBottom: '1px solid var(--cl-border)', verticalAlign: 'top', textAlign: 'left' };

export default function PhotoCreditsPage() {
  const [doc, setDoc] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchPhotoCredits().then((d) => { if (alive) setDoc(d); });
    return () => { alive = false; };
  }, []);

  const credits = (doc && doc.credits) || [];

  return (
    <LegalPageLayout title="Photo credits" eyebrow="Where our photos come from" lastUpdated="September 25, 2026">
      <p>
        Most photos of officials and candidates on CivicView come from the
        official sources listed in our <a href="/methodology">Methodology</a>,
        such as congressional and state legislature websites. Others come
        from{' '}
        <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>,
        and each of those is listed below with its author and license. Most
        are official portraits in the public domain; a few are shared under
        Creative Commons licenses that require this credit.
      </p>
      <p>
        The same credit appears under the larger photo on each profile and
        page. If you took one of these photos, or a photo shows the wrong
        person, please <a href="/contact">contact us</a>.
      </p>

      {doc === null ? (
        <p>Loading the list…</p>
      ) : credits.length === 0 ? (
        <p>The list could not be loaded right now. Please try again later.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={cell}>Photo of</th>
                <th style={cell}>Author</th>
                <th style={cell}>License</th>
                <th style={cell}>Source</th>
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <tr key={c.photo_url}>
                  <td style={cell}>{(c.subjects && c.subjects.length) ? c.subjects.join(', ') : 'Unnamed'}</td>
                  <td style={cell}>{c.author || 'Not stated on Commons'}</td>
                  <td style={cell}>
                    {c.license_url ? (
                      <a href={c.license_url} target="_blank" rel="noopener noreferrer">{c.license}</a>
                    ) : (c.license || 'Not stated')}
                  </td>
                  <td style={cell}>
                    <a href={c.file_page} target="_blank" rel="noopener noreferrer">File page</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {doc.retrieved && (
            <p style={{ fontSize: '0.8rem', color: 'var(--cl-text-light)', marginTop: 12 }}>
              Author and license details retrieved from Wikimedia Commons on {doc.retrieved}.
            </p>
          )}
        </div>
      )}
    </LegalPageLayout>
  );
}
