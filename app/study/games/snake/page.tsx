'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { MathText } from '@/components/daily/MathText';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { InlineMath } from '@/components/study/InlineMath';
import { localToday } from '@/lib/habits/dates';
import type { GameQuestion } from '@/lib/study/games';
import { BOARD, nextQuestion, snakeQuestions, startSnake, tick, turn, type Dir, type SnakeRun } from '@/lib/study/snake';
import { choiceLetter } from '@/lib/study/study';

// Study Snake. The rules are in lib/study/snake.ts. Answers go to the same place
// as every other game's, so they count toward her miss bank and PANCE map.

const STEP_MS = 240;
const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
const BEST_KEY = 'study-snake:best';

function readBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function saveBest(score: number) {
  try { localStorage.setItem(BEST_KEY, String(score)); } catch { /* just not remembered */ }
}

function saveAnswer(questionId: string, answer: number[]) {
  fetch('/api/study/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'answer', questionId, answer, today: localToday() }),
  }).catch(() => { /* the game carries on */ });
}

export default function SnakePage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error' | 'empty'>('loading');
  const [pool, setPool] = useState<GameQuestion[]>([]);
  const [run, setRun] = useState<SnakeRun | null>(null);
  const [best, setBest] = useState(0);
  const runRef = useRef<SnakeRun | null>(null);
  const poolRef = useRef<GameQuestion[]>([]);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);

  /** Every change goes through here, so the timer and the buttons can't trip over each other. */
  const apply = useCallback(<R,>(change: (next: SnakeRun) => R) => {
    if (!runRef.current) return null;
    const next = structuredClone(runRef.current);
    const out = change(next);
    runRef.current = next;
    setRun(next);
    return out;
  }, []);

  const begin = useCallback(() => {
    const fresh = startSnake(poolRef.current, Math.floor(Math.random() * 2 ** 31));
    runRef.current = fresh;
    setRun(fresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBest(readBest());
    (async () => {
      const search = new URLSearchParams(window.location.search);
      search.set('today', localToday());
      const res = await fetch(`/api/study/games?${search}`, { cache: 'no-store' });
      if (cancelled) return;
      if (res.status === 401) { setState('signed-out'); return; }
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !body.success) { setState('error'); return; }
      const usable = snakeQuestions(body.questions);
      if (!usable.length) { setState('empty'); return; }
      poolRef.current = usable;
      setPool(usable);
      setState('ready');
      begin();
    })().catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [begin]);

  const moving = run?.phase === 'moving';
  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => {
      const saved = apply((next) => tick(next, poolRef.current));
      if (saved) saveAnswer(saved.questionId, saved.answer);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [moving, apply]);

  const score = run?.score ?? 0;
  const over = run?.phase === 'over';
  useEffect(() => {
    if (over && score > readBest()) {
      saveBest(score);
      setBest(score);
    }
  }, [over, score]);

  const go = useCallback((dir: Dir) => { apply((next) => turn(next, dir)); }, [apply]);
  const onward = useCallback(() => { apply((next) => nextQuestion(next, poolRef.current)); }, [apply]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const dir = KEYS[event.key];
      if (dir) {
        event.preventDefault();
        go(dir);
      } else if ((event.key === ' ' || event.key === 'Enter') && runRef.current?.phase === 'feedback') {
        event.preventDefault();
        onward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onward]);

  const swipeEnd = (event: TouchEvent) => {
    const from = swipeFrom.current;
    const touch = event.changedTouches[0];
    swipeFrom.current = null;
    if (!from || !touch) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };

  const head = (
    <header className="sd-head pr-snake-head">
      <div>
        <Link className="sd-back" href="/study/games">← Games</Link>
        <h1>Study Snake</h1>
      </div>
    </header>
  );
  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to play">This game uses your own questions.</SignInPrompt></div>;
  if (state !== 'ready' || !run) {
    return (
      <div className="sd sd-narrow animate-fade-in">
        {head}
        {state === 'loading' && <p className="hb-hint">Loading…</p>}
        {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your questions.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}
        {state === 'empty' && (
          <section className="sd-card sd-done">
            <h2>No questions that fit</h2>
            <p className="hb-hint">Snake needs questions with one right answer. Pick something wider, or add a test.</p>
            <Link className="btn btn-primary" href="/study/games">Back to the games</Link>
          </section>
        )}
      </div>
    );
  }

  const question = pool.find((q) => q.id === run.questionId);
  const foodAt = new Map(run.foods.map((food, i) => [`${food.x}:${food.y}`, i]));
  const body = new Set(run.snake.map((s) => `${s.x}:${s.y}`));
  const headKey = `${run.snake[0].x}:${run.snake[0].y}`;
  const cells = Array.from({ length: BOARD * BOARD }, (_, i) => `${i % BOARD}:${Math.floor(i / BOARD)}`);

  return (
    <div className="sd sd-narrow animate-fade-in">
      {head}
      <div className="pr-snake-bar">
        <span aria-label={`${run.hearts} hearts left`}>{'❤️'.repeat(Math.max(0, run.hearts))}</span>
        <span className="sd-count">{run.phase === 'waiting' ? 'Read it, then turn to go' : `${run.right} right · ${run.score} points${best ? ` · best ${best}` : ''}`}</span>
      </div>

      {run.phase === 'over' ? (
        <section className="sd-card sd-done">
          <h2>Game over: {run.score} points</h2>
          <p className="hb-hint">{run.right} right, {run.wrong} wrong. {run.missed.length ? 'What you got wrong is in your miss bank.' : ''}</p>
          <div className="sd-actions">
            <button type="button" className="btn btn-primary" onClick={begin}>Play again</button>
            <Link className="btn btn-secondary" href="/study/games">Done</Link>
          </div>
        </section>
      ) : (
        <>
          {question && (
            <section className={`sd-card pr-snake-question${run.phase === 'feedback' ? ' is-full' : ''}`}>
              <div className="sd-stem"><MathText>{question.stem}</MathText></div>
              <ul className="pr-snake-legend">
                {run.foods.map((food, i) => {
                  const right = run.last && question.correct.includes(food.choice);
                  const chosen = run.last?.answer.includes(food.choice);
                  return (
                    <li key={food.choice} className={right ? 'is-right' : chosen ? 'is-wrong' : ''}>
                      <span className="pr-food">{choiceLetter(i)}</span>
                      <span><InlineMath>{question.choices[food.choice]}</InlineMath></span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {run.phase === 'feedback' && run.last && (
            <section className="sd-card" role="status">
              <h2>{run.last.crashed ? 'Crashed! That cost a heart.' : run.last.right ? '✓ Right' : '✕ Not that one'}</h2>
              {question?.explanation && <MathText>{question.explanation}</MathText>}
              <button type="button" className="btn btn-primary sd-self-start" onClick={onward}>Next question</button>
            </section>
          )}
          {run.phase !== 'feedback' && (
          <>
          <div
            className="pr-board"
            role="img"
            aria-label="Snake board. Use the arrow keys, swipe, or the buttons below."
            style={{ gridTemplateColumns: `repeat(${BOARD}, 1fr)` }}
            onTouchStart={(e) => { const t = e.touches[0]; swipeFrom.current = t ? { x: t.clientX, y: t.clientY } : null; }}
            onTouchEnd={swipeEnd}
          >
            {cells.map((key) => {
              const food = foodAt.get(key);
              return (
                <span key={key} className={key === headKey ? 'is-head' : body.has(key) ? 'is-body' : food !== undefined ? 'is-food' : ''}>
                  {food !== undefined && !body.has(key) ? choiceLetter(food) : ''}
                </span>
              );
            })}
          </div>
          <div className="pr-pad" aria-label="Steer">
            <button type="button" className="hb-small-btn" aria-label="Up" style={{ gridArea: 'up' }} onClick={() => go('up')}>▲</button>
            <button type="button" className="hb-small-btn" aria-label="Left" style={{ gridArea: 'left' }} onClick={() => go('left')}>◀</button>
            <button type="button" className="hb-small-btn" aria-label="Down" style={{ gridArea: 'down' }} onClick={() => go('down')}>▼</button>
            <button type="button" className="hb-small-btn" aria-label="Right" style={{ gridArea: 'right' }} onClick={() => go('right')}>▶</button>
          </div>
          </>
          )}
        </>
      )}
    </div>
  );
}
