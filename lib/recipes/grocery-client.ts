import { readPref, savePref } from '../workout/device-prefs';
import { addListItem, emptyKitchen, newKitchenId, normalizeKitchen, type KitchenAction, type KitchenState } from './kitchen';

// The grocery list from outside the recipes page (the launcher, the Today page),
// and the changes waiting to be sent. The page's useKitchen hears KITCHEN_CHANGED
// and picks the change up.

export const KITCHEN_PREF = 'recipes:kitchen';
export const KITCHEN_CHANGED = 'kitchen:changed';

const OUTBOX_PREF = 'recipes:kitchen:outbox';
const OUTBOX_LIMIT = 500;

export type QueuedChange = { id: string; action: KitchenAction };

/** Used only when the browser won't store anything: then changes last until the page closes. */
let outboxCopy: QueuedChange[] = [];

/**
 * Changes not yet confirmed by the server. They're kept in storage rather than
 * memory so a list ticked off with no signal survives closing the page, and
 * read fresh each time because another tab may be sending them too.
 */
export function readOutbox(): QueuedChange[] {
  const saved = readPref(OUTBOX_PREF);
  if (saved === null) return outboxCopy;
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(queue: QueuedChange[]) {
  outboxCopy = queue;
  savePref(OUTBOX_PREF, JSON.stringify(queue));
}

export function queueChange(action: KitchenAction) {
  writeOutbox([...readOutbox(), { id: newKitchenId(), action }].slice(-OUTBOX_LIMIT));
}

export function clearSentChanges(sent: QueuedChange[]) {
  const ids = new Set(sent.map((q) => q.id));
  writeOutbox(readOutbox().filter((q) => !ids.has(q.id)));
}

export function readLocalKitchen(): KitchenState {
  try {
    return normalizeKitchen(JSON.parse(readPref(KITCHEN_PREF) || 'null'));
  } catch {
    return emptyKitchen();
  }
}

export const isEmptyKitchen = (k: KitchenState) => !k.have.length && !Object.keys(k.plans).length && !k.listRecipes.length && !k.listItems.length;

/**
 * Put something on the list: in the household's when signed in (the server adds
 * it to what's there, so nobody else's list is overwritten), else on this device.
 * Returns false if it couldn't be saved.
 */
export async function addGroceryItem(text: string): Promise<boolean> {
  const local = readLocalKitchen();
  const res = await fetch('/api/recipes/kitchen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ add: text }),
  }).catch(() => null);
  if (!res || (!res.ok && res.status !== 401)) return false;

  const next = addListItem(local, text);
  savePref(KITCHEN_PREF, JSON.stringify(next));
  if (res.ok) {
    const body = await res.json().catch(() => ({}));
    // The account's first kitchen: bring along what this device already had.
    if (body.created && !isEmptyKitchen(local)) {
      await fetch('/api/recipes/kitchen', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kitchen: next }) }).catch(() => {});
    }
  }
  window.dispatchEvent(new Event(KITCHEN_CHANGED));
  return true;
}
