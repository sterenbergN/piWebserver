'use client';

import { useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import type { ParsedQuestion } from '@/lib/skills/parse';

// One question from a pasted reply: a tick, what it is and a peek at the whole
// thing. Ones that could not be read show why, and cannot be added.

export function QuestionRow({ q, checked, onToggle }: { q: ParsedQuestion; checked: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);

  if (!q.ok) {
    return (
      <li className="sk-qp-row is-bad">
        <div className="sk-qp-body">
          <strong>{q.title}</strong>
          <ul className="sk-qp-errors">{q.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      </li>
    );
  }

  const item = q.item;
  const difficulty = item.kind === 'graded' ? item.question.difficulty : item.difficulty;
  return (
    <li className="sk-qp-row">
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Add ${q.title}`} />
      <div className="sk-qp-body">
        <strong>{q.title}</strong>
        <span className="sk-pp-meta">
          <span aria-hidden>{item.kind === 'graded' ? '📝' : '🃏'}</span> {item.kind === 'graded' ? 'Graded' : 'Card'} · {q.topicName} · difficulty {difficulty}
        </span>
        {q.warning && <p className="sk-warning">{q.warning}</p>}
        <button type="button" className="sk-text-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Preview'}</button>
        {open && (
          <div className="sk-qp-preview">
            {item.kind === 'graded' ? (
              <>
                <MathText>{item.question.prompt}</MathText>
                <h5>Solution</h5>
                <MathText>{item.question.solution}</MathText>
              </>
            ) : (
              <>
                <h5>Front</h5>
                <MathText>{item.front}</MathText>
                <h5>Back</h5>
                <MathText>{item.back}</MathText>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
