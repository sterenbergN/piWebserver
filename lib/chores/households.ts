import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { generateId } from '@/lib/workout/data';
import { applyChoreAction, emptyChoresData, normalizeChoresData, type ChoresData } from './chores';

// Chores belong to a household, so everyone in it sees and ticks off the same
// list. .data/chores/households.json says who is in which household (and its
// invite code); each household's chores live in .data/chores/<id>.json. Every
// account gets a household of its own the first time it opens chores.

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
 * folded into the new one, chores and history included; otherwise you just
 * leave the old one, and its chores stay with the people still in it.
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
  }
  return result.target;
}

/** Leave your household for a fresh one of your own. The chores stay with whoever is left. */
export async function leaveHousehold(userId: string) {
  const mine = await householdFor(userId);
  if (mine.members.length <= 1) throw new HouseholdError('You’re the only one in this household.');
  await updateJson(INDEX(), empty(), (data) => {
    const household = data.households.find((h) => h.id === mine.id);
    if (household) household.members = household.members.filter((m) => m !== userId);
  });
  return householdFor(userId);
}
