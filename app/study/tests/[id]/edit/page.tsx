'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { useSitePopup } from '@/components/SitePopup';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { InlineMath } from '@/components/study/InlineMath';
import { QuestionEditor } from '@/components/study/QuestionEditor';
import { Loading } from '@/components/study/Ui';
import type { Attempt, StudyTest } from '@/lib/study/study';

// Everything in a test, open to change. Each question saves by itself, so fixing one
// can't lose work on another. This page shows the answers, so it says so if she hasn't
// taken the test yet.

const NEW = 'new';

export default function EditTestPage() {
  const { id } = useParams<{ id: string }>();
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [test, setTest] = useState<StudyTest | null>(null);
  const [taken, setTaken] = useState(false);
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState('');
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const body = await studyGet<{ test: StudyTest; attempts: Attempt[] }>(`test=${encodeURIComponent(id)}`);
    setTest(body.test);
    setTaken(body.attempts.some((a) => a.finishedAt));
    setState('ready');
    return body.test;
  }, [id]);

  useEffect(() => {
    load().then((loaded) => {
      setTitle(loaded.title);
      setCourse(loaded.course);
    }).catch((e) => setState(e instanceof SignedOut ? 'signed-out' : 'error'));
  }, [load]);

  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase();
    const numbered = (test?.questions ?? []).map((question, i) => ({ question, number: i + 1 }));
    if (!words) return numbered;
    return numbered.filter(({ question: q }) => [q.stem, q.topic, q.explanation, ...q.choices].join(' ').toLowerCase().includes(words));
  }, [test, filter]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to edit this test">Your tests are only shown to your account.</SignInPrompt></div>;
  if (state === 'loading') return <div className="sd sd-narrow"><Loading rows={2} /></div>;
  if (!test) return <div className="sd sd-narrow"><div className="hb-banner is-error"><span>That test isn’t here any more.</span></div><Link className="sd-back" href="/study/tests"><Icon name="left" /> Practice tests</Link></div>;

  const dirty = title !== test.title || course !== test.course;
  const saveDetails = async () => {
    setDetailsError('');
    try {
      await studyPost('update-test', { testId: id, title, course });
      await load();
      setDetailsSaved(true);
    } catch (e) {
      setDetailsError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    }
  };
  const done = async (message: string) => {
    await load();
    setOpen(null);
    setNotice(message);
  };
  const remove = async (questionId: string, number: number) => {
    const ok = await confirm({ title: `Remove question ${number}?`, message: 'It goes from this test and your miss bank, and stops counting in the scores of tries you’ve finished.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await studyPost('remove-question', { testId: id, questionId });
    await done(`Question ${number} removed.`);
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      {popup}
      <header className="sd-head">
        <div>
          <Link className="sd-back" href={`/study/tests/${id}`}><Icon name="left" /> {test.title}</Link>
          <h1>Edit this test</h1>
          <p>{test.questions.length} question{test.questions.length === 1 ? '' : 's'}</p>
        </div>
      </header>

      {!taken && test.questions.length > 0 && <div className="sd-nudge"><span>You haven’t taken this one yet, and this page shows the answers.</span></div>}

      <section className="sd-card">
        <div className="sd-fields">
          <label className="sd-wide">Name
            <input value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setDetailsSaved(false); }} />
          </label>
          <label className="sd-wide">Class or module
            <input value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => { setCourse(e.target.value); setDetailsSaved(false); }} />
          </label>
        </div>
        {detailsError && <p className="sd-warning" role="alert">{detailsError}</p>}
        <div className="sd-actions">
          <button type="button" className="btn btn-secondary" disabled={!dirty || !title.trim()} onClick={saveDetails}>Save</button>
          {detailsSaved && !dirty && <span className="sd-outcome"><Icon name="check" /> Saved</span>}
        </div>
      </section>

      <section className="sd-card">
        <div className="sd-card-head">
          <h2>Questions</h2>
          <button type="button" className="hb-small-btn" onClick={() => { setOpen(NEW); setNotice(''); }}><Icon name="plus" /> Add a question</button>
        </div>
        {test.questions.length > 8 && <input value={filter} aria-label="Find a question" placeholder="Find a question" onChange={(e) => setFilter(e.target.value)} />}
        {notice && <p className="sd-outcome" role="status"><Icon name="check" /> {notice}</p>}
        {open === NEW && (
          <QuestionEditor saveLabel="Add the question" onCancel={() => setOpen(null)} onSave={async (input) => {
            await studyPost('add-question', { testId: id, ...input });
            await done('Question added.');
          }} />
        )}
        <ol className="ed-list">
          {shown.map(({ question, number }) => (
            <li key={question.id} className={open === question.id ? 'is-open' : ''}>
              {open === question.id ? (
                <>
                  <p className="sd-count">Question {number}</p>
                  <QuestionEditor question={question} onCancel={() => setOpen(null)} onRemove={() => remove(question.id, number)} onSave={async (input) => {
                    await studyPost('edit-question', { testId: id, questionId: question.id, ...input });
                    await done(`Question ${number} saved.`);
                  }} />
                </>
              ) : (
                <>
                  <span className="ed-number" aria-hidden>{number}</span>
                  <span className="ed-summary">
                    <span className="ed-stem"><InlineMath>{question.stem}</InlineMath></span>
                    <small>{question.correct.map((i) => question.choices[i]).filter(Boolean).map((c, i) => <span key={i}>{i > 0 && ' · '}<InlineMath>{c}</InlineMath></span>)}</small>
                  </span>
                  <button type="button" className="hb-small-btn" aria-label={`Edit question ${number}`} onClick={() => { setOpen(question.id); setNotice(''); }}><Icon name="pencil" /> Edit</button>
                </>
              )}
            </li>
          ))}
        </ol>
        {!shown.length && <p className="hb-hint">{test.questions.length ? 'Nothing matches that.' : 'No questions yet. Add one above.'}</p>}
      </section>
    </div>
  );
}
