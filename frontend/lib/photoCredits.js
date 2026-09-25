// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Photo credits for the Wikimedia Commons photos in the data (audit P2).
 *
 * The backend serves one list, /api/photo-credits, built from the
 * Wikimedia Commons API. It is fetched once per page load and shared,
 * so every profile that shows a photo can look its credit up by URL.
 */

import { getJson } from './http';

let creditsPromise = null;

export function isWikimediaPhoto(url) {
  return typeof url === 'string' && url.startsWith('https://upload.wikimedia.org/');
}

/** Resolves to { retrieved, credits: [...] }; an empty list on failure. */
export function fetchPhotoCredits() {
  if (!creditsPromise) {
    creditsPromise = getJson('/api/photo-credits')
      .catch(() => null)
      .then((raw) => {
        const doc = raw || { retrieved: null, credits: [] };
        // A failed fetch should be retried by the next caller.
        if (!doc.credits || doc.credits.length === 0) creditsPromise = null;
        return doc;
      });
  }
  return creditsPromise;
}

/** Resolves to the credit entry for one photo URL, or null. */
export async function creditForPhoto(url) {
  if (!isWikimediaPhoto(url)) return null;
  const doc = await fetchPhotoCredits();
  return (doc.credits || []).find((c) => c.photo_url === url) || null;
}

/**
 * The Commons file page for a Wikimedia URL, worked out from the URL
 * itself. Used when the credits list has no entry yet, so the photo is
 * never shown without at least a link to its source.
 */
export function commonsFilePage(url) {
  if (!isWikimediaPhoto(url)) return null;
  const parts = new URL(url).pathname.split('/');
  const i = parts.indexOf('commons');
  if (i < 0) return null;
  let rest = parts.slice(i + 1);
  if (rest[0] === 'thumb') rest = rest.slice(1);
  if (rest.length < 3) return null;
  return `https://commons.wikimedia.org/wiki/File:${rest[2]}`;
}
