// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // ─────────────────────────────────────────────────────────────
      // Colors — every utility resolves through a CSS variable so
      // any value swap in globals.css propagates to Tailwind classes
      // without a rebuild.
      // ─────────────────────────────────────────────────────────────
      colors: {
        // Canonical CL palette — preferred for new code.
        cl: {
          primary: 'var(--cl-primary)',
          'primary-light': 'var(--cl-primary-light)',
          accent: 'var(--cl-accent)',
          'accent-light': 'var(--cl-accent-light)',
          'accent-soft': 'var(--cl-accent-soft)',

          republican: 'var(--cl-republican)',
          'republican-soft': 'var(--cl-republican-soft)',
          democrat: 'var(--cl-democrat)',
          'democrat-soft': 'var(--cl-democrat-soft)',
          independent: 'var(--cl-independent)',
          'independent-soft': 'var(--cl-independent-soft)',

          up: 'var(--cl-up)',
          'up-soft': 'var(--cl-up-soft)',
          'up-text': 'var(--cl-up-text)',
          'up-border': 'var(--cl-up-border)',
          down: 'var(--cl-down)',
          'down-soft': 'var(--cl-down-soft)',
          'down-text': 'var(--cl-down-text)',
          'down-border': 'var(--cl-down-border)',

          warning: 'var(--cl-warning)',
          'warning-text': 'var(--cl-warning-text)',
          'warning-soft': 'var(--cl-warning-soft)',
          'warning-border': 'var(--cl-warning-border)',
          success: 'var(--cl-success)',
          'success-text': 'var(--cl-success-text)',
          'success-soft': 'var(--cl-success-soft)',
          'success-border': 'var(--cl-success-border)',
          danger: 'var(--cl-danger)',
          'danger-text': 'var(--cl-danger-text)',
          'danger-soft': 'var(--cl-danger-soft)',
          'danger-border': 'var(--cl-danger-border)',

          bg: 'var(--cl-bg)',
          card: 'var(--cl-card)',
          'bg-soft': 'var(--cl-bg-soft)',
          border: 'var(--cl-border)',
          'border-strong': 'var(--cl-border-strong)',
          divider: 'var(--cl-divider)',

          text: 'var(--cl-text)',
          'text-light': 'var(--cl-text-light)',
          'text-muted': 'var(--cl-text-muted)',
        },

        // Legacy names — preserved so existing utility classes in the
        // 39 components keep working. Resolves to the same vars.
        primary: {
          DEFAULT: 'var(--cl-primary)',
          light: 'var(--cl-primary-light)',
        },
        accent: {
          DEFAULT: 'var(--cl-accent)',
          light: 'var(--cl-accent-light)',
        },
        republican: 'var(--cl-republican)',
        democrat: 'var(--cl-democrat)',
      },

      fontFamily: {
        sans: ['var(--cl-font-sans)'],
        display: ['var(--cl-font-display)'],
        mono: ['var(--cl-font-mono)'],
      },

      fontSize: {
        'cl-2xs': 'var(--cl-text-2xs)',
        'cl-xs':  'var(--cl-text-xs)',
        'cl-sm':  'var(--cl-text-sm)',
        'cl-md':  'var(--cl-text-md)',
        'cl-lg':  'var(--cl-text-lg)',
        'cl-xl':  'var(--cl-text-xl)',
        'cl-2xl': 'var(--cl-text-2xl)',
        'cl-3xl': 'var(--cl-text-3xl)',
        'cl-display': 'var(--cl-text-display)',
      },

      spacing: {
        'cl-1':  'var(--cl-space-1)',
        'cl-2':  'var(--cl-space-2)',
        'cl-3':  'var(--cl-space-3)',
        'cl-4':  'var(--cl-space-4)',
        'cl-5':  'var(--cl-space-5)',
        'cl-6':  'var(--cl-space-6)',
        'cl-8':  'var(--cl-space-8)',
        'cl-10': 'var(--cl-space-10)',
        'cl-12': 'var(--cl-space-12)',
      },

      borderRadius: {
        'cl-xs':   'var(--cl-radius-xs)',
        'cl-sm':   'var(--cl-radius-sm)',
        'cl-md':   'var(--cl-radius-md)',
        'cl-lg':   'var(--cl-radius-lg)',
        'cl-xl':   'var(--cl-radius-xl)',
        'cl-2xl':  'var(--cl-radius-2xl)',
        'cl-pill': 'var(--cl-radius-pill)',
      },

      boxShadow: {
        'cl-sticky': 'var(--cl-shadow-sticky)',
        'cl-card':   'var(--cl-shadow-card)',
        'cl-pop':    'var(--cl-shadow-pop)',
        'cl-modal':  'var(--cl-shadow-modal)',
        'cl-focus':  'var(--cl-shadow-focus)',
        'cl-pulse':  'var(--cl-shadow-pulse)',
      },

      transitionDuration: {
        'cl-instant': 'var(--cl-duration-instant)',
        'cl-fast':    'var(--cl-duration-fast)',
        'cl-base':    'var(--cl-duration-base)',
        'cl-slow':    'var(--cl-duration-slow)',
      },

      transitionTimingFunction: {
        'cl-standard':   'var(--cl-ease-standard)',
        'cl-emphasized': 'var(--cl-ease-emphasized)',
      },
    },
  },
  plugins: [],
};
