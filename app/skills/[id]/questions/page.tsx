'use client';

// Write questions with AI: pick the topics, the style and how hard, copy the
// prompt, paste the reply, tick what to keep. The server reads the reply again
// when it is added, so the preview here is only a courtesy.

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CopyPrompt, ErrorNote, LevelBar, Loading, PasteReply, SignedOutCard, StateChip } from '@/components/skills/Ui';
import { SignedOut, skillsGet, skillsPost, type Material, type SubjectResponse } from '@/components/skills/api';
import MyNotes from '@/components/skills/prompt/MyNotes';
import { QuestionRow } from '@/components/skills/prompt/QuestionPreview';
import { QUESTION_STYLES, buildQuestionsPrompt, type QuestionStyle } from '@/lib/skills/prompts';
import { SkillsInputError, parseQuestionsReply, type ParsedQuestions } from '@/lib/skills/parse';
import { LEVELS, STAGES } from '@/lib/skills/types';

export default function QuestionsPage() {
  return <Suspense fallback={<main className="sk sk-narrow"><Loading /></main>}><Loader /></Suspense>;
}

function Loader() {
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
  return <Writer key={id} id={id} data={data} reload={load} />;
}

type Off = { reply: string; skip: Set<number> };

function Writer({ id, data, reload }: { id: string; data: SubjectResponse; reload: () => Promise<void> }) {
  const { subject, stats } = data;
  const params = useSearchParams();
  const topicStats = stats.topics;

  const [picked, setPicked] = useState<Set<string>>(() => {
    const fromUrl = (params.get('topics') ?? '').split(',').filter((t) => topicStats.some((s) => s.topicId === t));
    if (fromUrl.length) return new Set(fromUrl);
    const needy = topicStats.filter((t) => ['weak', 'fading', 'untested', 'gap'].includes(t.state) || t.liveItems < 3);
    return new Set((needy.length ? needy : topicStats).map((t) => t.topicId));
  });
  const [style, setStyle] = useState<QuestionStyle>(() => {
    const s = params.get('style');
    return QUESTION_STYLES.find((q) => q.id === s)?.id ?? 'mixed';
  });
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<'auto' | number>('auto');
  const [extra, setExtra] = useState('');
  const [material, setMaterial] = useState<Material[]>([]);
  const [reply, setReply] = useState('');
  const [off, setOff] = useState<Off>({ reply: '', skip: new Set() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ added: number; failed: number } | null>(null);

  const selected = useMemo(() => topicStats.filter((t) => picked.has(t.topicId)), [topicStats, picked]);
  const placement = style === 'placement';
  const total = placement ? selected.length * 3 : count;
  const fallbackTopicId = selected.length === 1 ? selected[0].topicId : undefined;

  const prompt = useMemo(() => buildQuestionsPrompt({
    subject: { name: subject.name, resources: subject.resources, items: data.items.map((r) => ({ title: r.title, retired: r.retired, feedback: r.feedback })) },
    topics: selected.map((t) => ({ ...t, description: subject.topics.find((x) => x.id === t.topicId)?.description })),
    count, style, difficulty, extra: extra.trim() || undefined, material,
  }), [subject, data.items, selected, count, style, difficulty, extra, material]);

  const parsed = useMemo((): { result?: ParsedQuestions; hint?: string } => {
    if (!reply.trim()) return {};
    try {
      return { result: parseQuestionsReply(reply, subject, { fallbackTopicId }) };
    } catch (e) {
      return { hint: e instanceof SkillsInputError ? e.message : 'That reply couldn’t be read.' };
    }
  }, [reply, subject, fallbackTopicId]);
  const result = parsed.result;

  const skip = off.reply === reply ? off.skip : new Set<number>();
  const toggle = (i: number) => {
    const next = new Set(skip);
    if (!next.delete(i)) next.add(i);
    setOff({ reply, skip: next });
  };
  const ready = result ? result.questions.filter((q) => q.ok).length : 0;
  const unreadable = result ? result.questions.length - ready : 0;
  const willAdd = result ? result.questions.filter((q, i) => q.ok && !skip.has(i)).length : 0;

  const setPick = (ids: string[]) => setPicked(new Set(ids));
  const toggleTopic = (topicId: string) => {
    const next = new Set(picked);
    if (!next.delete(topicId)) next.add(topicId);
    setPicked(next);
  };

  async function add() {
    if (!result || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await skillsPost<{ added: number; failed: number }>('import-questions', {
        subjectId: id, reply, skip: [...skip], fallbackTopicId,
      });
      setAdded({ added: res.added, failed: res.failed });
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t add the questions. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="sk-head">
      <div>
        <Link className="sk-back" href={`/skills/${id}`}>← {subject.icon} {subject.name}</Link>
        <h1>Write questions with AI</h1>
        <p>Pick what to be tested on, copy the prompt into your AI, and paste its questions back.</p>
      </div>
    </header>
  );

  if (!topicStats.length) {
    return (
      <main className="sk sk-narrow">
        {header}
        <div className="sk-empty">
          <p>Questions are tied to topics, and {subject.name} has none yet.</p>
          <Link className="btn btn-primary" href={`/skills/${id}/plan`}>Plan it with AI first</Link>
        </div>
      </main>
    );
  }

  if (added) {
    return (
      <main className="sk sk-narrow">
        {header}
        <section className="sk-card sk-done" role="status">
          <h2>Added {added.added} {added.added === 1 ? 'question' : 'questions'}</h2>
          {added.failed > 0 && <p className="sk-warning">{added.failed} couldn’t be added.</p>}
          <div className="sk-actions">
            <Link className="btn btn-primary" href={`/skills/review?subject=${id}&mode=all`}>Answer them now</Link>
            <button type="button" className="btn btn-secondary" onClick={() => { setAdded(null); setReply(''); }}>Write more</button>
            <Link className="btn btn-secondary" href={`/skills/${id}`}>Back to {subject.name}</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="sk sk-narrow">
      {header}

      <section className="sk-card">
        <div className="sk-card-head">
          <h2>Topics</h2>
          <span className="sk-hint">{selected.length} of {topicStats.length} picked</span>
        </div>
        <div className="sk-toggles">
          <button type="button" className="sk-small-btn" onClick={() => setPick(topicStats.filter((t) => t.state === 'weak' || t.state === 'fading').map((t) => t.topicId))}>Weak &amp; fading</button>
          <button type="button" className="sk-small-btn" onClick={() => setPick(topicStats.filter((t) => t.state === 'untested' || t.state === 'gap').map((t) => t.topicId))}>Untested</button>
          <button type="button" className="sk-small-btn" onClick={() => setPick(topicStats.map((t) => t.topicId))}>All</button>
          <button type="button" className="sk-small-btn" onClick={() => setPick([])}>None</button>
        </div>
        <ul className="sk-pp-list">
          {topicStats.map((t) => (
            <li key={t.topicId}>
              <label className="sk-pick-row">
                <input type="checkbox" checked={picked.has(t.topicId)} onChange={() => toggleTopic(t.topicId)} />
                <span className="sk-pick-main">
                  <span className="sk-pick-top">
                    <strong>{t.name}</strong>
                    <span className="sk-pp-meta">{STAGES[t.stage - 1]?.name}</span>
                    <StateChip state={t.state} />
                    <span className="sk-pick-count">{t.liveItems} {t.liveItems === 1 ? 'question' : 'questions'}</span>
                  </span>
                  <LevelBar size="sm" level={t.level} fitted={t.fitted} target={subject.target} label={t.name} />
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="sk-card">
        <h2>Style</h2>
        <div className="sk-style-grid" role="radiogroup" aria-label="Style of question">
          {QUESTION_STYLES.map((s) => (
            <label key={s.id} className={`sk-style-card${style === s.id ? ' is-on' : ''}`}>
              <input type="radio" name="sk-style" checked={style === s.id} onChange={() => setStyle(s.id)} />
              <strong>{s.label}</strong>
              <span>{s.blurb}</span>
            </label>
          ))}
        </div>

        {placement ? (
          <p className="sk-hint">{total} questions: 3 per topic.</p>
        ) : (
          <label className="sk-field">
            <span>How many</span>
            <span className="sk-range">
              <input type="range" min={5} max={30} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              <strong>{count}</strong>
            </span>
          </label>
        )}

        <label className="sk-field">
          <span>How hard</span>
          <select value={String(difficulty)} onChange={(e) => setDifficulty(e.target.value === 'auto' ? 'auto' : Number(e.target.value))} disabled={placement}>
            <option value="auto">Auto (one above your level in each topic)</option>
            {LEVELS.filter((l) => l.level >= 1).map((l) => <option key={l.level} value={l.level}>{l.level} · {l.name}</option>)}
          </select>
          {placement && <small>A placement test always spans 1 to 5.</small>}
        </label>

        <label className="sk-field">
          <span>Anything else?</span>
          <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. use SI units, or focus on troubleshooting" />
        </label>
      </section>

      <MyNotes subjectId={subject.id} topicIds={selected.map((t) => t.topicId)} onChange={setMaterial} />

      {selected.length === 0 ? (
        <p className="sk-empty">Pick at least one topic to get a prompt.</p>
      ) : (
        <CopyPrompt title="Copy this into your AI" prompt={prompt}>
          <p className="sk-hint">Asking for {total} {total === 1 ? 'question' : 'questions'} on {selected.length} {selected.length === 1 ? 'topic' : 'topics'}. A reasoning or thinking model writes better questions and checks its own calculations.</p>
        </CopyPrompt>
      )}

      <PasteReply value={reply} onChange={setReply}>
        {parsed.hint && <p className="sk-hint">{parsed.hint}</p>}
      </PasteReply>

      {result && (
        <section className="sk-card" aria-live="polite">
          <h2>What it wrote</h2>
          <p className="sk-qp-summary">{ready} ready{unreadable > 0 ? `, ${unreadable} can’t be read` : ''}</p>
          {result.cutOff && <p className="sk-warning">The reply looked cut off, so only the complete questions were read.</p>}
          <ul className="sk-qp-list">
            {result.questions.map((q, i) => <QuestionRow key={i} q={q} checked={!skip.has(i)} onToggle={() => toggle(i)} />)}
          </ul>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="sk-actions">
            <button type="button" className="btn btn-primary" disabled={busy || willAdd === 0} onClick={add}>
              {busy ? 'Adding…' : `Add ${willAdd} ${willAdd === 1 ? 'question' : 'questions'}`}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
