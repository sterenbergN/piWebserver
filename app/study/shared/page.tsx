'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, sharedGet } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { Loading } from '@/components/study/Ui';
import type { SharePreview } from '@/lib/study/sharing';

// Tests people here have published for everyone, and the ones she's shared herself.
// Opening one shows what it covers before she adds her own copy.

type Loaded = { pool: SharePreview[]; mine: SharePreview[]; added: Record<string, string> };

function SharedRow({ item, note }: { item: SharePreview; note?: string }) {
  return (
    <li>
      <Link className="sd-test" href={`/study/shared/${item.id}`}>
        <span className="sd-test-main">
          <strong>{item.title}</strong>
          <small>{[`by ${item.by}`, item.course, `${item.count} question${item.count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small>
        </span>
        {note && <span className="td-chip">{note}</span>}
      </Link>
    </li>
  );
}

export default function SharedTestsPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [data, setData] = useState<Loaded | null>(null);
  const [find, setFind] = useState('');

  useEffect(() => {
    sharedGet<Loaded>().then((body) => { setData(body); setState('ready'); })
      .catch((e) => setState(e instanceof SignedOut ? 'signed-out' : 'error'));
  }, []);

  const mineIds = useMemo(() => new Set(data?.mine.map((m) => m.id)), [data]);
  const others = useMemo(() => {
    const words = find.trim().toLowerCase();
    return (data?.pool ?? []).filter((p) => !mineIds.has(p.id) && (!words || [p.title, p.course, p.by, ...p.topics].join(' ').toLowerCase().includes(words)));
  }, [data, find, mineIds]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see shared tests">Shared tests are for people with an account here.</SignInPrompt></div>;

  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/tests"><Icon name="left" /> Practice tests</Link>
          <h1>Shared tests</h1>
          <p>Tests people here have shared. Add one, and you get your own copy to take.</p>
        </div>
      </header>

      {state === 'loading' && <Loading />}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load shared tests.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {data && (
        <>
          <section className="sd-card">
            <h2>From everyone</h2>
            {data.pool.length > 8 && <input value={find} aria-label="Find a shared test" placeholder="Find by name, class, topic or person" onChange={(e) => setFind(e.target.value)} />}
            {others.length > 0 ? (
              <ul className="sd-test-list">{others.map((item) => <SharedRow key={item.id} item={item} note={data.added[item.id] ? 'Added' : undefined} />)}</ul>
            ) : find ? <p className="hb-hint">Nothing matches that.</p> : (
              <p className="hb-hint">Nothing from anyone else yet. When someone publishes a test, it shows up here for everyone signed in. A test shared by private link only shows to whoever has the link.</p>
            )}
          </section>

          <section className="sd-card">
            <h2>Shared by you</h2>
            {data.mine.length > 0 ? (
              <ul className="sd-test-list">{data.mine.map((item) => <SharedRow key={item.id} item={item} note={item.public ? 'Everyone' : 'Link only'} />)}</ul>
            ) : (
              <p className="hb-hint">Open one of your tests and use Share it, near the bottom, to send a link or publish it here.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
