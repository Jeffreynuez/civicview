import './globals.css';

export const metadata = {
  title: 'CivicLens - Know Your Representatives',
  description: 'Track your elected officials, legislation, and upcoming elections',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.1.1/dist/maplibre-gl.css" />
      </head>
      <body className="h-screen flex flex-col">{children}</body>
    </html>
  );
}
