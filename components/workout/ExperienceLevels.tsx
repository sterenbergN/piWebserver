'use client';

import type { ExperienceResult } from '@/lib/workout/analytics';

type Level = ExperienceResult['level'];

/** What each lifter level looks like, and how to train at it. Levels are every 2 points of score. */
export const EXPERIENCE_LEVELS: { level: Level; symbol: string; range: string; looks: string; train: string[] }[] = [
  {
    level: 'Beginner', symbol: '⚪', range: 'under 2',
    looks: 'Still learning the lifts. Strength goes up almost every session because your nervous system is learning to use the muscle you have.',
    train: [
      '2–3 full-body sessions a week',
      'Add weight every session while reps stay clean',
      'Stop 2–3 reps short of failure; form first',
      'No planned deloads needed yet',
    ],
  },
  {
    level: 'Novice', symbol: '🟢', range: '2–4',
    looks: 'Lifts are solid and you train regularly. Simple linear progress still works, but some sessions start to stall.',
    train: [
      '3–4 sessions a week (full body or upper/lower)',
      'About 10–12 hard sets per muscle a week',
      'Add weight week to week; repeat a weight when reps fall short',
      'Deload when the same lift stalls twice in a row',
    ],
  },
  {
    level: 'Intermediate', symbol: '🔵', range: '4–6',
    looks: 'Strong for your bodyweight with months of steady training. Progress comes month to month, not session to session.',
    train: [
      'Double progression: hit the top of the rep range, then add weight',
      'Vary the week: a heavy day and a lighter, higher-rep day per lift',
      '12–16 hard sets per muscle a week',
      'Planned deload every 5–8 weeks',
    ],
  },
  {
    level: 'Advanced', symbol: '🟣', range: '6–8',
    looks: 'Years of consistent training and well above average strength. Gains are measured across whole training blocks.',
    train: [
      'Run blocks: build volume for a few weeks, then go heavier',
      'Bring up weak points with extra sets for lagging muscles',
      '14–20 hard sets per muscle a week, effort tracked closely (RIR)',
      'Deload every 4–6 weeks; sleep and food matter as much as the plan',
    ],
  },
  {
    level: 'Elite', symbol: '🟡', range: '8+',
    looks: 'Close to your ceiling for strength relative to bodyweight. Small gains take careful programming.',
    train: [
      'Periodize around goals or meets, with peaking phases',
      'Recovery is the limit: sleep, nutrition and stress decide progress',
      'Fewer, better sets near your limits; lots of easy technique work',
      'Watch for nagging joints, and back off early',
    ],
  },
];

/** The five lifter levels, with yours highlighted, and what goes into the score. */
export default function ExperienceLevels({ current, score, breakdown }: { current: Level; score: number; breakdown?: ExperienceResult['breakdown'] | null }) {
  return (
    <div className="xp-levels">
      <p className="workout-hint" style={{ margin: 0 }}>
        Your score ({score.toFixed(2)}) is 20% time training + 30% consistency (sessions a week) + 30% strength (best squat, bench and deadlift vs bodyweight) + 20% progression (typical % gained a month).
      </p>
      {breakdown && (
        <div className="xp-breakdown">
          {([['Time', breakdown.time], ['Consistency', breakdown.consistency], ['Strength', breakdown.strength], ['Progression', breakdown.progression]] as const).map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{value.toFixed(2)}</strong></div>
          ))}
        </div>
      )}
      <ol className="xp-level-list">
        {EXPERIENCE_LEVELS.map((l) => (
          <li key={l.level} className={l.level === current ? 'is-current' : ''} aria-current={l.level === current ? 'true' : undefined}>
            <div className="xp-level-head">
              <strong>{l.symbol} {l.level}</strong>
              <span>score {l.range}{l.level === current ? ' · you' : ''}</span>
            </div>
            <p>{l.looks}</p>
            <ul>{l.train.map((t) => <li key={t}>{t}</li>)}</ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
