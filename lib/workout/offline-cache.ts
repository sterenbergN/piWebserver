// Offline-first reads for the workout pages: every successful GET of workout
// data (gyms, workout types, history, programs, goals, your login) is kept in
// localStorage, and when the server can't be reached (no signal in the gym,
// Pi rebooting) the last copy is used instead. Writes still go to the server;
// finished workouts that can't be saved go to the offline queue.

const PREFIX = 'wcache:';

type Cached<T> = { at: number; data: T };

function read<T>(url: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + url);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(url: string, data: unknown) {
  try {
    localStorage.setItem(PREFIX + url, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage full: the page works, just not offline.
  }
}

/**
 * GET JSON, falling back to the last good copy when offline. `offline` is true
 * when the cached copy (or nothing) was returned because the network failed.
 * A reachable server's answer is always returned as-is (e.g. "logged out").
 */
export async function fetchWorkoutJson<T = any>(url: string, { timeoutMs = 6000 } = {}): Promise<{ data: T | null; offline: boolean; cachedAt?: number }> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, { signal: controller?.signal });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (response.ok && data && data.success !== false) write(url, data);
    return { data, offline: false };
  } catch {
    const cached = read<T>(url);
    return { data: cached?.data ?? null, offline: true, cachedAt: cached?.at };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Forget cached workout data (on logout, so the next person can't see it). */
export function clearWorkoutCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing cached or storage unavailable.
  }
}
