'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { stepProgress } from '@/lib/skills/model';
import { RESOURCE_LABEL, SKILL_STEP_KINDS, type Resource, type SkillStep, type SkillStepKind, type Topic } from '@/lib/skills/types';
import type { SubjectResponse } from '../api';
import { ErrorNote } from '../Ui';
import { longDay, useAct } from './shared';
import './steps-projects.css';

// Explicit ordered progression steps for a subject (Req #2).
// Toggling a step syncs directly with the interconnected study schedule.

type Act = ReturnType<typeof useAct>['act'];

const STEP_KIND_META: Record<SkillStepKind, { label: string; icon: string }> = {
  read: { label: 'Read', icon: '📖' },
  practice: { label: 'Practice', icon: '✍️' },
  project: { label: 'Project', icon: '🛠️' },
  note: { label: 'Note', icon: '📝' },
  other: { label: 'Step', icon: '•' },
};

export default function Steps({ data, reload, onOpenPlan }: { data: SubjectResponse; reload: () => Promise<void>; onOpenPlan?: () => void }) {
  const { subject } = data;
  const { act, busy, error } = useAct(data, reload);
  const steps = subject.steps ?? [];
  const progress = stepProgress(subject);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const remainingMinutes = steps.filter((s) => !s.done).reduce((sum, s) => sum + (s.minutes ?? 0), 0);

  return (
    <>
      <section className="sk-card">
        <div className="sk-card-head">
          <h2>Study Steps</h2>
          {onOpenPlan ? (
            <button type="button" className="sk-small-btn" onClick={onOpenPlan}>AI Plan Steps →</button>
          ) : (
            <Link className="sk-small-btn" href={`/skills/${subject.id}/plan`}>AI Plan Steps →</Link>
          )}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {progress.total > 0 && (
          <div className="sk-steps-summary">
            <div className="sk-steps-summary-row">
              <span><strong>{progress.done}</strong> of <strong>{progress.total}</strong> step{progress.total === 1 ? '' : 's'} complete ({pct}%)</span>
              {remainingMinutes > 0 && (
                <span className="sk-muted">~{remainingMinutes >= 60 ? `${(remainingMinutes / 60).toFixed(1)} hrs` : `${remainingMinutes} min`} remaining</span>
              )}
            </div>
            <div
              className="sk-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label={`${subject.name} step progress`}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {steps.length === 0 ? (
          <div className="sk-step-empty">
            <p>
              No steps yet. Explicit steps break <strong>{subject.name}</strong> into ordered milestones — with exact reading amounts
              (like <em>Ch. 1–2 (pp. 1–45)</em>), practice targets, and time estimates — that automatically feed your interconnected daily schedule.
            </p>
            <div className="sk-actions">
              {onOpenPlan ? (
                <button type="button" className="btn btn-primary" onClick={onOpenPlan}>AI Plan Steps →</button>
              ) : (
                <Link className="btn btn-primary" href={`/skills/${subject.id}/plan`}>AI Plan Steps →</Link>
              )}
            </div>
          </div>
        ) : (
          <ol className="sk-step-list">
            {steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                index={index}
                total={steps.length}
                topics={subject.topics}
                resources={subject.resources}
                act={act}
                busy={busy}
              />
            ))}
          </ol>
        )}
      </section>

      <AddStepForm topics={subject.topics} resources={subject.resources} act={act} busy={busy} />
    </>
  );
}

function StepRow({
  step,
  index,
  total,
  topics,
  resources,
  act,
  busy,
}: {
  step: SkillStep;
  index: number;
  total: number;
  topics: Topic[];
  resources: Resource[];
  act: Act;
  busy: boolean;
}) {
  const { confirm, popup } = useSitePopup();
  const [editing, setEditing] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const kindMeta = STEP_KIND_META[step.kind] ?? STEP_KIND_META.other;
  const topic = step.topicId ? topics.find((t) => t.id === step.topicId) : undefined;
  const resource = step.resourceId ? resources.find((r) => r.id === step.resourceId) : undefined;
  const longDetail = (step.detail?.length ?? 0) > 160;

  async function remove() {
    const ok = await confirm({
      title: `Delete "${step.title}"?`,
      message: 'This removes the step and unlinks any scheduled task referencing it.',
      confirmLabel: 'Delete step',
      danger: true,
    });
    if (ok) await act('remove-step', { stepId: step.id });
  }

  if (editing) {
    return (
      <li className="sk-topic-edit">
        <StepForm
          initial={step}
          topics={topics}
          resources={resources}
          busy={busy}
          submitLabel="Save step"
          onSubmit={async (changes) => {
            if (await act('edit-step', { stepId: step.id, changes })) setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className={`sk-step-item${step.done ? ' is-done' : ''}`}>
      <div className="sk-step-top">
        <label className="sk-step-check">
          <input
            type="checkbox"
            checked={!!step.done}
            disabled={busy}
            aria-label={`Mark "${step.title}" as ${step.done ? 'not done' : 'done'}`}
            onChange={() => void act('toggle-step', { stepId: step.id })}
          />
        </label>

        <div className="sk-step-body">
          <div className="sk-step-title-row">
            <span className="sk-step-index">#{index + 1}</span>
            <span className="sk-step-title">{step.title}</span>
          </div>

          <div className="sk-chips">
            <span className="sk-chip is-kind"><span aria-hidden>{kindMeta.icon}</span> {kindMeta.label}</span>
            {step.amount && <span className="sk-chip is-amount">{step.amount}</span>}
            {step.minutes ? <span className="sk-chip is-minutes">{step.minutes} min</span> : null}
            {topic && <span className="sk-chip is-topic">{topic.name}</span>}
            {resource && (
              <span className="sk-chip is-resource">
                <span aria-hidden>{RESOURCE_LABEL[resource.kind].icon}</span> {resource.title}
              </span>
            )}
            {step.done && step.completedOn && <span className="sk-muted">Done {longDay(step.completedOn)}</span>}
          </div>

          {step.detail && (!longDetail || detailOpen) && <p className="sk-step-detail">{step.detail}</p>}
          {step.detail && longDetail && (
            <button type="button" className="sk-text-btn" onClick={() => setDetailOpen(!detailOpen)}>
              {detailOpen ? 'Hide note' : 'Show note'}
            </button>
          )}
        </div>
      </div>

      <div className="sk-row-actions">
        <button
          type="button"
          className="sk-small-btn"
          disabled={busy || index === 0}
          aria-label={`Move ${step.title} up`}
          onClick={() => void act('move-step', { stepId: step.id, direction: 'up' })}
        >
          ↑
        </button>
        <button
          type="button"
          className="sk-small-btn"
          disabled={busy || index === total - 1}
          aria-label={`Move ${step.title} down`}
          onClick={() => void act('move-step', { stepId: step.id, direction: 'down' })}
        >
          ↓
        </button>
        <button type="button" className="sk-text-btn" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="sk-text-btn is-danger" onClick={remove}>Delete</button>
      </div>
      {popup}
    </li>
  );
}

type StepFormValues = {
  title: string;
  kind: SkillStepKind;
  amount: string;
  minutes: number | null;
  topicId: string | null;
  resourceId: string | null;
  detail: string;
};

function StepForm({
  initial,
  topics,
  resources,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: SkillStep;
  topics: Topic[];
  resources: Resource[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: StepFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [kind, setKind] = useState<SkillStepKind>(initial?.kind ?? 'read');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [minutes, setMinutes] = useState(initial?.minutes ? String(initial.minutes) : '');
  const [topicId, setTopicId] = useState(initial?.topicId ?? '');
  const [resourceId, setResourceId] = useState(initial?.resourceId ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedMinutes = minutes.trim() ? Math.max(1, Math.min(600, Math.round(Number(minutes)))) : null;
    void onSubmit({
      title: title.trim(),
      kind,
      amount: amount.trim(),
      minutes: parsedMinutes !== null && Number.isFinite(parsedMinutes) ? parsedMinutes : null,
      topicId: topicId || null,
      resourceId: resourceId || null,
      detail: detail.trim(),
    });
  }

  return (
    <form className="sk-inline-form" onSubmit={handleSubmit}>
      <div className="sk-grid-2">
        <label className="sk-field">
          <span>Title</span>
          <input
            value={title}
            maxLength={200}
            required
            placeholder="e.g. Read fundamentals of flight"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="sk-field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as SkillStepKind)}>
            {SKILL_STEP_KINDS.map((k) => (
              <option key={k} value={k}>
                {STEP_KIND_META[k].icon} {STEP_KIND_META[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sk-grid-2">
        <label className="sk-field">
          <span>Amount / target</span>
          <input
            value={amount}
            maxLength={120}
            placeholder="e.g. Ch. 1–3 (pp. 1–60) or 10 problems"
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="sk-field">
          <span>Estimated minutes</span>
          <input
            type="number"
            min={1}
            max={600}
            value={minutes}
            placeholder="e.g. 45"
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
      </div>

      {(topics.length > 0 || resources.length > 0) && (
        <div className="sk-grid-2">
          {topics.length > 0 && (
            <label className="sk-field">
              <span>Linked topic (optional)</span>
              <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">None</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          )}
          {resources.length > 0 && (
            <label className="sk-field">
              <span>Linked resource (optional)</span>
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                <option value="">None</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {RESOURCE_LABEL[r.kind].icon} {r.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <label className="sk-field">
        <span>Detail / notes (optional)</span>
        <textarea
          rows={2}
          maxLength={1200}
          value={detail}
          placeholder="Focus areas, exercises to complete, or what done looks like"
          onChange={(e) => setDetail(e.target.value)}
        />
      </label>

      <div className="sk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="sk-text-btn" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  );
}

function AddStepForm({
  topics,
  resources,
  act,
  busy,
}: {
  topics: Topic[];
  resources: Resource[];
  act: Act;
  busy: boolean;
}) {
  const [round, setRound] = useState(0);

  return (
    <section className="sk-card">
      <h2>Add a step</h2>
      <StepForm
        key={round}
        topics={topics}
        resources={resources}
        busy={busy}
        submitLabel="Add step"
        onSubmit={async (values) => {
          if (await act('add-step', values)) setRound((r) => r + 1);
        }}
      />
    </section>
  );
}
