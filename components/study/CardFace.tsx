'use client';

import type { DraftCard } from '@/lib/study/cards';
import { clozeParts } from '@/lib/study/cards';
import { InlineMath } from './InlineMath';

/** A card as she'd see it, with a cloze's blanks picked out. */
export function CardFace({ card }: { card: Pick<DraftCard, 'kind' | 'front' | 'back' | 'quote'> }) {
  return (
    <div className="cd-face">
      <p className="cd-front">
        {card.kind === 'cloze'
          ? clozeParts(card.front).map((part, i) => (part.blank ? <mark key={i}><InlineMath>{part.text}</InlineMath></mark> : <InlineMath key={i}>{part.text}</InlineMath>))
          : <InlineMath>{card.front}</InlineMath>}
      </p>
      {card.back && <p className="cd-back"><InlineMath>{card.back}</InlineMath></p>}
      {card.quote && <p className="cd-quote"><InlineMath>{card.quote}</InlineMath></p>}
    </div>
  );
}
