import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clampToday } from '@/lib/daily/store';
import { CalendarError, fetchCalendar, isGoogleIcalUrl, readCalendarUrl, readIcsText, removeCalendarUrl, saveCalendarUrl, STALE_MS } from '@/lib/study/calendar';
import {
  acceptEvent, addDeadline, addSyllabus, addTask, eat, editDeadline, editTask, ignoreEvent, noteClean, parseSyllabusReply, PlanInputError, removeDeadline, removeTask,
  saveSettings, setDayOff, spreadPile, syncCalendar, uneat, type PlanData,
} from '@/lib/study/plan';
import { readPlan, readProgress, readTests, updatePlan } from '@/lib/study/store';
import { dueMisses } from '@/lib/study/study';

// The signed-in account's planner. The browser works out the plate and warnings
// from the plan itself (lib/study/plan.ts), so every answer is the plan again. The
// calendar's secret address is never part of an answer.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const newId = () => crypto.randomBytes(9).toString('base64url');

async function answer(userId: string, today: string, extra: Record<string, unknown> = {}) {
  const [plan, progress, tests] = await Promise.all([readPlan(userId), readProgress(userId), readTests(userId)]);
  const fetched = plan.calendar.lastFetchedAt ? Date.parse(plan.calendar.lastFetchedAt) : 0;
  return NextResponse.json({
    success: true,
    plan,
    reviewsDue: dueMisses(progress, today).length,
    reviewedToday: progress.reviewDays.includes(today),
    tests: tests.tests.map((t) => ({ id: t.id, title: t.title, course: t.course })),
    calendarStale: plan.calendar.connected && plan.calendar.source === 'url' && Date.now() - fetched > STALE_MS,
    ...extra,
  }, { headers: PRIVATE });
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    return await answer(userId, clampToday(new URL(request.url).searchParams.get('today')));
  } catch (error) {
    return handleApiError(error, 'Load plan failed');
  }
}

/** Fetch the calendar and bring the plan into line. A failure is noted for her and changes nothing else. */
async function refreshCalendar(userId: string, url: string, plan: PlanData, today: string) {
  try {
    const events = await fetchCalendar(url, plan.settings.timeZone);
    await updatePlan(userId, (stored) => {
      stored.calendar.connected = true;
      syncCalendar(stored, events, today, { source: 'url', checkGone: true }, new Date().toISOString());
    });
    return true;
  } catch (error) {
    const message = error instanceof CalendarError ? error.message : 'Couldn’t read your calendar just now.';
    await updatePlan(userId, (stored) => {
      stored.calendar.lastError = message;
      stored.calendar.lastFetchedAt = new Date().toISOString();
    });
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const change = <R>(mutate: (plan: PlanData) => R) => updatePlan(userId, mutate);

    switch (body.action) {
      case 'settings':
        await change((plan) => saveSettings(plan, body, today));
        break;
      case 'add-deadline':
        await change((plan) => addDeadline(plan, body, newId));
        break;
      case 'edit-deadline':
        await change((plan) => editDeadline(plan, body.id, body, today));
        break;
      case 'remove-deadline':
        await change((plan) => removeDeadline(plan, body.id));
        break;
      case 'clear-moved':
        await change((plan) => { for (const d of plan.deadlines) delete d.movedFrom; });
        break;
      case 'add-task':
        await change((plan) => addTask(plan, body, newId, today));
        break;
      case 'edit-task':
        await change((plan) => editTask(plan, body.id, body, today));
        break;
      case 'remove-task':
        await change((plan) => removeTask(plan, body.id));
        break;
      case 'eat':
      case 'uneat': {
        const progress = await readProgress(userId);
        const due = dueMisses(progress, today).length;
        const reviewed = progress.reviewDays.includes(today);
        const cleaned = await change((plan) => {
          if (body.action === 'eat') eat(plan, body.id, today, Math.min(40, Math.max(1, Math.round(Number(body.count) || 1))));
          else uneat(plan, body.id, today);
          return noteClean(plan, today, due, reviewed);
        });
        return await answer(userId, today, { cleaned });
      }
      case 'spread': {
        const moved = await change((plan) => spreadPile(plan, today));
        return await answer(userId, today, { moved });
      }
      case 'day-off':
        await change((plan) => setDayOff(plan, body.day, body.on === true, today));
        break;
      case 'syllabus': {
        const pack = parseSyllabusReply(body.text, today);
        const added = await change((plan) => addSyllabus(plan, pack, newId, today));
        return await answer(userId, today, { added, problems: pack.problems });
      }
      case 'calendar-connect': {
        if (!isGoogleIcalUrl(body.url)) throw new ApiError(400, 'That isn’t a Google Calendar secret address. It should start with https://calendar.google.com/calendar/ical/ and end in .ics.');
        const plan = await readPlan(userId);
        const zone = typeof body.timeZone === 'string' ? body.timeZone.slice(0, 60) : plan.settings.timeZone;
        // Check it works before keeping it.
        let events;
        try {
          events = await fetchCalendar(body.url, zone);
        } catch (error) {
          if (error instanceof CalendarError) throw new ApiError(400, error.message);
          throw error;
        }
        await saveCalendarUrl(userId, body.url.trim());
        await change((stored) => {
          if (zone) stored.settings.timeZone = zone;
          stored.calendar.connected = true;
          syncCalendar(stored, events, today, { source: 'url', checkGone: true }, new Date().toISOString());
        });
        break;
      }
      case 'calendar-file': {
        const plan = await readPlan(userId);
        const zone = typeof body.timeZone === 'string' ? body.timeZone.slice(0, 60) : plan.settings.timeZone;
        let events;
        try {
          events = readIcsText(body.text, zone);
        } catch (error) {
          if (error instanceof CalendarError) throw new ApiError(400, error.message);
          throw error;
        }
        await change((stored) => {
          if (zone) stored.settings.timeZone = zone;
          // A file may only be part of a calendar, so what's missing from it isn't treated as cancelled.
          syncCalendar(stored, events, today, { source: 'file', checkGone: false }, new Date().toISOString());
        });
        break;
      }
      case 'calendar-refresh': {
        const url = await readCalendarUrl(userId);
        if (url) await refreshCalendar(userId, url, await readPlan(userId), today);
        break;
      }
      case 'calendar-disconnect':
        await removeCalendarUrl(userId);
        await change((plan) => {
          plan.calendar.connected = false;
          delete plan.calendar.source;
          delete plan.calendar.lastError;
          plan.calendar.events = [];
        });
        break;
      case 'calendar-accept':
        await change((plan) => acceptEvent(plan, body.uid, body.kind, newId));
        break;
      case 'calendar-ignore':
        await change((plan) => ignoreEvent(plan, body.uid));
        break;
      default:
        throw new ApiError(400, 'Unknown action');
    }
    return await answer(userId, today);
  } catch (error) {
    if (error instanceof PlanInputError) return handleApiError(new ApiError(400, error.message));
    return handleApiError(error, 'Plan update failed');
  }
}
