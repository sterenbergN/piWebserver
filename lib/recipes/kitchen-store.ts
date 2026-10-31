import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { emptyKitchen, mergeKitchens, normalizeKitchen, type KitchenState } from './kitchen';

// Where kitchens live: .data/recipes/kitchen/household-<id>.json for a household
// (see lib/chores/households.ts). The hashed-name files are from before kitchens
// were shared, and the site admin's, who signs in without an account of their own.

const DIR = () => path.join(process.cwd(), '.data', 'recipes', 'kitchen');

export function personalKitchenFile(owner: string) {
  return path.join(DIR(), `${crypto.createHash('sha256').update(owner).digest('hex').slice(0, 32)}.json`);
}

export function householdKitchenFile(householdId: string) {
  if (!/^[\w-]{1,64}$/.test(householdId)) throw new Error('Invalid household');
  return path.join(DIR(), `household-${householdId}.json`);
}

/** Move one kitchen into another, keeping everything from both. Nothing to move, nothing happens. */
export async function foldKitchen(from: string, into: string) {
  const moving = await readJson<KitchenState | null>(from, null);
  if (moving === null) return;
  await updateJson<KitchenState, void>(into, emptyKitchen(), (stored) => {
    Object.assign(stored, mergeKitchens(normalizeKitchen(stored), normalizeKitchen(moving)));
  });
  await fs.rm(from, { force: true });
}
