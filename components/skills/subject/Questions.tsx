'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { useSitePopup } from '@/components/SitePopup';
import type { Answer } from '@/lib/daily/types';
import type { Topic } from '@/lib/skills/types';
import { skillsGet, type ItemResponse, type ItemRow } from '../api';
import { ErrorNote } from '../Ui';
import { dueText, longDay, useAct, type TabProps } from './shared';

// The questions tab: everything written for this subject, filterable, with a
// peek at each question and its answer, plus a form for adding a card by hand.

type Act = ReturnType<typeof useAct>['act'];

function Dots({ n }: { n: number }) {
  return (
    <span className="sk-dots" role="img" aria-label={`Difficulty ${n} of 5`} title={`Difficulty ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'is-on' : ''} />)}
    </span>
  );
}

/** One line per part saying what the right answer is. */
function summarize(a: Answer): string {
  switch (a.type) {
    case 'numeric': return `${a.value}${a.unit ? ` ${a.unit}` : ''}${a.tolerance ? ` (within ${a.tolerance * 100}%)` : ''}`;
    case 'choice': return a.options[a.correct] ?? '';
    case 'multi': return a.correct.map((i) => a.options[i]).filter(Boolean).join('; ');
    case 'range': return `${a.min ?? '−∞'} to ${a.max ?? '∞'}`;
    case 'coefficients': return `numerator [${a.numerator.join(', ')}], denominator [${a.denominator.join(', ')}]`;
    case 'order': return a.items.join(' → ');
  }
}

export default function Questions({ data, reload }: TabProps) {
  const { subject, items, stats } = data;
  const { act, busy, error } = useAct(data, reload);
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'all' | 'graded' | 'card'>('all');
  const [showRetired, setShowRetired] = useState(false);
  const retired = items.filter((i) => i.retired).length;
  const shown = items.filter((i) => (!topic || i.topicId === topic) && (kind === 'all' || i.kind === kind) && (showRetired || !i.retired));

  return (
    <>
      <section className="sk-card">
        <div className="sk-card-head">
          <h2>Questions</h2>
          <Link className="btn btn-primary" href={`/skills/${subject.id}/questions`}>Write questions with AI</Link>
        </div>
        <p className="sk-hint">{stats.liveItems} live, {stats.due} due, {retired} retired. Retired ones are never asked and don’t count toward your level.</p>
        <label className="sk-weekly">
          <input type="checkbox" checked={!!subject.autoTopUp} disabled={busy} onChange={(e) => act('edit-subject', { changes: { autoTopUp: e.target.checked } })} />
          <span>
            <strong>Weekly questions</strong>
            <small>
              Each week, the question writer that makes the daily questions adds a few to topics running low on fresh ones, weakest and most faded first (up to 12 a week).
              {items.some((i) => i.source === 'weekly') ? ` ${items.filter((i) => i.source === 'weekly').length} so far.` : ''}
            </small>
          </span>
        </label>
        <div className="sk-filters">
          <label className="sk-field"><span>Topic</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">All topics</option>
              {subject.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="sk-field"><span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">All</option><option value="graded">Graded</option><option value="card">Cards</option>
            </select>
          </label>
          <label className="sk-check"><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired</label>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {shown.length === 0
          ? <p className="sk-empty">{items.length ? 'Nothing matches those filters.' : 'No questions yet. Write some with AI, or add a card by hand below.'}</p>
          : <ul className="sk-rows">{shown.map((row) => <QuestionRow key={row.id} row={row} topics={subject.topics} subjectId={subject.id} act={act} busy={busy} />)}</ul>}
      </section>
      {subject.topics.length > 0 && <AddCard topics={subject.topics} act={act} busy={busy} />}
    </>
  );
}

function QuestionRow({ row, topics, subjectId, act, busy }: { row: ItemRow; topics: Topic[]; subjectId: string; act: Act; busy: boolean }) {
  const { confirm, popup } = useSitePopup();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<ItemResponse | null>(null);
  const [problem, setProblem] = useState('');
  const topicName = topics.find((t) => t.id === row.topicId)?.name ?? 'No topic';

  async function view() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setProblem('');
    try { setDetail(await skillsGet<ItemResponse>({ item: row.id })); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'Couldn’t load that question.'); }
  }

  async function edit() {
    if (!detail) {
      try { setDetail(await skillsGet<ItemResponse>({ item: row.id })); }
      catch (e) { setProblem(e instanceof Error ? e.message : 'Couldn’t load that card.'); return; }
    }
    setEditing(true);
  }

  async function remove() {
    if (await confirm({ title: 'Delete this question?', message: 'It’s removed along with every answer you’ve given to it, which can change your level. This can’t be undone.', confirmLabel: 'Delete', danger: true })) {
      await act('remove-item', { itemId: row.id });
    }
  }

  const report = row.feedback?.report;

  return (
    <li className={`sk-q${row.retired ? ' is-retired' : ''}`}>
      <div className="sk-q-main">
        <div className="sk-q-title"><span aria-hidden>{row.kind === 'graded' ? '📝' : '🃏'}</span> <strong>{row.title}</strong>
          {row.retired && <span className="sk-chip">retired</span>}</div>
        <div className="sk-topic-meta">
          <span className="sk-muted">{row.kind === 'graded' ? 'Graded' : 'Card'}</span>
          <Dots n={row.difficulty} />
          <span className="sk-muted">{topicName}</span>
          <span className="sk-muted">{row.answers} answer{row.answers === 1 ? '' : 's'}</span>
          {row.lastScore !== null && <span className="sk-muted">last {Math.round(row.lastScore * 100)}%</span>}
          {!row.retired && <span className="sk-muted">{dueText(row.due)}</span>}
        </div>
        {report && <p className="sk-hint">Reported{report.note ? `: ${report.note}` : '.'}</p>}
      </div>
      <div className="sk-row-actions">
        <button type="button" className="sk-small-btn" aria-expanded={open} onClick={view}>{open ? 'Hide' : 'View'}</button>
        <button type="button" className="sk-small-btn" disabled={busy} onClick={() => act('retire-item', { itemId: row.id, retired: !row.retired })}>{row.retired ? 'Bring back' : 'Retire'}</button>
        {row.kind === 'card' && <button type="button" className="sk-text-btn" onClick={edit}>Edit</button>}
        <label className="sk-move">
          <span className="sk-sr">Move to topic</span>
          <select value="" disabled={busy} aria-label={`Move “${row.title}” to a topic`} onChange={(e) => e.target.value && act('move-item', { itemId: row.id, topicId: e.target.value })}>
            <option value="">Move to…</option>
            {topics.filter((t) => t.id !== row.topicId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button type="button" className="sk-text-btn is-danger" onClick={remove}>Delete</button>
      </div>
      {problem && <ErrorNote>{problem}</ErrorNote>}
      {editing && detail?.item.kind === 'card' && (
        <CardForm topics={topics} busy={busy} submitLabel="Save card" initial={{ topicId: detail.item.topicId, front: detail.item.front, back: detail.item.back, difficulty: detail.item.difficulty }}
          onSubmit={async (v) => { if (await act('save-card', { ...v, itemId: row.id })) { setEditing(false); setDetail(null); setOpen(false); } }} onCancel={() => setEditing(false)} />
      )}
      {open && !editing && (detail ? <Detail detail={detail} /> : !problem && <p className="sk-hint">Loading…</p>)}
      {popup}
    </li>
  );
}

function Detail({ detail }: { detail: ItemResponse }) {
  const { item, attempts } = detail;
  return (
    <div className="sk-q-detail">
      {item.kind === 'graded' ? (
        <>
          <MathText>{item.question.prompt}</MathText>
          <h4>Answer</h4>
          <ul className="sk-answers">
            {item.question.parts.map((p, i) => (
              <li key={p.id}>{item.question.parts.length > 1 && <strong>Part {i + 1}: </strong>}{p.prompt && <span className="sk-muted">{p.prompt} </span>}{summarize(p.answer)}</li>
            ))}
          </ul>
          <h4>Solution</h4>
          <MathText figures={item.question.solutionFigures} widgets={item.question.solutionWidgets}>{item.question.solution}</MathText>
        </>
      ) : (
        <>
          <h4>Front</h4>
          <MathText>{item.front}</MathText>
          <h4>Back</h4>
          <MathText>{item.back}</MathText>
        </>
      )}
      <h4>Recent attempts</h4>
      {attempts.length === 0 ? <p className="sk-hint">Not answered yet.</p> : (
        <ul className="sk-attempts">
          {attempts.slice(-8).reverse().map((a) => <li key={a.id}>{longDay(a.day)}: {Math.round(a.score * 100)}%{a.rating ? ` (${a.rating})` : ''}</li>)}
        </ul>
      )}
    </div>
  );
}

type CardValues = { topicId: string; front: string; back: string; difficulty: number };

function CardForm({ topics, initial, busy, submitLabel, onSubmit, onCancel }: {
  topics: Topic[]; initial?: CardValues; busy: boolean; submitLabel: string; onSubmit: (v: CardValues) => void | Promise<void>; onCancel?: () => void;
}) {
  const [topicId, setTopicId] = useState(initial?.topicId ?? topics[0]?.id ?? '');
  const [front, setFront] = useState(initial?.front ?? '');
  const [back, setBack] = useState(initial?.back ?? '');
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? 2);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void onSubmit({ topicId, front, back, difficulty });
  }

  return (
    <form className="sk-inline-form" onSubmit={submit}>
      <div className="sk-grid-2">
        <label className="sk-field"><span>Topic</span>
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="sk-field"><span>Difficulty</span>
          <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}{d === 1 ? ' (easy)' : d === 5 ? ' (hard)' : ''}</option>)}
          </select>
        </label>
      </div>
      <label className="sk-field"><span>Front</span><textarea rows={3} value={front} maxLength={3000} required onChange={(e) => setFront(e.target.value)} placeholder="The question or prompt" /><small>Markdown and $math$ both work.</small></label>
      <label className="sk-field"><span>Back</span><textarea rows={4} value={back} maxLength={6000} required onChange={(e) => setBack(e.target.value)} placeholder="The answer" /></label>
      <div className="sk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !front.trim() || !back.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="sk-text-btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function AddCard({ topics, act, busy }: { topics: Topic[]; act: Act; busy: boolean }) {
  const [round, setRound] = useState(0);
  return (
    <section className="sk-card">
      <h2>Add a card by hand</h2>
      <p className="sk-hint">For things you can say but not calculate, like how a turbopump works. You’ll rate yourself Again, Hard, Good or Easy when it comes up.</p>
      <CardForm key={round} topics={topics} busy={busy} submitLabel="Add card"
        onSubmit={async (v) => { if (await act('save-card', { ...v })) setRound(round + 1); }} />
    </section>
  );
}
