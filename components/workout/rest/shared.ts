'use client';

import { useSyncExternalStore } from 'react';
import { readPref, savePref } from '@/lib/workout/device-prefs';

// What the rest panel and its activities share: which activity this device
// picked, and whether one is part-way through (so a short rest still lets you
// finish it). Kept at module level, so it outlives the panel between rests.

export const ACTIVITIES = [
  { id: 'skills', icon: '🧠', label: 'Skills question' },
  { id: 'chess', icon: '♟️', label: 'Chess puzzle' },
  { id: 'math', icon: '🔢', label: 'Quick math' },
] as const;
export type Activity = (typeof ACTIVITIES)[number]['id'];
export type Choice = Activity | 'off';

const CHOICE_PREF = 'workout:restActivity';
const OPEN_PREF = 'workout:restActivityOpen';

export function readChoice(): Choice | null {
  const saved = readPref(CHOICE_PREF);
  return saved === 'off' || ACTIVITIES.some((a) => a.id === saved) ? (saved as Choice) : null;
}
export const saveChoice = (choice: Choice) => savePref(CHOICE_PREF, choice);
export const readOpen = () => readPref(OPEN_PREF) !== '0';
export const saveOpen = (open: boolean) => savePref(OPEN_PREF, open ? '1' : '0');

/**
 * Props every activity gets from the panel. An activity is only mounted while
 * it can be used: unmounted is paused, so each keeps its place at module level.
 */
export type ActivityProps = {
  /** Enough rest left to start something new (another puzzle, another sprint). */
  canStartNew: boolean;
  onSwitch: (to: Activity) => void;
  /** Optional callback fired when a puzzle or sprint result is recorded. */
  onResult?: () => void;
};

// ── Part-way through? ──
const busy: Record<Activity, boolean> = { skills: false, chess: false, math: false };
const listeners = new Set<() => void>();

export function setInProgress(activity: Activity, value: boolean) {
  if (busy[activity] === value) return;
  busy[activity] = value;
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useInProgress(activity: Activity | null) {
  return useSyncExternalStore(subscribe, () => (activity ? busy[activity] : false), () => false);
}

/** Read and write a JSON value in localStorage; never throws. */
export function readJsonPref<T>(key: string): T | null {
  try {
    const raw = readPref(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export function saveJsonPref(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else savePref(key, JSON.stringify(value));
  } catch { /* not remembered, still works */ }
}

export const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
