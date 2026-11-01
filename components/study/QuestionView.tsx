'use client';

import { useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { Icon } from './Icon';
import { InlineMath } from './InlineMath';
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
              <span className="sd-letter" aria-hidden>{reveal && right ? <Icon name="check" size="0.95rem" /> : reveal && chosen ? <Icon name="x" size="0.95rem" /> : choiceLetter(shown)}</span>
              <span className="sd-choice-text">
                <InlineMath>{question.choices[original]}</InlineMath>
                {reveal && !right && note && <small><InlineMath>{note}</InlineMath></small>}
              </span>
            </button>
            {!reveal && (
              <button type="button" className="sd-cross" aria-pressed={isCrossed} aria-label={`${isCrossed ? 'Bring back' : 'Rule out'} ${choiceLetter(shown)}`} title={isCrossed ? 'Bring it back' : 'Rule it out'}
                onClick={() => setCrossed((list) => (list.includes(original) ? list.filter((x) => x !== original) : [...list, original]))}>
                {isCrossed ? <Icon name="review" size="0.95rem" /> : <Icon name="x" size="0.95rem" />}
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
      <p className="sd-verdict">{right ? <><Icon name="check" /> Right</> : answer.length ? <><Icon name="x" /> Not quite</> : 'Not answered'}</p>
      {question.explanation ? <MathText>{question.explanation}</MathText> : <p className="hb-hint">No explanation came with this question.</p>}
      {question.quote && <blockquote className="sd-quote"><span>From your notes</span><InlineMath>{question.quote}</InlineMath></blockquote>}
    </div>
  );
}
