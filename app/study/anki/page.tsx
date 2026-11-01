'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loading } from '@/components/study/Ui';
import SignInPrompt from '@/components/journal/SignInPrompt';
import AnkiImport from '@/components/study/AnkiImport';
import { SignedOut, studyGet } from '@/components/study/api';
import { localToday } from '@/lib/habits/dates';
import { ANKI_DECK } from '@/lib/study/anki';
import type { StudySummary } from '@/lib/study/study';

// Anki stays her flashcard scheduler, so this page is the bridge to it. Her
// review history comes in for the PANCE map, and missed questions go out as a
// file for File → Import.

export default function AnkiPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [review, setReview] = useState<StudySummary['review'] | null>(null);
  const [scope, setScope] = useState<'new' | 'all'>('new');
  const [handOff, setHandOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const load = useCallback(async () => {
    const body = await studyGet<{ summary: StudySummary }>();
    setReview(body.summary.review);
    setState('ready');
  }, []);
  useEffect(() => {
    load().catch((e) => setState(e instanceof SignedOut ? 'signed-out' : 'error'));
  }, [load]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to use Anki here">Your missed questions are only shown to your account.</SignInPrompt></div>;

  const forAnki = review?.forAnki ?? 0;
  const active = review?.active ?? 0;
  const anki = review?.anki ?? 0;
  // Nothing new since last time: all that's left to offer is everything again.
  const chosen = forAnki ? scope : 'all';
  const count = chosen === 'new' ? forAnki : active;

  const download = async () => {
    setBusy(true);
    setError('');
    setSent('');
    try {
      const res = await fetch('/api/study/anki', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: chosen, handOff, today: localToday() }),
      });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `missed-questions-${localToday()}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setSent(`Downloaded ${res.headers.get('X-Study-Count') ?? count} question${count === 1 ? '' : 's'}. Now import the file into Anki.`);
      await load();
    } catch {
      setError('Couldn’t make the file. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Anki</h1>
          <p>Show the PANCE map what you’ve studied, and turn the questions you miss into cards.</p>
        </div>
      </header>

      {state === 'loading' && <Loading rows={2} />}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your missed questions.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {state !== 'error' && <AnkiImport />}

      {review && (
        <>
          <section className="sd-card">
            <h2>Send your misses to Anki</h2>
            {sent && <p className="sd-outcome">{sent}</p>}
            {active > 0 ? (
              <>
                <div className="sd-segments" role="radiogroup" aria-label="Which questions">
                  <button type="button" role="radio" aria-checked={chosen === 'new'} disabled={!forAnki} onClick={() => setScope('new')}>New since last time ({forAnki})</button>
                  <button type="button" role="radio" aria-checked={chosen === 'all'} onClick={() => setScope('all')}>All waiting ({active})</button>
                </div>
                <label className="sd-check">
                  <input type="checkbox" checked={handOff} onChange={(e) => setHandOff(e.target.checked)} />
                  <span>Stop reviewing these here, since Anki will take over</span>
                </label>
                {error && <p className="sd-warning" role="alert">{error}</p>}
                <button type="button" className="btn btn-primary sd-self-start" disabled={busy || !count} onClick={download}>{busy ? 'Making the file…' : `Download ${count} for Anki`}</button>
              </>
            ) : (
              <p className="hb-hint">Nothing to send yet. Questions you miss on a test will be ready to send from here.</p>
            )}
            {anki > 0 && <p className="hb-hint">{anki} handed over to Anki so far. If you miss one on a test again, it comes back to Review too.</p>}
          </section>

          <section className="sd-card sd-welcome">
            <h2>Getting them into Anki</h2>
            <ol>
              <li>Download the file above on the computer where you use Anki.</li>
              <li>In Anki, choose <strong>File → Import</strong> and pick the file.</li>
              <li>Check that it shows the Basic note type, then click <strong>Import</strong>.</li>
            </ol>
            <p className="hb-hint">Cards land in a deck called “{ANKI_DECK}”, tagged by class, topic and organ system. The question goes on the front, and the answer, explanation and your notes go on the back. Importing a question twice won’t make a second card. Needs Anki 2.1.54 or newer.</p>
          </section>
        </>
      )}
    </div>
  );
}
