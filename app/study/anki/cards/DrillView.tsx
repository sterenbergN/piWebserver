'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { InlineMath } from '@/components/study/InlineMath';
import {
  drillAccuracy,
  drillCardFaces,
  drillClozeSegments,
  gradeDrillCard,
  initDrillQueue,
  shuffleDrillQueue,
  type CardDeck,
  type DrillGrade,
  type DrillScope,
  type DrillState,
} from '@/lib/study/cards';

type Props = {
  deck: CardDeck;
  initialScope: DrillScope;
  onClose: () => void;
  onSaveCard: (cardId: string, front: string, back: string) => Promise<void>;
};

const KEY_TO_GRADE: Record<string, DrillGrade> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

export function DrillView({ deck, initialScope, onClose, onSaveCard }: Props) {
  const [scope, setScope] = useState<DrillScope>(initialScope);
  const [drill, setDrill] = useState<DrillState>(() => initDrillQueue(deck.cards, { scope: initialScope }));
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const unsentCount = useMemo(() => deck.cards.filter((c) => !c.exportedAt).length, [deck.cards]);
  const cardMap = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck.cards]);
  const currentId = drill.queue[0];
  const currentCard = currentId ? cardMap.get(currentId) : undefined;
  const accuracy = drillAccuracy(drill);

  const faces = useMemo(() => (currentCard ? drillCardFaces(currentCard) : null), [currentCard]);
  const segments = useMemo(() => (currentCard ? drillClozeSegments(currentCard) : []), [currentCard]);
  const isClozeCard = Boolean(faces && faces.blanks.length > 0);

  const switchScope = useCallback((nextScope: DrillScope) => {
    setScope(nextScope);
    setDrill(initDrillQueue(deck.cards, { scope: nextScope }));
    setFlipped(false);
    setEditing(false);
  }, [deck.cards]);

  const shuffle = useCallback(() => {
    setDrill((d) => shuffleDrillQueue(d));
    setFlipped(false);
  }, []);

  const grade = useCallback((value: DrillGrade) => {
    setDrill((d) => gradeDrillCard(d, value));
    setFlipped(false);
    setEditing(false);
  }, []);

  const retryMissed = useCallback(() => {
    const missed = deck.cards.filter((c) => drill.missedIds.includes(c.id));
    setDrill(initDrillQueue(missed));
    setFlipped(false);
    setEditing(false);
  }, [deck.cards, drill.missedIds]);

  const restart = useCallback(() => {
    setDrill(initDrillQueue(deck.cards, { scope }));
    setFlipped(false);
    setEditing(false);
  }, [deck.cards, scope]);

  const startEdit = () => {
    if (!currentCard) return;
    setEditFront(currentCard.front);
    setEditBack(currentCard.back);
    setEditError('');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!currentCard || saving) return;
    setSaving(true);
    setEditError('');
    try {
      await onSaveCard(currentCard.id, editFront, editBack);
      setEditing(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      if (editing) {
        if (e.key === 'Escape') setEditing(false);
        return;
      }
      if (!currentCard || drill.queue.length === 0) return;

      if (e.key === ' ' || e.key === 'Enter') {
        const isOtherControl =
          target instanceof HTMLElement &&
          (target.tagName === 'BUTTON' || target.tagName === 'A') &&
          !target.classList.contains('cd-drill-stage');
        if (isOtherControl) return;
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }

      if (flipped && KEY_TO_GRADE[e.key]) {
        e.preventDefault();
        grade(KEY_TO_GRADE[e.key]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, currentCard, drill.queue.length, flipped, grade]);

  const progressPct = drill.totalCards > 0 ? Math.round((drill.completedIds.length / drill.totalCards) * 100) : 0;
  const goodEasyCount = drill.counts.good + drill.counts.easy;
  const missedCount = drill.missedIds.length;

  return (
    <section className="cd-drill" aria-label="Flashcard drill">
      <div className="cd-drill-bar">
        <div className="cd-drill-stats">
          <strong>{drill.completedIds.length} / {drill.totalCards} reviewed</strong>
          <span>Accuracy {accuracy === null ? '—' : `${accuracy}%`}</span>
        </div>
        <div className="cd-drill-controls">
          <div className="sd-segments cd-scope-pick" role="radiogroup" aria-label="Card filter">
            <button type="button" role="radio" aria-checked={scope === 'all'} onClick={() => switchScope('all')}>
              All
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={scope === 'new'}
              disabled={unsentCount === 0}
              onClick={() => switchScope('new')}
            >
              New only{unsentCount > 0 ? ` (${unsentCount})` : ''}
            </button>
          </div>
          <button type="button" className="hb-small-btn" disabled={drill.queue.length <= 1} onClick={shuffle}>
            🔀 Shuffle
          </button>
          <button type="button" className="hb-small-btn" onClick={onClose}>
            Close / Back to list
          </button>
        </div>
      </div>

      <div className="cd-drill-progress" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(1, drill.totalCards)} aria-valuenow={drill.completedIds.length}>
        <div className="cd-drill-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {drill.totalCards === 0 && (
        <div className="sd-card cd-drill-recap">
          <h2>No new cards left</h2>
          <p className="hb-hint">Every card in this deck has already been downloaded to Anki.</p>
          <div className="sd-actions">
            <button type="button" className="btn btn-primary" onClick={() => switchScope('all')}>
              Practice all {deck.cards.length} cards
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Back to list
            </button>
          </div>
        </div>
      )}

      {drill.totalCards > 0 && drill.queue.length === 0 && (
        <div className="sd-card cd-drill-recap">
          <span className="sd-done-mark" aria-hidden="true"><Icon name="check" size="1.5em" /></span>
          <h2>Session complete</h2>
          <p className="hb-hint">
            Finished {drill.totalCards} card{drill.totalCards === 1 ? '' : 's'} in {drill.reviewed} review{drill.reviewed === 1 ? '' : 's'}.
          </p>
          <dl className="cd-recap-grid">
            <div className="cd-recap-good">
              <dt>Good / Easy</dt>
              <dd>{goodEasyCount}</dd>
            </div>
            <div>
              <dt>Hard</dt>
              <dd>{drill.counts.hard}</dd>
            </div>
            <div className="cd-recap-again">
              <dt>Again</dt>
              <dd>{drill.counts.again}</dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>{accuracy === null ? '—' : `${accuracy}%`}</dd>
            </div>
          </dl>
          <div className="sd-actions">
            {missedCount > 0 && (
              <button type="button" className="btn btn-primary" onClick={retryMissed}>
                🔁 Retry missed ({missedCount})
              </button>
            )}
            <button type="button" className={missedCount > 0 ? 'btn btn-secondary' : 'btn btn-primary'} onClick={restart}>
              Practice again
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Back to list
            </button>
          </div>
        </div>
      )}

      {currentCard && faces && (
        <div className="cd-drill-card">
          <div className="cd-drill-meta">
            <div className="cd-drill-tags">
              <span className="td-chip">{currentCard.topic}</span>
              {currentCard.system && <span className="td-chip">{currentCard.system}</span>}
              {!currentCard.exportedAt && <span className="td-chip is-going">New</span>}
              <span className="hb-hint">{drill.queue.length} left in queue</span>
            </div>
            {!editing && (
              <button type="button" className="hb-small-btn" onClick={startEdit}>
                ✏️ Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="cd-editing">
              <label className="sd-mend-label">
                {currentCard.kind === 'cloze' ? 'Text, with {{c1::blanks}}' : 'Question'}
                <textarea rows={3} value={editFront} autoFocus onChange={(e) => setEditFront(e.target.value)} />
              </label>
              <label className="sd-mend-label">
                {currentCard.kind === 'cloze' ? 'Extra' : 'Answer'}
                <textarea rows={3} value={editBack} onChange={(e) => setEditBack(e.target.value)} />
              </label>
              {editError && <p className="sd-warning" role="alert">{editError}</p>}
              <div className="sd-actions">
                <button type="button" className="btn btn-primary" disabled={saving} onClick={saveEdit}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="hb-text-btn" disabled={saving} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={flipped}
                aria-label={flipped ? 'Card back showing. Click to hide answer.' : 'Card front showing. Click to reveal answer.'}
                className={`cd-drill-stage${flipped ? ' is-flipped' : ''}`}
                onClick={() => setFlipped((f) => !f)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    setFlipped((f) => !f);
                  }
                }}
              >
                <span className="cd-drill-face-label">{flipped ? 'Answer' : 'Prompt'}</span>
                {!flipped ? (
                  <>
                    <p className="cd-drill-text">
                      {isClozeCard
                        ? segments.map((seg, i) =>
                            seg.blank ? (
                              <span key={i} className="cd-drill-blank">
                                {seg.hint ? `[${seg.hint}]` : '[____]'}
                              </span>
                            ) : (
                              <InlineMath key={i}>{seg.text}</InlineMath>
                            ),
                          )
                        : <InlineMath>{faces.frontHtmlOrText}</InlineMath>}
                    </p>
                    <p className="cd-drill-hint">Click card or press Space / Enter to reveal</p>
                  </>
                ) : (
                  <>
                    {isClozeCard ? (
                      <>
                        <p className="cd-drill-text">
                          {segments.map((seg, i) =>
                            seg.blank ? (
                              <mark key={i} className="cd-drill-answer">
                                <InlineMath>{seg.text}</InlineMath>
                              </mark>
                            ) : (
                              <InlineMath key={i}>{seg.text}</InlineMath>
                            ),
                          )}
                        </p>
                        {faces.extra && (
                          <div className="cd-drill-extra">
                            <span>Extra</span>
                            <p><InlineMath>{faces.extra}</InlineMath></p>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="cd-drill-prompt-muted"><InlineMath>{faces.frontHtmlOrText}</InlineMath></p>
                        <div className="cd-drill-reveal"><InlineMath>{faces.revealAnswer}</InlineMath></div>
                      </>
                    )}
                    {currentCard.quote && (
                      <p className="cd-quote">From your notes: <InlineMath>{currentCard.quote}</InlineMath></p>
                    )}
                  </>
                )}
              </div>

              {!flipped ? (
                <div className="sd-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setFlipped(true)}>
                    Show answer (Space)
                  </button>
                </div>
              ) : (
                <div className="cd-drill-grades" role="group" aria-label="Grade recall">
                  <button type="button" className="cd-grade-btn is-again" onClick={() => grade('again')}>
                    1 · Again (re-queue)
                  </button>
                  <button type="button" className="cd-grade-btn is-hard" onClick={() => grade('hard')}>
                    2 · Hard
                  </button>
                  <button type="button" className="cd-grade-btn is-good" onClick={() => grade('good')}>
                    3 · Good
                  </button>
                  <button type="button" className="cd-grade-btn is-easy" onClick={() => grade('easy')}>
                    4 · Easy
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
