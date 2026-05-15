// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Legacy route — /admin/appeals previously rendered the appeals
// queue as its own page. After the Q2 admin redesign it became
// the Appeals tab inside /admin. This route is preserved so that
// any old bookmarks / inbound links don't 404; it just sends the
// user to the right tab on the unified surface.
import { redirect } from 'next/navigation';

export default function AdminAppealsLegacyRedirect() {
  redirect('/admin?tab=appeals');
}
