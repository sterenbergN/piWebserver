import type { Metadata } from 'next';
import Link from 'next/link';
import { CASES } from '@/lib/loop-lab/content';
import { getProcess } from '@/lib/loop-lab/processes';

export const metadata: Metadata = {
  title: 'Case studies · Loop Lab',
  description: 'Worked control problems, from a flow loop where PI is the answer to a mixing tank that needs MPC, each ending in an honest verdict.',
};

const GROUPS = [
  { family: 'pid-wins', label: 'Where PID is the answer' },
  { family: 'escalation', label: 'Where PID falls short' },
] as const;

export default function CasesPage() {
  return (
    <div className="ll ll-index">
      <header className="ll-title">
        <h1>Case studies</h1>
        <p>Each one starts from a real question, tries the simple answer first, and ends in a verdict with the numbers behind it.</p>
      </header>
      {GROUPS.map((g) => (
        <section key={g.family} className="ll-section">
          <div className="ll-section-head"><h2>{g.label}</h2></div>
          <div className="ll-rows is-2">
            {CASES.filter((c) => c.family === g.family).map((c) => (
              <Link key={c.id} className="ll-row" href={`/loop-lab/cases/${c.id}`}>
                <span className="ll-row-mark" aria-hidden>{getProcess(c.process).icon}</span>
                <span className="ll-row-text"><strong>{c.title}</strong><span>{c.question}</span></span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
