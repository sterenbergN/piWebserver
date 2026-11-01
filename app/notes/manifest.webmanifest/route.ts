// Notes as its own app on a home screen, apart from the site's main one (app/manifest.ts).
// `standalone`, like the Reader: `fullscreen` runs under the status bar on an iPad, where it
// gets a dark gradient over the top of the page.

const MANIFEST = {
  id: '/notes',
  name: 'Notes',
  short_name: 'Notes',
  description: 'Handwritten and typed notes, on every device, with or without a connection.',
  start_url: '/notes',
  scope: '/notes',
  display: 'standalone',
  background_color: '#1a1c22',
  theme_color: '#1a1c22',
  icons: [
    { src: '/icons/notes-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/notes-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/notes-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/notes-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

export function GET() {
  return new Response(JSON.stringify(MANIFEST), { headers: { 'Content-Type': 'application/manifest+json' } });
}
