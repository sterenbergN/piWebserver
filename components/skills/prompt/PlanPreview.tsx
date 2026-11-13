'use client';

import { useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { RESOURCE_LABEL, STAGES, type Subject } from '@/lib/skills/types';
import type { ParsedPlan } from '@/lib/skills/parse';

// What a pasted plan says, before anything is saved: topics by stage and resources
// with a tick each, and the roadmap. The page owns the ticks; this only draws them.

export type RoadmapChoice = true | false | 'append';

export function PlanPreview({
  plan, subject, offTopics, offResources, onToggleTopic, onToggleResource, roadmap, onRoadmap,
}: {
  plan: ParsedPlan;
  subject: Pick<Subject, 'topics' | 'roadmap'>;
  offTopics: Set<string>;
  offResources: Set<number>;
  onToggleTopic: (key: string) => void;
  onToggleResource: (index: number) => void;
  roadmap: RoadmapChoice;
  onRoadmap: (choice: RoadmapChoice) => void;
}) {
  const [showRoadmap, setShowRoadmap] = useState(false);
  const topicName = (key: string) => {
    if (key.startsWith('existing:')) return subject.topics.find((t) => t.id === key.slice(9))?.name;
    return plan.topics.find((t) => t.key === key)?.name;
  };
  const hasRoadmap = !!subject.roadmap?.trim();

  return (
    <section className="sk-card" aria-live="polite">
      <h2>What it suggests</h2>
      {plan.summary && <p className="sk-pp-summary">{plan.summary}</p>}
      {plan.warnings.length > 0 && <ul className="sk-pp-warnings">{plan.warnings.map((w, i) => <li key={i} className="sk-warning">{w}</li>)}</ul>}

      <h3>Topics</h3>
      {plan.topics.length === 0 && <p className="sk-hint">No topics in this reply.</p>}
      {STAGES.map(({ stage, name }) => {
        const list = plan.topics.filter((t) => t.stage === stage);
        if (!list.length) return null;
        return (
          <div key={stage} className="sk-pp-group">
            <h4>{stage} · {name}</h4>
            <ul className="sk-pp-list">
              {list.map((t) => (
                <li key={t.key} className={`sk-pp-row${t.existingId ? ' is-have' : ''}`}>
                  {t.existingId ? <span className="sk-pp-have">Already have</span> : (
                    <input type="checkbox" checked={!offTopics.has(t.key)} onChange={() => onToggleTopic(t.key)} aria-label={`Add ${t.name}`} />
                  )}
                  <div className="sk-pp-body">
                    <strong>{t.name}</strong>
                    {!t.core && <span className="sk-chip">Optional</span>}
                    {t.description && <p className="sk-hint">{t.description}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <h3>Books, courses and projects</h3>
      {plan.resources.length === 0 && <p className="sk-hint">No resources in this reply.</p>}
      <ul className="sk-pp-list">
        {plan.resources.map((r, i) => {
          const tied = r.topicKeys.map(topicName).filter((n): n is string => !!n);
          const meta = RESOURCE_LABEL[r.kind];
          return (
            <li key={i} className={`sk-pp-row${r.existingId ? ' is-have' : ''}`}>
              {r.existingId ? <span className="sk-pp-have">Already have</span> : (
                <input type="checkbox" checked={!offResources.has(i)} onChange={() => onToggleResource(i)} aria-label={`Add ${r.title}`} />
              )}
              <div className="sk-pp-body">
                <strong><span aria-hidden>{meta.icon}</span> {r.title}</strong>
                <span className="sk-pp-meta">{meta.label}{r.author ? ` · ${r.author}` : ''}{r.hours ? ` · about ${r.hours} h` : ''}</span>
                {r.detail && <p className="sk-hint">{r.detail}</p>}
                {tied.length > 0 && <span className="sk-chips">{tied.map((n) => <span key={n} className="sk-chip">{n}</span>)}</span>}
              </div>
            </li>
          );
        })}
      </ul>

      {plan.roadmap && (
        <>
          <h3>Roadmap</h3>
          <button type="button" className="sk-text-btn" aria-expanded={showRoadmap} onClick={() => setShowRoadmap(!showRoadmap)}>{showRoadmap ? 'Hide the roadmap' : 'Read the roadmap'}</button>
          {showRoadmap && <div className="sk-pp-roadmap"><MathText>{plan.roadmap}</MathText></div>}
          {hasRoadmap ? (
            <div className="sk-pp-choices" role="radiogroup" aria-label="What to do with your roadmap">
              {([[true, 'Replace the roadmap you have'], ['append', 'Add it below the old one'], [false, 'Keep the old one']] as const).map(([value, label]) => (
                <label key={String(value)}><input type="radio" name="sk-roadmap" checked={roadmap === value} onChange={() => onRoadmap(value)} /> {label}</label>
              ))}
            </div>
          ) : (
            <label className="sk-pp-choices"><input type="checkbox" checked={roadmap === true} onChange={(e) => onRoadmap(e.target.checked)} /> Save the roadmap</label>
          )}
        </>
      )}
    </section>
  );
}
