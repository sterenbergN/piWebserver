import { choiceFromParam, customManifestIcons } from '@/lib/home-icons';
// Study as its own app on a home screen, apart from the site's main one
// (app/manifest.ts), which opens on the home page.

const MANIFEST = {
  id: '/study',
  name: 'PA Study',
  short_name: 'PA Study',
  description: 'Practice tests and the questions you keep missing.',
  start_url: '/study',
  scope: '/study',
  display: 'standalone',
  background_color: '#11141b',
  theme_color: '#11141b',
  icons: [
    { src: '/icons/study-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/study-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/study-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/study-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Review misses', url: '/study/review', icons: [{ src: '/icons/study-192.png', sizes: '192x192' }] },
    { name: 'Add a test', url: '/study/add', icons: [{ src: '/icons/study-192.png', sizes: '192x192' }] },
  ],
};

// ?icon= swaps in the symbol and colour chosen for this app (lib/home-icons.ts).
export function GET(request: Request) {
  const choice = choiceFromParam(new URL(request.url).searchParams.get('icon'));
  const manifest = choice ? { ...MANIFEST, icons: customManifestIcons(choice) } : MANIFEST;
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
}
