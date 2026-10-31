import Link from 'next/link';
import { DIFFICULTIES } from '@/lib/study/prompt';
import type { TestSummary } from '@/lib/study/study';

export const pct = (right: number, total: number) => (total ? Math.round((right / total) * 100) : 0);
export const fmtDay = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** One test in a list: where it came from, and how it went last. */
export function TestRow({ test }: { test: TestSummary }) {
  return (
    <li>
      <Link className="sd-test" href={`/study/tests/${test.id}`}>
        <span className="sd-test-main">
          <strong>{test.title}</strong>
          <small>{[test.course, `${test.count} question${test.count === 1 ? '' : 's'}`, test.difficulty ? DIFFICULTIES[test.difficulty - 1]?.label : '', fmtDay(test.createdAt)].filter(Boolean).join(' · ')}</small>
        </span>
        {test.open ? <span className="td-chip is-going">Continue · {test.open.answered}/{test.open.total}</span>
          : test.last ? <span className="sd-score">{pct(test.last.right, test.last.total)}%</span>
            : <span className="td-chip">Not taken</span>}
      </Link>
    </li>
  );
}
