// CivicView — /embed/* layout.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Everything under /embed is a fragment of CivicView rendered inside someone
// else's page. Two things follow from that, and both live here so any future
// embed route gets them for free:
//
// 1. NOINDEX. An embed route is not a destination. Left indexable, Google
//    would happily rank a chrome-free map page above civicview.app itself for
//    a "congressional district map" query, and a visitor who landed there
//    would find a map with no way into the product. The header form of this
//    (X-Robots-Tag) is set alongside the CSP in next.config.js, because a
//    <meta> tag alone does not cover a page fetched as a subresource.
//
// 2. THE DOCUMENT IS THE COMPONENT. There is no page to scroll, so the body
//    must not scroll, and it must not paint a margin around the frame. The
//    root layout's body classes assume a normal page; these three lines undo
//    that for embeds only.
//
// The chrome itself is suppressed in the root layout via <EmbedGate>, not
// here — a nested layout renders inside the chrome, so it cannot remove it.

export const metadata = {
  robots: { index: false, follow: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function EmbedLayout({ children }) {
  return (
    <>
      <style>{`
        html, body { height: 100%; margin: 0; overflow: hidden; background: var(--cl-bg, #f8f9fa); }
        /* Belt and braces: if a future root-mounted component slips past
           EmbedGate, it still cannot scroll the frame into a second screen. */
        body { overscroll-behavior: none; }

        /* The shell's contract with whatever it wraps: you get the whole
           frame. MapView's root element carries the Tailwind class flex-1 —
           so without this rule the embed would be quietly relying on
           Tailwind's content globbing still reaching components/ at build
           time. It does today. If it ever stopped, the map would collapse to
           zero height inside the iframe, and that failure would read as a
           broken embed rather than as a purged utility class.
           min-height:0 is the other half: a flex child defaults to
           min-height:auto and refuses to shrink below its own content, which
           is how a map that should fit the frame ends up overflowing it. */
        .cv-embed-shell > * { flex: 1 1 auto; min-height: 0; }
      `}</style>
      {children}
    </>
  );
}
