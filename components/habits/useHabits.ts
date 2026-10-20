'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, localDayOf, localToday, type DateKey } from '@/lib/habits/dates';
import { applyHabitAction, EDIT_WINDOW_DAYS, emptyHabitsData, HabitInputError, isActive, normalizeHabitsData, type HabitAction, type HabitLink, type HabitsData } from '@/lib/habits/habits';
import { readDeviceAttempts } from '@/components/daily/useDaily';

/** `account`: saved to the signed-in account. `device`: signed out, saved in this browser. */
export type HabitsMode = 'loading' | 'account' | 'device' | 'error';

const DEVICE_KEY = 'habits:device';

function readDevice(today: DateKey): HabitsData {
  try {
    return normalizeHabitsData(JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'), today);
  } catch {
    return emptyHabitsData();
  }
}

function writeDevice(data: HabitsData | null) {
  try {
    if (data) localStorage.setItem(DEVICE_KEY, JSON.stringify(data));
    else localStorage.removeItem(DEVICE_KEY);
  } catch { /* storage full or blocked: changes last until the page closes */ }
}

function randomId() {
  try { return crypto.randomUUID().slice(0, 13); } catch { return Math.random().toString(36).slice(2, 12); }
}

/**
 * Habit data with instant updates. Each change is applied here first (the same
 * reducer the server runs), then sent; saves go out one at a time, in order, and
 * a failed save reloads what the server has.
 */
export function useHabits() {
  const [mode, setMode] = useState<HabitsMode>('loading');
  const [data, setData] = useState<HabitsData>(emptyHabitsData);
  const [today, setToday] = useState<DateKey>(() => localToday());
  const [error, setError] = useState('');
  /** Habits kept on this device from before signing in, offered for import. */
  const [deviceData, setDeviceData] = useState<HabitsData | null>(null);
  const dataRef = useRef(data);
  const modeRef = useRef(mode);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);

  const commit = (next: HabitsData) => { dataRef.current = next; setData(next); };

  const load = useCallback(async () => {
    const day = localToday();
    setToday(day);
    try {
      const res = await fetch(`/api/habits?today=${day}`, { cache: 'no-store' });
      if (res.status === 401) {
        modeRef.current = 'device';
        setMode('device');
        commit(readDevice(day));
        return;
      }
      const body = await res.json();
      if (!body.success) throw new Error(body.message);
      modeRef.current = 'account';
      setMode('account');
      commit(normalizeHabitsData(body.data, day));
      const local = readDevice(day);
      setDeviceData(local.habits.length ? local : null);
    } catch {
      setMode('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Past midnight with the page still open, move on to the new day.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setToday(localToday()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const dispatch = useCallback((action: HabitAction): boolean => {
    if (action.type === 'save' && !action.habit.id) action = { ...action, newId: action.newId ?? randomId() };
    let next: HabitsData;
    try {
      next = applyHabitAction(structuredClone(dataRef.current), action, today, randomId);
    } catch (e) {
      setError(e instanceof HabitInputError ? e.message : 'That didn’t work.');
      return false;
    }
    setError('');
    commit(next);

    if (modeRef.current !== 'account') {
      writeDevice(next);
      return true;
    }
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        const res = await fetch('/api/habits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, today }),
        });
        const body = await res.json().catch(() => ({}));
        if (!body.success) throw new Error(body.message || 'Couldn’t save that change.');
        // Take the server's copy once nothing newer is waiting to be sent.
        if (pending.current === 1) commit(normalizeHabitsData(body.data, today));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Couldn’t save that change.');
        await load();
      } finally {
        pending.current--;
      }
    });
    return true;
  }, [today, load]);

  // Linked habits tick themselves off: on days you logged a workout, or did that
  // day's question on the day. Once per load (and per day, or when a habit is added).
  useEffect(() => {
    if (mode !== 'account' && mode !== 'device') return;
    const links = new Set(data.habits.filter((h) => isActive(h) && h.link).map((h) => h.link as HabitLink));
    if (!links.size) return;
    let cancelled = false;
    const from = addDays(today, -EDIT_WINDOW_DAYS);
    const sync = (link: HabitLink, days: (DateKey | null)[]) => {
      if (cancelled) return;
      const linked = dataRef.current.habits.filter((h) => isActive(h) && h.link === link);
      const missing = [...new Set(days)].filter((d): d is DateKey => !!d && d >= from && d <= today && linked.some((h) => !dataRef.current.log[d]?.[h.id]));
      if (missing.length) dispatch({ type: 'link-done', link, dates: missing });
    };
    const onTime = (attempts: { date: DateKey; answeredOn: DateKey; meta?: { core?: boolean } }[]) =>
      attempts.filter((a) => a.meta?.core && a.answeredOn === a.date).map((a) => a.date);

    // Signed-out workouts are only a demo, so workouts link only for accounts.
    if (links.has('workout') && mode === 'account') {
      fetch('/api/workout/history', { cache: 'no-store' }).then((r) => r.json())
        .then((body) => { if (Array.isArray(body.history)) sync('workout', body.history.map((w: any) => (typeof w?.timestamp === 'string' ? localDayOf(w.timestamp) : null))); })
        .catch(() => { /* try again next visit */ });
    }
    if (links.has('daily-question')) {
      if (mode === 'account') {
        fetch(`/api/daily/progress?today=${today}`, { cache: 'no-store' }).then((r) => r.json())
          .then((body) => { if (Array.isArray(body.history)) sync('daily-question', onTime(body.history)); })
          .catch(() => { /* try again next visit */ });
      } else {
        sync('daily-question', onTime(readDeviceAttempts()));
      }
    }
    return () => { cancelled = true; };
  }, [mode, today, data.habits.length]);

  const importDevice = useCallback(() => {
    if (!deviceData) return;
    if (dispatch({ type: 'import', data: deviceData })) {
      writeDevice(null);
      setDeviceData(null);
    }
  }, [deviceData, dispatch]);

  const dismissDevice = useCallback(() => {
    writeDevice(null);
    setDeviceData(null);
  }, []);

  return { mode, data, today, error, clearError: () => setError(''), dispatch, deviceData, importDevice, dismissDevice, reload: load };
}
