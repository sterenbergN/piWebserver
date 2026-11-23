import { choiceFromParam, customManifestIcons } from '@/lib/home-icons';
// The recipe box as its own app on a home screen, apart from the site's main one
// (app/manifest.ts), which opens on the home page.

const ICON = [{ src: '/icons/recipes-192.png', sizes: '192x192' }];

const MANIFEST = {
  id: '/recipes',
  name: 'Recipe Box',
  short_name: 'Recipes',
  description: 'Your recipes, the week’s meals, the shopping list and the pantry.',
  start_url: '/recipes',
  scope: '/recipes',
  display: 'standalone',
  background_color: '#2b303b',
  theme_color: '#2b303b',
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

// ?icon= swaps in the symbol and colour chosen for this app (lib/home-icons.ts).
export function GET(request: Request) {
  const choice = choiceFromParam(new URL(request.url).searchParams.get('icon'));
  const manifest = choice ? { ...MANIFEST, icons: customManifestIcons(choice) } : MANIFEST;
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
}
