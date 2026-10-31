'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { MathText } from '@/components/daily/MathText';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import { Choices, Explanation } from '@/components/study/QuestionView';
import { REVIEW_DAYS, type Miss, type StudyQuestion, type StudySummary } from '@/lib/study/study';

// The miss bank: everything due today, one at a time with the answer straight after.

type Item = { miss: Miss; question: StudyQuestion; testTitle: string; course: string };

/** Where a review just left a question. */
function outcome(miss: Miss | undefined, right: boolean) {
  if (!miss) return '';
  if (miss.state === 'cleared') return '🎉 Cleared. You won’t see this one again unless you miss it on a test.';
  if (!right) return 'Back tomorrow.';
  const days = REVIEW_DAYS[miss.box];
  return `Back in ${days} days.`;
}

export default function ReviewPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<number[]>([]);
  const [result, setResult] = useState<{ right: boolean; miss?: Miss } | null>(null);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));

  useEffect(() => {
    let cancelled = false;
    Promise.all([studyGet<{ items: Item[] }>('review=1'), studyGet<{ summary: StudySummary }>()]).then(([due, over]) => {
      if (cancelled) return;
      setItems(due.items);
      setSummary(over.summary);
      setState('ready');
    }).catch((e) => { if (!cancelled) setState(e instanceof SignedOut ? 'signed-out' : 'error'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to review">Your missed questions are only shown to your account.</SignInPrompt></div>;

  const item = items[index];
  const done = state === 'ready' && !item;

  const check = async () => {
    if (!item || busy) return;
    setBusy(true);
    setError('');
    try {
      const body = await studyPost<{ right: boolean; miss: Miss }>('review', { questionId: item.question.id, answer });
      setResult({ right: body.right, miss: body.miss });
      setTally((t) => (body.right ? { ...t, right: t.right + 1 } : { ...t, wrong: t.wrong + 1 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setIndex((i) => i + 1);
    setAnswer([]);
    setResult(null);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Review</h1>
          {state === 'ready' && item && <p>{index + 1} of {items.length} due today</p>}
        </div>
      </header>

      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your reviews.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {item && (
        <section className="sd-card sd-question">
          <div className="sd-question-head">
            <span className="sd-count">{[item.question.topic !== 'General' ? item.question.topic : '', item.testTitle].filter(Boolean).join(' · ')}</span>
            {item.miss.misses > 1 && <span className="td-chip">Missed {item.miss.misses} times</span>}
          </div>
          <MathText className="sd-stem">{item.question.stem}</MathText>
          <Choices key={item.question.id} question={item.question} seed={seed} answer={answer} reveal={!!result} onChange={result ? undefined : setAnswer} />
          {result && <Explanation question={item.question} answer={answer} />}
          {result && <p className="sd-outcome">{outcome(result.miss, result.right)}</p>}
          {error && <p className="sd-warning" role="alert">{error}</p>}
          <div className="sd-actions sd-question-nav">
            {result
              ? <button type="button" className="btn btn-primary" onClick={next}>{index + 1 < items.length ? 'Next' : 'Finish'}</button>
              : <button type="button" className="btn btn-primary" disabled={busy || !answer.length} onClick={check}>Check answer</button>}
          </div>
        </section>
      )}

      {done && (
        <section className="sd-card sd-done">
          <h2>{tally.right + tally.wrong ? '✨ That’s everything for today' : 'Nothing due today'}</h2>
          <p className="hb-hint">
            {tally.right + tally.wrong
              ? `${tally.right} right, ${tally.wrong} back for tomorrow. You can stop here.`
              : summary?.review.active ? 'Your missed questions will come back when they’re due.' : 'Questions you miss on a test will show up here.'}
          </p>
          <Link className="btn btn-secondary" href="/study">Back to PA Today</Link>
        </section>
      )}

      {summary && state === 'ready' && summary.review.active > 0 && (
        <Link className="sd-more" href="/study/anki">🗂️ Send your misses to Anki →</Link>
      )}
    </div>
  );
}
