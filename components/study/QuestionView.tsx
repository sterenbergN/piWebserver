'use client';

import { useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { choiceLetter, choiceOrder, isRight, type StudyQuestion } from '@/lib/study/study';

/** The choices, in this attempt's shuffled order. With `reveal` they show what was right and why. */
export function Choices({ question, seed, answer, onChange, reveal = false, hidden = [] }: {
  question: StudyQuestion;
  seed: number;
  answer: number[];
  onChange?: (answer: number[]) => void;
  reveal?: boolean;
  /** Choices taken away, as original indexes. */
  hidden?: number[];
}) {
  const [crossed, setCrossed] = useState<number[]>([]);
  const multi = question.correct.length > 1;
  const pick = (i: number) => {
    if (!onChange) return;
    onChange(multi ? (answer.includes(i) ? answer.filter((x) => x !== i) : [...answer, i]) : [i]);
  };

  return (
    <div className="sd-choices" role={multi ? 'group' : 'radiogroup'} aria-label="Choices">
      {multi && !reveal && <p className="sd-multi">Select all that apply</p>}
      {choiceOrder(question, seed).filter((i) => reveal || !hidden.includes(i)).map((original, shown) => {
        const chosen = answer.includes(original);
        const right = question.correct.includes(original);
        const isCrossed = crossed.includes(original) && !reveal;
        const note = question.whyWrong?.[original];
        const state = reveal ? (right ? ' is-right' : chosen ? ' is-wrong' : '') : chosen ? ' is-chosen' : '';
        return (
          <div key={original} className={`sd-choice${state}${isCrossed ? ' is-crossed' : ''}`}>
            <button type="button" className="sd-choice-main" role={multi ? 'checkbox' : 'radio'} aria-checked={chosen} disabled={reveal} onClick={() => pick(original)}>
              <span className="sd-letter" aria-hidden>{reveal && right ? '✓' : reveal && chosen ? '✕' : choiceLetter(shown)}</span>
              <span className="sd-choice-text">
                {question.choices[original]}
                {reveal && !right && note && <small>{note}</small>}
              </span>
            </button>
            {!reveal && (
              <button type="button" className="sd-cross" aria-pressed={isCrossed} aria-label={`${isCrossed ? 'Bring back' : 'Rule out'} ${choiceLetter(shown)}`} title={isCrossed ? 'Bring it back' : 'Rule it out'}
                onClick={() => setCrossed((list) => (list.includes(original) ? list.filter((x) => x !== original) : [...list, original]))}>
                {isCrossed ? '↺' : '✕'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What you learn after answering: the verdict, why, and the line of your notes it came from. */
export function Explanation({ question, answer }: { question: StudyQuestion; answer: number[] }) {
  const right = isRight(question, answer);
  return (
    <div className={`sd-explain${right ? ' is-right' : ' is-wrong'}`}>
      <p className="sd-verdict">{right ? '✅ Right' : answer.length ? '❌ Not quite' : '⬜ Not answered'}</p>
      {question.explanation ? <MathText>{question.explanation}</MathText> : <p className="hb-hint">No explanation came with this question.</p>}
      {question.quote && <blockquote className="sd-quote"><span>From your notes</span>{question.quote}</blockquote>}
    </div>
  );
}

/** Fix a wrong answer key, or drop the question. AI gets things wrong, and you shouldn't have to learn them. */
export function MendQuestion({ question, onFix, onRemove }: {
  question: StudyQuestion;
  onFix: (correct: number[], explanation: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [correct, setCorrect] = useState(question.correct);
  const [explanation, setExplanation] = useState(question.explanation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <button type="button" className="hb-text-btn sd-mend-open" onClick={() => setOpen(true)}>Something wrong with this question?</button>;
  return (
    <div className="sd-mend">
      <p className="sd-mend-title">The right answer is:</p>
      {question.choices.map((choice, i) => (
        <label key={i} className="sd-check">
          <input type="checkbox" checked={correct.includes(i)} onChange={() => setCorrect((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort()))} />
          {choice}
        </label>
      ))}
      <label className="sd-mend-label">Explanation
        <textarea rows={4} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </label>
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !correct.length} onClick={() => run(() => onFix(correct, explanation))}>Save fix</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(onRemove)}>Remove the question</button>
        <button type="button" className="hb-text-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
