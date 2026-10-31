'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { savePref } from '@/lib/workout/device-prefs';
import { applyKitchenAction, emptyKitchen, newKitchenId, normalizeKitchen, type KitchenAction, type KitchenState, type PlanEntry } from '@/lib/recipes/kitchen';
import { clearSentChanges, isEmptyKitchen as isEmpty, KITCHEN_CHANGED, KITCHEN_PREF, queueChange, readLocalKitchen as readLocal, readOutbox } from '@/lib/recipes/grocery-client';
import type { HouseholdInfo } from '@/components/chores/useChores';
import type { DateKey } from '@/lib/habits/dates';

const SYNC_DELAY_MS = 800;
/** How often an open page checks for what the rest of the household did: quick enough to split up at the store. */
const REFRESH_MS = 20_000;
const MAX_BATCH = 50;

export type Kitchen = ReturnType<typeof useKitchen>;
export type HouseholdOp = 'invite' | 'invite-off' | 'join' | 'leave';

/** The server's kitchen, plus whatever this device hasn't got through to it yet. */
const withUnsent = (kitchen: KitchenState) => readOutbox().reduce((k, q) => applyKitchenAction(k, q.action), kitchen);

/**
 * What the household has, its plans and its list: kept on the device and, once
 * signed in, shared. Each change shows straight away and is sent on its own, so
 * two people editing at once both keep theirs, and changes made with no signal
 * wait until there is one. Coming back to the page picks up everyone else's.
 */
export function useKitchen(signedIn: boolean) {
  const [state, setState] = useState<KitchenState>(emptyKitchen);
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const current = useRef(state);
  const me = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sending = useRef(false);
  /** Counts confirmed saves: a load that began before one may not include it. */
  const saves = useRef(0);

  const show = useCallback((next: KitchenState) => {
    if (JSON.stringify(next) === JSON.stringify(current.current)) return;
    current.current = next;
    setState(next);
  }, []);

  const send = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (sending.current) return;
    const batch = readOutbox().slice(0, MAX_BATCH);
    if (!batch.length) return;
    sending.current = true;
    let sent = false;
    try {
      const res = await fetch('/api/recipes/kitchen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: batch.map((q) => q.action) }),
        keepalive: true,
      });
      // Refused as nonsense would only be refused again; anything else waits to be retried.
      if (res.ok || res.status === 400) {
        sent = true;
        clearSentChanges(batch);
        saves.current += 1;
        const body = await res.json().catch(() => null);
        if (body?.kitchen) show(withUnsent(normalizeKitchen(body.kitchen)));
      }
    } catch {
      /* no signal: still queued on this device */
    } finally {
      sending.current = false;
    }
    if (sent && readOutbox().length) void send();
  }, [show]);

  useEffect(() => {
    show(readLocal());
  }, [show]);

  useEffect(() => {
    savePref(KITCHEN_PREF, JSON.stringify(state));
  }, [state]);

  const pull = useCallback(async () => {
    const started = saves.current;
    const data = await fetch('/api/recipes/kitchen').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!data || saves.current !== started) return;
    me.current = data.household?.me;
    const nextHousehold: HouseholdInfo | null = data.household ?? null;
    setHousehold((prev) => (JSON.stringify(prev) === JSON.stringify(nextHousehold) ? prev : nextHousehold));
    if (data.kitchen) show(withUnsent(normalizeKitchen(data.kitchen)));
    else if (!isEmpty(current.current)) {
      // First sign-in: keep what this device has.
      fetch('/api/recipes/kitchen', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kitchen: current.current }),
      }).catch(() => {});
    }
  }, [show]);

  const catchUp = useCallback(() => {
    if (readOutbox().length) void send();
    else void pull();
  }, [send, pull]);

  // Something was added from outside this page (the launcher, the Today page).
  useEffect(() => {
    const onChanged = () => { if (signedIn) void pull(); else show(readLocal()); };
    window.addEventListener(KITCHEN_CHANGED, onChanged);
    return () => window.removeEventListener(KITCHEN_CHANGED, onChanged);
  }, [signedIn, pull, show]);

  useEffect(() => {
    if (!signedIn) return;
    void pull();
    if (readOutbox().length) void send(); // left over from the last visit
    const onVisible = () => {
      if (document.visibilityState === 'visible') catchUp();
      else if (timer.current) void send();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', catchUp);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', catchUp);
      if (timer.current) void send();
    };
  }, [signedIn, pull, send, catchUp]);

  // Only worth checking on its own when there's someone else to hear from, or an invite out.
  const listening = signedIn && ((household?.members.length ?? 0) > 1 || !!household?.invite);
  useEffect(() => {
    if (!listening) return;
    const handle = window.setInterval(() => { if (document.visibilityState === 'visible') catchUp(); }, REFRESH_MS);
    return () => window.clearInterval(handle);
  }, [listening, catchUp]);

  const dispatch = useCallback(
    (action: KitchenAction) => {
      show(applyKitchenAction(current.current, action));
      if (!signedIn) return;
      queueChange(action);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void send(), SYNC_DELAY_MS);
    },
    [signedIn, send, show],
  );

  /** Invite codes, joining and leaving. Returns what went wrong, if anything. */
  const householdOp = useCallback(async (op: HouseholdOp, code?: string): Promise<string | null> => {
    await send(); // changes still on their way belong to the household they were made in
    try {
      const res = await fetch('/api/chores/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.success) return body.message || 'That didn’t work.';
      await pull();
      return null;
    } catch {
      return 'Network error. Try again.';
    }
  }, [send, pull]);

  const actions = useMemo(() => ({
    toggleHave: (key: string) => dispatch({ type: 'have', key, on: !current.current.have.includes(key) }),
    addToPlan: (week: DateKey, recipeId: string, servings: number, day: number | null) =>
      dispatch({ type: 'plan-add', week, entry: { id: newKitchenId(), recipeId, servings, day } }),
    updateEntry: (week: DateKey, id: string, patch: Partial<PlanEntry>) => dispatch({ type: 'plan-change', week, ids: [id], patch }),
    removeEntry: (week: DateKey, id: string) => dispatch({ type: 'plan-remove', week, id }),
    markCooked: (week: DateKey, ids: string[]) => dispatch({ type: 'plan-change', week, ids, patch: { cooked: true } }),
    copyWeek: (from: DateKey, to: DateKey) =>
      dispatch({
        type: 'plan-copy',
        week: to,
        entries: (current.current.plans[from] || []).map((e) => ({ id: newKitchenId(), recipeId: e.recipeId, servings: e.servings, day: e.day })),
      }),
    addListRecipe: (recipeId: string, servings: number) => dispatch({ type: 'list-recipe', recipeId, servings }),
    removeListRecipe: (recipeId: string) => dispatch({ type: 'list-recipe-remove', recipeId }),
    addListItem: (text: string) => dispatch({ type: 'list-item', id: newKitchenId(), text, by: me.current }),
    removeListItem: (id: string) => dispatch({ type: 'list-item-remove', id }),
    toggleGot: (key: string) => dispatch({ type: 'got', key, on: !current.current.got.includes(key) }),
    /** Done shopping: empty the basket and the typed items, leave the plan alone. */
    finishShopping: () => {
      const { listItems, listRecipes, got } = current.current;
      dispatch({ type: 'list-clear', items: listItems.map((i) => i.id), recipes: listRecipes.map((r) => r.recipeId), got });
    },
  }), [dispatch]);

  return { state, household, householdOp, ...actions };
}
