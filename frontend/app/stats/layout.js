// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Server layout that exists only to give this client-rendered route its
// own title, description and link preview. See lib/seo.js.
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Stats',
  description: 'Public numbers on the government CivicView covers and who uses it.',
  path: '/stats',
});

export default function Layout({ children }) {
  return children;
}
