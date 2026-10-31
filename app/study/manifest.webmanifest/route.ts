// Study as its own app on a home screen, apart from the site's main one
// (app/manifest.ts), which opens on the workout tracker.

const MANIFEST = {
  id: '/study',
  name: 'PA Study',
  short_name: 'PA Study',
  description: 'Practice tests and the questions you keep missing.',
  start_url: '/study',
  scope: '/study',
  display: 'standalone',
  background_color: '#2b303b',
  theme_color: '#2b303b',
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

export function GET() {
  return new Response(JSON.stringify(MANIFEST), { headers: { 'Content-Type': 'application/manifest+json' } });
}
