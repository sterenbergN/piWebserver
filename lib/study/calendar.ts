import fs from 'fs/promises';
import path from 'path';
import { readJson, writeJsonAtomic } from '@/lib/json-store';
import { parseIcal } from './ical';
import type { CalEvent } from './plan';
import { studyFolder } from './store';

// Reading her Google Calendar through its secret iCal address, which works like a
// password. It lives in a file of its own, is never sent back to the browser or
// written to a log, stays out of "Download my data", and is only ever fetched from
// Google's calendar host, so this can't be used to reach anything else.

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
/** How old the calendar can get before the page asks for a fresh copy. */
export const STALE_MS = 6 * 60 * 60 * 1000;

export class CalendarError extends Error {}

const secretFile = (userId: string) => path.join(studyFolder(userId), 'calendar-secret.json');
export const readCalendarUrl = async (userId: string) => (await readJson<{ url?: string }>(secretFile(userId), {})).url ?? null;
export const saveCalendarUrl = (userId: string, url: string) => writeJsonAtomic(secretFile(userId), { url });
export const removeCalendarUrl = (userId: string) => fs.rm(secretFile(userId), { force: true });

/** Only Google's own secret-address form. */
export function isGoogleIcalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'calendar.google.com' && !url.username && !url.password && !url.port
      && /^\/calendar\/ical\/[^/]+\/[^/]+\/[^/]+\.ics$/.test(url.pathname);
  } catch {
    return false;
  }
}

async function readCapped(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new CalendarError('Google sent back nothing.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new CalendarError('That calendar is too large to read.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchCalendar(url: string, timeZone?: string): Promise<CalEvent[]> {
  if (!isGoogleIcalUrl(url)) throw new CalendarError('That isn’t a Google Calendar secret address.');
  let response: Response;
  try {
    response = await fetch(url.trim(), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CalendarError('Couldn’t reach Google Calendar just now.');
  }
  if (response.status === 403 || response.status === 404) throw new CalendarError('Google didn’t recognize that address. It may have been reset, so copy it again from your calendar’s settings.');
  if (!response.ok) throw new CalendarError('Google Calendar didn’t answer properly just now.');
  try {
    return parseIcal(await readCapped(response), timeZone);
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('That address didn’t return a calendar.');
  }
}

export function readIcsText(text: unknown, timeZone?: string) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new CalendarError('That file is too large to read.');
  try {
    return parseIcal(text, timeZone);
  } catch {
    throw new CalendarError('That isn’t a calendar file. In Google Calendar, export it from Settings, and unzip it to get the .ics file.');
  }
}
