import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Noah Stuf',
    short_name: 'Noah Stuf',
    description: 'Your day, workouts, recipes, games and more — hosted on a Raspberry Pi.',
    start_url: '/workout',
    scope: '/',
    display: 'standalone',
    background_color: '#2b303b',
    theme_color: '#2b303b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today', url: '/today', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Start workout', url: '/workout', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Grocery list', url: '/recipes?view=list', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Journal', url: '/journal', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Party games', url: '/party', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
