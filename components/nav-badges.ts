import { deviceProgress, readDeviceAttempts } from '@/components/daily/useDaily';
import { readDeviceChores } from '@/components/chores/useChores';
import { normalizeChoresData, isOpen, type ChoresData } from '@/lib/chores/chores';
import { dueStatus } from '@/lib/chores/stats';
import { localToday } from '@/lib/habits/dates';
import { isActive, normalizeHabitsData, type HabitsData } from '@/lib/habits/habits';
import { isDueOn, isWeekly } from '@/lib/habits/stats';
import { currentWeek, groceriesLeft, mealsToday } from '@/lib/recipes/kitchen';
import { readLocalKitchen } from '@/lib/recipes/grocery-client';
import { readTodayHidden } from '@/lib/today-prefs';
import { formatRelativeDay } from '@/lib/workout/session-insights';

// What's waiting on each page, and what's going on in each room, for the rooms.
// Each is on its own, so one failing just leaves its place without a label.

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
  const [body, settings] = await Promise.all([json(`/api/daily?today=${today}`), json('/api/today')]);
  const id = body?.day?.core?.id;
  if (!id || readTodayHidden(settings?.hidden).includes('question')) return false;
  if (body.signedIn) return !body.answered?.[id];
  deviceProgress(today);
  return !readDeviceAttempts().some((a) => a.questionId === id);
}

async function journalOpen(today: string) {
  const body = await json(`/api/journal?date=${today}`);
  return Boolean(body?.success && !body.entry);
}

async function kitchenNow(today: string) {
  const [recipes, synced] = await Promise.all([json('/api/recipes'), json('/api/recipes/kitchen')]);
  if (!Array.isArray(recipes?.recipes)) return { left: 0, tonight: '' };
  const kitchen = synced?.kitchen ?? readLocalKitchen();
  const tonight = mealsToday(recipes.recipes, kitchen, today).tonight.find((m) => !m.entry.cooked);
  return { left: groceriesLeft(recipes.recipes, kitchen, currentWeek(today)), tonight: tonight?.recipe.title ?? '' };
}

async function lastLift() {
  const body = await json('/api/workout/history');
  const history: { timestamp?: string }[] = Array.isArray(body?.history) ? body.history : [];
  const last = [...history].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
  return last?.timestamp ? formatRelativeDay(last.timestamp) : '';
}

async function piTemperature() {
  const body = await json('/api/stats');
  const temp = body?.data?.temp;
  return typeof temp === 'string' && temp !== 'N/A' && temp !== 'Unknown' ? temp : '';
}

/** Counts by page, and a line on what's going on in each room right now. */
export type NavInfo = { badges: NavBadges; status: Record<string, string> };

let cache: { at: number; info: Promise<NavInfo> } | null = null;

export function loadNavInfo(): Promise<NavInfo> {
  if (cache && Date.now() - cache.at < 60_000) return cache.info;
  const today = localToday();
  const count = (n: number) => (n > 0 ? String(n) : '');
  const info = (async (): Promise<NavInfo> => {
    const [habits, chores, question, journal, kitchen, lifted, temp] = await Promise.all([
      habitsLeft(today).catch(() => 0), choresDue(today).catch(() => 0), questionOpen(today).catch(() => false),
      journalOpen(today).catch(() => false), kitchenNow(today).catch(() => ({ left: 0, tonight: '' })), lastLift().catch(() => ''), piTemperature().catch(() => ''),
    ]);
    const toDo = habits + chores + (question ? 1 : 0) + (journal ? 1 : 0);
    return {
      badges: {
        '/habits': count(habits), '/chores': count(chores), '/daily': question ? 'New' : '',
        '/journal': journal ? 'Write' : '', '/recipes?view=list': count(kitchen.left),
      },
      status: {
        day: toDo ? `${toDo} thing${toDo === 1 ? '' : 's'} to do today` : '',
        kitchen: kitchen.tonight ? `🍽️ Tonight: ${kitchen.tonight}` : kitchen.left ? `🛒 ${kitchen.left} to buy` : '',
        gym: lifted ? `Last lift: ${lifted}` : '',
        workshop: temp ? `🟢 The Pi is up, at ${temp}` : '',
      },
    };
  })();
  cache = { at: Date.now(), info };
  return info;
}
