// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Legacy route — /admin/users previously rendered the suspended-
// accounts table as its own page. After the Q2 admin redesign it
// became the Suspended users tab inside /admin. This route is
// preserved so any old bookmarks / inbound links don't 404; it
// sends the user to the right tab on the unified surface.
import { redirect } from 'next/navigation';

export default function AdminUsersLegacyRedirect() {
  redirect('/admin?tab=suspended');
}
