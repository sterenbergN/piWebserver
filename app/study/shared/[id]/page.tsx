'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, sharedGet, sharedPost } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { InlineMath } from '@/components/study/InlineMath';
import { Loading } from '@/components/study/Ui';
import { DIFFICULTIES } from '@/lib/study/prompt';
import type { SharePreview } from '@/lib/study/sharing';

// One shared test, from a link or the shared list: what it covers, a taste of its
// questions and none of the answers, then a copy of her own to take.

type Loaded = { preview: SharePreview; mine: boolean; testId?: string; addedId: string | null };

export default function SharedTestPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sharedGet<Loaded>(`id=${encodeURIComponent(id)}`).then((body) => { setData(body); setState('ready'); })
      .catch((e) => {
        if (e instanceof SignedOut) setState('signed-out');
        else { setError(e instanceof Error ? e.message : 'Couldn’t open that test.'); setState('error'); }
      });
  }, [id]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const body = await sharedPost<{ testId: string }>('add', { id });
      router.push(`/study/tests/${body.testId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
      setBusy(false);
    }
  };

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see this test">Shared tests are for people with an account here. Ask whoever sent the link for one.</SignInPrompt></div>;
  if (state === 'loading') return <div className="sd sd-narrow"><Loading rows={2} /></div>;
  if (!data) {
    return (
      <div className="sd sd-narrow">
        <div className="hb-banner is-error"><span>{error || 'Couldn’t open that test.'}</span></div>
        <Link className="sd-back" href="/study/shared"><Icon name="left" /> Shared tests</Link>
      </div>
    );
  }

  const { preview: p } = data;
  const level = p.difficulty ? DIFFICULTIES[p.difficulty - 1]?.label : '';
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/shared"><Icon name="left" /> Shared tests</Link>
          <h1>{p.title}</h1>
          <p>{[data.mine ? 'Shared by you' : `Shared by ${p.by}`, p.course, `${p.count} question${p.count === 1 ? '' : 's'}`, level].filter(Boolean).join(' · ')}</p>
        </div>
      </header>

      <section className="sd-card">
        {data.mine ? (
          <>
            <h2>This is your test</h2>
            <p className="hb-hint">{p.public ? 'It’s listed in Shared tests for everyone, and this link opens it.' : 'Only people with this link can open it.'}</p>
            <Link className="btn btn-secondary sd-self-start" href={`/study/tests/${data.testId}`}>Change how it’s shared</Link>
          </>
        ) : data.addedId ? (
          <>
            <h2>It’s in your tests</h2>
            <p className="hb-hint">You added a copy of this one already.</p>
            <Link className="btn btn-primary sd-self-start" href={`/study/tests/${data.addedId}`}>Open it</Link>
          </>
        ) : (
          <>
            <h2>Add it to your tests</h2>
            <p className="hb-hint">You get your own copy. Your tries and misses are yours, and {p.by} doesn’t see them. Your copy stays as it is if they change theirs later.</p>
            <button type="button" className="btn btn-primary sd-self-start" disabled={busy} onClick={add}>{busy ? 'Adding…' : 'Add to my tests'}</button>
          </>
        )}
        {error && <p className="sd-warning" role="alert">{error}</p>}
      </section>

      {p.topics.length > 0 && (
        <section className="sd-card">
          <h2>What it covers</h2>
          <ul className="sd-share-topics">
            {p.topics.map((t) => <li key={t} className="td-chip">{t}</li>)}
            {p.moreTopics > 0 && <li className="td-chip">and {p.moreTopics} more</li>}
          </ul>
        </section>
      )}

      {p.sample.length > 0 && (
        <section className="sd-card">
          <h2>A taste of it</h2>
          <ol className="sd-share-sample">{p.sample.map((stem, i) => <li key={i}><InlineMath>{stem}</InlineMath></li>)}</ol>
          <p className="hb-hint">The answers stay hidden until you take it.</p>
        </section>
      )}
    </div>
  );
}
