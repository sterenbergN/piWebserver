'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Confetti from '@/components/habits/Confetti';

// The end of a review session: how it went, by subject and topic, and what to do next.

export type Outcome = { id: string; title: string; subjectId: string; subjectName: string; subjectIcon: string; topicName: string; right: boolean };

export default function SessionSummary({ outcomes, subjectId, subjectName, onKeepGoing }: {
  outcomes: Outcome[];
  subjectId?: string;
  subjectName?: string;
  onKeepGoing: () => void;
}) {
  const right = outcomes.filter((o) => o.right).length;
  const pct = outcomes.length ? right / outcomes.length : 0;
  const [fire, setFire] = useState(0);
  useEffect(() => { if (outcomes.length >= 3 && pct >= 0.8) setFire(1); }, [outcomes.length, pct]);

  // subject → topic → outcomes
  const groups = new Map<string, { name: string; icon: string; topics: Map<string, Outcome[]> }>();
  for (const o of outcomes) {
    const g = groups.get(o.subjectId) ?? { name: o.subjectName, icon: o.subjectIcon, topics: new Map() };
    g.topics.set(o.topicName, [...(g.topics.get(o.topicName) ?? []), o]);
    groups.set(o.subjectId, g);
  }

  return (
    <section className="sk-card sk-summary" aria-live="polite">
      <Confetti fire={fire} />
      <h2>{outcomes.length === 0 ? 'That’s the queue' : pct >= 0.8 ? 'Nicely done' : 'Session done'}</h2>
      {outcomes.length === 0 ? (
        <p className="sk-hint">You skipped everything, so nothing counted this time.</p>
      ) : (
        <p className="sk-summary-score"><strong>{right}</strong> of {outcomes.length} right <span>({Math.round(pct * 100)}%)</span></p>
      )}

      {[...groups.entries()].map(([id, g]) => (
        <div key={id} className="sk-summary-group">
          <h3>{g.icon} {g.name}</h3>
          <ul>
            {[...g.topics.entries()].map(([topic, list]) => (
              <li key={topic}>
                <span>{topic}</span>
                <span className="sk-summary-count">{list.filter((o) => o.right).length}/{list.length}</span>
                {list.some((o) => !o.right) && (
                  <ul className="sk-summary-misses">
                    {list.filter((o) => !o.right).map((o) => <li key={o.id}>✗ {o.title}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="sk-actions">
        <Link href="/skills" className="btn btn-primary">Back to Skills</Link>
        <button type="button" className="btn btn-secondary" onClick={onKeepGoing}>Keep going</button>
        {subjectId && <Link href={`/skills/${subjectId}`} className="btn btn-secondary">See {subjectName ?? 'the subject'}</Link>}
      </div>
    </section>
  );
}
