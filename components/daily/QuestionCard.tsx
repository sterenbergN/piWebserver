'use client';

import { useState } from 'react';
import AnswerInput, { AnswerText, toResponse, type Draft } from './AnswerInput';
import { MathText } from './MathText';
import type { PartResult, PublicInput, PublicQuestion, QuestionStatus } from '@/lib/daily/grade';
import { XP_RULES, triesFactor } from '@/lib/daily/progress';
import type { CheckResult } from './useDaily';
import { REPORT_KINDS, REPORT_LABEL, TRACK_LABEL, type Formula, type PartResponse, type Question } from '@/lib/daily/types';

export type Feedback = { rating: 'up' | 'down' | null; difficulty: 'easy' | 'right' | 'hard' | null; report: { kind: string; note: string } | null };

export type Answered = {
  status: QuestionStatus;
  correct: number;
  total: number;
  parts: PartResult[];
  responses: Record<string, PartResponse> | null;
  hints: number;
  /** Checks it took (1–3). */
  tries?: number;
  xp: number;
  regraded?: boolean;
  late?: boolean;
  question: Omit<Question, 'check'>;
  feedback?: Feedback;
};

/** Show a saved response in the same boxes it was typed into. */
function draftFrom(input: PublicInput, response: PartResponse | undefined): Draft {
  if (!response) return {};
  switch (response.type) {
    case 'numeric': return { text: String(response.value) };
    case 'choice': return { option: response.option };
    case 'multi': return { options: response.options };
    case 'range': return { min: response.min === null ? '' : String(response.min), max: response.max === null ? '' : String(response.max), minOpen: response.min === null, maxOpen: response.max === null };
    case 'coefficients': return { num: response.numerator.join(', '), den: response.denominator.join(', ') };
    case 'order': return { items: response.items };
  }
}

const RESULT_TEXT: Record<QuestionStatus, { icon: string; title: string }> = {
  solved: { icon: '✅', title: 'Solved!' },
  partial: { icon: '🟡', title: 'Partly right' },
  wrong: { icon: '❌', title: 'Not quite' },
  studied: { icon: '📖', title: 'Studied' },
};

type Props = {
  q: PublicQuestion;
  kind: 'core' | 'bonus';
  boss: boolean;
  /** Answering a past day's question (half XP). */
  late: boolean;
  answered?: Answered;
  /** Checks already used (when the question isn't finished). */
  tries?: number;
  formulas: Formula[];
  signedIn: boolean;
  /** Check the answer: resolves with a CheckResult when there are checks left and it wasn't fully right. */
  onAnswer: (responses: Record<string, PartResponse>, hints: number) => Promise<unknown>;
  onReveal: (hints: number) => Promise<unknown>;
  onFeedback: (patch: Partial<Feedback>) => Promise<void>;
};

export default function QuestionCard({ q, kind, boss, late, answered, tries = 0, formulas, signedIn, onAnswer, onReveal, onFeedback }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [hintsShown, setHintsShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  /** The last check that wasn't fully right; a part's mark clears once you change it. */
  const [lastCheck, setLastCheck] = useState<CheckResult | null>(null);
  const hints = answered ? answered.hints : hintsShown;
  const locked = !!answered;

  const responses: Record<string, PartResponse> = {};
  for (const p of q.parts) {
    const r = toResponse(p.input, drafts[p.id] ?? {});
    if (r) responses[p.id] = r;
  }
  const complete = Object.keys(responses).length === q.parts.length;
  const multiplier = (late ? XP_RULES.late : 1) * (kind === 'core' && boss ? XP_RULES.boss : 1);
  const maxXp = Math.round((XP_RULES.base + XP_RULES.perDifficulty * q.difficulty) * multiplier
    * Math.max(XP_RULES.minHintFactor, 1 - XP_RULES.hintCost * hintsShown) * triesFactor(tries + 1));
  const studyXp = Math.round(XP_RULES.studied * multiplier);
  const triesLeft = XP_RULES.maxTries - tries;

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const check = () => run(async () => {
    const res = await onAnswer(responses, hintsShown) as CheckResult | null | undefined;
    setLastCheck(res && res.final === false ? res : null);
  });
  const usedFormulas = (q.formulas ?? []).map((id) => formulas.find((f) => f.id === id)).filter(Boolean) as Formula[];

  return (
    <article className={`dq-card is-${q.track}${kind === 'core' ? ' is-core' : ''}${answered ? ` is-${answered.status}` : ''}`}>
      <header className="dq-card-head">
        <div className="dq-badges">
          <span className="dq-badge is-kind">{kind === 'core' ? (boss ? '👹 Boss problem' : '⭐ Today’s question') : '🎁 Bonus'}</span>
          <span className={`dq-badge is-track is-${q.track}`}>{TRACK_LABEL[q.track]}</span>
          <span className="dq-badge">{q.topic}</span>
          <span className="dq-difficulty" title={`Difficulty ${q.difficulty} of 5`} aria-label={`Difficulty ${q.difficulty} of 5`}>
            {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < q.difficulty ? 'is-on' : ''} />)}
          </span>
        </div>
        <h2>{q.title}</h2>
      </header>

      <MathText>{q.prompt}</MathText>
      {q.figure && (
        <figure className="dq-figure">
          {/* An image, not inline SVG: the markup can't run anything. */}
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.figure)}`} alt={q.figureAlt ?? ''} />
        </figure>
      )}

      <div className="dq-parts">
        {q.parts.map((p, i) => {
          const result = answered ? answered.parts.find((r) => r.id === p.id) : lastCheck?.parts.find((r) => r.id === p.id);
          const draft = answered ? draftFrom(p.input, answered.responses?.[p.id]) : drafts[p.id] ?? {};
          const key = answered?.question.parts.find((x) => x.id === p.id)?.answer;
          return (
            <section key={p.id} className={`dq-part${result ? (result.correct ? ' is-right' : ' is-wrong') : ''}`}>
              <div id={`${q.id}-${p.id}-label`} className="dq-part-label">
                {q.parts.length > 1 && <strong>({String.fromCharCode(97 + i)}) </strong>}
                {p.prompt ? <MathText className="is-inline">{p.prompt}</MathText> : q.parts.length === 1 ? <span className="dq-hint">Your answer</span> : null}
              </div>
              {(!answered || answered.responses) && (
                <AnswerInput id={`${q.id}-${p.id}`} input={p.input} draft={draft} locked={locked}
                  onChange={(d) => {
                    setDrafts((all) => ({ ...all, [p.id]: d }));
                    setLastCheck((c) => (c ? { ...c, parts: c.parts.filter((r) => r.id !== p.id) } : c));
                  }} />
              )}
              {answered && key && (
                <div className="dq-key">
                  {result && <span className="dq-mark" aria-label={result.correct ? 'Correct' : 'Incorrect'}>{result.correct ? '✓' : '✗'}</span>}
                  <span>{result?.correct ? 'Correct:' : 'Answer:'}</span> <AnswerText answer={key} />
                </div>
              )}
              {!answered && result && (
                <div className="dq-key">
                  <span className="dq-mark" aria-label={result.correct ? 'Correct' : 'Incorrect'}>{result.correct ? '✓' : '✗'}</span>
                  <span>{result.correct ? 'That part’s right.' : 'Not this one — have another go.'}</span>
                </div>
              )}
              {result?.mistake && <div className="dq-mistake"><strong>Common slip:</strong> <MathText className="is-inline">{result.mistake}</MathText></div>}
            </section>
          );
        })}
      </div>

      {!answered && (
        <>
          {q.hints && q.hints.length > 0 && (
            <div className="dq-hints">
              {q.hints.slice(0, hintsShown).map((h, i) => <div key={i} className="dq-hint-box"><strong>Hint {i + 1}:</strong> <MathText className="is-inline">{h}</MathText></div>)}
              {hintsShown < q.hints.length && (
                <button type="button" className="dq-text-btn" onClick={() => setHintsShown((n) => n + 1)}>
                  💡 Show a hint ({q.hints.length - hintsShown} left, −{Math.round(XP_RULES.hintCost * 100)}% XP each)
                </button>
              )}
            </div>
          )}
          <div className="dq-actions">
            <button type="button" className="btn btn-primary" disabled={!complete || busy} onClick={check}>
              {busy ? 'Checking…' : tries === 0 ? 'Check my answer' : `Check again (${triesLeft} left)`}
            </button>
            {!confirmReveal ? (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmReveal(true)}>{tries ? 'Give up, show me the work' : 'Just show me the work'}</button>
            ) : (
              <div className="dq-confirm" role="alert">
                <span>{kind === 'core' ? `This counts for your streak and earns ${studyXp} XP for studying it, and the question locks.` : `This earns ${studyXp} XP for studying it, and the question locks.`}</span>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmReveal(false)}>Back</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => onReveal(hintsShown))}>Show it</button>
              </div>
            )}
          </div>
          {lastCheck && (
            <p className="dq-check-note" role="status">
              {lastCheck.correct} of {lastCheck.total} part{lastCheck.total === 1 ? '' : 's'} right. {triesLeft === 1 ? 'Last check left' : `${triesLeft} checks left`} — fix the ✗ and try again, or give up and see the work.
            </p>
          )}
          <p className="dq-hint dq-worth">
            Worth up to <strong>{maxXp} XP</strong>{late ? ' (half, catching up on an earlier day)' : ''}{kind === 'core' && boss ? ' (×1.5 boss bonus)' : ''}.
            {' '}Up to {XP_RULES.maxTries} checks, −{Math.round(XP_RULES.retryCost * 100)}% XP for each one after the first. Stuck? The worked solution is {studyXp} XP.
          </p>
        </>
      )}

      {answered && (
        <>
          <div className={`dq-result is-${answered.status}`} role="status">
            <span className="dq-result-icon" aria-hidden>{RESULT_TEXT[answered.status].icon}</span>
            <div>
              <strong>{RESULT_TEXT[answered.status].title}</strong>
              <span>
                {answered.status === 'studied' ? `You read the worked solution · +${answered.xp} XP for studying it.`
                  : `${answered.correct} of ${answered.total} part${answered.total === 1 ? '' : 's'} right · +${answered.xp} XP${(answered.tries ?? 1) > 1 ? ` · check ${answered.tries}` : ''}${answered.hints ? ` · ${answered.hints} hint${answered.hints === 1 ? '' : 's'}` : ''}${answered.late ? ' · caught up' : ''}`}
              </span>
              {answered.regraded && <span className="dq-regraded">🔁 Regraded after the answer key was corrected.</span>}
            </div>
          </div>

          <section className="dq-solution">
            <h3>Worked solution</h3>
            <MathText>{answered.question.solution}</MathText>
          </section>

          {usedFormulas.length > 0 && (
            <p className="dq-hint">Formulas used: {usedFormulas.map((f) => f.name).join(' · ')}</p>
          )}
          <section className="dq-sources">
            <h3>Sources</h3>
            <ul>
              {answered.question.sources.map((s, i) => (
                <li key={i}>
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                  {s.detail && <span className="dq-hint"> — {s.detail}</span>}
                </li>
              ))}
            </ul>
          </section>

          {signedIn && answered.feedback && <FeedbackBox feedback={answered.feedback} onChange={onFeedback} />}
        </>
      )}
    </article>
  );
}

function FeedbackBox({ feedback, onChange }: { feedback: Feedback; onChange: (patch: Partial<Feedback>) => Promise<void> }) {
  const [reporting, setReporting] = useState(false);
  const [kind, setKind] = useState<string>(REPORT_KINDS[0]);
  const [note, setNote] = useState('');

  return (
    <section className="dq-feedback">
      <h3>How was this one?</h3>
      <p className="dq-hint">Your ratings shape next week’s questions.</p>
      <div className="dq-feedback-row">
        <div className="dq-seg" role="radiogroup" aria-label="Difficulty">
          {(['easy', 'right', 'hard'] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={feedback.difficulty === d} onClick={() => onChange({ difficulty: d })}>
              {d === 'easy' ? 'Too easy' : d === 'right' ? 'About right' : 'Too hard'}
            </button>
          ))}
        </div>
        <div className="dq-thumbs">
          <button type="button" aria-pressed={feedback.rating === 'up'} aria-label="Good question" onClick={() => onChange({ rating: feedback.rating === 'up' ? null : 'up' })}>👍</button>
          <button type="button" aria-pressed={feedback.rating === 'down'} aria-label="Not a good question" onClick={() => onChange({ rating: feedback.rating === 'down' ? null : 'down' })}>👎</button>
        </div>
      </div>
      {feedback.report ? (
        <p className="dq-hint">⚑ Reported: {REPORT_LABEL[feedback.report.kind as keyof typeof REPORT_LABEL] ?? feedback.report.kind}{feedback.report.note ? ` — “${feedback.report.note}”` : ''}. Thanks, it’ll be checked. <button type="button" className="dq-text-btn" onClick={() => onChange({ report: null })}>Withdraw</button></p>
      ) : !reporting ? (
        <button type="button" className="dq-text-btn" onClick={() => setReporting(true)}>⚑ Report a problem with this question</button>
      ) : (
        <div className="dq-report">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What’s wrong">
            {REPORT_KINDS.map((k) => <option key={k} value={k}>{REPORT_LABEL[k]}</option>)}
          </select>
          <textarea rows={2} maxLength={1000} placeholder="What should it say? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="dq-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setReporting(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={async () => { await onChange({ report: { kind, note } }); setReporting(false); }}>Send report</button>
          </div>
        </div>
      )}
    </section>
  );
}
