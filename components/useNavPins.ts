'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { defaultPins } from './nav-links';

// The pages you've pinned (on this device), shown in the header and the phone
// dock, and the ones you've been to lately, shown in the launcher.

const PINS_KEY = 'nav:pins';
const RECENT_KEY = 'nav:recent';
const RECENT_KEPT = 6;

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
};
const read = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const parse = (raw: string | null): string[] | null => {
  try {
    const list = JSON.parse(raw || 'null');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : null;
  } catch {
    return null;
  }
};
const write = (key: string, list: string[]) => {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* lasts until the page closes */ }
  listeners.forEach((fn) => fn());
};

export function useNavPins(signedIn: boolean) {
  const raw = useSyncExternalStore(subscribe, () => read(PINS_KEY), () => null);
  const pins = parse(raw) ?? defaultPins(signedIn);
  const togglePin = useCallback((href: string) => {
    const current = parse(read(PINS_KEY)) ?? defaultPins(signedIn);
    write(PINS_KEY, current.includes(href) ? current.filter((p) => p !== href) : [...current, href]);
  }, [signedIn]);
  return { pins, togglePin };
}

export function useRecentPages() {
  const raw = useSyncExternalStore(subscribe, () => read(RECENT_KEY), () => null);
  return parse(raw) ?? [];
}

/** Note a page as just visited (newest first). */
export function rememberPage(href: string) {
  const current = parse(read(RECENT_KEY)) ?? [];
  if (current[0] === href) return;
  write(RECENT_KEY, [href, ...current.filter((p) => p !== href)].slice(0, RECENT_KEPT));
}
