import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Noah Stuf',
    short_name: 'Noah Stuf',
    description: 'Workout tracker, tools, games and gallery — hosted on a Raspberry Pi.',
    start_url: '/workout',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0c',
    theme_color: '#0a0a0c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Start workout', url: '/workout', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Workout analytics', url: '/workout/analytics' },
      { name: 'Tools', url: '/tools' },
    ],
  };
}
