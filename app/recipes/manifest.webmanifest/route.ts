// The recipe box as its own app on a home screen, apart from the site's main one
// (app/manifest.ts), which opens on the workout tracker.

const ICON = [{ src: '/icons/recipes-192.png', sizes: '192x192' }];

const MANIFEST = {
  id: '/recipes',
  name: 'Recipe Box',
  short_name: 'Recipes',
  description: 'Your recipes, the week’s meals, the shopping list and the pantry.',
  start_url: '/recipes',
  scope: '/recipes',
  display: 'standalone',
  background_color: '#2b1a0e',
  theme_color: '#2b1a0e',
  icons: [
    { src: '/icons/recipes-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/recipes-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/recipes-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/recipes-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Shopping list', url: '/recipes?view=list', icons: ICON },
    { name: 'This week', url: '/recipes?view=week', icons: ICON },
    { name: 'Pantry', url: '/recipes?view=pantry', icons: ICON },
  ],
};

export function GET() {
  return new Response(JSON.stringify(MANIFEST), { headers: { 'Content-Type': 'application/manifest+json' } });
}
