// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// ESLint for the frontend (audit F8). Run: npm run lint
//
// Starts from Next.js's own rules (next/core-web-vitals: React, hooks,
// accessibility basics, Next-specific checks) and adds `no-undef`, which
// the Next preset leaves off for JavaScript projects. That one would
// have caught a sign-in bug in review (a login helper calling a function
// it no longer imported) and two 2FA error paths that referenced a
// variable they never read. CI runs this on every pull request.
import { FlatCompat } from '@eslint/eslintrc';
import globals from 'globals';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'android/**', 'public/**', 'out/**', 'assets/**'],
  },
  ...compat.extends('next/core-web-vitals'),
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-undef': 'error',
      // Apostrophes and quotes in JSX text render correctly in React;
      // escaping all ~180 of them would only make the copy harder to
      // read and edit.
      'react/no-unescaped-entities': 'off',
      // The Next image optimizer is off on purpose (next.config.js,
      // audit F1), so plain <img> is the intended element.
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
