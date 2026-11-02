'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { ShareCard } from '@/components/study/ShareCard';
import { clock, pct, Results, Runner } from '@/components/study/TestTaking';
import { Loading, scoreTone } from '@/components/study/Ui';
import { DIFFICULTIES } from '@/lib/study/prompt';
import type { Share } from '@/lib/study/sharing';
import { scoreAttempt, type Attempt, type AttemptMode, type QuestionInput, type StudyTest } from '@/lib/study/study';

// One test: its cover (take it, or look back at past tries), taking it, and the
// results. Your place is saved as you go, so it can be picked up on another device.

const NEW_SET = 'new-set';

type SetOption = { id: string; title: string };
type Loaded = { test: StudyTest; attempts: Attempt[]; sets: SetOption[]; share: Share | null };

export default function TestPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [error, setError] = useState('');
  const [data, setData] = useState<Loaded | null>(null);
  /** The attempt being taken, or null for the cover. */
  const [taking, setTaking] = useState<Attempt | null>(null);
  /** The finished attempt on show. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [setName, setSetName] = useState('');

  const load = useCallback(async () => {
    try {
      const body = await studyGet<Loaded>(`test=${encodeURIComponent(id)}`);
      setData({ test: body.test, attempts: body.attempts, sets: body.sets, share: body.share ?? null });
      setState('ready');
      return body;
    } catch (e) {
      if (e instanceof SignedOut) setState('signed-out');
      else { setError(e instanceof Error ? e.message : 'Couldn’t load that test.'); setState('error'); }
      return null;
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const start = async (mode: AttemptMode, options: { fresh?: boolean; questionIds?: string[] } = {}) => {
    try {
      const body = await studyPost<{ attempt: Attempt }>('start', { testId: id, mode, ...options });
      setViewing(null);
      setTaking(body.attempt);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start the test.');
    }
  };

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see this test">Your tests are only shown to your account.</SignInPrompt></div>;
  if (state === 'loading') return <div className="sd sd-narrow"><Loading rows={2} /></div>;
  if (state === 'error' || !data) {
    return <div className="sd"><div className="hb-banner is-error"><span>{error || 'Couldn’t load that test.'}</span></div><Link className="sd-back" href="/study/tests">← Practice tests</Link></div>;
  }

  const { test, attempts, sets, share } = data;
  const inSet = sets.find((s) => s.id === test.setId);
  if (taking) {
    return (
      <Runner test={test} attempt={taking}
        onLeave={async () => { setTaking(null); await load(); }}
        onFinished={async (finished) => { setTaking(null); await load(); setViewing(finished); window.scrollTo({ top: 0 }); }} />
    );
  }

  const finished = attempts.filter((a) => a.finishedAt).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  const open = attempts.find((a) => !a.finishedAt);
  const shown = viewing ? finished.find((a) => a.id === viewing) : null;
  const before = shown ? finished[finished.indexOf(shown) + 1] : undefined;

  const deleteTest = async () => {
    const ok = await confirm({ title: 'Delete this test?', message: `“${test.title}”, every try at it, and its questions in your miss bank will be gone for good.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await studyPost('delete-test', { testId: id });
      router.push('/study/tests');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete it.');
    }
  };

  const discard = async () => {
    if (!open) return;
    const ok = await confirm({ title: 'Throw away this try?', message: 'Your answers so far won’t be kept or graded.', confirmLabel: 'Throw away', danger: true });
    if (!ok) return;
    await studyPost('discard', { attemptId: open.id }).catch(() => {});
    await load();
  };

  const moveToSet = async (setId: string, newTitle?: string) => {
    setError('');
    if (setId === NEW_SET && !newTitle) {
      setNaming(true);
      return;
    }
    try {
      await studyPost('move-test', { testId: id, ...(newTitle ? { newSet: { title: newTitle, course: test.course, difficulty: test.difficulty } } : { setId }) });
      setNaming(false);
      setSetName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t move it.');
    }
  };

  const fix = async (questionId: string, input: QuestionInput) => {
    await studyPost('edit-question', { testId: id, questionId, ...input });
    await load();
  };
  const removeQ = async (questionId: string) => {
    await studyPost('remove-question', { testId: id, questionId });
    await load();
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      {popup}
      <header className="sd-head">
        <div>
          <Link className="sd-back" href={inSet ? `/study/tests/sets/${inSet.id}` : '/study/tests'}>← {inSet ? inSet.title : 'Practice tests'}</Link>
          <h1>{test.title}</h1>
          <p>{[test.course, `${test.questions.length} question${test.questions.length === 1 ? '' : 's'}`, test.difficulty ? DIFFICULTIES[test.difficulty - 1]?.label : '', test.source ? `from ${test.source.by}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
        {!shown && <Link className="btn btn-secondary" href={`/study/tests/${id}/edit`}><Icon name="pencil" /> Edit</Link>}
      </header>
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}

      {shown ? (
        <>
          {inSet && (
            <div className="sd-nudge">
              <span>Ready for more on {inSet.title}? The next test will know how this one went.</span>
              <Link className="hb-small-btn" href={`/study/add?set=${inSet.id}`}>Make the next test</Link>
            </div>
          )}
          <Results test={test} attempt={shown} previous={before} onBack={() => setViewing(null)}
            onRetake={(ids) => start('exam', { fresh: true, questionIds: ids })} onFix={fix} onRemove={removeQ} />
        </>
      ) : (
        <>
          <section className="sd-card">
            {open ? (
              <>
                <h2>You’re part way through</h2>
                <p className="hb-hint">{Object.keys(open.answers).length} of {open.questionIds.length} answered, {clock(open.elapsed)} so far.</p>
                <div className="sd-actions">
                  <button type="button" className="btn btn-primary" onClick={() => start(open.mode)}>Keep going</button>
                  <button type="button" className="btn btn-secondary" onClick={discard}>Throw it away</button>
                </div>
              </>
            ) : test.questions.length === 0 ? (
              <p className="hb-hint">This test has no questions left.</p>
            ) : (
              <>
                <h2>{finished.length ? 'Take it again' : 'Take this test'}</h2>
                <div className="sd-modes">
                  <button type="button" className="sd-mode" onClick={() => start('exam')}>
                    <span className="sd-tile-icon"><Icon name="tests" /></span>
                    <span><strong>Exam</strong><small>Answer everything, then see your score.</small></span>
                  </button>
                  <button type="button" className="sd-mode" onClick={() => start('tutor')}>
                    <span className="sd-tile-icon"><Icon name="chat" /></span>
                    <span><strong>Tutor</strong><small>See the answer and why after each question.</small></span>
                  </button>
                </div>
              </>
            )}
          </section>

          {finished.length > 0 && (
            <section className="sd-card">
              <h2>Past tries</h2>
              <ul className="sd-test-list">
                {finished.map((attempt) => {
                  const score = scoreAttempt(attempt, test);
                  return (
                    <li key={attempt.id}>
                      <button type="button" className="sd-test" onClick={() => setViewing(attempt.id)}>
                        <span className="sd-test-main">
                          <strong>{new Date(String(attempt.finishedAt)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
                          <small>{score.right} of {score.total} right · {clock(attempt.elapsed)} · {attempt.mode === 'tutor' ? 'Tutor' : 'Exam'}</small>
                        </span>
                        <span className={`sd-score ${scoreTone(pct(score.right, score.total))}`}>{pct(score.right, score.total)}%</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <label className="sd-set-move">Set
            <select value={naming ? NEW_SET : test.setId ?? ''} onChange={(e) => { setNaming(false); void moveToSet(e.target.value); }}>
              <option value="">Not in a set</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              <option value={NEW_SET}>New set…</option>
            </select>
          </label>
          {naming && (
            <form className="sd-rename" onSubmit={(e) => { e.preventDefault(); if (setName.trim()) void moveToSet(NEW_SET, setName.trim()); }}>
              <input value={setName} autoFocus maxLength={120} placeholder="Name it after its subject" aria-label="New set name" onChange={(e) => setSetName(e.target.value)} />
              <button type="submit" className="hb-small-btn is-primary" disabled={!setName.trim()}>Create</button>
            </form>
          )}

          {/* A copy of someone else's test is theirs to share, not passed on from here. */}
          {!test.source && test.questions.length > 0 && <ShareCard testId={test.id} share={share} onChange={(next) => setData({ ...data, share: next })} />}

          <button type="button" className="hb-text-btn sd-danger-link" onClick={deleteTest}>Delete this test</button>
        </>
      )}
    </div>
  );
}
