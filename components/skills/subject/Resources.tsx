'use client';

import { useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { RESOURCE_KINDS, RESOURCE_LABEL, RESOURCE_STATUS_LABEL, RESOURCE_STATUSES, type Resource, type ResourceKind, type ResourceStatus, type Topic } from '@/lib/skills/types';
import { ErrorNote } from '../Ui';
import { AddFromReader, ReaderLine } from './ReaderLink';
import { longDay, useAct, type TabProps } from './shared';

// The resources tab: books, courses and projects grouped by where you are with
// them. Each card can be moved along, tracked, edited and deleted in place.

type Act = ReturnType<typeof useAct>['act'];

const UNITS = ['pages', 'chapters', 'lessons', 'videos', 'hours'];
const GROUPS: { status: ResourceStatus; title: string }[] = [
  { status: 'doing', title: 'In progress' },
  { status: 'planned', title: 'Planned' },
  { status: 'done', title: 'Done' },
];

export default function Resources({ data, reload }: TabProps) {
  const { subject } = data;
  const { act, busy, error } = useAct(data, reload);
  const dropped = subject.resources.filter((r) => r.status === 'dropped');

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {subject.resources.length === 0 && <p className="sk-empty">No books, courses or projects yet. Add one below, or plan the subject with AI to get a list.</p>}
      <div className="sk-actions"><AddFromReader resources={subject.resources} topics={subject.topics} act={act} busy={busy} /></div>
      {GROUPS.map((g) => {
        const rows = subject.resources.filter((r) => r.status === g.status);
        if (!rows.length) return null;
        return (
          <section key={g.status} className="sk-res-group" aria-label={g.title}>
            <h2>{g.title} <span className="sk-muted">{rows.length}</span></h2>
            {rows.map((r) => <ResourceCard key={r.id} resource={r} topics={subject.topics} act={act} busy={busy} />)}
          </section>
        );
      })}
      {dropped.length > 0 && (
        <details className="sk-res-group">
          <summary><h2>Dropped <span className="sk-muted">{dropped.length}</span></h2></summary>
          {dropped.map((r) => <ResourceCard key={r.id} resource={r} topics={subject.topics} act={act} busy={busy} />)}
        </details>
      )}
      <AddResource topics={subject.topics} act={act} busy={busy} />
    </>
  );
}

function ResourceCard({ resource: r, topics, act, busy }: { resource: Resource; topics: Topic[]; act: Act; busy: boolean }) {
  const { confirm, popup } = useSitePopup();
  const [editing, setEditing] = useState(false);
  const kind = RESOURCE_LABEL[r.kind];
  const names = r.topicIds.map((id) => topics.find((t) => t.id === id)?.name).filter(Boolean) as string[];
  const p = r.progress;
  const set = (status: ResourceStatus) => act('edit-resource', { resourceId: r.id, changes: { status } });
  const setDone = (done: number) => p && act('edit-resource', { resourceId: r.id, changes: { progress: { ...p, done: Math.max(0, Math.min(p.total, Math.round(done) || 0)) } } });

  async function remove() {
    if (await confirm({ title: `Delete ${r.title}?`, message: 'It’s removed from this subject. Your topics and questions aren’t touched.', confirmLabel: 'Delete', danger: true })) {
      await act('remove-resource', { resourceId: r.id });
    }
  }

  if (editing) {
    return (
      <article id={`r-${r.id}`} className="sk-card sk-res">
        <ResourceForm initial={r} topics={topics} busy={busy} submitLabel="Save"
          onSubmit={async (values) => { if (await act('edit-resource', { resourceId: r.id, changes: values })) setEditing(false); }}
          onCancel={() => setEditing(false)} />
      </article>
    );
  }

  return (
    <article id={`r-${r.id}`} className="sk-card sk-res">
      <div className="sk-card-head">
        <span className="sk-res-kind"><span aria-hidden>{kind.icon}</span> {kind.label}</span>
        <span className="sk-chip">{RESOURCE_STATUS_LABEL[r.status]}</span>
      </div>
      <h3 className="sk-res-title">
        {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : r.title}
      </h3>
      {r.author && <p className="sk-hint">{r.author}</p>}
      {r.detail && <p className="sk-res-detail">{r.detail}</p>}
      {names.length > 0 && <div className="sk-chips" aria-label="Topics it covers">{names.map((n) => <span key={n} className="sk-chip">{n}</span>)}</div>}
      {r.hours ? <p className="sk-hint">About {r.hours} hour{r.hours === 1 ? '' : 's'}</p> : null}
      {(r.readerBookId || ['book', 'paper', 'article', 'video', 'course', 'other'].includes(r.kind)) && <ReaderLine resource={r} act={act} busy={busy} />}

      {p && (
        <div className="sk-progress">
          <div className="sk-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label={`${r.title} progress`}>
            <span style={{ width: `${Math.min(100, (p.done / p.total) * 100)}%` }} />
          </div>
          {!r.readerBookId && <div className="sk-progress-controls">
            <button type="button" className="sk-small-btn" disabled={busy || p.done <= 0} aria-label="Take 10 off" onClick={() => setDone(p.done - 10)}>−10</button>
            <label className="sk-progress-input">
              <span className="sk-sr">{p.unit} done</span>
              <input key={p.done} type="number" min={0} max={p.total} defaultValue={p.done}
                onBlur={(e) => { if (Number(e.target.value) !== p.done) void setDone(Number(e.target.value)); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            </label>
            <span className="sk-muted">of {p.total} {p.unit}</span>
            <button type="button" className="sk-small-btn" disabled={busy || p.done >= p.total} aria-label="Add 10" onClick={() => setDone(p.done + 10)}>+10</button>
          </div>}
          {r.readerBookId && <p className="sk-hint">{p.done} of {p.total} {p.unit}</p>}
        </div>
      )}

      {r.status === 'done' && (
        <>
          {r.finishedOn && <p className="sk-hint">Finished on {longDay(r.finishedOn)}.</p>}
          <label className="sk-field"><span>What did you take away?</span>
            <textarea key={r.takeaways ?? ''} rows={3} maxLength={6000} defaultValue={r.takeaways ?? ''} placeholder="A few lines in your own words"
              onBlur={(e) => { if (e.target.value.trim() !== (r.takeaways ?? '')) void act('edit-resource', { resourceId: r.id, changes: { takeaways: e.target.value } }); }} />
          </label>
        </>
      )}

      <div className="sk-actions">
        {r.status === 'planned' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => set('doing')}>Start</button>}
        {r.status === 'doing' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => set('done')}>Mark done</button>}
        {r.status === 'planned' && <button type="button" className="sk-small-btn" disabled={busy} onClick={() => set('done')}>Mark done</button>}
        {(r.status === 'planned' || r.status === 'doing') && <button type="button" className="sk-small-btn" disabled={busy} onClick={() => set('dropped')}>Drop</button>}
        {r.status === 'doing' && <button type="button" className="sk-small-btn" disabled={busy} onClick={() => set('planned')}>Back to planned</button>}
        {(r.status === 'done' || r.status === 'dropped') && <button type="button" className="sk-small-btn" disabled={busy} onClick={() => set('planned')}>Back to planned</button>}
        <button type="button" className="sk-text-btn" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="sk-text-btn is-danger" onClick={remove}>Delete</button>
      </div>
      {popup}
    </article>
  );
}

type FormValues = {
  kind: ResourceKind; title: string; author: string; url: string; detail: string; topicIds: string[]; hours: string;
  progress: { done: number; total: number; unit: string } | null; status: ResourceStatus;
};

function ResourceForm({ initial, topics, busy, submitLabel, onSubmit, onCancel }: {
  initial?: Resource; topics: Topic[]; busy: boolean; submitLabel: string; onSubmit: (values: FormValues) => void | Promise<void>; onCancel?: () => void;
}) {
  const [kind, setKind] = useState<ResourceKind>(initial?.kind ?? 'book');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [author, setAuthor] = useState(initial?.author ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  const [topicIds, setTopicIds] = useState<string[]>(initial?.topicIds ?? []);
  const [hours, setHours] = useState(initial?.hours ? String(initial.hours) : '');
  const [total, setTotal] = useState(initial?.progress ? String(initial.progress.total) : '');
  const [unit, setUnit] = useState(initial?.progress?.unit ?? 'pages');
  const [status, setStatus] = useState<ResourceStatus>(initial?.status ?? 'planned');
  const project = kind === 'project';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Math.round(Number(total));
    const progress = n > 0 ? { done: Math.min(initial?.progress?.done ?? 0, n), total: n, unit } : null;
    void onSubmit({ kind, title, author, url, detail, topicIds, hours, progress, status });
  }

  return (
    <form className="sk-inline-form" onSubmit={submit}>
      <div className="sk-grid-2">
        <label className="sk-field"><span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)}>
            {RESOURCE_KINDS.map((k) => <option key={k} value={k}>{RESOURCE_LABEL[k].icon} {RESOURCE_LABEL[k].label}</option>)}
          </select>
        </label>
        <label className="sk-field"><span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ResourceStatus)}>
            {RESOURCE_STATUSES.map((s) => <option key={s} value={s}>{RESOURCE_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="sk-field"><span>Title</span><input value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="sk-field"><span>{project ? 'Who it’s for' : 'Author'}</span><input value={author} maxLength={160} onChange={(e) => setAuthor(e.target.value)} /></label>
      </div>
      <label className="sk-field"><span>Link</span><input type="url" inputMode="url" value={url} maxLength={600} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
      <label className="sk-field"><span>{project ? 'What to build' : 'Why it’s here'}</span>
        <textarea rows={3} value={detail} maxLength={1200} onChange={(e) => setDetail(e.target.value)}
          placeholder={project ? 'What you’ll build, and what done looks like' : 'Why it’s on the list, and which chapters to read'} />
      </label>
      {topics.length > 0 && (
        <fieldset className="sk-topic-pick">
          <legend>Topics it teaches</legend>
          {topics.map((t) => (
            <label key={t.id} className="sk-check">
              <input type="checkbox" checked={topicIds.includes(t.id)} onChange={(e) => setTopicIds(e.target.checked ? [...topicIds, t.id] : topicIds.filter((x) => x !== t.id))} /> {t.name}
            </label>
          ))}
        </fieldset>
      )}
      <div className="sk-grid-3">
        <label className="sk-field"><span>Hours it takes</span><input type="number" min={0} max={5000} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        <label className="sk-field"><span>How many in total</span><input type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Optional" /></label>
        <label className="sk-field"><span>Counted in</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {(UNITS.includes(unit) ? UNITS : [...UNITS, unit]).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      </div>
      <div className="sk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="sk-text-btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function AddResource({ topics, act, busy }: { topics: Topic[]; act: Act; busy: boolean }) {
  // Remount the form after a save so it comes back empty.
  const [round, setRound] = useState(0);
  return (
    <section className="sk-card">
      <h2>Add a resource</h2>
      <ResourceForm key={round} topics={topics} busy={busy} submitLabel="Add resource"
        onSubmit={async (v) => { if (await act('add-resource', { ...v })) setRound(round + 1); }} />
    </section>
  );
}
