// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Served at /sitemap.xml. Only the public routes that exist as real
// pages. Officials, bills and elections open inside the main map view
// and are not separate URLs yet, so they are not listed. No
// lastModified: a date that does not track real edits is worse than
// none.
import { SITE_URL } from '@/lib/seo';

const ROUTES = [
  { path: '/', priority: 1.0, changeFrequency: 'daily' },
  { path: '/bills', priority: 0.8, changeFrequency: 'daily' },
  { path: '/polls', priority: 0.7, changeFrequency: 'daily' },
  { path: '/posts', priority: 0.7, changeFrequency: 'daily' },
  { path: '/stats', priority: 0.5, changeFrequency: 'weekly' },
  { path: '/methodology', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/editorial-standards', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/child-safety', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/photo-credits', priority: 0.2, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/account/delete', priority: 0.2, changeFrequency: 'yearly' },
];

export default function sitemap() {
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency,
    priority,
  }));
}
