// The Reader as its own app on a home screen, apart from the site's main one
// (app/manifest.ts), and shown the same way: `fullscreen` runs under the status bar on an
// iPad, where it gets a dark gradient over the top of the page.

const MANIFEST = {
  id: '/reader',
  name: 'Reader',
  short_name: 'Reader',
  description: 'Your books and notes, on every device, with or without a connection.',
  start_url: '/reader',
  scope: '/reader',
  display: 'standalone',
  background_color: '#14161c',
  theme_color: '#14161c',
  icons: [
    { src: '/icons/reader-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/reader-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/reader-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/reader-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

export function GET() {
  return new Response(JSON.stringify(MANIFEST), { headers: { 'Content-Type': 'application/manifest+json' } });
}
