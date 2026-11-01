'use client';

import { useRef, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { BLUEPRINT } from '@/lib/study/coverage';
import { choiceLetter, type QuestionInput, type StudyQuestion } from '@/lib/study/study';
import { Icon } from './Icon';
import { InlineMath } from './InlineMath';

// Every part of a question, for fixing what her AI got wrong or writing her own. Each
// choice remembers where it started, so the server can move past answers along with it.

const MAX_CHOICES = 8;
type Row = { key: number; text: string; from: number | null; why: string; correct: boolean };

function startRows(question?: StudyQuestion): Row[] {
  if (!question) return [0, 1, 2, 3].map((key) => ({ key, text: '', from: null, why: '', correct: false }));
  return question.choices.map((text, i) => ({ key: i, text, from: i, why: question.whyWrong?.[i] ?? '', correct: question.correct.includes(i) }));
}

export function QuestionEditor({ question, onSave, onRemove, onCancel, saveLabel = 'Save' }: {
  question?: StudyQuestion;
  onSave: (input: QuestionInput) => Promise<void>;
  /** Left out for a new question, or where removing it would make no sense. */
  onRemove?: () => Promise<void>;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [stem, setStem] = useState(question?.stem ?? '');
  const [rows, setRows] = useState<Row[]>(() => startRows(question));
  const nextKey = useRef(rows.length);
  const [explanation, setExplanation] = useState(question?.explanation ?? '');
  const [topic, setTopic] = useState(question?.topic && question.topic !== 'General' ? question.topic : '');
  const [system, setSystem] = useState<string>(question?.system ?? '');
  const [quote, setQuote] = useState(question?.quote ?? '');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
      setBusy(false);
    }
  };
  const save = () => run(() => onSave({
    stem,
    choices: rows.map((r) => ({ text: r.text, ...(r.from === null ? {} : { from: r.from }), why: r.correct ? '' : r.why })),
    correct: rows.flatMap((r, i) => (r.correct ? [i] : [])),
    explanation, topic, system, quote,
  }));
  const several = rows.filter((r) => r.correct).length > 1;

  return (
    <div className="ed-question">
      {preview ? (
        <div className="ed-preview">
          <MathText className="sd-stem">{stem || 'No question yet.'}</MathText>
          <ol className="pr-answers">
            {rows.map((r, i) => (
              <li key={r.key} className={r.correct ? 'is-right' : ''}>
                <span aria-hidden>{r.correct ? <Icon name="check" /> : choiceLetter(i)}</span>
                <span><InlineMath>{r.text || '(empty)'}</InlineMath></span>
              </li>
            ))}
          </ol>
          {explanation && <MathText>{explanation}</MathText>}
        </div>
      ) : (
        <>
          <label className="sd-mend-label">Question
            <textarea rows={4} value={stem} autoFocus={!question} placeholder="A 58-year-old has crushing chest pain…" onChange={(e) => setStem(e.target.value)} />
          </label>
          <fieldset className="ed-choices">
            <legend>Choices <small>Tick what’s right. Tick more than one for select-all.</small></legend>
            {rows.map((r, i) => (
              <div key={r.key} className={`ed-choice${r.correct ? ' is-right' : ''}`}>
                <label className="ed-right">
                  <input type="checkbox" checked={r.correct} aria-label={`Choice ${choiceLetter(i)} is correct`} onChange={(e) => change(r.key, { correct: e.target.checked })} />
                  <span aria-hidden>{choiceLetter(i)}</span>
                </label>
                <div className="ed-choice-fields">
                  <textarea rows={Math.min(6, Math.ceil(r.text.length / 32) || 1)} value={r.text} aria-label={`Choice ${choiceLetter(i)}`} placeholder={`Choice ${choiceLetter(i)}`} onChange={(e) => change(r.key, { text: e.target.value })} />
                  {!r.correct && <input className="ed-why" value={r.why} aria-label={`Why ${choiceLetter(i)} is wrong`} placeholder="Why it’s wrong (optional)" onChange={(e) => change(r.key, { why: e.target.value })} />}
                </div>
                <button type="button" className="hb-small-btn ed-remove" aria-label={`Remove choice ${choiceLetter(i)}`} disabled={rows.length <= 2} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}><Icon name="x" /></button>
              </div>
            ))}
            {rows.length < MAX_CHOICES && (
              <button type="button" className="hb-small-btn sd-self-start" onClick={() => setRows((list) => [...list, { key: nextKey.current++, text: '', from: null, why: '', correct: false }])}><Icon name="plus" /> Add a choice</button>
            )}
            {several && <p className="hb-hint">This is a select-all question, so it won’t appear in Study Snake or Trivia Death.</p>}
          </fieldset>
          <label className="sd-mend-label">Explanation
            <textarea rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </label>
          <details className="sd-more-info" open={!!quote}>
            <summary>Topic, organ system and source</summary>
            <div className="sd-fields ed-more">
              <label>Topic
                <input value={topic} maxLength={80} placeholder="Heart failure" onChange={(e) => setTopic(e.target.value)} />
              </label>
              <label>Organ system
                <select value={system} onChange={(e) => setSystem(e.target.value)}>
                  <option value="">None</option>
                  {BLUEPRINT.map((b) => <option key={b.system} value={b.system}>{b.label}</option>)}
                </select>
              </label>
              <label className="sd-wide">The line of your notes it came from
                <textarea rows={2} value={quote} onChange={(e) => setQuote(e.target.value)} />
              </label>
            </div>
          </details>
        </>
      )}
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : saveLabel}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="hb-text-btn" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Back to editing' : 'Preview'}</button>
        {onRemove && <button type="button" className="hb-text-btn sd-danger-link ed-push" disabled={busy} onClick={() => run(onRemove)}>Remove this question</button>}
      </div>
    </div>
  );
}
