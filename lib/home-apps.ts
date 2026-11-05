import type { Metadata } from 'next';
import { navGroups } from '@/components/nav-links';

// Every section of the site can go on a phone's home screen as its own app, opening
// straight to that section, not to the site's main app (app/manifest.ts, which opens on
// the workout tracker). The list comes from the site's navigation, so a new section
// joins it; its icon is made once by `npm run icons:apps` and kept in public/icons.

export type HomeApp = { slug: string; path: string; name: string; short: string; description: string; glyph: string; color: string };

/** Sections that already are apps of their own, with hand-drawn icons and offline extras. */
const OWN_APPS = new Set(['/recipes', '/notes', '/reader', '/study']);
/** Sections that stay part of the main app, as they always have. */
const MAIN_APP = new Set(['/', '/workout']);

/** The rooms' colours (the dark theme's), which tint each icon. */
const ROOM_HEX: Record<string, string> = {
  'var(--habit-1)': '#3987e5', 'var(--habit-2)': '#d95926', 'var(--habit-3)': '#199e70', 'var(--habit-4)': '#c98500',
  'var(--habit-5)': '#d55181', 'var(--habit-6)': '#008300', 'var(--habit-7)': '#9085e9', 'var(--habit-8)': '#e66767',
};

export const HOME_APPS: HomeApp[] = [
  ...navGroups(true).flatMap((group) => group.items
    .filter((item) => /^\/[a-z-]+$/.test(item.href) && !OWN_APPS.has(item.href) && !MAIN_APP.has(item.href))
    .map((item) => ({
      slug: item.href.slice(1),
      path: item.href,
      name: item.label,
      short: item.short ?? item.label,
      description: item.blurb ?? item.label,
      glyph: item.icon,
      color: ROOM_HEX[group.color] ?? '#3987e5',
    }))),
  // The nav only links into its parts (calculators, movies, food).
  { slug: 'tools', path: '/tools', name: 'Tools', short: 'Tools', description: 'Calculators, a movie picker and where to eat', glyph: '🧰', color: ROOM_HEX['var(--habit-3)'] },
];

export const homeApp = (slug: string) => HOME_APPS.find((app) => app.slug === slug);

export const appIcon = (slug: string, kind: '192' | '512' | 'maskable-192' | 'maskable-512' | 'apple-touch-icon') => `/icons/app-${slug}-${kind}.png`;

export function appManifest(app: HomeApp) {
  return {
    id: app.path,
    name: app.name,
    short_name: app.short,
    description: app.description,
    start_url: app.path,
    scope: app.path,
    display: 'standalone',
    background_color: '#2b303b',
    theme_color: '#2b303b',
    icons: [
      { src: appIcon(app.slug, '192'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: appIcon(app.slug, '512'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: appIcon(app.slug, 'maskable-192'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: appIcon(app.slug, 'maskable-512'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/**
 * What a section's layout adds to its metadata so it goes on the home screen as itself.
 * Setting `icons` replaces the site's file icons, for that section's pages only.
 */
export function homeScreenMetadata(slug: string): Pick<Metadata, 'manifest' | 'appleWebApp' | 'icons'> {
  const app = homeApp(slug);
  if (!app) throw new Error(`No home-screen app called ${slug}`);
  return {
    manifest: `/apps/${slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: app.short, statusBarStyle: 'black-translucent' },
    icons: { icon: appIcon(slug, '192'), apple: appIcon(slug, 'apple-touch-icon') },
  };
}
