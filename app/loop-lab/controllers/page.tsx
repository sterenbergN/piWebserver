import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTROLLER_GROUPS, KIND_HINT, metaOf } from '@/lib/loop-lab/catalog';

export const metadata: Metadata = {
  title: 'Controllers · Loop Lab',
  description: 'The controller ladder, from on-off and PID to state feedback, MPC and ADRC: the theory, when each one works, how to tune it and how to implement it.',
};

export default function ControllersPage() {
  return (
    <div className="ll ll-index">
      <header className="ll-title">
        <h1>The controller ladder</h1>
        <p>From the simplest thing that could work to the most it could cost you. Climb only as far as the process asks.</p>
      </header>
      {CONTROLLER_GROUPS.map((g) => (
        <section key={g.label} className="ll-section">
          <div className="ll-section-head"><h2>{g.label}</h2></div>
          <div className="ll-rows is-2">
            {g.kinds.map((kind) => {
              const k = metaOf(kind);
              return (
                <Link key={kind} className="ll-row" href={`/loop-lab/controllers/${kind}`}>
                  <span className="ll-rung" aria-hidden>{k.rung}</span>
                  <span className="ll-row-text"><strong>{k.name}</strong><span>{KIND_HINT[kind]}</span></span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
