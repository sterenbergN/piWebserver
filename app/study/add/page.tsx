'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import { buildTestPrompt, type PromptSource, type PromptStyle } from '@/lib/study/prompt';
import { parseTestReply, StudyInputError, type ParsedPack, type StudySummary } from '@/lib/study/study';

// Two steps, because the AI lives elsewhere: copy a prompt into it with your
// notes, then paste what it wrote back here. The reply is checked as you paste,
// so a problem shows before anything is saved.

function readPack(text: string): { pack?: ParsedPack; error?: string } {
  if (!text.trim()) return {};
  try {
    return { pack: parseTestReply(text) };
  } catch (error) {
    return { error: error instanceof StudyInputError ? error.message : 'That couldn’t be read.' };
  }
}

export default function AddTestPage() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [source, setSource] = useState<PromptSource>('notes');
  const [course, setCourse] = useState('');
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState(25);
  const [style, setStyle] = useState<PromptStyle>('vignette');
  const [useWeak, setUseWeak] = useState(true);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [reply, setReply] = useState('');
  const [title, setTitle] = useState('');
  const [testCourse, setTestCourse] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const promptBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    studyGet<{ summary: StudySummary }>().then((body) => setSummary(body.summary)).catch((error) => { if (error instanceof SignedOut) setSignedOut(true); });
  }, []);

  const weakTopics = useMemo(() => summary?.weakTopics.map((t) => t.topic) ?? [], [summary]);
  const prompt = useMemo(() => buildTestPrompt({ source, course, focus, count, style, weakTopics: useWeak ? weakTopics : [] }), [source, course, focus, count, style, useWeak, weakTopics]);
  const { pack, error } = useMemo(() => readPack(reply), [reply]);
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
    try {
      const body = await studyPost<{ id: string }>('add-test', { text: reply, title: title || pack.title, course: testCourse || pack.course || course });
      router.push(`/study/test/${body.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Couldn’t save the test.');
      setSaving(false);
    }
  }

  if (signedOut) return <div className="sd"><SignInPrompt title="Sign in to add tests">Your tests are only shown to your account.</SignInPrompt></div>;

  const topics = pack ? [...new Set(pack.questions.map((q) => q.topic))] : [];
  const selectAll = pack ? pack.questions.filter((q) => q.correct.length > 1).length : 0;
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study">← Study</Link>
          <h1>Add a test</h1>
        </div>
      </header>

      <section className="sd-card">
        <h2><span className="sd-step">1</span> Copy this into your AI, with your notes</h2>
        <div className="sd-segments" role="radiogroup" aria-label="What the AI is working from">
          <button type="button" role="radio" aria-checked={source === 'notes'} onClick={() => setSource('notes')}>From my notes</button>
          <button type="button" role="radio" aria-checked={source === 'old-test'} onClick={() => setSource('old-test')}>Convert an old test</button>
        </div>
        <div className="sd-fields">
          <label>Class or module
            <input list="sd-courses" value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => setCourse(e.target.value)} />
            <datalist id="sd-courses">{summary?.courses.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          {source === 'notes' && (
            <>
              <label>Questions
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[10, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}</option>)}
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
              {weakTopics.length > 0 && (
                <label className="sd-check sd-wide">
                  <input type="checkbox" checked={useWeak} onChange={(e) => setUseWeak(e.target.checked)} />
                  Ask about my weakest topics too ({weakTopics.slice(0, 3).join(', ')}{weakTopics.length > 3 ? '…' : ''})
                </label>
              )}
            </>
          )}
        </div>
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
              <label className="sd-wide">Name
                <input value={title} maxLength={120} placeholder={pack.title || 'Practice test'} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="sd-wide">Class or module
                <input list="sd-courses" value={testCourse} maxLength={80} placeholder={pack.course || course || 'Optional'} onChange={(e) => setTestCourse(e.target.value)} />
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
