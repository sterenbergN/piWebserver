import type { Metadata } from 'next';
import Link from 'next/link';
import { benchLink, CONTROLLER_GROUPS, KIND_HINT, metaOf } from '@/lib/loop-lab/catalog';
import { defaultController, isAvailable, type ControllerKind } from '@/lib/loop-lab/controllers';
import type { ProcessId } from '@/lib/loop-lab/model';
import { getProcess, PROCESSES } from '@/lib/loop-lab/processes';
import { defaultExperiment } from '@/lib/loop-lab/setup';

const SHOWN_ON: Partial<Record<ControllerKind, ProcessId>> = {
  schedule: 'tank', characterized: 'tank', feedforward: 'hx', cascade: 'hx', smith: 'feeder', override: 'hx', ratio: 'blend',
  statefb: 'crane', multiloop: 'mixing', mpc: 'mixing', adrc: 'batch', adaptive: 'batch',
};

export const metadata: Metadata = {
  title: 'Controllers · Loop Lab',
  description: 'The controller ladder, from on-off and PID to state feedback, MPC and ADRC: the theory, when each one works, how to tune it and how to implement it.',
};

export default function ControllersPage() {
  return (
    <div className="ll ll-index">
      <header className="ll-title">
        <h1>The Controller Ladder</h1>
        <p>
          From the simplest thing that could work to multi-variable model predictive control.
          Climb only as far as the process and performance requirements demand.
        </p>
      </header>

      {CONTROLLER_GROUPS.map((g) => (
        <section key={g.label} className="ll-section">
          <div className="ll-section-head">
            <h2>{g.label}</h2>
            <span className="ll-small">{g.kinds.length} controller{g.kinds.length === 1 ? '' : 's'}</span>
          </div>

          <div className="ll-ctrl-ladder-grid">
            {g.kinds.map((kind) => {
              const meta = metaOf(kind);
              const hint = KIND_HINT[kind];
              const compatible = PROCESSES.filter((p) => isAvailable(p, kind));
              const sampleProc = SHOWN_ON[kind] ?? compatible[0]?.id ?? 'flow';
              const sampleExp = { ...defaultExperiment(sampleProc), controller: defaultController(kind, getProcess(sampleProc)) };

              return (
                <article key={kind} className="ll-ctrl-ladder-card">
                  <div className="ll-ctrl-ladder-header">
                    <span className="ll-rung-badge" aria-hidden>{meta.rung}</span>
                    <span className="ll-ctrl-icon" aria-hidden>{meta.icon}</span>
                    <div className="ll-ctrl-ladder-titles">
                      <h3>
                        <Link href={`/loop-lab/controllers/${kind}`}>{meta.name}</Link>
                      </h3>
                      <span className="ll-badge">
                        {compatible.length} compatible plant{compatible.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  <p className="ll-ctrl-hint">{hint}</p>

                  <div className="ll-ctrl-actions">
                    <Link className="ll-btn is-small" href={`/loop-lab/controllers/${kind}`}>
                      Theory &amp; tuning →
                    </Link>
                    <Link className="ll-btn is-small is-primary" href={benchLink(sampleExp)}>
                      Try on bench
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
