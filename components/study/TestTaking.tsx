'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { MathText } from '@/components/daily/MathText';
import { choiceOrder, isRight, scoreAttempt, type Attempt, type QuestionInput, type StudyQuestion, type StudyTest } from '@/lib/study/study';
import { studyPost } from './api';
import { Icon } from './Icon';
import { QuestionEditor } from './QuestionEditor';
import { Choices, Explanation } from './QuestionView';
import { ScoreRing, scoreTone } from './Ui';

// Taking a test and seeing how it went. Shared by her own tests and by a shared
// test someone takes without an account, which saves to their browser instead.

const SAVE_DELAY = 1500;
export const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
};
export const pct = (right: number, total: number) => (total ? Math.round((right / total) * 100) : 0);

// ── Taking it ────────────────────────────────────────────────────────────────

/** Where a try's answers go as they're given: her account, or (for a guest) this browser. */
export type AttemptSaver = {
  save: (payload: AttemptPayload) => Promise<void>;
  finish: (payload: AttemptPayload) => Promise<void>;
  /** The last answers as the page goes away. It can't wait for a reply. */
  onPageHide: (payload: AttemptPayload) => void;
};
export type AttemptPayload = { attemptId: string; answers: Record<string, number[]>; flagged: string[]; elapsed: number };

export const accountSaver: AttemptSaver = {
  save: async (payload) => { await studyPost('save', payload); },
  finish: async (payload) => { await studyPost('finish', payload); },
  onPageHide: (payload) => { navigator.sendBeacon?.('/api/study', new Blob([JSON.stringify({ action: 'save', ...payload })], { type: 'application/json' })); },
};

export function Runner({ test, attempt, onLeave, onFinished, saver = accountSaver }: { test: StudyTest; attempt: Attempt; onLeave: () => Promise<void>; onFinished: (id: string) => Promise<void>; saver?: AttemptSaver }) {
  const { confirm, popup } = useSitePopup();
  const questions = useMemo(() => {
    const byId = new Map(test.questions.map((q) => [q.id, q]));
    return attempt.questionIds.flatMap((id) => { const q = byId.get(id); return q ? [q] : []; });
  }, [test, attempt.questionIds]);
  const [answers, setAnswers] = useState(attempt.answers);
  const [flagged, setFlagged] = useState(attempt.flagged);
  const firstOpen = Math.max(0, questions.findIndex((q) => !attempt.answers[q.id]?.length));
  const [index, setIndex] = useState(firstOpen);
  /** Tutor mode: questions whose answer has been checked. A resumed attempt treats what's answered as checked. */
  const [checked, setChecked] = useState<string[]>(() => Object.keys(attempt.answers));
  const [elapsed, setElapsed] = useState(attempt.elapsed);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');

  // What to send: kept in a ref so the timer and the send on leaving see the latest.
  const latest = useRef({ answers, flagged, elapsed, dirty: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const l = latest.current;
    if (!l.dirty) return;
    l.dirty = false;
    try {
      await saver.save({ attemptId: attempt.id, answers: l.answers, flagged: l.flagged, elapsed: l.elapsed });
      setSaveFailed(false);
      setSavedOnce(true);
    } catch {
      l.dirty = true;
      setSaveFailed(true);
    }
  }, [attempt.id, saver]);
  const change = useCallback((next: Partial<{ answers: Record<string, number[]>; flagged: string[] }>) => {
    Object.assign(latest.current, next, { dirty: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY);
  }, [flush]);

  // The clock only runs while the page is in front of you.
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.hidden) return;
      latest.current.elapsed += 1;
      setElapsed(latest.current.elapsed);
    }, 1000);
    return () => clearInterval(tick);
  }, []);
  // Leaving the page shouldn't lose the last answer.
  useEffect(() => {
    const send = () => {
      const l = latest.current;
      if (!l.dirty) return;
      saver.onPageHide({ attemptId: attempt.id, answers: l.answers, flagged: l.flagged, elapsed: l.elapsed });
      l.dirty = false;
    };
    window.addEventListener('pagehide', send);
    return () => { window.removeEventListener('pagehide', send); send(); };
  }, [attempt.id, saver]);

  const question = questions[index];
  const tutor = attempt.mode === 'tutor';
  const revealed = !!question && tutor && checked.includes(question.id);
  const answer = question ? answers[question.id] ?? [] : [];
  const go = useCallback((to: number) => { setIndex(Math.max(0, Math.min(questions.length - 1, to))); window.scrollTo({ top: 0 }); }, [questions.length]);

  const setAnswer = useCallback((q: StudyQuestion, value: number[]) => {
    const next = { ...latest.current.answers };
    if (value.length) next[q.id] = value;
    else delete next[q.id];
    setAnswers(next);
    change({ answers: next });
  }, [change]);
  const toggleFlag = (id: string) => {
    const now = latest.current.flagged;
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    setFlagged(next);
    change({ flagged: next });
  };

  // Keys, for a long test at a desk: a letter or number picks that choice, arrows move, Enter goes on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!question || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') { go(index + 1); return; }
      if (e.key === 'ArrowLeft') { go(index - 1); return; }
      if (e.key === 'Enter') {
        if ((e.target as HTMLElement).closest?.('button, a')) return;
        if (tutor && !revealed) { if (answers[question.id]?.length) setChecked((list) => [...list, question.id]); return; }
        go(index + 1);
        return;
      }
      if (revealed || !/^[a-h1-8]$/i.test(e.key)) return;
      const shown = /\d/.test(e.key) ? Number(e.key) - 1 : e.key.toUpperCase().charCodeAt(0) - 65;
      const original = choiceOrder(question, attempt.seed)[shown];
      if (original === undefined) return;
      const current = answers[question.id] ?? [];
      setAnswer(question, question.correct.length > 1 ? (current.includes(original) ? current.filter((x) => x !== original) : [...current, original]) : [original]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [question, index, go, revealed, tutor, attempt.seed, answers, setAnswer]);

  const answered = questions.filter((q) => answers[q.id]?.length).length;

  const finish = async () => {
    const blank = questions.length - answered;
    const ok = await confirm({
      title: 'Hand it in?',
      message: blank ? `${blank} question${blank === 1 ? ' is' : 's are'} still blank and will count as missed.` : 'You’ll see your score and every explanation.',
      confirmLabel: 'Hand it in',
    });
    if (!ok) return;
    setFinishing(true);
    setFinishError('');
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      const l = latest.current;
      l.dirty = false;
      await saver.finish({ attemptId: attempt.id, answers: l.answers, flagged: l.flagged, elapsed: l.elapsed });
      await onFinished(attempt.id);
    } catch (e) {
      latest.current.dirty = true;
      setFinishError(e instanceof Error ? e.message : 'Couldn’t hand it in. Your answers are still here.');
      setFinishing(false);
    }
  };

  if (!question) {
    return <div className="sd sd-narrow"><p className="hb-hint">This try has no questions left.</p><button type="button" className="btn btn-secondary" onClick={() => void onLeave()}>Back</button></div>;
  }

  return (
    <div className="sd sd-narrow sd-runner">
      {popup}
      <div className="sd-runner-top">
        <div className="sd-runner-bar">
          <button type="button" className="hb-text-btn sd-with-icon" onClick={async () => { latest.current.dirty = true; await flush(); await onLeave(); }}><Icon name="left" /> Save and leave</button>
          <span className="sd-runner-tools">
            {savedOnce && !saveFailed && <span className="sd-saved">Saved</span>}
            <span className="sd-clock" aria-label={`Time ${clock(elapsed)}`}><Icon name="clock" /> {clock(elapsed)}</span>
            <button type="button" className="btn btn-secondary sd-finish" disabled={finishing} onClick={finish}>{finishing ? 'Handing in…' : 'Hand in'}</button>
          </span>
        </div>
        <div className="progress" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={answered}>
          <div style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>
      </div>
      {saveFailed && <div className="hb-banner is-error" role="alert"><span>Couldn’t save just now. Your answers are still here and it’ll try again.</span></div>}
      {finishError && <div className="hb-banner is-error" role="alert"><span>{finishError}</span></div>}

      <section className="sd-card sd-question">
        <div className="sd-question-head">
          <span className="sd-count">Question {index + 1} of {questions.length}</span>
          <button type="button" className={`sd-flag${flagged.includes(question.id) ? ' is-on' : ''}`} aria-pressed={flagged.includes(question.id)} onClick={() => toggleFlag(question.id)}>
            <Icon name="flag" /> Not sure
          </button>
        </div>
        <div className="sd-question-body" key={question.id}>
          <MathText className="sd-stem">{question.stem}</MathText>
          <Choices question={question} seed={attempt.seed} answer={answer} reveal={revealed} onChange={revealed ? undefined : (value) => setAnswer(question, value)} />
          {revealed && <Explanation question={question} answer={answer} />}
        </div>
        <div className="sd-actions sd-question-nav">
          <button type="button" className="btn btn-secondary" disabled={index === 0} onClick={() => go(index - 1)}>Back</button>
          {tutor && !revealed ? (
            <button type="button" className="btn btn-primary" disabled={!answer.length} onClick={() => setChecked((list) => [...list, question.id])}>Check answer</button>
          ) : index < questions.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => go(index + 1)}>Next</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={finishing} onClick={finish}>Hand in</button>
          )}
        </div>
      </section>

      <p className="sd-keys" aria-hidden><kbd>A</kbd> to <kbd>{String.fromCharCode(64 + Math.min(8, question.choices.length))}</kbd> answer · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>Enter</kbd> {tutor && !revealed ? 'check' : 'next'}</p>

      <nav className="sd-map" aria-label="Jump to a question">
        {questions.map((q, i) => {
          const isDone = !!answers[q.id]?.length;
          const shownWrong = tutor && checked.includes(q.id) && !isRight(q, answers[q.id]);
          return (
            <button key={q.id} type="button" aria-current={i === index ? 'step' : undefined} aria-label={`Question ${i + 1}${isDone ? ', answered' : ''}${flagged.includes(q.id) ? ', not sure' : ''}`}
              className={`${isDone ? 'is-done' : ''}${shownWrong ? ' is-wrong' : ''}${flagged.includes(q.id) ? ' is-flagged' : ''}`} onClick={() => go(i)}>
              {i + 1}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ── Results ──────────────────────────────────────────────────────────────────

/** A plain word on the score: honest, and never a pat on the head for a bad day. */
const verdict = (percent: number) => (percent === 100 ? 'A clean sheet' : percent >= 90 ? 'Excellent' : percent >= 80 ? 'Solid' : percent >= 60 ? 'Getting there' : 'Worth another pass');

export function Results({ test, attempt, previous, onBack, onRetake, onFix, onRemove, guest = false }: {
  test: StudyTest;
  attempt: Attempt;
  previous?: Attempt;
  onBack: () => void;
  onRetake: (questionIds: string[]) => void;
  /** Left out where the test isn't hers to change. */
  onFix?: (questionId: string, input: QuestionInput) => Promise<void>;
  onRemove?: (questionId: string) => Promise<void>;
  /** Taken without an account, so there's no Review for misses to come back in. */
  guest?: boolean;
}) {
  const score = useMemo(() => scoreAttempt(attempt, test), [attempt, test]);
  const missed = score.results.filter((r) => !r.right);
  const [filter, setFilter] = useState<'missed' | 'unsure' | 'all'>(missed.length ? 'missed' : 'all');
  const unsure = score.results.filter((r) => r.flagged);
  const shown = filter === 'missed' ? missed : filter === 'unsure' ? unsure : score.results;
  const number = (id: string) => score.results.findIndex((r) => r.question.id === id) + 1;
  const percent = pct(score.right, score.total);
  const [editing, setEditing] = useState<string | null>(null);
  const earlier = previous ? scoreAttempt(previous, test) : null;
  const change = earlier && earlier.total ? percent - pct(earlier.right, earlier.total) : null;

  return (
    <>
      <section className="sd-card sd-result">
        <div className="sd-result-hero">
          <ScoreRing percent={percent} label="Your score" />
          <div className="sd-result-text">
            <h2>{verdict(percent)}</h2>
            <p>{score.right} of {score.total} right, in {clock(attempt.elapsed)}</p>
            {change !== null && (
              <span className={`sd-delta ${change > 0 ? 'is-up' : change < 0 ? 'is-down' : 'is-same'}`}>
                {change !== 0 && <Icon name="trend" />}{change > 0 ? `Up ${change} points from last time` : change < 0 ? `Down ${-change} points from last time` : 'The same as last time'}
              </span>
            )}
          </div>
        </div>
        <p className="hb-hint">{!(missed.length || unsure.length) ? 'Nothing to review.' : guest ? 'Retake what you missed below. With an account, it would come back in Review until you know it.' : 'What you missed or weren’t sure of will come back in Review.'}</p>
        <div className="sd-actions">
          {missed.length > 0 && <button type="button" className="btn btn-primary" onClick={() => onRetake(missed.map((r) => r.question.id))}>Retake the {missed.length} I missed</button>}
          <button type="button" className="btn btn-secondary" onClick={onBack}>Back to the test</button>
        </div>
        {score.byTopic.length > 1 && (
          <ul className="sd-topics">
            {score.byTopic.map((t) => (
              <li key={t.topic}>
                <span className="progress-label"><span>{t.topic}</span><span>{t.right}/{t.total}</span></span>
                <span className="progress" role="img" aria-label={`${pct(t.right, t.total)}% right`}><span className={`sd-bar ${scoreTone(pct(t.right, t.total))}`} style={{ width: `${pct(t.right, t.total)}%` }} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sd-segments" role="radiogroup" aria-label="Which questions to show">
        <button type="button" role="radio" aria-checked={filter === 'missed'} onClick={() => setFilter('missed')}>Missed ({missed.length})</button>
        <button type="button" role="radio" aria-checked={filter === 'unsure'} onClick={() => setFilter('unsure')}>Not sure ({unsure.length})</button>
        <button type="button" role="radio" aria-checked={filter === 'all'} onClick={() => setFilter('all')}>All ({score.results.length})</button>
      </div>

      {shown.map(({ question, answer, flagged }) => (
        <section key={question.id} className="sd-card sd-question">
          <div className="sd-question-head">
            <span className="sd-count">Question {number(question.id)}{question.topic !== 'General' ? ` · ${question.topic}` : ''}</span>
            {flagged && <span className="sd-flag is-on is-static"><Icon name="flag" /> Not sure</span>}
          </div>
          {editing === question.id && onFix && onRemove ? (
            <QuestionEditor question={question} onCancel={() => setEditing(null)}
              onSave={async (input) => { await onFix(question.id, input); setEditing(null); }}
              onRemove={async () => { await onRemove(question.id); setEditing(null); }} />
          ) : (
            <>
              <MathText className="sd-stem">{question.stem}</MathText>
              <Choices question={question} seed={attempt.seed} answer={answer} reveal />
              <Explanation question={question} answer={answer} />
              {onFix && <button type="button" className="hb-text-btn sd-with-icon sd-self-start" onClick={() => setEditing(question.id)}><Icon name="pencil" /> Something wrong? Edit this question</button>}
            </>
          )}
        </section>
      ))}
      {!shown.length && <p className="hb-hint">Nothing in this group.</p>}
    </>
  );
}
