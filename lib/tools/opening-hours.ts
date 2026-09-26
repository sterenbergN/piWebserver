// "Is it open right now?" for OpenStreetMap opening_hours strings.
// Handles the everyday forms — "Mo-Fr 08:00-17:00; Sa 09:00-14:00",
// "Mo-Th 07:00-22:00, Fr 07:00-02:00" (past midnight), "24/7",
// "Su off" — and returns null for anything fancier (months, holidays,
// sunrise…) rather than guessing.

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
type Span = [number, number]; // minutes from midnight; end may exceed 1440

const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const DAY_LIST = `${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*`;
const TIME = '\\d{1,2}:\\d{2}';
const SPANS = `${TIME}-${TIME}\\+?(?:,${TIME}-${TIME}\\+?)*`;
const RULE = new RegExp(`(${DAY_LIST})?\\s*(${SPANS}|off|closed)`, 'g');
const UNSUPPORTED = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|week|sunrise|sunset|dawn|dusk|easter|SH)\b|\[|"/i;

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function expandDays(list: string): number[] {
  const out: number[] = [];
  for (const part of list.split(',')) {
    const [a, b] = part.split('-').map((d) => DAYS.indexOf(d as (typeof DAYS)[number]));
    if (b === undefined) out.push(a);
    else for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b) break; }
  }
  return out;
}

/** Weekly schedule (index 0 = Sunday), or null if the string can't be read. */
export function parseOpeningHours(text: string): (Span[] | null)[] | null {
  const src = text.trim();
  if (!src) return null;
  if (/^24\/7$/.test(src)) return DAYS.map(() => [[0, 1440]]);
  if (UNSUPPORTED.test(src)) return null;
  const week: (Span[] | null)[] = DAYS.map(() => null);
  let matched = false;
  // Public-holiday rules ("PH off") can't be applied without a calendar; skip them.
  for (const segment of src.split(';').map((s) => s.trim()).filter((s) => s && !/^PH\b/.test(s))) {
    for (const m of segment.matchAll(RULE)) {
      matched = true;
      const days = m[1] ? expandDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
      const spans: Span[] = /^(off|closed)$/.test(m[2]) ? [] : m[2].split(',').map((s) => {
        const [from, to] = s.replace('+', '').split('-');
        const start = minutes(from);
        let end = minutes(to);
        if (end <= start) end += 1440; // runs past midnight
        return [start, end];
      });
      // A later rule for the same day replaces the earlier one (OSM semantics).
      for (const d of days) week[d] = spans;
    }
  }
  return matched ? week : null;
}

/** true / false, or null when the hours are missing or too unusual to read. */
export function isOpenAt(text: string | null | undefined, day: number, minuteOfDay: number): boolean | null {
  if (!text) return null;
  const week = parseOpeningHours(text);
  if (!week) return null;
  const today = week[day] || [];
  if (today.some(([s, e]) => minuteOfDay >= s && minuteOfDay < e)) return true;
  // Yesterday's late session that runs past midnight.
  const yesterday = week[(day + 6) % 7] || [];
  return yesterday.some(([, e]) => e > 1440 && minuteOfDay < e - 1440);
}
