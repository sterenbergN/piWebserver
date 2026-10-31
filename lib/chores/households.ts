import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson, writeJsonAtomic } from '@/lib/json-store';
import { emptyKitchen } from '@/lib/recipes/kitchen';
import { foldKitchen, householdKitchenFile, personalKitchenFile } from '@/lib/recipes/kitchen-store';
import { generateId } from '@/lib/workout/data';
import { loadUsersData } from '@/lib/workout/users';
import { applyChoreAction, emptyChoresData, normalizeChoresData, type ChoresData } from './chores';

// Chores, the meal plan and the grocery list belong to a household, so everyone
// in it sees and ticks off the same things. .data/chores/households.json says
// who is in which household (and its invite code); each household's chores live
// in .data/chores/<id>.json and its kitchen in .data/recipes/kitchen/. Every
// account gets a household of its own the first time it opens either.

export type Household = { id: string; members: string[]; invite: string | null; createdOn: string };
type HouseholdsFile = { households: Household[] };

const DIR = () => path.join(process.cwd(), '.data', 'chores');
const INDEX = () => path.join(DIR(), 'households.json');
const empty = (): HouseholdsFile => ({ households: [] });
/** No 0/O or 1/I/L, so a code read out loud or off a screen can't be mistyped. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function choresFile(householdId: string) {
  if (!/^[\w-]{1,64}$/.test(householdId)) throw new Error('Invalid household');
  return path.join(DIR(), `${householdId}.json`);
}

function newCode() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** The user's household if they have one (without making one). */
export async function findHousehold(userId: string): Promise<Household | null> {
  return (await readJson(INDEX(), empty())).households?.find((h) => h.members.includes(userId)) ?? null;
}

/** The user's household, made for them if they don't have one yet. */
export async function householdFor(userId: string): Promise<Household> {
  const found = (await readJson(INDEX(), empty())).households?.find((h) => h.members.includes(userId));
  if (found) return found;
  return updateJson(INDEX(), empty(), (data) => {
    data.households ||= [];
    const again = data.households.find((h) => h.members.includes(userId));
    if (again) return again;
    const household: Household = { id: generateId(), members: [userId], invite: null, createdOn: new Date().toISOString() };
    data.households.push(household);
    return household;
  });
}

/** Who's in the household, by name, for "done by" and "shared with". */
export async function describeHousehold(household: Household, me: string) {
  const users = (await loadUsersData()).users;
  return {
    me,
    invite: household.invite,
    members: household.members.map((id) => ({ id, name: String(users.find((u) => u.id === id)?.username || 'Someone') })),
  };
}

/** Turn the invite code on (or make a new one), or off with `on: false`. */
export async function setInvite(userId: string, on: boolean) {
  const mine = await householdFor(userId);
  return updateJson(INDEX(), empty(), (data) => {
    const household = data.households.find((h) => h.id === mine.id)!;
    if (!on) household.invite = null;
    else {
      const taken = new Set(data.households.map((h) => h.invite));
      let code = newCode();
      while (taken.has(code)) code = newCode();
      household.invite = code;
    }
    return household;
  });
}

export class HouseholdError extends Error {}

/**
 * Join the household with this invite code. A household you were alone in is
 * folded into the new one, chores, history and kitchen included; otherwise you
 * just leave the old one, and all that stays with the people still in it.
 */
export async function joinHousehold(userId: string, rawCode: string, today: string) {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw new HouseholdError('Codes are 6 letters and numbers.');
  const mine = await householdFor(userId);
  const result = await updateJson(INDEX(), empty(), (data) => {
    const target = data.households.find((h) => h.invite === code);
    if (!target) throw new HouseholdError('No household has that code. Check it, or ask for a new one.');
    if (target.id === mine.id) throw new HouseholdError('You’re already in this household.');
    const old = data.households.find((h) => h.id === mine.id);
    const alone = !old || old.members.length <= 1;
    if (old) old.members = old.members.filter((m) => m !== userId);
    data.households = data.households.filter((h) => h.members.length > 0);
    target.members.push(userId);
    return { target, mergeFrom: alone ? mine.id : null };
  });
  if (result.mergeFrom) {
    const leftBehind = normalizeChoresData(await readJson(choresFile(result.mergeFrom), emptyChoresData()), today);
    if (leftBehind.chores.length) {
      await updateJson<ChoresData, false | void>(choresFile(result.target.id), emptyChoresData(), (stored) => {
        const next = normalizeChoresData(stored, today);
        applyChoreAction(next, { type: 'import', data: leftBehind, by: userId }, today, generateId);
        Object.assign(stored, next);
      });
    }
    await fs.rm(choresFile(result.mergeFrom), { force: true });
    await foldKitchen(householdKitchenFile(result.mergeFrom), householdKitchenFile(result.target.id));
  }
  return result.target;
}

/** Leave your household for a fresh one of your own. Its chores and kitchen stay with whoever is left. */
export async function leaveHousehold(userId: string) {
  const mine = await householdFor(userId);
  if (mine.members.length <= 1) throw new HouseholdError('You’re the only one in this household.');
  await updateJson(INDEX(), empty(), (data) => {
    const household = data.households.find((h) => h.id === mine.id);
    if (household) household.members = household.members.filter((m) => m !== userId);
  });
  const fresh = await householdFor(userId);
  // Stored empty, not missing: a missing kitchen takes in whatever the device has, here the list just left.
  await writeJsonAtomic(householdKitchenFile(fresh.id), emptyKitchen());
  return fresh;
}

/** An account was deleted: it's no longer in anyone's household, and one it had to itself goes with it. */
export async function removeFromHousehold(userId: string) {
  const emptied = await updateJson<HouseholdsFile, string | null>(INDEX(), empty(), (data) => {
    data.households ||= [];
    const household = data.households.find((h) => h.members.includes(userId));
    if (!household) return null;
    household.members = household.members.filter((m) => m !== userId);
    if (household.members.length) return null;
    data.households = data.households.filter((h) => h !== household);
    return household.id;
  });
  if (emptied) {
    await fs.rm(choresFile(emptied), { force: true });
    await fs.rm(householdKitchenFile(emptied), { force: true });
  }
  await fs.rm(personalKitchenFile(userId), { force: true });
}
