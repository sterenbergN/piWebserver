import { readPref, savePref } from '../workout/device-prefs';
import { addListItem, emptyKitchen, normalizeKitchen, type KitchenState } from './kitchen';

// The grocery list from outside the recipes page (the launcher, the Today page).
// The page's useKitchen hears KITCHEN_CHANGED and picks the change up.

export const KITCHEN_PREF = 'recipes:kitchen';
export const KITCHEN_CHANGED = 'kitchen:changed';

export function readLocalKitchen(): KitchenState {
  try {
    return normalizeKitchen(JSON.parse(readPref(KITCHEN_PREF) || 'null'));
  } catch {
    return emptyKitchen();
  }
}

export const isEmptyKitchen = (k: KitchenState) => !k.have.length && !Object.keys(k.plans).length && !k.listRecipes.length && !k.listItems.length;

/**
 * Put something on the list: in the account when signed in (the server adds it
 * to what's there, so another device's list isn't overwritten), else on this
 * device. Returns false if it couldn't be saved.
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
