'use client';

import { useMemo, useState } from 'react';
import { diagnoseOscillation, steadyStretch, type Oscillation } from '@/lib/loop-lab/oscillation';
import type { ProcessDef } from '@/lib/loop-lab/model';
import { plantSummary } from '@/lib/loop-lab/plant';
import { runScenario, type Run } from '@/lib/loop-lab/sim';
import type { Experiment } from '@/lib/loop-lab/setup';
import { fmt } from './Chart';

const HEADLINE: Record<Oscillation['verdict'], string> = {
  none: 'Not cycling',
  stuck: 'Not cycling, but the output creeps while the PV sits still',
  stiction: 'Cycling: it looks like a sticky valve',
  linear: 'Cycling: a linear cycle (tuning, or something outside the loop)',
  unclear: 'Cycling: the signs are mixed',
};
const TONE: Record<Oscillation['verdict'], string> = { none: 'good', stuck: 'warn', stiction: 'bad', linear: 'warn', unclear: 'warn' };

/** A diagnosis in words: the verdict, the reasons, and what to try. */
export function OscillationReport({ d, label }: { d: Oscillation; label?: string }) {
  return (
    <div className="ll-osc">
      <p className={`ll-verdict-line is-${TONE[d.verdict]}`} role="status" style={{ fontSize: '0.95rem', margin: '0.4rem 0' }}>
        <span className="ll-dot" />
        {label && <strong>{label}: </strong>}{HEADLINE[d.verdict]}
        {d.verdict !== 'none' && Number.isFinite(d.period) && ` (every ${fmt(d.period, 3)} s)`}
      </p>
      <ul className="ll-small" style={{ margin: '0.2rem 0 0.4rem', paddingLeft: '1.1rem' }}>
        {d.evidence.map((e) => <li key={e}>{e}</li>)}
      </ul>
      {d.next && <p className="ll-note" style={{ marginTop: 0 }}>{d.next}</p>}
    </div>
  );
}

/** The run's longest stretch with a steady setpoint, diagnosed. */
export function diagnoseRun(proc: ProcessDef, exp: Experiment, run: Run) {
  const s = steadyStretch(run.trace.sp);
  const integrating = plantSummary(proc, exp.params)?.integrating ?? false;
  return diagnoseOscillation(run.trace.pv.subarray(s.from, s.to), run.trace.cv.subarray(s.from, s.to), run.Ts, { integrating, unit: proc.pv.unit });
}

/** What halving the gain did, read the way the field test is. */
function halvedReading(before: Oscillation, after: Oscillation) {
  if (after.verdict === 'stuck') return { tone: 'bad', text: 'With half the gain the valve has stuck where it stopped, and the output is creeping towards its next slip: still stiction, only slower. Retuning trades how often for how long; it can’t stop it.' };
  if (after.verdict === 'none') return { tone: 'good', text: 'With half the gain the cycle dies away: it was the tuning. Too much gain for this loop (or too little integral time).' };
  const pr = after.period / before.period, sr = after.pvSwing / Math.max(before.pvSwing, 1e-12);
  const sizes = `period ${fmt(before.period, 3)} → ${fmt(after.period, 3)} s, size ${fmt(before.pvSwing, 3)} → ${fmt(after.pvSwing, 3)}`;
  if (pr > 1.2 && sr > 0.6) return { tone: 'bad', text: `With half the gain it still cycles, slower and about as big (${sizes}): the stiction signature. Retuning trades how often for how long; it can’t stop it.` };
  if (pr > 0.85 && pr < 1.15) return { tone: 'warn', text: `With half the gain it keeps its period (${sizes}): the cycle comes from outside the loop, so look for where it starts.` };
  return { tone: 'warn', text: `With half the gain the cycle changes (${sizes}) but doesn't go away: more than one cause, perhaps.` };
}

/**
 * Is the selected run cycling, and why: the diagnosis from its PV and output, and the field test
 * (halve the gain, run it again) for a PID.
 */
export default function OscillationPanel({ proc, exp, run }: { proc: ProcessDef; exp: Experiment; run: Run }) {
  const d = useMemo(() => diagnoseRun(proc, exp, run), [proc, exp, run]);
  const key = JSON.stringify([exp, run.scenario.id]);
  const [halved, setHalved] = useState<{ key: string; d: Oscillation } | null>(null);
  const canHalve = exp.controller.kind === 'pid';
  const halve = () => {
    if (exp.controller.kind !== 'pid') return;
    const pid = exp.controller.pid;
    const half: Experiment = { ...exp, controller: { ...exp.controller, pid: { ...pid, Kc: pid.Kc / 2 } } };
    const r = runScenario(proc, { params: half.params, controller: half.controller, seed: 1 }, run.scenario);
    setHalved({ key, d: diagnoseRun(proc, half, r) });
  };
  const after = halved?.key === key ? halved.d : null;
  const reading = after && d.verdict !== 'none' ? halvedReading(d, after) : null;
  return (
    <details className="ll-more">
      <summary>
        Is it cycling? Why?{d.verdict !== 'none' && d.verdict !== 'stuck' && <span className={`ll-badge is-${d.verdict === 'stiction' ? 'bad' : 'warn'}`} style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}>cycling every {fmt(d.period, 3)} s</span>}
      </summary>
      <p className="ll-note">
        Read from the PV and the controller output over this test&apos;s longest stretch with a steady setpoint, the way you would on a
        plant trend: the shapes of the two waves, and how they line up. The same check takes a CSV from the plant on the Identify tab.
      </p>
      <OscillationReport d={d} />
      {d.verdict !== 'none' && canHalve && (
        <>
          <div className="ll-actions" style={{ margin: '0.4rem 0' }}>
            <button className="ll-btn is-small" onClick={halve}>Halve the gain and run this test again</button>
          </div>
          {reading && (
            <p className={`ll-verdict-line is-${reading.tone}`} role="status" style={{ fontSize: '0.92rem', margin: '0.4rem 0' }}>
              <span className="ll-dot" />{reading.text}
            </p>
          )}
        </>
      )}
    </details>
  );
}
