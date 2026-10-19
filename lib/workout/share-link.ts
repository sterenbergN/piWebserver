// Client helpers for sharing a workout by link.

/** Open the phone's share sheet for a link, or copy it. Returns what happened. */
export async function shareLink(url: string, title: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard?.writeText(url).catch(() => {});
  return 'copied';
}

/** Create a share link for a saved workout (history id) or one just finished (its save payload). */
export async function createWorkoutLink(body: { historyId: string } | { workout: unknown }) {
  const res = await fetch('/api/workout/shared-workouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || 'Could not create the link');
  return `${window.location.origin}/workout/shared-workout?token=${data.token}`;
}
