import test from 'node:test';
import { strict as assert } from 'node:assert';
import { markFound, rememberPage } from '../components/useNavPins';

// Minimal localStorage for node (the helpers read it when called, not on import).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

/** What the navbar does on each page: note it as recent, then tick off the places it is. */
function visit(href: string, places: string[] = [href]) {
  rememberPage(href);
  return markFound(places);
}

test('places stay found after they drop out of the recent pages', () => {
  store.clear();
  // A device from before there was a found list: only recent pages.
  store.set('nav:recent', JSON.stringify(['/blog']));
  for (const page of ['/workout/health', '/today', '/recipes', '/journal', '/notes', '/reader', '/golf', '/habits']) visit(page);
  // A corner (not a page, so never "recent") is a new place...
  assert.deepEqual(visit('/workout/health', ['/workout/health', '/workout/health?tab=plan']).fresh, ['/workout/health?tab=plan']);
  // ...and going back to pages that have since left the last six recent ones is not.
  assert.deepEqual(visit('/today').fresh, []);
  assert.deepEqual(visit('/blog').fresh, []);
  assert.deepEqual(visit('/workout/health', ['/workout/health', '/workout/health?tab=plan']).fresh, []);
});

test('a brand-new device starts its found list on the first page', () => {
  store.clear();
  assert.deepEqual(visit('/blog').fresh, []);
  assert.deepEqual(JSON.parse(store.get('nav:found') ?? 'null'), ['/blog']);
  assert.deepEqual(visit('/gallery').fresh, ['/gallery']);
});
