// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Server layout that exists only to give this client-rendered route its
// own title, description and link preview. See lib/seo.js.
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Overview video',
  description: 'A short video tour of CivicView: your representatives, any state, profiles, Pages, Polls, Floor Bills, Elections and My Tracked.',
  path: '/overview',
});

export default function Layout({ children }) {
  return children;
}
