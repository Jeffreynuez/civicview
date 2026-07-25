'use client';

// CivicView — push-notification tap → deep link (native app only).
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Renders nothing. Mounted in the ROOT layout (not app/page.js) so the
// tap listener exists on every route — a push tap must deep-link
// correctly even when the app opens on a non-home start page (the
// start_page preference can land users on /polls, /bills, etc.).
// Registration is module-level-once inside initPushTapNavigation, so
// route changes remounting this component are free.

import { useEffect } from 'react';
import { initPushTapNavigation } from '@/lib/push';

export default function PushTapNavigator() {
  useEffect(() => { initPushTapNavigation(); }, []);
  return null;
}
