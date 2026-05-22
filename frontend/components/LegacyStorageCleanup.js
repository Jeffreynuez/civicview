'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Mount-once client component that wipes the legacy tracked-items
 * localStorage keys. Renders nothing visible — pure side effect.
 *
 * Sits in app/layout.js so the cleanup fires on every page in the
 * app exactly once per browser, regardless of which route the user
 * lands on first.
 */
import { useEffect } from 'react';
import { runLegacyTrackedCleanup } from '@/lib/legacyStorageCleanup';

export default function LegacyStorageCleanup() {
  useEffect(() => {
    runLegacyTrackedCleanup();
  }, []);
  return null;
}
