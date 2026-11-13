'use client';

// Plan a subject with AI: tell it about you, copy the prompt, paste the reply,
// tick what to keep. Nothing is saved until the last button, and the reply is
// read again on the server then, so the preview here is only a courtesy.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyPrompt, ErrorNote, Loading, PasteReply, SignedOutCard } from '@/components/skills/Ui';
import { SignedOut, skillsGet, skillsPost, type SubjectResponse } from '@/components/skills/api';
import { PlanPreview, type RoadmapChoice } from '@/components/skills/prompt/PlanPreview';
import { LEARNING_STYLES, buildPlanPrompt } from '@/lib/skills/prompts';
import { SkillsInputError, parsePlanReply, type ParsedPlan } from '@/lib/skills/parse';
import { LEVELS } from '@/lib/skills/types';

type Done = { topics: number; resources: number; roadmap: boolean };
type Off = { reply: string; topics: Set<string>; resources: Set<number> };

export default function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SubjectResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signedOut' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await skillsGet<SubjectResponse>({ subject: id }));
      setState('ready');
    } catch (e) {
      if (e instanceof SignedOut) setState('signedOut');
      else { setError(e instanceof Error ? e.message : 'Something went wrong.'); setState('error'); }
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <main className="sk sk-narrow"><Loading /></main>;
  if (state === 'signedOut') return <main className="sk sk-narrow"><SignedOutCard /></main>;
  if (state === 'error' || !data) {
    return (
      <main className="sk sk-narrow">
        <ErrorNote>{error || 'Couldn’t load this subject.'}</ErrorNote>
        <Link className="sk-back" href="/skills">← Back to your skills</Link>
      </main>
    );
  }
  return <Planner key={id} id={id} data={data} reload={load} />;
}

function Planner({ id, data, reload }: { id: string; data: SubjectResponse; reload: () => Promise<void> }) {
  const { subject } = data;
  const replan = subject.topics.length > 0;

  const [background, setBackground] = useState(subject.background ?? '');
  const [hours, setHours] = useState(subject.hoursPerWeek ? String(subject.hoursPerWeek) : '');
  const [styles, setStyles] = useState<string[]>(['Books', 'Online courses', 'Hands-on projects']);
  const [extra, setExtra] = useState('');
  const [reply, setReply] = useState('');
  const [off, setOff] = useState<Off>({ reply: '', topics: new Set(), resources: new Set() });
  const [roadmap, setRoadmap] = useState<RoadmapChoice>(subject.roadmap?.trim() ? 'append' : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const saved = useRef({ background: subject.background ?? '', hours: subject.hoursPerWeek ? String(subject.hoursPerWeek) : '' });

  const hoursNumber = Number(hours);
  const hoursValue = hours.trim() && Number.isFinite(hoursNumber) && hoursNumber > 0 ? Math.min(80, Math.round(hoursNumber)) : undefined;

  // Keep what they told us for next time; a failure here is not worth a message.
  function saveAbout() {
    if (saved.current.background === background && saved.current.hours === hours) return;
    saved.current = { background, hours };
    skillsPost('edit-subject', { subjectId: id, changes: { background, hoursPerWeek: hoursValue ?? null } }).catch(() => {});
  }

  const prompt = useMemo(
    () => buildPlanPrompt({
      subject: { ...subject, background: background.trim() || undefined, hoursPerWeek: hoursValue },
      stats: replan ? data.stats : undefined,
      styles,
      extra: extra.trim() || undefined,
    }),
    [subject, data.stats, replan, background, hoursValue, styles, extra],
  );

  const parsed = useMemo((): { plan?: ParsedPlan; hint?: string } => {
    if (!reply.trim()) return {};
    try {
      return { plan: parsePlanReply(reply, subject) };
    } catch (e) {
      return { hint: e instanceof SkillsInputError ? e.message : 'That reply couldn’t be read.' };
    }
  }, [reply, subject]);
  const plan = parsed.plan;

  const offTopics = off.reply === reply ? off.topics : new Set<string>();
  const offResources = off.reply === reply ? off.resources : new Set<number>();
  const toggleTopic = (key: string) => {
    const next = new Set(offTopics);
    if (!next.delete(key)) next.add(key);
    setOff({ reply, topics: next, resources: offResources });
  };
  const toggleResource = (i: number) => {
    const next = new Set(offResources);
    if (!next.delete(i)) next.add(i);
    setOff({ reply, topics: offTopics, resources: next });
  };

  const topicKeys = plan ? plan.topics.filter((t) => !t.existingId && !offTopics.has(t.key)).map((t) => t.key) : [];
  const resourceIndexes = plan ? plan.resources.flatMap((r, i) => (!r.existingId && !offResources.has(i) ? [i] : [])) : [];
  const roadmapValue: RoadmapChoice = plan?.roadmap ? roadmap : false;

  async function add() {
    if (!plan || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await skillsPost<{ topics: number; resources: number; roadmap: boolean }>('import-plan', {
        subjectId: id, reply, topicKeys, resourceIndexes, roadmap: roadmapValue,
      });
      setDone({ topics: res.topics, resources: res.resources, roadmap: !!res.roadmap });
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t add the plan. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="sk-head">
      <div>
        <Link className="sk-back" href={`/skills/${id}`}>← {subject.icon} {subject.name}</Link>
        <h1>{replan ? 'Plan the next steps' : `Plan ${subject.name} from scratch`}</h1>
        <p>
          {replan
            ? 'It will see where you stand now, so it adds what’s missing instead of starting over.'
            : 'Tell an AI about you and it will lay out topics, books, projects and a roadmap. You pick what to keep.'}
        </p>
      </div>
    </header>
  );

  if (done) {
    const parts = [
      `${done.topics} ${done.topics === 1 ? 'topic' : 'topics'}`,
      `${done.resources} ${done.resources === 1 ? 'resource' : 'resources'}`,
    ];
    return (
      <main className="sk sk-narrow">
        {header}
        <section className="sk-card sk-done" role="status">
          <h2>Added {parts.join(' and ')}</h2>
          {done.roadmap && <p className="sk-hint">The roadmap is saved on the subject page.</p>}
          <p className="sk-hint">Next, tell it where you really are, so the levels start from something true.</p>
          <div className="sk-actions">
            <Link className="btn btn-primary" href={`/skills/${id}?tab=topics`}>Rate yourself on the topics</Link>
            <Link className="btn btn-secondary" href={`/skills/${id}/questions?style=placement`}>Take a placement test</Link>
            <Link className="btn btn-secondary" href={`/skills/${id}`}>See the subject</Link>
          </div>
        </section>
      </main>
    );
  }

  const count = topicKeys.length + resourceIndexes.length;

  return (
    <main className="sk sk-narrow">
      {header}

      <section className="sk-card">
        <h2><span className="sk-step">0</span> Tell it about you</h2>
        <div className="sk-grid-2">
          <div className="sk-readonly"><span>Your goal</span>{subject.goal || 'Not set'}</div>
          <div className="sk-readonly"><span>Where you want to get</span>Level {subject.target}, {LEVELS[Math.min(5, Math.max(0, subject.target))].name}</div>
        </div>
        <Link className="sk-text-btn" href={`/skills/${id}`}>Change these on the subject page</Link>
        <label className="sk-field">
          <span>What you already know</span>
          <textarea rows={3} value={background} onChange={(e) => setBackground(e.target.value)} onBlur={saveAbout} placeholder="Courses taken, jobs, what you can already do" />
        </label>
        <label className="sk-field">
          <span>Hours a week you can give it</span>
          <input type="number" inputMode="decimal" min={0} max={80} step={1} value={hours} onChange={(e) => setHours(e.target.value)} onBlur={saveAbout} placeholder="e.g. 5" />
        </label>
        <div className="sk-field" role="group" aria-label="What you like learning from">
          <span>What you like learning from</span>
          <div className="sk-toggles">
            {LEARNING_STYLES.map((s) => (
              <button key={s} type="button" className="sk-small-btn" aria-pressed={styles.includes(s)} onClick={() => setStyles(styles.includes(s) ? styles.filter((x) => x !== s) : [...styles, s])}>{s}</button>
            ))}
          </div>
        </div>
        <label className="sk-field">
          <span>Anything else?</span>
          <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. focus on what’s used in industrial automation, or I have 3 months" />
        </label>
      </section>

        <CopyPrompt title="Copy this into your AI" prompt={prompt}>
          <p className="sk-hint">
            {replan
              ? `It includes your ${subject.topics.length} topics and where you stand on each.`
              : 'A thinking model picks better books and sets better stages.'}
          </p>
        </CopyPrompt>

      <PasteReply value={reply} onChange={setReply}>
        {parsed.hint && <p className="sk-hint">{parsed.hint}</p>}
      </PasteReply>

      {plan && (
        <>
          <PlanPreview
            plan={plan}
            subject={subject}
            offTopics={offTopics}
            offResources={offResources}
            onToggleTopic={toggleTopic}
            onToggleResource={toggleResource}
            roadmap={roadmap}
            onRoadmap={setRoadmap}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="sk-actions">
            <button type="button" className="btn btn-primary" disabled={busy || (count === 0 && roadmapValue === false)} onClick={add}>
              {busy ? 'Adding…' : `Add ${topicKeys.length} ${topicKeys.length === 1 ? 'topic' : 'topics'} and ${resourceIndexes.length} ${resourceIndexes.length === 1 ? 'resource' : 'resources'}`}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
