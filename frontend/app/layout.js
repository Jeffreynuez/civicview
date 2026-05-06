import './globals.css';

export const metadata = {
  title: 'CivicLens - Know Your Representatives',
  description: 'Track your elected officials, legislation, and upcoming elections',
};

// Viewport metadata — Next.js 14 App Router pattern. Without this,
// mobile browsers default to a 980px-wide "desktop" viewport and
// auto-zoom the page to fit, which means our ≤768px breakpoint
// never fires and the entire mobile layout (split map / panel,
// compressed navbar, fullscreen profile takeovers, larger tap
// targets) stays inert on a real phone. `width: 'device-width'`
// makes the CSS pixel width match the actual screen width;
// `initialScale: 1` opens the page at 1:1 zoom. We deliberately
// do NOT set `maximumScale` or `userScalable: false` — letting
// users pinch-zoom the page is an accessibility requirement.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Viewport meta tag — belt-and-suspenders alongside the
            `viewport` metadata export above. Some Next.js setups
            haven't been picking up the export reliably during dev,
            and a missing viewport tag silently breaks the entire
            mobile layout. Placing the raw <meta> here guarantees
            the tag is in the HTML the phone receives, regardless
            of what the metadata API does. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.1.1/dist/maplibre-gl.css" />
      </head>
      <body className="h-screen flex flex-col">{children}</body>
    </html>
  );
}
