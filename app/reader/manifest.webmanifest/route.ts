// The Reader as its own app on a home screen, apart from the site's main one
// (app/manifest.ts). Android honours `fullscreen`; iPhones and iPads run it standalone,
// which the page's status-bar and safe-area settings make edge to edge.

const MANIFEST = {
  id: '/reader',
  name: 'Reader',
  short_name: 'Reader',
  description: 'Your books and notes, on every device, with or without a connection.',
  start_url: '/reader',
  scope: '/reader',
  display: 'fullscreen',
  display_override: ['fullscreen', 'standalone'],
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
