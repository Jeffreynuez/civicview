// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Server layout that exists only to give this client-rendered route its
// own title, description and link preview. See lib/seo.js.
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Posts',
  description: 'Posts from verified elected officials and candidates on CivicView.',
  path: '/posts',
});

export default function Layout({ children }) {
  return children;
}
