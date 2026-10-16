'use client';

import { formatClock } from '@/lib/workout/tracker-utils';
import type { useRestTimer } from './hooks';

/** Counts up from the last set to the rest target; ±15s and sound on/off. */
export default function RestTimer({ rest }: { rest: ReturnType<typeof useRestTimer> }) {
  if (!rest.visible) return null;
  return (
    <div className={`tracker-rest${rest.done ? ' done' : ''}`} role="timer" aria-live="polite">
      <div className="workout-flex-between" style={{ fontSize: '0.8rem', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span>{rest.done ? 'Rested — go!' : 'Resting'}</span>
        <span className="tracker-rest-controls">
          <button type="button" aria-label="Rest 15 seconds less" onClick={() => rest.adjust(-15)}>−15</button>
          <strong>{formatClock(rest.elapsed)} / {formatClock(rest.target)}</strong>
          <button type="button" aria-label="Rest 15 seconds more" onClick={() => rest.adjust(15)}>+15</button>
          <button type="button" aria-label={rest.sound ? 'Turn rest sound off' : 'Turn rest sound on'} aria-pressed={rest.sound} onClick={rest.toggleSound}>{rest.sound ? '🔔' : '🔕'}</button>
        </span>
      </div>
      <div className="tracker-rest-bar"><div style={{ width: `${Math.min(100, (rest.elapsed / rest.target) * 100)}%` }} /></div>
    </div>
  );
}
