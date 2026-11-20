'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  applyQuickNoteAction, normalizeQuickNotes, QuickNoteInputError, type QuickNote, type QuickNoteAction, type QuickNotesData,
} from '@/lib/quick-notes/quick-notes';

// One copy of the account's quick notes for the whole tab, so the Explore
// panel, the Quick notes page and the Today card always agree. Changes show at
// once and are saved in order; if a save fails the list is reloaded from the
// account and the error is shown.

export type QuickNotesState = {
  status: 'idle' | 'loading' | 'ready' | 'signed-out' | 'error';
  data: QuickNotesData;
  error: string;
};

let state: QuickNotesState = { status: 'idle', data: { notes: [] }, error: '' };
let loadedAt = 0;
let loading: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
const listeners = new Set<() => void>();

const set = (next: Partial<QuickNotesState>) => {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => state;
const SERVER: QuickNotesState = { status: 'idle', data: { notes: [] }, error: '' };

function load(force = false): Promise<void> {
  if (loading) return loading;
  if (!force && state.status === 'ready' && Date.now() - loadedAt < 15_000) return Promise.resolve();
  if (state.status !== 'ready') set({ status: 'loading' });
  loading = fetch('/api/quick-notes', { cache: 'no-store' })
    .then(async (res) => {
      if (res.status === 401) { set({ status: 'signed-out', data: { notes: [] } }); return; }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.message || 'Couldn’t load your quick notes.');
      loadedAt = Date.now();
      // A save on its way will bring the newer list.
      if (pending === 0) set({ status: 'ready', data: normalizeQuickNotes(body.data) });
      else set({ status: 'ready' });
    })
    .catch((error: Error) => set({ status: state.status === 'ready' ? 'ready' : 'error', error: error.message || 'Couldn’t load your quick notes.' }))
    .finally(() => { loading = null; });
  return loading;
}

const clientId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Apply a change here at once, then save it. Resolves true once saved. For an
 * 'add' it fills in the id, and the page it was written on if none is given.
 */
function dispatch(action: QuickNoteAction): Promise<boolean> {
  if (action.type === 'add') action = { ...action, id: action.id ?? clientId() };
  const local: QuickNotesData = { notes: state.data.notes.map((n) => ({ ...n })) };
  try {
    applyQuickNoteAction(local, action, new Date(), clientId);
  } catch (error) {
    set({ error: error instanceof QuickNoteInputError ? error.message : 'That didn’t work.' });
    return Promise.resolve(false);
  }
  set({ data: local, error: '' });
  const send = () => fetch('/api/quick-notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  }).then(async (res) => {
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) throw new Error(body?.message || 'That didn’t save. Try again.');
    loadedAt = Date.now();
    // Changes still on their way are already shown; the last reply has them all.
    if (pending === 1) set({ status: 'ready', data: normalizeQuickNotes(body.data) });
    return true;
  }).catch((error: Error) => {
    set({ error: error.message || 'That didn’t save. Try again.' });
    void load(true);
    return false;
  }).finally(() => { pending--; });
  pending++;
  const run = queue.then(send, send);
  queue = run;
  return run;
}

/** The page someone is on, for "written on …". */
export function herePage(): QuickNote['from'] {
  if (typeof window === 'undefined') return undefined;
  // Written on the notes page itself (or Today): nothing worth linking back to.
  if (/^\/(quick-notes|today)(\/|$)/.test(window.location.pathname)) return undefined;
  const title = document.title.split(/\s[|·–-]\s/)[0].trim();
  return { path: window.location.pathname + window.location.search, ...(title ? { title } : {}) };
}

/** The account's quick notes. Pass enabled=false to skip loading (signed out). */
export function useQuickNotes(enabled = true) {
  const current = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  useEffect(() => { if (enabled) void load(); }, [enabled]);
  const clearError = useCallback(() => set({ error: '' }), []);
  const reload = useCallback(() => load(true), []);
  return { ...current, dispatch, clearError, reload };
}
