'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { cleanStreak, plateView, type PlateItem } from '@/lib/study/plan';
import { Icon } from './Icon';
import type { usePlan } from './usePlan';

// Today's plate: the stack, what's on it, and the ways to deal with it. The stack
// is meant to push her along, not make her dread opening the page, so it always
// offers a way out: spread the pile, or take the day off.

const Confetti = dynamic(() => import('@/components/habits/Confetti'), { ssr: false });

/** Most pancakes drawn; past this the stack says how many more. */
const MAX_DRAWN = 14;
const COLORS: Record<number, [string, string]> = {
  0: ['#e0a95c', '#f3cf8e'],
  1: ['#dba355', '#efc985'],
  2: ['#c4a57c', '#dcc4a0'],
  3: ['#a59a8a', '#c2b9ab'],
};

/** A stack of pancakes that leans further and goes colder the longer the pile has sat. */
export function PancakeStack({ count, cold = 0, clean = false }: { count: number; cold?: number; clean?: boolean }) {
  const shown = clean ? 1 : Math.min(count, MAX_DRAWN);
  const [edge, top] = COLORS[cold] ?? COLORS[0];
  const height = 34 + Math.max(shown, 3) * 11;
  const lean = cold * 1.4;
  const label = clean ? 'A clean plate, with butter and syrup' : count ? `A stack of ${count} pancake${count === 1 ? '' : 's'}${cold >= 2 ? ', gone cold' : ''}` : 'An empty plate';
  return (
    <svg className={`sd-stack is-cold-${cold}${clean ? ' is-clean' : ''}`} viewBox={`0 0 120 ${height}`} role="img" aria-label={label}>
      <ellipse cx="60" cy={height - 8} rx="56" ry="7" fill="var(--surface-border)" />
      <ellipse cx="60" cy={height - 10} rx="46" ry="4.5" fill="var(--surface-hover)" />
      <g className="sd-stack-cakes">
        {Array.from({ length: shown }, (_, i) => {
          // A fixed zigzag, so the stack doesn't jump around between renders.
          const shift = ((i * 7) % 5 - 2) * (1 + lean * 0.8) + (i * lean) / 2;
          const y = height - 22 - i * 11;
          return (
            <g key={i} transform={`translate(${shift} 0)`}>
              <rect x="20" y={y} width="80" height="12" rx="6" fill={edge} />
              <rect x="25" y={y} width="70" height="5.5" rx="2.75" fill={top} />
            </g>
          );
        })}
        {count > MAX_DRAWN && !clean && <text x="60" y="13" textAnchor="middle" className="sd-stack-more">+{count - MAX_DRAWN}</text>}
        {clean && (
          <>
            <path className="sd-syrup" d={`M38 ${height - 21} q10 -3 22 -1 t24 0 q2 4 -2 5 q-3 8 -6 0 q-8 1 -14 0 q-2 11 -6 0 q-8 1 -14 -2 z`} fill="#b5651d" opacity="0.85" />
            <rect className="sd-butter" x="50" y={height - 27} width="20" height="8" rx="1.5" fill="#fff0a8" />
          </>
        )}
      </g>
    </svg>
  );
}

function Row({ item, onEat, busy, lead }: { item: PlateItem; onEat: (id: string, count: number) => void; busy: boolean; lead: boolean }) {
  const count = item.pile + item.today;
  return (
    <li className="sd-plate-row">
      <span className="sd-test-main">
        <strong>{item.task.title}</strong>
        <small>{[item.deadline?.title, item.pile ? `${item.pile} from earlier` : ''].filter(Boolean).join(' · ') || 'No date'}</small>
      </span>
      <span className="sd-actions">
        <button type="button" className={`btn ${lead ? 'btn-primary' : 'btn-secondary'} sd-eat`} disabled={busy} onClick={() => onEat(item.task.id, 1)} aria-label={`Eat one pancake of ${item.task.title}, ${count} on your plate`}>
          <Icon name="pancake" /> Eat{count > 1 ? ` 1 of ${count}` : ''}
        </button>
        {count > 1 && <button type="button" className="hb-small-btn" disabled={busy} onClick={() => onEat(item.task.id, count)}>All</button>}
      </span>
    </li>
  );
}

export default function Plate({ planner, compact = false, quiet = false }: { planner: ReturnType<typeof usePlan>; compact?: boolean; quiet?: boolean }) {
  const { data, post, today } = planner;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fire, setFire] = useState(0);
  const [lastEaten, setLastEaten] = useState<{ id: string; title: string; count: number } | null>(null);
  const [spread, setSpread] = useState(0);
  if (!data) return null;

  const view = plateView(data.plan, today, data.reviewsDue);
  const streak = cleanStreak(data.plan, today);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onEat = (id: string, count: number) => run(async () => {
    const title = data.plan.tasks.find((t) => t.id === id)?.title ?? '';
    const body = await post('eat', { id, count });
    setLastEaten({ id, title, count });
    setSpread(0);
    if (body.cleaned) setFire((n) => n + 1);
  });
  const undo = () => run(async () => {
    if (!lastEaten) return;
    for (let i = 0; i < lastEaten.count; i++) await post('uneat', { id: lastEaten.id });
    setLastEaten(null);
  });
  const onSpread = () => run(async () => {
    const body = await post('spread');
    setSpread(body.moved ?? 0);
  });
  const dayOff = (on: boolean) => run(async () => {
    await post('day-off', { day: today, on });
    setLastEaten(null);
  });

  const headline = view.clean ? 'Clean plate'
    : view.dayOff && !view.total ? 'Day off'
      : view.total ? `${view.total} pancake${view.total === 1 ? '' : 's'} on your plate`
        : 'Nothing on your plate';
  const detail = view.clean ? 'That’s everything for today. You can stop here.'
    : view.dayOff && !view.total ? 'Today’s pancakes moved to the coming days. Enjoy it.'
      : view.pile ? `${view.pile} from earlier, ${view.today + view.reviews} for today.`
        : view.total ? 'One at a time.'
          : view.eatenToday ? 'You’re done for today.' : 'Enjoy the quiet, or add some work to your plan.';
  const shown = compact ? view.items.slice(0, 3) : view.items;

  return (
    <section className={`sd-card sd-plate${compact ? ' is-compact' : ''}${view.clean ? ' is-clean' : ''}`} aria-label="Today’s plate">
      <Confetti fire={fire} />
      <div className="sd-plate-top">
        <PancakeStack count={view.total} cold={view.cold} clean={view.clean} />
        <div className="sd-plate-text">
          <h2>{headline}</h2>
          <p className="hb-hint">{detail}</p>
          {streak > 0 && <p className="sd-streak"><Icon name="flame" /> {streak} clean plate{streak === 1 ? '' : 's'} in a row</p>}
        </div>
      </div>

      {view.total > 0 && view.eatenToday > 0 && (
        <div className="sd-plate-progress">
          <div className="progress" role="progressbar" aria-label="Eaten today" aria-valuemin={0} aria-valuemax={view.total + view.eatenToday} aria-valuenow={view.eatenToday}>
            <div style={{ width: `${(view.eatenToday / (view.total + view.eatenToday)) * 100}%` }} />
          </div>
          <small>{view.eatenToday} of {view.total + view.eatenToday} today</small>
        </div>
      )}

      {view.pile > 0 && (
        <div className={`sd-pile is-cold-${view.cold}`}>
          <span>{view.cold >= 3 ? 'This pile has gone cold.' : view.cold === 2 ? 'The pile is getting wobbly.' : 'A few left from earlier.'}</span>
          <button type="button" className="hb-small-btn" disabled={busy} onClick={onSpread}>Spread the pile</button>
        </div>
      )}
      {spread > 0 && <p className="sd-outcome"><Icon name="check" /> {spread} pancake{spread === 1 ? '' : 's'} spread over the coming days.</p>}
      {error && <p className="sd-warning" role="alert">{error}</p>}

      {(shown.length > 0 || view.reviews > 0) && (
        <ul className="sd-plate-list">
          {view.reviews > 0 && (
            <li className="sd-plate-row">
              <span className="sd-test-main">
                <strong>Review your misses</strong>
                <small>{data.reviewsDue} question{data.reviewsDue === 1 ? '' : 's'} due · {view.reviews} pancake{view.reviews === 1 ? '' : 's'}</small>
              </span>
              <Link className={`btn ${quiet ? 'btn-secondary' : 'btn-primary'} sd-eat`} href="/study/review">Review now</Link>
            </li>
          )}
          {shown.map((item, i) => <Row key={item.task.id} item={item} onEat={onEat} busy={busy} lead={!quiet && i === 0 && !view.reviews} />)}
        </ul>
      )}
      {compact && view.items.length > shown.length && <Link className="sd-more" href="/study">{view.items.length - shown.length} more on your plate <Icon name="right" /></Link>}

      {lastEaten && (
        <p className="sd-undo">
          <span>Ate {lastEaten.count > 1 ? `${lastEaten.count} of ` : ''}{lastEaten.title}.</span>{' '}
          <button type="button" className="hb-text-btn" disabled={busy} onClick={undo}>Undo</button>
        </p>
      )}

      <div className="sd-plate-foot">
        {view.dayOff
          ? <button type="button" className="hb-text-btn" disabled={busy} onClick={() => dayOff(false)}>Studying after all</button>
          : !view.clean && view.today > 0 && <button type="button" className="hb-text-btn" disabled={busy} onClick={() => dayOff(true)}>Take today off</button>}
        {compact ? <Link className="sd-more" href="/study">Open PA Today <Icon name="right" /></Link> : <Link className="sd-more" href="/study/plan">Open your plan <Icon name="right" /></Link>}
      </div>
    </section>
  );
}
