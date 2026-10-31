import { deviceProgress, readDeviceAttempts } from '@/components/daily/useDaily';
import { readDeviceChores } from '@/components/chores/useChores';
import { normalizeChoresData, isOpen, type ChoresData } from '@/lib/chores/chores';
import { dueStatus } from '@/lib/chores/stats';
import { localToday } from '@/lib/habits/dates';
import { isActive, normalizeHabitsData, type HabitsData } from '@/lib/habits/habits';
import { isDueOn, isWeekly } from '@/lib/habits/stats';
import { currentWeek, groceriesLeft } from '@/lib/recipes/kitchen';
import { readLocalKitchen } from '@/lib/recipes/grocery-client';

// What's waiting on each page, for the launcher: href → short label. Each count
// is on its own, so one failing just leaves its page without a badge.

export type NavBadges = Record<string, string>;

const json = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function habitsLeft(today: string) {
  const body = await json(`/api/habits?today=${today}`);
  let stored: unknown = body?.data;
  if (!body) {
    try { stored = JSON.parse(localStorage.getItem('habits:device') || 'null'); } catch { stored = null; }
  }
  const data: HabitsData = normalizeHabitsData(stored, today);
  return data.habits.filter((h) => isActive(h) && !isWeekly(h) && isDueOn(h, today) && (data.log[today]?.[h.id] ?? 0) < h.target).length;
}

async function choresDue(today: string) {
  const body = await json(`/api/chores?today=${today}`);
  const data: ChoresData = body?.success ? normalizeChoresData(body.data, today) : readDeviceChores(today);
  const me: string | null = body?.household?.me ?? null;
  return data.chores.filter((c) => isOpen(c) && (!c.assignee || c.assignee === me) && ['overdue', 'today'].includes(dueStatus(c, today).status)).length;
}

async function questionOpen(today: string) {
  const body = await json(`/api/daily?today=${today}`);
  const id = body?.day?.core?.id;
  if (!id) return false;
  if (body.signedIn) return !body.answered?.[id];
  deviceProgress(today);
  return !readDeviceAttempts().some((a) => a.questionId === id);
}

async function journalOpen(today: string) {
  const body = await json(`/api/journal?date=${today}`);
  return Boolean(body?.success && !body.entry);
}

async function groceries(today: string) {
  const [recipes, synced] = await Promise.all([json('/api/recipes'), json('/api/recipes/kitchen')]);
  if (!Array.isArray(recipes?.recipes)) return 0;
  return groceriesLeft(recipes.recipes, synced?.kitchen ?? readLocalKitchen(), currentWeek(today));
}

let cache: { at: number; badges: Promise<NavBadges> } | null = null;

export function loadNavBadges(): Promise<NavBadges> {
  if (cache && Date.now() - cache.at < 60_000) return cache.badges;
  const today = localToday();
  const count = (n: number) => (n > 0 ? String(n) : '');
  const badges = (async (): Promise<NavBadges> => {
    const [habits, chores, question, journal, list] = await Promise.all([
      habitsLeft(today).catch(() => 0), choresDue(today).catch(() => 0), questionOpen(today).catch(() => false),
      journalOpen(today).catch(() => false), groceries(today).catch(() => 0),
    ]);
    return {
      '/habits': count(habits), '/chores': count(chores), '/daily': question ? 'New' : '',
      '/journal': journal ? 'Write' : '', '/recipes?view=list': count(list),
    };
  })();
  cache = { at: Date.now(), badges };
  return badges;
}
