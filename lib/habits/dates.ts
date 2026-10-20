// Calendar days as 'YYYY-MM-DD' keys in the user's own time zone. All math is
// done on the key itself (as a UTC date), so daylight-saving shifts can't skip
// or repeat a day.

export type DateKey = string;

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const m = KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function toUtc(key: DateKey) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): DateKey {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today on this device. */
export function localToday(now = new Date()): DateKey {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The local calendar day of an ISO timestamp, on this device. */
export function localDayOf(iso: string): DateKey | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? localToday(new Date(t)) : null;
}

export function addDays(key: DateKey, days: number): DateKey {
  return fromUtc(toUtc(key) + days * 86_400_000);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: DateKey, b: DateKey) {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(key: DateKey) {
  return new Date(toUtc(key)).getUTCDay();
}

/** The Monday that starts the week containing `key`. */
export function weekStart(key: DateKey): DateKey {
  return addDays(key, -((dayOfWeek(key) + 6) % 7));
}

/** Every day from `from` to `to`, inclusive. */
export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const days: DateKey[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}
