// Just enough of the iCal format to read a Google Calendar: one-off events with a
// title and a day. Recurring events are left out, since those are ordinary classes
// and not the exams and due dates the planner is after. Pure.

import { isDateKey, type DateKey } from '@/lib/habits/dates';
import type { CalEvent, DeadlineKind } from './plan';

/** Words in an event's name that suggest it's worth tracking. She confirms each one. */
export function classifyEvent(title: string): DeadlineKind | null {
  if (/\b(lectures?|labs?|class|office hours|review session|study group|orientation)\b/i.test(title)) return null;
  if (/\b(practicals?|osces?|skills? (check|exam|assessment))\b/i.test(title)) return 'practical';
  if (/\bquiz(zes)?\b/i.test(title)) return 'quiz';
  if (/\b(exams?|examination|midterms?|finals?|tests?|eor|packrat)\b/i.test(title)) return 'exam';
  if (/\b(due|assignments?|papers?|essay|projects?|presentations?|soap note|case stud(y|ies)|submit|deadline)\b/i.test(title)) return 'assignment';
  return null;
}

const unescapeText = (text: string) => text.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

/** The local day of a UTC moment, in her time zone. */
function dayInZone(moment: Date, timeZone?: string): DateKey {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(moment);
  } catch {
    return moment.toISOString().slice(0, 10);
  }
}

/** `20261105`, `20261105T090000` (already local to its zone) or `20261105T140000Z` (UTC). */
function readDay(value: string, timeZone?: string): DateKey | null {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, utc] = match;
  const day = `${y}-${m}-${d}`;
  if (!isDateKey(day)) return null;
  return utc ? dayInZone(new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)), timeZone) : day;
}

/** One-off, confirmed events in the file. `timeZone` is hers, for events stored in UTC. */
export function parseIcal(text: string, timeZone?: string): CalEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not-ical');
  // A long line continues on the next one, which starts with a space or tab.
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: CalEvent[] = [];
  const seen = new Set<string>();
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { current = {}; continue; }
    if (/^END:VEVENT/i.test(line)) {
      const event = current;
      current = null;
      if (!event?.UID || !event.DTSTART || event.RRULE || event['RECURRENCE-ID'] || /CANCELLED/i.test(event.STATUS ?? '') || seen.has(event.UID)) continue;
      const on = readDay(event.DTSTART, timeZone);
      const title = unescapeText(event.SUMMARY ?? '');
      if (!on || !title) continue;
      seen.add(event.UID);
      events.push({ uid: event.UID.slice(0, 300), title: title.slice(0, 200), on, kind: classifyEvent(title) });
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    if (!(name in current)) current[name] = line.slice(colon + 1);
  }
  return events;
}
