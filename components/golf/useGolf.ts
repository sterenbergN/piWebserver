'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyChange, emptySnapshot, enqueue, flush, readQueue, readSnapshot, rebase, writeSnapshot, type Change, type HoleChange, type KeyValue, type Snapshot } from '@/lib/golf/sync';
import type { Course, GolfUser, Round, RoundOp } from '@/lib/golf/types';

/** `account`: signed in, kept on the Pi (and on this phone for when there's no signal). `device`: signed out, kept here. */
export type GolfMode = 'loading' | 'account' | 'device';
export type Legacy = { count: number; names: string[] } | null;

const LAST_ACCOUNT = 'golf:last-account';
/** Rounds from the old Tools scorecard, kept in this browser. */
export const OLD_TOOL_KEY = 'golfGames';

const storage: KeyValue = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};

function oldToolRounds(): unknown[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OLD_TOOL_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function getJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.success !== false, data };
}

export function useGolf() {
  const [mode, setMode] = useState<GolfMode>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('Me');
  const [legacy, setLegacy] = useState<Legacy>(null);
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [waiting, setWaiting] = useState(0);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState('');
  /** Rounds on this phone from before signing in, and old Tools scorecards, offered for import. */
  const [deviceRounds, setDeviceRounds] = useState(0);
  const scope = useRef<string | null>(null);
  const dataRef = useRef(data);

  const commit = useCallback((next: Snapshot) => {
    dataRef.current = next;
    setData(next);
    if (scope.current) writeSnapshot(storage, scope.current, next);
  }, []);

  /** Fetch everything from the Pi and put anything still unsent on top. */
  const pull = useCallback(async () => {
    const s = scope.current;
    if (!s || s === 'device') return;
    try {
      const [rounds, courses, me] = await Promise.all([getJson('/api/golf/rounds?full=1'), getJson('/api/golf/courses'), getJson('/api/golf/me')]);
      if (!rounds.ok || !courses.ok || !me.ok) throw new Error('pull');
      const server: Snapshot = { rounds: rounds.data.rounds, courses: courses.data.courses, user: me.data.user };
      commit(rebase(server, readQueue(storage, s)));
      setLegacy(me.data.legacy);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [commit]);

  const sync = useCallback(async () => {
    const s = scope.current;
    if (!s || s === 'device') return;
    const result = await flush(storage, s);
    setWaiting(result.waiting);
    setOffline(result.offline);
    if (result.dropped.length) setNotice(`A change couldn't be saved: ${result.dropped[0]}`);
    if (!result.offline) await pull();
  }, [pull]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let res: Awaited<ReturnType<typeof getJson>> | null = null;
      try { res = await getJson('/api/golf/me'); } catch { res = null; }
      if (cancelled) return;
      const device = readSnapshot(storage, 'device');
      setDeviceRounds(device.rounds.length + oldToolRounds().length);
      if (res?.status === 401) {
        // Signed out: don't fall back to that account's copy later just because there's no signal.
        storage.remove(LAST_ACCOUNT);
        scope.current = 'device';
        commit(device);
        setMode('device');
        return;
      }
      // Signed in, or no connection: use the last account this phone had.
      const id: string | null = res?.ok ? res.data.userId : storage.get(LAST_ACCOUNT);
      if (!id) {
        scope.current = 'device';
        commit(device);
        setMode('device');
        setOffline(!res);
        return;
      }
      scope.current = id;
      try { storage.set(LAST_ACCOUNT, id); } catch { /* blocked */ }
      setUserId(id);
      if (res?.ok) {
        setName(res.data.name);
        setLegacy(res.data.legacy);
      }
      commit(readSnapshot(storage, id));
      setWaiting(readQueue(storage, id).length);
      setMode('account');
      if (res?.ok) await sync();
      else setOffline(true);
    })();
    return () => { cancelled = true; };
  }, [commit, sync]);

  // Try again when the connection comes back, the app comes to the front, or every so often while changes wait.
  useEffect(() => {
    if (mode !== 'account') return;
    const again = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    const timer = window.setInterval(() => { if (scope.current && readQueue(storage, scope.current).length) void sync(); }, 20000);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
      window.clearInterval(timer);
    };
  }, [mode, sync]);

  /** Apply a change here now and send it (signed in) or keep it (signed out). */
  const change = useCallback((c: Change) => {
    commit(applyChange(dataRef.current, c));
    const s = scope.current;
    if (s && s !== 'device') {
      enqueue(storage, s, c);
      setWaiting(readQueue(storage, s).length);
      void sync();
    }
  }, [commit, sync]);

  const actions = {
    startRound: (round: Round) => change({ kind: 'round', round }),
    edit: (roundId: string, ops: RoundOp[]) => change({ kind: 'ops', roundId, ops }),
    deleteRound: (roundId: string) => change({ kind: 'delete', roundId }),
    addCourse: (course: Course) => change({ kind: 'course', course }),
    setHole: (courseId: string, hole: HoleChange) => change({ kind: 'course-hole', courseId, hole }),
    editCourse: (course: Course) => change({ kind: 'course-edit', course }),
    saveUser: (user: GolfUser) => change({ kind: 'user', user }),
  };

  /** Look at a friend's round before joining it. Needs a connection. */
  const peekRound = useCallback(async (roundId: string, code: string) => {
    const r = await getJson(`/api/golf/rounds/${encodeURIComponent(roundId)}?code=${encodeURIComponent(code)}`).catch(() => null);
    if (!r) throw new Error('No connection. Try again when you have signal.');
    if (!r.ok) throw new Error(r.data.message || 'That round wasn\'t found');
    return { round: r.data.round as Round, member: !!r.data.member };
  }, []);

  const joinRound = useCallback(async (roundId: string, code: string, playerId: string | null) => {
    const res = await fetch(`/api/golf/rounds/${encodeURIComponent(roundId)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, playerId }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) throw new Error(body?.message || 'No connection. Try again when you have signal.');
    await pull();
    return body.round as Round;
  }, [pull]);

  /** Bring this phone's signed-out rounds and old scorecards into the account. */
  const importDevice = useCallback(async (me: string) => {
    const device = readSnapshot(storage, 'device');
    // Courses first, so the rounds' course links still lead somewhere. Adding one twice is harmless.
    for (const course of device.courses) {
      await fetch('/api/golf/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course }) }).catch(() => null);
    }
    const res = await fetch('/api/golf/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'device', me, rounds: device.rounds, legacy: oldToolRounds() }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) throw new Error(body?.message || 'No connection. Try again when you have signal.');
    storage.remove('golf:data:device');
    storage.remove(OLD_TOOL_KEY);
    setDeviceRounds(0);
    await pull();
    return body.added as number;
  }, [pull]);

  const dismissDevice = useCallback(() => {
    storage.remove('golf:data:device');
    storage.remove(OLD_TOOL_KEY);
    setDeviceRounds(0);
  }, []);

  /** The old admin scorecard's rounds saved on the Pi. */
  const importServer = useCallback(async (me: string) => {
    const res = await fetch('/api/golf/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'server', me }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) throw new Error(body?.message || 'No connection');
    setLegacy(null);
    await pull();
    return body.added as number;
  }, [pull]);

  return {
    mode, userId, name, legacy, data, waiting, offline, notice, deviceRounds,
    clearNotice: () => setNotice(''),
    ...actions, peekRound, joinRound, importDevice, dismissDevice, importServer, sync,
  };
}

export type Golf = ReturnType<typeof useGolf>;
