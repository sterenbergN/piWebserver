'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { STAGES, type Stage, type Topic } from '@/lib/skills/types';
import type { TopicStats } from '@/lib/skills/model';
import { fmtLevel } from '../api';
import { ErrorNote, LevelPicker, LevelScale, StateChip } from '../Ui';
import { useAct, type TabProps } from './shared';

// The topics tab: rate yourself on every topic at once, or work through them by
// stage (reorder, edit, test, delete), and add new ones.

type Act = ReturnType<typeof useAct>['act'];

export default function Topics({ data, reload }: TabProps) {
  const { subject, stats } = data;
  const { act, busy, error, setError } = useAct(data, reload);
  const [rating, setRating] = useState(false);

  return (
    <>
      <section className="sk-card">
        <div className="sk-card-head">
          <h2>{rating ? 'Rate yourself' : 'Topics'}</h2>
          {subject.topics.length > 0 && (
            <button type="button" className="sk-small-btn" aria-pressed={rating} onClick={() => { setRating(!rating); setError(''); }}>
              {rating ? 'Back to the list' : 'Rate yourself'}
            </button>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {subject.topics.length === 0 && <p className="sk-empty">No topics yet. Add the first one below, or <Link href={`/skills/${subject.id}/plan`}>plan the subject with AI</Link>.</p>}
        {rating && subject.topics.length > 0
          ? <RateForm data={data} act={act} busy={busy} onDone={() => setRating(false)} />
          : STAGES.map((st) => {
            const rows = subject.topics.filter((t) => t.stage === st.stage);
            if (!rows.length) return null;
            return (
              <div key={st.stage} className="sk-stage">
                <h3>{st.name}</h3>
                <ul className="sk-rows">
                  {rows.map((t) => (
                    <TopicRow key={t.id} topic={t} stats={stats.topics.find((x) => x.topicId === t.id)} subjectId={subject.id}
                      first={subject.topics[0] === t} last={subject.topics[subject.topics.length - 1] === t} act={act} busy={busy} />
                  ))}
                </ul>
              </div>
            );
          })}
      </section>
      {!rating && <AddTopic act={act} busy={busy} />}
    </>
  );
}

function RateForm({ data, act, busy, onDone }: { data: TabProps['data']; act: Act; busy: boolean; onDone: () => void }) {
  const topics = data.subject.topics;
  const [values, setValues] = useState<Record<string, number | null>>(() => Object.fromEntries(topics.map((t) => [t.id, t.selfRating ?? null])));
  const changed = topics.filter((t) => (values[t.id] ?? null) !== (t.selfRating ?? null));

  async function save() {
    const ratings = Object.fromEntries(changed.map((t) => [t.id, values[t.id] ?? null]));
    if (!changed.length || await act('rate-topics', { ratings })) onDone();
  }

  return (
    <>
      <p className="sk-hint">Be honest. A rating is where each topic starts before you’re tested, and it fades over time until a test backs it up.</p>
      <details className="sk-scale-help">
        <summary>What do the levels mean?</summary>
        <LevelScale />
      </details>
      <ul className="sk-rows">
        {topics.map((t) => (
          <li key={t.id} className="sk-rate-row">
            <span className="sk-rate-name">{t.name}{!t.core && <span className="sk-optional">optional</span>}</span>
            <LevelPicker label={`Your level in ${t.name}`} value={values[t.id] ?? undefined} onChange={(v) => setValues({ ...values, [t.id]: v })} />
          </li>
        ))}
      </ul>
      <div className="sk-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : changed.length ? `Save ${changed.length} rating${changed.length === 1 ? '' : 's'}` : 'Save ratings'}</button>
        <button type="button" className="sk-text-btn" onClick={onDone}>Cancel</button>
      </div>
    </>
  );
}

function TopicRow({ topic, stats, subjectId, first, last, act, busy }: { topic: Topic; stats?: TopicStats; subjectId: string; first: boolean; last: boolean; act: Act; busy: boolean }) {
  const { confirm, popup } = useSitePopup();
  const [editing, setEditing] = useState(false);
  const live = stats?.liveItems ?? 0;

  async function remove() {
    const ok = await confirm({
      title: `Delete ${topic.name}?`,
      message: `This also deletes ${live ? `its ${live} question${live === 1 ? '' : 's'}` : 'any questions on it'} and every answer you’ve given. This can’t be undone.`,
      confirmLabel: 'Delete topic',
      danger: true,
    });
    if (ok) await act('remove-topic', { topicId: topic.id });
  }

  if (editing) return <li className="sk-topic-edit"><TopicEditor topic={topic} act={act} busy={busy} onDone={() => setEditing(false)} /></li>;

  return (
    <li className="sk-topic-card">
      <div className="sk-topic-main">
        <div className="sk-topic-name">
          <strong>{topic.name}</strong>
          {!topic.core && <span className="sk-optional">optional</span>}
        </div>
        {topic.description && <p className="sk-hint">{topic.description}</p>}
        <div className="sk-topic-meta">
          {stats && <><strong className="sk-num">{fmtLevel(stats.level)}</strong><StateChip state={stats.state} /></>}
          <span className="sk-muted">{topic.selfRating !== undefined ? `you rated it ${topic.selfRating}` : 'not rated'}</span>
          <span className="sk-muted">{live} question{live === 1 ? '' : 's'}</span>
          {!!stats?.dueItems && <span className="sk-due">{stats.dueItems} due</span>}
        </div>
      </div>
      <div className="sk-row-actions">
        <button type="button" className="sk-small-btn" disabled={busy || first} aria-label={`Move ${topic.name} up`} onClick={() => act('move-topic', { topicId: topic.id, direction: 'up' })}>↑</button>
        <button type="button" className="sk-small-btn" disabled={busy || last} aria-label={`Move ${topic.name} down`} onClick={() => act('move-topic', { topicId: topic.id, direction: 'down' })}>↓</button>
        {live > 0 && <Link className="sk-small-btn" href={`/skills/review?subject=${subjectId}&topic=${topic.id}`}>Test me</Link>}
        <Link className="sk-small-btn" href={`/skills/${subjectId}/questions?topics=${topic.id}`}>Write questions</Link>
        <button type="button" className="sk-text-btn" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="sk-text-btn is-danger" onClick={remove}>Delete</button>
      </div>
      {popup}
    </li>
  );
}

function TopicEditor({ topic, act, busy, onDone }: { topic: Topic; act: Act; busy: boolean; onDone: () => void }) {
  const [name, setName] = useState(topic.name);
  const [stage, setStage] = useState<Stage>(topic.stage);
  const [core, setCore] = useState(topic.core);
  const [description, setDescription] = useState(topic.description ?? '');
  const [notes, setNotes] = useState(topic.notes ?? '');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await act('edit-topic', { topicId: topic.id, changes: { name, stage, core, description, notes } })) onDone();
  }

  return (
    <form className="sk-inline-form" onSubmit={save}>
      <div className="sk-grid-2">
        <label className="sk-field"><span>Name</span><input value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} /></label>
        <label className="sk-field"><span>Stage</span>
          <select value={stage} onChange={(e) => setStage(Number(e.target.value) as Stage)}>
            {STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.stage}. {s.name}</option>)}
          </select>
        </label>
      </div>
      <label className="sk-check"><input type="checkbox" checked={core} onChange={(e) => setCore(e.target.checked)} /> Core topic <small>(optional topics count half toward your level)</small></label>
      <label className="sk-field"><span>Description</span><textarea rows={2} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="sk-field"><span>Your notes</span><textarea rows={3} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="sk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="sk-text-btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function AddTopic({ act, busy }: { act: Act; busy: boolean }) {
  const [name, setName] = useState('');
  const [stage, setStage] = useState<Stage>(2);
  const [core, setCore] = useState(true);
  const [description, setDescription] = useState('');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await act('add-topic', { name, stage, core, description })) {
      setName('');
      setDescription('');
    }
  }

  return (
    <form className="sk-card" onSubmit={add}>
      <h2>Add a topic</h2>
      <div className="sk-grid-2">
        <label className="sk-field"><span>Name</span><input value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} placeholder="e.g. Root locus" /></label>
        <label className="sk-field"><span>Stage</span>
          <select value={stage} onChange={(e) => setStage(Number(e.target.value) as Stage)}>
            {STAGES.map((s) => <option key={s.stage} value={s.stage}>{s.stage}. {s.name}</option>)}
          </select>
        </label>
      </div>
      <label className="sk-check"><input type="checkbox" checked={core} onChange={(e) => setCore(e.target.checked)} /> Core topic <small>(optional topics count half toward your level)</small></label>
      <label className="sk-field"><span>Description</span><textarea rows={2} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} placeholder="What it covers, in a line or two" /></label>
      <div className="sk-actions"><button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>Add topic</button></div>
    </form>
  );
}
