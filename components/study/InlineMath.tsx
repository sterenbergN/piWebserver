'use client';

import { Tex } from '@/components/daily/MathText';
import { splitMath } from '@/lib/study/math';

/** A line of text with its math typeset, for answer choices and other short text inside a button or label. */
export function InlineMath({ children }: { children: string }) {
  return (
    <span className="sd-inline-math">
      {splitMath(children).map((part, i) => (part.math ? <Tex key={i} latex={part.text} /> : <span key={i}>{part.text}</span>))}
    </span>
  );
}
