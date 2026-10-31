'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet, studyPost } from '@/components/study/api';
import { pct, TestRow } from '@/components/study/TestRow';
import { DIFFICULTIES } from '@/lib/study/prompt';
import type { SetBrief } from '@/lib/study/sets';
import type { TestSummary } from '@/lib/study/study';

// One set: its tests in order, how they've gone, and the way to the next one.

type Loaded = { brief: SetBrief; tests: TestSummary[] };

export default function SetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const body = await studyGet<Loaded>(`set=${encodeURIComponent(id)}`);
      setData({ brief: body.brief, tests: body.tests });
      setName(body.brief.set.title);
      setState('ready');
    } catch (e) {
      if (e instanceof SignedOut) setState('signed-out');
      else { setError(e instanceof Error ? e.message : 'Couldn’t load that set.'); setState('error'); }
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see this set">Your tests are only shown to your account.</SignInPrompt></div>;
  if (state === 'loading') return <div className="sd"><p className="hb-hint">Loading…</p></div>;
  if (state === 'error' || !data) {
    return <div className="sd"><div className="hb-banner is-error"><span>{error || 'Couldn’t load that set.'}</span></div><Link className="sd-back" href="/study/tests">← Practice tests</Link></div>;
  }

  const { brief, tests } = data;
  const { set } = brief;
  const level = DIFFICULTIES[set.difficulty - 1];
  const hasResults = brief.answered > 0;

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await studyPost('update-set', { setId: id, title: name });
      setRenaming(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save.');
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Remove this set?', message: `“${set.title}” goes, and its ${tests.length} test${tests.length === 1 ? '' : 's'} stay, just not grouped any more.`, confirmLabel: 'Remove the set', danger: true });
    if (!ok) return;
    try {
      await studyPost('delete-set', { setId: id });
      router.push('/study/tests');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save.');
    }
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      {popup}
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/tests">← Practice tests</Link>
          {renaming ? (
            <form className="sd-rename" onSubmit={rename}>
              <input value={name} autoFocus maxLength={120} aria-label="Set name" onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="hb-small-btn is-primary">Save</button>
              <button type="button" className="hb-text-btn" onClick={() => { setRenaming(false); setName(set.title); }}>Cancel</button>
            </form>
          ) : <h1>{set.title}</h1>}
          <p>{[set.course, `${tests.length} test${tests.length === 1 ? '' : 's'}`, `${brief.stems.length} questions`].filter(Boolean).join(' · ')}</p>
        </div>
        <Link className="btn btn-primary" href={`/study/add?set=${set.id}`}>Make test {tests.length + 1}</Link>
      </header>
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}

      <section className="sd-card">
        <h2>Tests</h2>
        {tests.length > 0
          ? <ul className="sd-test-list">{tests.map((test) => <TestRow key={test.id} test={test} />)}</ul>
          : <p className="hb-hint">No tests in this set yet.</p>}
      </section>

      <section className="sd-card">
        <h2>What the next test will do</h2>
        <p className="hb-hint">Your AI gets the {brief.stems.length} questions so far and is told not to repeat them{hasResults ? ', along with how you did' : ''}. It’s set to {level?.label ?? 'Board level'}, and you can change that when you make it.</p>
        {!hasResults && tests.length > 0 && <p className="hb-hint">Take these tests first, and the next one can aim at what you missed.</p>}
        {brief.weak.length > 0 && (
          <div>
            <p className="sd-setup-title">Aiming at your weakest topics</p>
            <ul className="sd-topics">
              {brief.weak.slice(0, 8).map((t) => (
                <li key={t.topic}>
                  <span className="progress-label"><span>{t.topic}</span><span>{t.right}/{t.total}</span></span>
                  <span className="progress" role="img" aria-label={`${pct(t.right, t.total)}% right`}><span className="sd-bar" style={{ width: `${pct(t.right, t.total)}%` }} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {brief.missed.length > 0 && <p className="hb-hint">It will come back at the ideas behind {brief.missed.length} question{brief.missed.length === 1 ? '' : 's'} you got wrong, in new ways.</p>}
        {brief.unsure.length > 0 && <p className="hb-hint">It will also retest {brief.unsure.length} you marked “Not sure”.</p>}
        {brief.strong.length > 0 && <p className="hb-hint">It will go easy on {brief.strong.slice(0, 4).map((t) => t.topic).join(', ')}, where you’re solid.</p>}
      </section>

      <div className="sd-actions">
        {!renaming && <button type="button" className="hb-text-btn" onClick={() => setRenaming(true)}>Rename this set</button>}
        <button type="button" className="hb-text-btn sd-danger-link" onClick={remove}>Remove this set</button>
      </div>
    </div>
  );
}
