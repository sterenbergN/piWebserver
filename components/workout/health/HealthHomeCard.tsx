'use client';

import './health.css';
import { useEffect, useMemo, useState } from 'react';
import ReadinessCard from './ReadinessCard';
import { fetchWorkoutJson } from '@/lib/workout/offline-cache';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import { formatMinutes, localKey, readiness, shiftKey } from '@/lib/workout/health-insights';
import type { PublicHealth } from '@/lib/workout/health';

/**
 * Apple Health on the workout home screen: today's readiness and last
 * night / yesterday at a glance, linking to the health page. Before it's set
 * up, a small prompt you can dismiss.
 */
export default function HealthHomeCard({ defaultIntensity, todayIntensity, onUseIntensity }: {
  defaultIntensity: number;
  todayIntensity: number | null;
  onUseIntensity: (value: number | null) => void;
}) {
  const [health, setHealth] = useState<PublicHealth | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(readPref('workout:healthPromptHidden') === '1');
    fetchWorkoutJson('/api/workout/health').then((res) => { if (res.data?.success) setHealth(res.data.health); });
  }, []);

  const today = localKey(new Date());
  const days = health?.days;
  const ready = useMemo(() => (days ? readiness(days, today, defaultIntensity) : null), [days, today, defaultIntensity]);
  if (!health) return null;

  if (Object.keys(health.days).length === 0) {
    if (dismissed || health.connected) return null;
    return (
      <a className="hc-connect" href="/workout/health?setup=1">
        <span aria-hidden>❤️</span>
        <span>
          <strong>Connect Apple Health</strong>
          <small>Readiness, Watch heart rate, sleep, steps and your scale — optional.</small>
        </span>
        <button type="button" className="workout-text-btn" onClick={(e) => { e.preventDefault(); savePref('workout:healthPromptHidden', '1'); setDismissed(true); }}>Not now</button>
      </a>
    );
  }

  const lastNight = health.days[today]?.sleep;
  const yesterday = health.days[shiftKey(today, 1)];
  const latestRhr = health.days[today]?.restingHr ?? yesterday?.restingHr;
  const steps = yesterday?.steps !== undefined ? `${yesterday.steps.toLocaleString()} steps yesterday` : null;
  // With readiness showing, sleep and resting HR are already in its tiles.
  const footer = (
    <a className="hc-ready-link" href="/workout/health">
      <span>{steps || 'Sleep, steps, heart and body trends'}</span>
      <strong>Health ›</strong>
    </a>
  );
  const stats = (
    <a className="hc-ready-link" href="/workout/health">
      <div className="hc-home-stats" style={{ flex: 1 }}>
        <div><span>Last night</span><strong>{lastNight ? formatMinutes(lastNight.asleepMin) : '—'}</strong></div>
        <div><span>Steps</span><strong>{yesterday?.steps !== undefined ? yesterday.steps.toLocaleString() : '—'}</strong></div>
        <div><span>Resting HR</span><strong>{latestRhr !== undefined ? `${latestRhr} bpm` : '—'}</strong></div>
      </div>
      <strong>Health ›</strong>
    </a>
  );

  return (
    <div className="hc-home">
      {ready ? (
        <ReadinessCard readiness={ready} compact todayIntensity={todayIntensity} onUseIntensity={onUseIntensity} footer={footer} />
      ) : (
        <section className="hc-ready is-compact">{stats}</section>
      )}
    </div>
  );
}
