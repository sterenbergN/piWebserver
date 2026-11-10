import type { Metadata } from 'next';
import Link from 'next/link';
import { benchOn, PROCESS_GROUPS } from '@/lib/loop-lab/catalog';
import { defaultSummary, type PlantSummary } from '@/lib/loop-lab/plant';

const fmt = (n: number, sig = 2) => (Number.isFinite(n) ? Number(n.toPrecision(sig)).toString() : '—');

export const metadata: Metadata = {
  title: 'Processes · Loop Lab',
  description: 'The plants in Loop Lab: flow loops, tanks, heat exchangers, reactors, a crane, a flexible drive and more, each with its own quirks.',
};

function ControllabilityBadge({ summary }: { summary: PlantSummary | null }) {
  if (!summary) {
    return <span className="ll-badge">User-defined model</span>;
  }
  if (summary.integrating) {
    return <span className="ll-badge is-warn">Integrating process</span>;
  }
  if (summary.tau <= 0) return null;
  const ratio = summary.theta / summary.tau;
  if (ratio < 0.2) {
    return (
      <span className="ll-badge is-good" title="Lag-dominant: straightforward for standard PI">
        θ/τ = {ratio.toFixed(2)} (Lag-dominant)
      </span>
    );
  }
  if (ratio <= 0.8) {
    return (
      <span className="ll-badge" title="Balanced lag and dead time">
        θ/τ = {ratio.toFixed(2)} (Balanced)
      </span>
    );
  }
  return (
    <span className="ll-badge is-warn" title="Dead-time dominant: difficult for standard PI">
      θ/τ = {ratio.toFixed(2)} (Dead-time dominant)
    </span>
  );
}

export default function ProcessesPage() {
  return (
    <div className="ll ll-index">
      <header className="ll-title">
        <h1>Processes</h1>
        <p>
          Each plant is a realistic physical system with distinct dynamics, non-linearities, and sensor noise.
          Inspect the mechanical and control blueprints, or experiment with controllers on the live bench.
        </p>
      </header>

      {PROCESS_GROUPS.map((g) => (
        <section key={g.label} className="ll-section">
          <div className="ll-section-head">
            <h2>{g.label}</h2>
            <span className="ll-small">{g.list.length} plant{g.list.length === 1 ? '' : 's'}</span>
          </div>

          <div className="ll-proc-grid">
            {g.list.map((p) => {
              const summary = defaultSummary(p);
              return (
                <article key={p.id} className="ll-proc-card">
                  <div className="ll-proc-card-head">
                    <span className="ll-proc-icon" aria-hidden>{p.icon}</span>
                    <div>
                      <h3 className="ll-proc-title">
                        <Link href={`/loop-lab/processes/${p.id}`}>{p.name}</Link>
                      </h3>
                      <span className="ll-proc-pv">{p.pv.label} ({p.pv.unit})</span>
                    </div>
                  </div>

                  <p className="ll-proc-desc">{p.summary}</p>

                  {summary ? (
                    <div className="ll-dynamics-strip">
                      <div className="ll-dynamics-item" title="Nominal dead time (theta)">
                        <span className="ll-dynamics-label">Dead time θ</span>
                        <span className="ll-dynamics-val">{fmt(summary.theta, 2)} s</span>
                      </div>
                      <div className="ll-dynamics-item" title="Nominal time constant (tau)">
                        <span className="ll-dynamics-label">Time const τ</span>
                        <span className="ll-dynamics-val">
                          {summary.integrating ? 'Integrating' : `${fmt(summary.tau, 2)} s`}
                        </span>
                      </div>
                      <div className="ll-dynamics-item" title="Process gain (K)">
                        <span className="ll-dynamics-label">Gain K</span>
                        <span className="ll-dynamics-val">
                          {summary.integrating ? `${fmt(summary.kPrime, 3)} /s` : fmt(summary.K, 2)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="ll-dynamics-strip is-custom">
                      <span className="ll-small">Import trend data or tune custom model parameters.</span>
                    </div>
                  )}

                  <div className="ll-proc-card-foot">
                    <ControllabilityBadge summary={summary} />
                    <div className="ll-proc-actions">
                      <Link className="ll-btn is-small" href={`/loop-lab/processes/${p.id}`}>
                        Read reference →
                      </Link>
                      <Link className="ll-btn is-small is-primary" href={benchOn(p.id)}>
                        🎛️ Bench
                      </Link>
                    </div>
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
