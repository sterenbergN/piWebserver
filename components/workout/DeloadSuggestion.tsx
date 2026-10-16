'use client';

import type { DeloadSuggestion as Suggestion } from '@/lib/workout/deload';

type DeloadSuggestionProps = {
  suggestion: Suggestion;
  /** Whether the next workout will be a deload. */
  chosen: boolean;
  onChoose: (deload: boolean) => void;
  onDismiss: () => void;
};

/**
 * "Deload suggested" with the reasons. Only a suggestion: use it for the next
 * workout or ignore it.
 */
export default function DeloadSuggestion({ suggestion, chosen, onChoose, onDismiss }: DeloadSuggestionProps) {
  return (
    <div className={`workout-deload-card${chosen ? ' is-chosen' : ''}`} role="note">
      <strong style={{ display: 'block', marginBottom: '0.25rem' }}>{chosen ? '🧘 Next workout is a deload' : '🧘 Deload suggested'}</strong>
      {!chosen && (
        <ul style={{ margin: '0 0 0.6rem', paddingLeft: '1.1rem', fontSize: '0.82rem', color: 'var(--muted)' }}>
          {suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      <p className="workout-hint" style={{ margin: '0 0 0.6rem' }}>
        {chosen ? 'Lighter weights and fewer sets so you recover and come back stronger.' : 'A lighter session — about 15% less weight and one fewer set per lift. Your call.'}
      </p>
      {chosen ? (
        <button className="workout-button is-small" onClick={() => onChoose(false)}>Undo — train normally</button>
      ) : (
        <div className="workout-grid-2">
          <button className="workout-button is-primary" onClick={() => onChoose(true)}>Use for this workout</button>
          <button className="workout-button" onClick={onDismiss}>Not today</button>
        </div>
      )}
    </div>
  );
}
