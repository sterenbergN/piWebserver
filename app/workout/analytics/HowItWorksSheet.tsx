'use client';

import { useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import IntensitySlider from '@/components/workout/IntensitySlider';
import { getTargetRir } from '@/lib/workout/progression';
import EngineExplainer from './EngineExplainer';
import { EXPERIENCE_LEVELS } from '@/components/workout/ExperienceLevels';

type HowItWorksProps = {
  user: any;
  isDemo: boolean;
  experience: { symbol: string; level: string; score: number; breakdown: { time: number; consistency: number; strength: number; progression: number }; progressPctPerMonth?: number | null } | null;
  calibrations: { gymId: string; liftKey: string; scaleFactor?: number; confidence?: number; stationType?: string; updatedAt?: string }[];
  gymNames: Map<string, string>;
  onClose: () => void;
  onIntensitySaved: (value: number) => void;
};

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Settings and explanations that used to fill the analytics tabs. */
export default function HowItWorksSheet({ user, isDemo, experience, calibrations, gymNames, onClose, onIntensitySaved }: HowItWorksProps) {
  const [intensity, setIntensity] = useState<number>(user?.intensityFactor ?? 1);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [section, setSection] = useState<string | null>('engine');

  const saveIntensity = async () => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/workout/auth', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intensityFactor: intensity }) });
      if (!res.ok) throw new Error();
      onIntensitySaved(intensity);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const toggle = (key: string) => setSection((prev) => (prev === key ? null : key));

  return (
    <Sheet title="How it works" subtitle="Settings and the maths behind the numbers" onClose={onClose}>
      {!isDemo && (
        <div className="workout-tile">
          <IntensitySlider title="Default workout intensity" prominent value={intensity} onChange={(value) => { setIntensity(value); setSaveState('idle'); }} />
          <p className="workout-hint">Aims for RIR {getTargetRir(intensity)} on most lifts. You can still change it per workout in the tracker&apos;s Details.</p>
          <button type="button" className="workout-button is-primary is-block" disabled={saveState === 'saving' || intensity === (user?.intensityFactor ?? 1)} onClick={saveIntensity}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? 'Try again' : 'Save default'}
          </button>
        </div>
      )}

      <Section title="Progression engine" open={section === 'engine'} onToggle={() => toggle('engine')}>
        <EngineExplainer intensityFactor={intensity} />
      </Section>

      {experience && (
        <Section title={`Lifter level: ${experience.symbol} ${experience.level}`} open={section === 'level'} onToggle={() => toggle('level')}>
          <p className="workout-hint" style={{ marginTop: 0 }}>Score {experience.score.toFixed(2)} = 20% time training + 30% consistency + 30% strength (vs bodyweight) + 20% progression.</p>
          <p className="workout-hint">
            Progression is your typical strength gain per month
            {typeof experience.progressPctPerMonth === 'number' ? ` (now ${experience.progressPctPerMonth > 0 ? '+' : ''}${experience.progressPctPerMonth}%/month)` : ' (needs a few more weeks of history)'},
            comparing each lift&apos;s last three sessions with three from at least three weeks earlier. Each lift&apos;s first three sessions are skipped, since the app starts light while it finds your level.
          </p>
          <div className="an-review">
            <div><span>Time</span><strong>{experience.breakdown.time.toFixed(2)}</strong></div>
            <div><span>Consistency</span><strong>{experience.breakdown.consistency.toFixed(2)}</strong></div>
            <div><span>Strength</span><strong>{experience.breakdown.strength.toFixed(2)}</strong></div>
            <div><span>Progression</span><strong>{experience.breakdown.progression.toFixed(2)}</strong></div>
          </div>
          <p className="workout-hint">Levels: {EXPERIENCE_LEVELS.map((l) => `${l.level} ${l.range}`).join(' · ')}. What each means for your training is on the workout home page, under Experience Profile.</p>
        </Section>
      )}

      <Section title={`Machine calibration (${calibrations.length})`} open={section === 'calibration'} onToggle={() => toggle('calibration')}>
        <p className="workout-hint" style={{ marginTop: 0 }}>
          The same weight on two gyms&apos; machines rarely feels the same. After you do a lift on a stack or cable machine at a new gym, its numbers are scaled against your other gym so trends and suggestions stay comparable.
          If two lifts should share a calibration, make them the same exercise (Configuration → Your exercises).
        </p>
        {calibrations.length === 0 ? <p className="workout-hint">None yet.</p> : (
          <div className="workout-stack">
            {calibrations.map((c) => (
              <div key={`${c.gymId}|${c.liftKey}`} className="an-session">
                <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
                  <strong>{titleCase(c.liftKey)}</strong>
                  <span>×{Number(c.scaleFactor || 1).toFixed(2)}</span>
                </div>
                <span className="workout-hint">{gymNames.get(c.gymId) || 'Unknown gym'} · {Math.round((c.confidence || 0) * 100)}% confident{c.updatedAt ? ` · ${new Date(c.updatedAt).toLocaleDateString()}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {!isDemo && (
        <Section title="Export your data" open={section === 'export'} onToggle={() => toggle('export')}>
          <p className="workout-hint" style={{ marginTop: 0 }}>A CSV with one row per logged set, for spreadsheets or other apps.</p>
          <a className="workout-button is-block" href="/api/workout/export">Download CSV</a>
        </Section>
      )}
    </Sheet>
  );
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="an-section">
      <button type="button" className="an-section-head" aria-expanded={open} onClick={onToggle}>
        <span>{title}</span>
        <span className={`workout-chevron${open ? ' is-open' : ''}`} aria-hidden>›</span>
      </button>
      {open && <div className="an-section-body animate-fade-in">{children}</div>}
    </div>
  );
}
