// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Server layout that exists only to give this client-rendered route its
// own title, description and link preview. See lib/seo.js.
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Bills and votes',
  description: 'Follow bills in Congress and see how your representatives voted.',
  path: '/bills',
});

export default function Layout({ children }) {
  return children;
}
