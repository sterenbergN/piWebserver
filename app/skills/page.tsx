'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { skillsGet, SignedOut, type BoardResponse, fmtLevel } from '@/components/skills/api';
import { ConfidenceChip, ErrorNote, LevelBar, LevelScale, LevelText, Loading, SignedOutCard, TierBadge } from '@/components/skills/Ui';
import { TIER_LABEL, type NextStepKind, type SubjectCard, type Tier } from '@/lib/skills/model';
import { STATUS_LABEL, SUBJECT_STATUSES, type SubjectStatus } from '@/lib/skills/types';

// The skill board: where I stand (who's the SME), what to do next, and every
// subject by area. Filter and sort are remembered on this device only.

const TIERS: Tier[] = ['sme', 'proficient', 'competent', 'developing', 'not-started'];
const STEP_ICON: Record<NextStepKind, string> = {
  review: '🔁', plan: '🗺️', rate: '🎚️', practice: '🎯', refresh: '🍂', 'test-yourself': '✅', write: '✍️', resource: '📚', 'find-material': '🔎',
};
const EXAMPLES = ['Rocket propulsion', 'PID tuning', 'Thermodynamics', 'TIA Portal', 'Python', 'Public speaking'];

type StatusFilter = 'all' | SubjectStatus;
type SortKey = 'level' | 'gap' | 'name' | 'tested';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'gap', label: 'Furthest from target' },
  { key: 'name', label: 'Name' },
  { key: 'tested', label: 'Last tested' },
];
const FILTER_KEY = 'skills:board:status';
const SORT_KEY = 'skills:board:sort';

function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch { /* no storage: use the default */ }
  return fallback;
}
function remember(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* fine without it */ }
}

function sorter(sort: SortKey) {
  return (a: SubjectCard, b: SubjectCard) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'level') return b.level - a.level || a.name.localeCompare(b.name);
    if (sort === 'gap') return (b.target - b.level) - (a.target - a.level) || a.name.localeCompare(b.name);
    return (b.lastTested ?? '').localeCompare(a.lastTested ?? '') || a.name.localeCompare(b.name);
  };
}

function daysSince(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((today - then) / 86400000));
}
function testedText(day?: string) {
  if (!day) return 'never tested';
  const n = daysSince(day);
  return n === 0 ? 'tested today' : n === 1 ? 'tested yesterday' : `last tested ${n} days ago`;
}

function Chips({ names, kind }: { names: string[]; kind: 'strong' | 'weak' | 'fading' }) {
  if (!names.length) return null;
  const label = kind === 'strong' ? 'Strong' : kind === 'weak' ? 'Weak' : 'Fading';
  return (
    <span className="sk-chips sk-board-topics" aria-label={`${label} topics`}>
      {names.slice(0, 3).map((n) => <span key={n} className={`sk-chip is-${kind}`}>{n}</span>)}
      {names.length > 3 && <span className="sk-chip">+{names.length - 3}</span>}
    </span>
  );
}

function Card({ s }: { s: SubjectCard }) {
  const facts = [
    s.due > 0 ? `${s.due} due` : null,
    `${s.topics} topic${s.topics === 1 ? '' : 's'}`,
    s.resources.total > 0 ? `${s.resources.done}/${s.resources.total} resources done` : null,
    testedText(s.lastTested),
  ].filter(Boolean);
  return (
    <li>
      <Link href={`/skills/${s.id}`} className="sk-board-card">
        <span className="sk-board-card-top">
          <span className="sk-board-icon" aria-hidden>{s.icon}</span>
          <span className="sk-board-name">{s.name}</span>
        </span>
        <span className="sk-board-meta">
          <span className="sk-board-status">{STATUS_LABEL[s.status]}</span>
          <TierBadge tier={s.tier} />
        </span>
        <LevelBar level={s.level} fitted={s.fitted} target={s.target} />
        <span className="sk-board-level">
          <LevelText level={s.level} />
          <ConfidenceChip confidence={s.confidence} />
        </span>
        <span className="sk-hint">{facts.join(' · ')}</span>
        <Chips names={s.strong} kind="strong" />
        <Chips names={s.weak} kind="weak" />
        <Chips names={s.fading} kind="fading" />
      </Link>
    </li>
  );
}

function HowLevelsWork() {
  return (
    <details className="sk-card sk-board-how">
      <summary>How levels work</summary>
      <LevelScale />
      <p className="sk-hint">Every question has a difficulty from 1 to 5. Your level for a topic is fitted to your answers, like a chess rating: it goes up when you get a hard one right and down when you miss one you should have got.</p>
      <p className="sk-hint">Knowledge fades if you don’t use it. Untouched topics slowly drop towards half their level (a hatched bar shows what was lost) until you’re tested again. A finished book or project counts as practice.</p>
      <p className="sk-hint">Confidence says how much a level is backed by answers: self-rated, some evidence, or verified. A subject’s level is the average of its topics, so breadth counts as well as depth.</p>
      <p className="sk-hint">The SME badge needs level 4 or more, most core topics at 3.5 or more, at least 10 answers, and a test in the last 90 days. Stop testing and it goes, which is the point.</p>
    </details>
  );
}

function Empty() {
  return (
    <section className="sk-card sk-board-empty">
      <h2>Map what you know</h2>
      <p className="sk-hint">Add the subjects you know, are learning or want to learn. Then three steps:</p>
      <ol className="sk-board-steps">
        <li><strong>Add a subject and plan it with AI.</strong> You get topics, books, courses and projects to get there.</li>
        <li><strong>Log what you read, take and build.</strong> Tie each one to the topics it teaches.</li>
        <li><strong>Get tested and watch your levels.</strong> Questions come back on a schedule, so you can see where you’re the expert.</li>
      </ol>
      <div className="sk-actions">
        <Link href="/skills/new" className="btn btn-primary">Add your first subject</Link>
      </div>
      <p className="sk-hint">Or start from an idea:</p>
      <div className="sk-chips">
        {EXAMPLES.map((e) => (
          <Link key={e} href={`/skills/new?name=${encodeURIComponent(e)}`} className="sk-chip sk-board-example">{e}</Link>
        ))}
      </div>
    </section>
  );
}

export default function SkillsBoardPage() {
  const [board, setBoard] = useState<BoardResponse['board'] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('level');

  useEffect(() => {
    // Restore after mount so server and client markup agree.
    setStatus(remembered<StatusFilter>(FILTER_KEY, ['all', ...SUBJECT_STATUSES], 'all'));
    setSort(remembered<SortKey>(SORT_KEY, SORTS.map((s) => s.key), 'level'));
    skillsGet<BoardResponse>()
      .then((r) => setBoard(r.board))
      .catch((e) => (e instanceof SignedOut ? setSignedOut(true) : setError(e instanceof Error ? e.message : 'Couldn’t load your skills.')));
  }, []);

  const shown = useMemo(() => (board ? board.subjects.filter((s) => status === 'all' || s.status === status).sort(sorter(sort)) : []), [board, status, sort]);
  const byTier = useMemo(() => {
    const map = new Map<Tier, SubjectCard[]>();
    for (const s of board?.subjects ?? []) map.set(s.tier, [...(map.get(s.tier) ?? []), s]);
    for (const list of map.values()) list.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    return map;
  }, [board]);

  if (signedOut) return <main className="sk sk-board"><SignedOutCard /></main>;
  if (error) return <main className="sk sk-board"><ErrorNote>{error}</ErrorNote></main>;
  if (!board) return <main className="sk sk-board"><Loading /></main>;

  const areas = board.areas.filter((a) => shown.some((s) => s.area === a));
  const stats = [
    { label: 'Questions due', value: board.due },
    { label: 'Answered today', value: board.answeredToday },
    { label: 'This week', value: board.answeredThisWeek },
    { label: 'Review streak', value: `${board.streak} day${board.streak === 1 ? '' : 's'}` },
  ];

  return (
    <main className="sk sk-board">
      <header className="sk-head">
        <div>
          <h1>Skills</h1>
          <p>What you know, what you’re learning, and where you’re the expert.</p>
        </div>
        <div className="sk-actions">
          <Link href="/skills/review" className="btn btn-primary">{board.due > 0 ? `Review (${board.due})` : 'Test me'}</Link>
          <Link href="/skills/new" className="btn btn-secondary">+ Add a subject</Link>
        </div>
      </header>

      {board.subjects.length === 0 ? <Empty /> : (
        <>
          <dl className="sk-board-stats">
            {stats.map((s) => (
              <div key={s.label}><dd>{s.value}</dd><dt>{s.label}</dt></div>
            ))}
          </dl>

          <section className="sk-card" aria-labelledby="sk-stand">
            <h2 id="sk-stand">Where you stand</h2>
            {TIERS.filter((t) => byTier.get(t)?.length).map((t) => (
              <div key={t} className="sk-board-tier">
                <TierBadge tier={t} />
                <span className="sk-visually-hidden">{TIER_LABEL[t]}:</span>
                <ul className="sk-board-pills">
                  {byTier.get(t)!.map((s) => (
                    <li key={s.id}>
                      <Link href={`/skills/${s.id}`} className="sk-board-pill">
                        <span aria-hidden>{s.icon}</span> {s.name} <strong>{fmtLevel(s.level)}</strong>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          {board.nextSteps.length > 0 && (
            <section className="sk-card" aria-labelledby="sk-next">
              <h2 id="sk-next">Next steps</h2>
              <ul className="sk-board-next">
                {board.nextSteps.map((n, i) => (
                  <li key={`${n.href}-${i}`}>
                    <Link href={n.href} className="sk-board-step">
                      <span className="sk-board-step-icon" aria-hidden>{STEP_ICON[n.kind]}</span>
                      <span><strong>{n.title}</strong><span className="sk-hint">{n.detail}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="sk-board-controls">
            <label className="sk-field">
              <span>Show</span>
              <select value={status} onChange={(e) => { const v = e.target.value as StatusFilter; setStatus(v); remember(FILTER_KEY, v); }}>
                <option value="all">All</option>
                {SUBJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="sk-field">
              <span>Sort by</span>
              <select value={sort} onChange={(e) => { const v = e.target.value as SortKey; setSort(v); remember(SORT_KEY, v); }}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {areas.length === 0 && <p className="sk-empty">No subjects with that status.</p>}
          {areas.map((area) => (
            <section key={area} aria-label={area} className="sk-board-area">
              <h2>{area}</h2>
              <ul className="sk-board-grid">
                {shown.filter((s) => s.area === area).map((s) => <Card key={s.id} s={s} />)}
              </ul>
            </section>
          ))}
        </>
      )}

      <HowLevelsWork />
    </main>
  );
}
