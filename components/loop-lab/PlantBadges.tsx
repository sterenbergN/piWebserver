import type { ProcessDef } from '@/lib/loop-lab/model';
import type { PlantSummary } from '@/lib/loop-lab/plant';

/**
 * What a plant's step response is like, and what the lab found PID does on it. The first is a fact
 * about dead time against lag (θ/τ) and says nothing about difficulty on its own: a fast servo with
 * no dead time to speak of still rings, and a reactor with a long lag can still run away. The second
 * is the verdict the lab files the plant under.
 */
export default function PlantBadges({ proc, summary }: { proc: ProcessDef; summary: PlantSummary | null }) {
  let shape: { text: string; title: string } | null = null;
  if (summary?.integrating) {
    shape = { text: 'Integrating', title: 'With the valve fixed it ramps instead of settling.' };
  } else if (summary && summary.tau > 0) {
    const ratio = summary.theta / summary.tau;
    const r = ratio.toFixed(2);
    shape = ratio < 0.2
      ? { text: `Lag-dominant · θ/τ ${r}`, title: 'Dead time short next to the time constant.' }
      : ratio <= 0.8
        ? { text: `Balanced · θ/τ ${r}`, title: 'Dead time and lag both matter.' }
        : { text: `Dead-time dominant · θ/τ ${r}`, title: 'The controller waits a long time for any answer.' };
  }
  // Your own identified plant has no verdict: that is what you are there to find out.
  const verdict = proc.id === 'custom' ? null : proc.family === 'pid-wins'
    ? <span className="ll-badge is-good" title="Filed under where PID is the answer">PID is the answer</span>
    : <span className="ll-badge is-warn" title="Filed under where PID falls short">PID falls short</span>;
  if (!shape && !verdict) return null;
  return (
    <div className="ll-plant-badges">
      {verdict}
      {shape && <span className="ll-badge" title={shape.title}>{shape.text}</span>}
    </div>
  );
}
