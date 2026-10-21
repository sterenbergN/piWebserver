'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localToday, type DateKey } from '@/lib/habits/dates';
import { applyChoreAction, ChoreInputError, emptyChoresData, normalizeChoresData, type ChoreAction, type ChoresData } from '@/lib/chores/chores';

/** `account`: the signed-in household's list. `device`: signed out, saved in this browser. */
export type ChoresMode = 'loading' | 'account' | 'device' | 'error';
export type Member = { id: string; name: string };
export type HouseholdInfo = { me: string; invite: string | null; members: Member[] };

export const CHORES_DEVICE_KEY = 'chores:device';
/** How often an open page checks for what the rest of the household did. */
const REFRESH_MS = 60_000;

export function readDeviceChores(today: DateKey): ChoresData {
  try {
    return normalizeChoresData(JSON.parse(localStorage.getItem(CHORES_DEVICE_KEY) || 'null'), today);
  } catch {
    return emptyChoresData();
  }
}

function writeDevice(data: ChoresData | null) {
  try {
    if (data) localStorage.setItem(CHORES_DEVICE_KEY, JSON.stringify(data));
    else localStorage.removeItem(CHORES_DEVICE_KEY);
  } catch { /* storage full or blocked: changes last until the page closes */ }
}

function randomId() {
  try { return crypto.randomUUID().slice(0, 13); } catch { return Math.random().toString(36).slice(2, 12); }
}

/**
 * The household's chores with instant updates, the same way useHabits works:
 * each change is applied here first, then sent in order; a failed save reloads
 * what the server has. The list also refreshes when the page comes back into
 * view and every minute while it's open, so others' changes show up.
 */
export function useChores() {
  const [mode, setMode] = useState<ChoresMode>('loading');
  const [data, setData] = useState<ChoresData>(emptyChoresData);
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [today, setToday] = useState<DateKey>(() => localToday());
  const [error, setError] = useState('');
  /** Chores kept on this device from before signing in, offered for import. */
  const [deviceData, setDeviceData] = useState<ChoresData | null>(null);
  const dataRef = useRef(data);
  const modeRef = useRef(mode);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);

  const commit = (next: ChoresData) => { dataRef.current = next; setData(next); };

  const load = useCallback(async (quiet = false) => {
    const day = localToday();
    setToday(day);
    try {
      const res = await fetch(`/api/chores?today=${day}`, { cache: 'no-store' });
      if (res.status === 401) {
        modeRef.current = 'device';
        setMode('device');
        commit(readDeviceChores(day));
        return;
      }
      const body = await res.json();
      if (!body.success) throw new Error(body.message);
      // A change made while this was loading wins; the next refresh catches up.
      if (pending.current) return;
      modeRef.current = 'account';
      setMode('account');
      commit(normalizeChoresData(body.data, day));
      setHousehold(body.household);
      const local = readDeviceChores(day);
      setDeviceData(local.chores.length ? local : null);
    } catch {
      if (!quiet) setMode('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && modeRef.current === 'account') load(true); };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setToday(localToday());
      refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [load]);

  const dispatch = useCallback((action: ChoreAction): boolean => {
    // Name new things here, so the server's copy matches what's on screen.
    if (action.type === 'save' && !action.chore.id) action = { ...action, newId: action.newId ?? randomId() };
    if ((action.type === 'done' || action.type === 'skip') && !action.entryId) action = { ...action, entryId: randomId() };
    if (action.type === 'done' || action.type === 'skip') action = { ...action, by: household?.me ?? null };
    let next: ChoresData;
    try {
      next = applyChoreAction(structuredClone(dataRef.current), action, today, randomId);
    } catch (e) {
      setError(e instanceof ChoreInputError ? e.message : 'That didn’t work.');
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
        const res = await fetch('/api/chores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, today }),
        });
        const body = await res.json().catch(() => ({}));
        if (!body.success) throw new Error(body.message || 'Couldn’t save that change.');
        if (pending.current === 1) commit(normalizeChoresData(body.data, today));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Couldn’t save that change.');
        pending.current--;
        await load();
        pending.current++;
      } finally {
        pending.current--;
      }
    });
    return true;
  }, [today, load, household?.me]);

  /** Invite codes, joining and leaving; reloads the list afterwards. */
  const householdOp = useCallback(async (op: 'invite' | 'invite-off' | 'join' | 'leave', code?: string) => {
    try {
      const res = await fetch('/api/chores/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, code, today }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.success) { setError(body.message || 'That didn’t work.'); return false; }
      await load(true);
      return true;
    } catch {
      setError('Network error. Try again.');
      return false;
    }
  }, [today, load]);

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

  return { mode, data, household, today, error, clearError: () => setError(''), dispatch, householdOp, deviceData, importDevice, dismissDevice, reload: load };
}
