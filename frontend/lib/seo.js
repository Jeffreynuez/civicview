// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Shared page metadata for search results and link previews.
 *
 * Every page under app/ is a client component, and a client component
 * cannot export `metadata`. So each public route gets a two-line
 * server layout.js that calls pageMetadata() and renders its children
 * unchanged. That keeps the pages themselves untouched.
 *
 * Why the helper repeats openGraph and twitter instead of leaning on
 * the root layout: Next merges metadata one key deep. A route that
 * sets openGraph.title replaces the whole openGraph object, image
 * included, so the image has to travel with every route that sets its
 * own title.
 */

export const SITE_URL = 'https://civicview.app';
export const SITE_NAME = 'CivicView';
export const DEFAULT_TITLE = 'CivicView - Know Your Representatives';
export const DEFAULT_DESCRIPTION =
  'Track your elected officials, legislation, and upcoming elections';

export const OG_IMAGE = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'CivicView: know your representatives, follow the bills, see your ballot.',
};

export function pageMetadata({ title, description = DEFAULT_DESCRIPTION, path, noindex = false }) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE;
  const meta = {
    title: title || DEFAULT_TITLE,
    description,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      url: path,
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [OG_IMAGE.url],
    },
  };
  if (path) meta.alternates = { canonical: path };
  if (noindex) meta.robots = { index: false, follow: false };
  return meta;
}
