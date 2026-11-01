import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recipes',
  description: 'Recipes with a step-by-step cook mode, scaling, kitchen timers and grocery lists.',
  // Its own app on a home screen. Setting `icons` here replaces the site's file icons, for these pages only.
  manifest: '/recipes/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Recipes', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/recipes-192.png', apple: '/icons/recipes-apple-touch-icon.png' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
