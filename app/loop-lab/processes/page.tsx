import type { Metadata } from 'next';
import Link from 'next/link';
import { benchOn, PROCESS_GROUPS } from '@/lib/loop-lab/catalog';

export const metadata: Metadata = {
  title: 'Processes · Loop Lab',
  description: 'The plants in Loop Lab: flow loops, tanks, heat exchangers, reactors, a crane, a flexible drive and more, each with its own quirks.',
};

export default function ProcessesPage() {
  return (
    <div className="ll ll-index">
      <header className="ll-title">
        <h1>Processes</h1>
        <p>Each one is a real piece of plant with its own quirks. Read how it behaves, or put a controller on it.</p>
      </header>
      {PROCESS_GROUPS.map((g) => (
        <section key={g.label} className="ll-section">
          <div className="ll-section-head"><h2>{g.label}</h2></div>
          <div className="ll-tiles">
            {g.list.map((p) => (
              <article key={p.id} className="ll-tile">
                <h3><span aria-hidden>{p.icon}</span> <Link href={`/loop-lab/processes/${p.id}`}>{p.name}</Link></h3>
                <p>{p.summary}</p>
                <Link className="ll-tile-go" href={benchOn(p.id)}>Open on the bench</Link>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
