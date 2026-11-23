'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { ART_APPS, customIconUrl, iconParam, type IconChoice } from '@/lib/home-icons';

// The home-screen icons this account picked, and putting the one for the section
// you're in into the page's <head>: its manifest (Android, desktop) and its
// apple-touch-icon (iPhone and iPad take the icon from the page when you tap Add
// to Home Screen). The page's own links come from each section's metadata.

type State = { loaded: boolean; signedIn: boolean; icons: Record<string, IconChoice> };

let state: State = { loaded: false, signedIn: false, icons: {} };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((fn) => fn()); applyHomeIcon(); };

export function loadHomeIcons(refresh = false) {
  if (!loading || refresh) {
    loading = fetch('/api/home-icons', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { state = { loaded: true, signedIn: !!body?.signedIn, icons: body?.icons ?? {} }; })
      .catch(() => { state = { ...state, loaded: true }; })
      .finally(emit);
  }
  return loading;
}

/** After saving: the account's icons as the server now has them. */
export function setHomeIcons(icons: Record<string, IconChoice>) {
  state = { ...state, icons };
  emit();
}

export function useHomeIcons(): State {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
    () => state,
  );
}

/** Which section's app this page installs as, from its manifest link (null for the site's main app). */
export function currentIconSlug(): string | null {
  const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href')?.split('?')[0] ?? '';
  const generated = href.match(/^\/apps\/([a-z-]+)\/manifest\.webmanifest$/);
  if (generated) return generated[1];
  const own = href.match(/^\/([a-z-]+)\/manifest\.webmanifest$/);
  return own && ART_APPS[own[1]] ? own[1] : null;
}

/**
 * Point one <link> at `custom`, or back at the page's own address. Next replaces the
 * address when you move to another section, so the original is whatever is there
 * now unless it's the one this set.
 */
function point(link: HTMLLinkElement, custom: string | null) {
  const now = link.getAttribute('href') ?? '';
  const original = now === link.dataset.customHref ? link.dataset.origHref ?? now : now;
  link.dataset.origHref = original;
  const next = custom ?? original;
  if (custom) link.dataset.customHref = custom;
  else delete link.dataset.customHref;
  if (now !== next) link.setAttribute('href', next);
}

export function applyHomeIcon() {
  if (typeof document === 'undefined') return;
  const slug = currentIconSlug();
  const choice = slug ? state.icons[slug] ?? null : null;
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest) {
    const base = (manifest.getAttribute('href') === manifest.dataset.customHref ? manifest.dataset.origHref : manifest.getAttribute('href'))?.split('?')[0] ?? '';
    point(manifest, choice && base ? `${base}?icon=${iconParam(choice)}` : null);
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]')) point(link, choice ? customIconUrl(choice, 'apple-touch-icon') : null);
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) point(link, choice ? customIconUrl(choice, '192') : null);
}

/** In the navbar: load the choices once, and keep the page's icon links on them as you move around. */
export function useHomeIconLinks(pathname: string) {
  useEffect(() => { void loadHomeIcons(); }, []);
  useEffect(() => {
    applyHomeIcon();
    // Next writes the new section's links as it commits; catch them after that too.
    const frame = requestAnimationFrame(applyHomeIcon);
    const late = window.setTimeout(applyHomeIcon, 400);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(late); };
  }, [pathname]);
}
