'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import { buildTestPrompt, DIFFICULTIES, type PromptSource, type PromptStyle } from '@/lib/study/prompt';
import { dropRepeats, suggestDifficulty, type SetBrief, type SetSummary } from '@/lib/study/sets';
import { parseTestReply, StudyInputError, type ParsedPack, type StudySummary } from '@/lib/study/study';

// Two steps, because the AI lives elsewhere: copy a prompt into it with your
// notes, then paste what it wrote back here. The reply is checked as you paste,
// so a problem shows before anything is saved. A test can belong to a set, and
// then the prompt knows what the set has already asked and how it went.

const QUESTION_COUNTS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200];
/** Past this, a reply is likely to get cut off. Whole questions are still kept. */
const LONG_TEST = 100;
const NEW_SET = 'new';
const NO_SET = 'none';

function readPack(text: string, earlier: string[]): { pack?: ParsedPack; error?: string } {
  if (!text.trim()) return {};
  try {
    return { pack: dropRepeats(parseTestReply(text), earlier) };
  } catch (error) {
    return { error: error instanceof StudyInputError ? error.message : 'That couldn’t be read.' };
  }
}

/** What the set has told this prompt to do differently. */
function Tailoring({ brief }: { brief: SetBrief }) {
  const lines = [
    `Not to repeat the ${brief.stems.length} question${brief.stems.length === 1 ? '' : 's'} so far`,
    brief.weak.length ? `To spend about half the test on ${brief.weak.slice(0, 3).map((t) => t.topic).join(', ')}${brief.weak.length > 3 ? ` and ${brief.weak.length - 3} more` : ''}` : '',
    brief.missed.length ? `To come back at the ideas behind ${brief.missed.length} you got wrong, in new ways` : '',
    brief.unsure.length ? `To retest ${brief.unsure.length} you weren’t sure of` : '',
    brief.strong.length ? `To go easy on ${brief.strong.slice(0, 3).map((t) => t.topic).join(', ')}, where you’re solid` : '',
  ].filter(Boolean);
  return (
    <div className="sd-tailoring">
      <p className="sd-setup-title">This prompt tells your AI:</p>
      <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
      {!brief.answered && <p className="hb-hint">Take the tests already in this set first, and it can use your results too.</p>}
    </div>
  );
}

export default function AddTestPage() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [target, setTarget] = useState(NEW_SET);
  const [setName, setSetName] = useState('');
  const [brief, setBrief] = useState<SetBrief | null>(null);
  const [source, setSource] = useState<PromptSource>('notes');
  const [course, setCourse] = useState('');
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState(25);
  const [style, setStyle] = useState<PromptStyle>('vignette');
  const [difficulty, setDifficulty] = useState(3);
  const [useWeak, setUseWeak] = useState(true);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [reply, setReply] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const promptBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    studyGet<{ summary: StudySummary; sets: SetSummary[] }>().then((body) => {
      setSummary(body.summary);
      setSets(body.sets);
    }).catch((error) => { if (error instanceof SignedOut) setSignedOut(true); });
    const params = new URLSearchParams(window.location.search);
    // The map sends you here to make a test on one organ system, and a set to make its next test.
    const wanted = params.get('focus');
    if (wanted) setFocus(wanted.slice(0, 200));
    const set = params.get('set');
    if (set) setTarget(set);
  }, []);

  // Choosing a set picks up where its last test left off.
  useEffect(() => {
    if (target === NEW_SET || target === NO_SET) {
      setBrief(null);
      return;
    }
    let cancelled = false;
    studyGet<{ brief: SetBrief }>(`set=${encodeURIComponent(target)}`).then((body) => {
      if (cancelled) return;
      const { set } = body.brief;
      setBrief(body.brief);
      setCourse(set.course);
      setFocus(set.focus);
      setStyle(set.style);
      setCount(set.count);
      setDifficulty(set.difficulty);
    }).catch(() => { if (!cancelled) setTarget(NEW_SET); });
    return () => { cancelled = true; };
  }, [target]);

  const weakTopics = useMemo(() => summary?.weakTopics.map((t) => t.topic) ?? [], [summary]);
  const prompt = useMemo(() => buildTestPrompt({
    source, course, focus, count, style, difficulty,
    weakTopics: useWeak && !brief ? weakTopics : [],
    ...(brief ? { brief } : {}),
  }), [source, course, focus, count, style, difficulty, useWeak, weakTopics, brief]);
  const { pack, error } = useMemo(() => readPack(reply, brief?.stems ?? []), [reply, brief]);
  const nudge = brief ? suggestDifficulty(brief, difficulty) : null;
  const level = DIFFICULTIES[difficulty - 1] ?? DIFFICULTIES[2];
  const sameName = target === NEW_SET ? sets.find((s) => s.title.toLowerCase() === setName.trim().toLowerCase()) : undefined;
  useEffect(() => setCopied('idle'), [prompt]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('copied');
    } catch {
      // Some phones refuse the clipboard: leave it selected to copy by hand.
      promptBox.current?.focus();
      promptBox.current?.select();
      setCopied('failed');
    }
  }

  async function save() {
    if (!pack || saving) return;
    setSaving(true);
    setSaveError('');
    const settings = { course, focus, style, count, difficulty };
    try {
      const body = await studyPost<{ id: string }>('add-test', {
        text: reply,
        title,
        course: course || pack.course,
        ...(source === 'notes' ? { difficulty } : {}),
        ...(target === NEW_SET ? { newSet: { title: setName.trim() || focus.trim() || course.trim() || pack.title || 'Practice tests', ...settings } } : {}),
        ...(brief ? { setId: brief.set.id, ...(source === 'notes' ? { settings } : {}) } : {}),
      });
      router.push(`/study/tests/${body.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Couldn’t save the test.');
      setSaving(false);
    }
  }

  if (signedOut) return <div className="sd"><SignInPrompt title="Sign in to add tests">Your tests are only shown to your account.</SignInPrompt></div>;

  const topics = pack ? [...new Set(pack.questions.map((q) => q.topic))] : [];
  const selectAll = pack ? pack.questions.filter((q) => q.correct.length > 1).length : 0;
  const titleHint = brief ? `Test ${brief.testCount + 1}` : target === NEW_SET ? 'Test 1' : pack?.title || 'Practice test';
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href={brief ? `/study/tests/sets/${brief.set.id}` : '/study/tests'}>← {brief ? brief.set.title : 'Practice tests'}</Link>
          <h1>{brief ? `Test ${brief.testCount + 1} in ${brief.set.title}` : 'Add a test'}</h1>
        </div>
      </header>

      <section className="sd-card">
        <h2><span className="sd-step">1</span> Copy this into your AI, with your notes</h2>
        <div className="sd-segments" role="radiogroup" aria-label="What the AI is working from">
          <button type="button" role="radio" aria-checked={source === 'notes'} onClick={() => setSource('notes')}>From my notes</button>
          <button type="button" role="radio" aria-checked={source === 'old-test'} onClick={() => setSource('old-test')}>Convert an old test</button>
        </div>
        <div className="sd-fields">
          <label className="sd-wide">Set
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value={NEW_SET}>New set</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.tests} test{s.tests === 1 ? '' : 's'})</option>)}
              <option value={NO_SET}>Not in a set</option>
            </select>
          </label>
          {target === NEW_SET && (
            <label className="sd-wide">Name the set after its subject
              <input value={setName} maxLength={120} placeholder="Heart failure" onChange={(e) => setSetName(e.target.value)} />
              {sameName && <small className="hb-hint">You already have this set, so the test will join it.</small>}
            </label>
          )}
          <label>Class or module
            <input list="sd-courses" value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => setCourse(e.target.value)} />
            <datalist id="sd-courses">{summary?.courses.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          {source === 'notes' && (
            <>
              <label>Questions
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[...new Set([...QUESTION_COUNTS, count])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>Style
                <select value={style} onChange={(e) => setStyle(e.target.value as PromptStyle)}>
                  <option value="vignette">Patient scenarios</option>
                  <option value="mixed">Mixed</option>
                  <option value="recall">Quick recall</option>
                </select>
              </label>
              <label className="sd-wide">Focus on (optional)
                <input value={focus} maxLength={200} placeholder="Heart failure and antiarrhythmics" onChange={(e) => setFocus(e.target.value)} />
              </label>
              <label className="sd-wide sd-difficulty">
                <span className="sd-difficulty-head"><span>Difficulty</span><strong>{level.level}. {level.label}</strong></span>
                <input type="range" min={1} max={DIFFICULTIES.length} step={1} value={difficulty} aria-valuetext={`${level.label}: ${level.blurb}`} onChange={(e) => setDifficulty(Number(e.target.value))} />
                <span className="sd-difficulty-ends" aria-hidden><span>Easier</span><span>Harder</span></span>
                <small className="hb-hint">{level.blurb}</small>
              </label>
              {nudge && (
                <div className="sd-wide sd-nudge">
                  <span>{nudge.why}</span>
                  <button type="button" className="hb-small-btn" onClick={() => setDifficulty(nudge.level)}>Use level {nudge.level}</button>
                </div>
              )}
              {!brief && weakTopics.length > 0 && (
                <label className="sd-check sd-wide">
                  <input type="checkbox" checked={useWeak} onChange={(e) => setUseWeak(e.target.checked)} />
                  Ask about my weakest topics too ({weakTopics.slice(0, 3).join(', ')}{weakTopics.length > 3 ? '…' : ''})
                </label>
              )}
            </>
          )}
        </div>
        {source === 'notes' && count > LONG_TEST && (
          <p className="hb-hint">An AI may stop partway through a test this long. Every whole question still gets saved, or you can make two shorter tests.</p>
        )}
        {source === 'notes' && brief && brief.testCount > 0 && <Tailoring brief={brief} />}
        <textarea ref={promptBox} className="sd-prompt" readOnly rows={6} value={prompt} aria-label="The prompt to copy" />
        <div className="sd-actions">
          <button type="button" className="btn btn-primary" onClick={copy}>{copied === 'copied' ? '✓ Copied' : 'Copy prompt'}</button>
          {copied === 'failed' && <span className="hb-hint">Couldn’t reach the clipboard. It’s selected above, so copy it from there.</span>}
        </div>
      </section>

      <section className="sd-card">
        <h2><span className="sd-step">2</span> Paste what it wrote</h2>
        <textarea className="sd-reply" rows={8} value={reply} placeholder="Paste the whole reply here" aria-label="The AI’s reply" onChange={(e) => { setReply(e.target.value); setSaveError(''); }} />
        {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
        {pack && (
          <div className="sd-preview">
            <p className="sd-found">
              <strong>{pack.questions.length} question{pack.questions.length === 1 ? '' : 's'} ready</strong>
              {' '}across {topics.length} topic{topics.length === 1 ? '' : 's'}{selectAll ? `, ${selectAll} select-all` : ''}.
            </p>
            {pack.warnings.map((w) => <p key={w} className="sd-warning">⚠️ {w}</p>)}
            {pack.problems.length > 0 && (
              <details className="sd-problems" open={pack.problems.length <= 3}>
                <summary>{pack.problems.length} couldn’t be used</summary>
                <ul>{pack.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            <div className="sd-fields">
              <label className="sd-wide">Name (optional)
                <input value={title} maxLength={120} placeholder={titleHint} onChange={(e) => setTitle(e.target.value)} />
              </label>
            </div>
            {saveError && <div className="hb-banner is-error" role="alert"><span>{saveError}</span></div>}
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save and open the test'}</button>
          </div>
        )}
      </section>
    </div>
  );
}
