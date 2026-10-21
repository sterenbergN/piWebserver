'use client';

import { useEffect, useMemo, useState } from 'react';
import { COACH_ICON } from '@/components/workout/health/CoachCard';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import { fullCoach, profileFromUser } from '@/lib/workout/coach';
import type { TrainingWorkout } from '@/lib/workout/training-coach';
import type { PublicHealth } from '@/lib/workout/health';

const SNOOZE_PREF = 'workout:coachSnoozed';
const SNOOZE_MS = 14 * 86_400_000;

function readSnoozed(): Record<string, number> {
  try { return JSON.parse(readPref(SNOOZE_PREF) || '{}') || {}; } catch { return {}; }
}

/**
 * The coach's top point on the home screen: the most important thing to work
 * on and its first step. "Got it" hides that point for two weeks; it comes
 * back if it's still true.
 */
export default function CoachHomeCard({ history, health, user }: { history: TrainingWorkout[]; health: PublicHealth | null; user?: Record<string, any> | null }) {
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  useEffect(() => { setSnoozed(readSnoozed()); }, []);

  const all = useMemo(() => {
    return fullCoach({ history, health, profile: profileFromUser(user) }).insights.filter((i) => i.tone === 'warn');
  }, [history, health, user]);
  const now = Date.now();
  const top = all.find((i) => !(snoozed[i.id] > now));
  if (!top) return null;
  const more = all.filter((i) => i !== top && !(snoozed[i.id] > now)).length;

  const gotIt = () => {
    const next = { ...readSnoozed(), [top.id]: Date.now() + SNOOZE_MS };
    savePref(SNOOZE_PREF, JSON.stringify(next));
    setSnoozed(next);
  };

  return (
    <section className="workout-tile coach-home" aria-label="Coach">
      <div className="coach-home-head">
        <span className="coach-home-kicker"><span aria-hidden>{COACH_ICON[top.category]}</span> Coach</span>
        {more > 0 && <span className="workout-hint">+{more} more</span>}
      </div>
      <strong className="coach-home-title">{top.title}</strong>
      {(top.steps?.[0] || top.tip) && <p className="coach-home-step">{top.steps?.[0] || top.tip}</p>}
      <div className="coach-home-actions">
        <button type="button" className="workout-text-btn" onClick={gotIt}>Got it</button>
        <a className="workout-text-btn" href="/workout/analytics?tab=coach">All advice ›</a>
      </div>
    </section>
  );
}
