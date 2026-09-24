// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Served at /robots.txt. The disallowed paths are pages with nothing for
// a search engine: the admin console, the password reset form, and the
// map embed that lives inside other sites' iframes (it also sends
// X-Robots-Tag: noindex, see next.config.js).
import { SITE_URL } from '@/lib/seo';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/password-reset', '/embed/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
