'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';

/**
 * useTheme — reads the saved theme preference, applies it to
 * <html data-theme="..."> on mount, and returns a tuple
 * [theme, toggleTheme]. globals.css has a `[data-theme="dark"]`
 * block that overrides the default --cl-* surface/text tokens; see
 * that file for the actual color values.
 *
 * SSR-safety: returns 'light' on the first render (server + client
 * hydration). The boot script in app/layout.js sets data-theme=dark
 * synchronously BEFORE paint when the user has previously chosen
 * dark, so the page never flashes light. After mount this hook
 * reads the same localStorage key and updates React state to match.
 *
 * Storage key: 'civiclens:theme:v1'. Bumping the suffix invalidates
 * stale preferences if we ever introduce more than light/dark.
 */
export const THEME_STORAGE_KEY = 'civiclens:theme:v1';

export function useTheme() {
  const [theme, setThemeState] = useState('light');

  // On mount, sync state with whatever the boot script applied to
  // <html data-theme="...">. Without this, the React state would
  // disagree with the DOM until the user toggled.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const applied = document.documentElement.dataset.theme;
    if (applied === 'dark') setThemeState('dark');
    else setThemeState('light');
  }, []);

  // setTheme writes both the DOM attribute and localStorage, then
  // updates React state so consumers re-render with the new value.
  const setTheme = (next) => {
    if (next !== 'dark' && next !== 'light') return;
    setThemeState(next);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = next;
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch { /* private-mode Safari — ignore */ }
    }
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return [theme, toggleTheme, setTheme];
}
