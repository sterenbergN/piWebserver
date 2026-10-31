'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { savePref } from '@/lib/workout/device-prefs';
import { addListItem, emptyKitchen, newKitchenId, type KitchenState, type PlanEntry } from '@/lib/recipes/kitchen';
import { isEmptyKitchen as isEmpty, KITCHEN_CHANGED, KITCHEN_PREF, readLocalKitchen as readLocal } from '@/lib/recipes/grocery-client';
import type { DateKey } from '@/lib/habits/dates';

const SYNC_DELAY_MS = 800;

export type Kitchen = ReturnType<typeof useKitchen>;

/**
 * What you have, your plans and your list: kept on the device and, once signed
 * in, in your account. The last change wins, and returning to the page picks up
 * anything changed on another device (unless a change here is still being sent).
 */
export function useKitchen(signedIn: boolean) {
  const [state, setState] = useState<KitchenState>(emptyKitchen);
  const dirty = useRef(false);
  const latest = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(() => {
    timer.current = null;
    dirty.current = false;
    fetch('/api/recipes/kitchen', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kitchen: latest.current }),
      keepalive: true,
    }).catch(() => {
      dirty.current = true; // still on this device; sent with the next change
    });
  }, []);

  useEffect(() => {
    setState(readLocal());
  }, []);

  useEffect(() => {
    latest.current = state;
    savePref(KITCHEN_PREF, JSON.stringify(state));
  }, [state]);

  const pull = useCallback(() => {
    fetch('/api/recipes/kitchen')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || dirty.current) return;
        if (data.kitchen) setState(data.kitchen);
        else if (!isEmpty(latest.current)) send(); // first sign-in: keep what this device has
      })
      .catch(() => {});
  }, [send]);

  // Something was added from outside this page (the launcher, the Today page).
  useEffect(() => {
    const onChanged = () => { if (signedIn) pull(); else setState(readLocal()); };
    window.addEventListener(KITCHEN_CHANGED, onChanged);
    return () => window.removeEventListener(KITCHEN_CHANGED, onChanged);
  }, [signedIn, pull]);

  useEffect(() => {
    if (!signedIn) return;
    pull();
    const catchUp = () => {
      if (dirty.current && !timer.current) send();
      else pull();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') catchUp();
      else if (timer.current) {
        clearTimeout(timer.current);
        send();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', catchUp);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', catchUp);
      if (timer.current) {
        clearTimeout(timer.current);
        send();
      }
    };
  }, [signedIn, pull, send]);

  const update = useCallback(
    (change: (k: KitchenState) => KitchenState) => {
      setState((prev) => change(prev));
      if (!signedIn) return;
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(send, SYNC_DELAY_MS);
    },
    [signedIn, send],
  );

  const actions = useMemo(() => {
    const setPlan = (week: DateKey, change: (entries: PlanEntry[]) => PlanEntry[]) =>
      update((k) => ({ ...k, plans: { ...k.plans, [week]: change(k.plans[week] || []) } }));
    return {
      toggleHave: (key: string) =>
        update((k) => ({ ...k, have: k.have.includes(key) ? k.have.filter((h) => h !== key) : [...k.have, key] })),
      addToPlan: (week: DateKey, recipeId: string, servings: number, day: number | null) =>
        setPlan(week, (entries) => [...entries, { id: newKitchenId(), recipeId, servings, day }]),
      updateEntry: (week: DateKey, id: string, patch: Partial<PlanEntry>) =>
        setPlan(week, (entries) => entries.map((e) => (e.id === id ? { ...e, ...patch } : e))),
      removeEntry: (week: DateKey, id: string) => setPlan(week, (entries) => entries.filter((e) => e.id !== id)),
      markCooked: (week: DateKey, ids: string[]) =>
        setPlan(week, (entries) => entries.map((e) => (ids.includes(e.id) ? { ...e, cooked: true } : e))),
      copyWeek: (from: DateKey, to: DateKey) =>
        update((k) => ({
          ...k,
          plans: { ...k.plans, [to]: (k.plans[from] || []).map((e) => ({ id: newKitchenId(), recipeId: e.recipeId, servings: e.servings, day: e.day })) },
        })),
      addListRecipe: (recipeId: string, servings: number) =>
        update((k) => ({ ...k, listRecipes: [...k.listRecipes.filter((r) => r.recipeId !== recipeId), { recipeId, servings }] })),
      removeListRecipe: (recipeId: string) =>
        update((k) => ({ ...k, listRecipes: k.listRecipes.filter((r) => r.recipeId !== recipeId) })),
      addListItem: (text: string) =>
        update((k) => addListItem(k, text)),
      removeListItem: (id: string) =>
        update((k) => ({ ...k, listItems: k.listItems.filter((i) => i.id !== id), got: k.got.filter((g) => g !== id) })),
      toggleGot: (key: string) =>
        update((k) => ({ ...k, got: k.got.includes(key) ? k.got.filter((g) => g !== key) : [...k.got, key] })),
      /** Done shopping: empty the basket and the typed items, leave the plan alone. */
      finishShopping: () =>
        update((k) => ({ ...k, got: [], listRecipes: [], listItems: [] })),
    };
  }, [update]);

  return { state, ...actions };
}
