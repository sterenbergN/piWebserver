import { choiceFromParam, customManifestIcons } from '@/lib/home-icons';
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

// ?icon= swaps in the symbol and colour chosen for this app (lib/home-icons.ts).
export function GET(request: Request) {
  const choice = choiceFromParam(new URL(request.url).searchParams.get('icon'));
  const manifest = choice ? { ...MANIFEST, icons: customManifestIcons(choice) } : MANIFEST;
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
}
