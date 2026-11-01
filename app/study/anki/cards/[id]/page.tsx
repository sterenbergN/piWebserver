'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { useSitePopup } from '@/components/SitePopup';
import { SignedOut } from '@/components/study/api';
import { CardFace } from '@/components/study/CardFace';
import { Icon } from '@/components/study/Icon';
import { Loading } from '@/components/study/Ui';
import { unsentCards, type AnkiCard, type CardDeck } from '@/lib/study/cards';

// One deck: get it into Anki, fix what's wrong, and make more. Cards already handed
// over stay marked, so she can send only what's new and leave her edits in Anki alone.

async function post(action: string, payload: Record<string, unknown>) {
  const res = await fetch('/api/study/anki/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'That didn’t save. Try again.');
}

function CardRow({ card, deckId, onChanged }: { card: AnkiCard; deckId: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="cd-editing">
        <label className="sd-mend-label">{card.kind === 'cloze' ? 'Text, with {{c1::blanks}}' : 'Question'}
          <textarea rows={3} value={front} onChange={(e) => setFront(e.target.value)} />
        </label>
        <label className="sd-mend-label">{card.kind === 'cloze' ? 'Extra' : 'Answer'}
          <textarea rows={3} value={back} onChange={(e) => setBack(e.target.value)} />
        </label>
        {error && <p className="sd-warning" role="alert">{error}</p>}
        <div className="sd-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => post('edit-card', { deckId, cardId: card.id, front, back }))}>Save</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(() => post('remove-card', { deckId, cardId: card.id }))}>Remove the card</button>
          <button type="button" className="hb-text-btn" disabled={busy} onClick={() => { setEditing(false); setFront(card.front); setBack(card.back); }}>Cancel</button>
        </div>
      </li>
    );
  }
  return (
    <li>
      <CardFace card={card} />
      <span className="cd-row-side">
        {!card.exportedAt && <span className="td-chip is-going">New</span>}
        <button type="button" className="hb-small-btn" aria-label={`Edit: ${card.front.slice(0, 60)}`} onClick={() => setEditing(true)}><Icon name="pencil" /> Edit</button>
      </span>
    </li>
  );
}

export default function DeckPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [deck, setDeck] = useState<CardDeck | null>(null);
  const [scope, setScope] = useState<'new' | 'all'>('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/study/anki/cards?deck=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.status === 401) throw new SignedOut();
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error();
    setDeck(body.deck);
    setState('ready');
  }, [id]);
  useEffect(() => {
    load().catch((e) => setState(e instanceof SignedOut ? 'signed-out' : 'error'));
  }, [load]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to see this deck">Your decks are only shown to your account.</SignInPrompt></div>;
  const back = <Link className="sd-back" href="/study/anki/cards"><Icon name="left" /> Make flashcards</Link>;
  if (!deck) {
    return (
      <div className="sd sd-narrow">
        {state === 'loading' ? <Loading rows={2} /> : <><div className="hb-banner is-error"><span>That deck isn’t here any more.</span></div>{back}</>}
      </div>
    );
  }

  const unsent = unsentCards(deck).length;
  const chosen = unsent ? scope : 'all';
  const count = chosen === 'new' ? unsent : deck.cards.length;

  const download = async () => {
    setBusy(true);
    setError('');
    setSent('');
    try {
      const res = await fetch('/api/study/anki/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download', deckId: id, scope: chosen }),
      });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = res.headers.get('X-Study-File') ?? 'cards-anki.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setSent(`Downloaded ${count} card${count === 1 ? '' : 's'}. Now import the file into Anki.`);
      await load();
    } catch {
      setError('Couldn’t make the file. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Delete this deck?', message: `“${deck.title}” goes from here. Anything already imported stays in Anki.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await post('delete-deck', { deckId: id });
      router.push('/study/anki/cards');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete it.');
    }
  };
  const rename = async () => {
    setError('');
    try {
      await post('rename-deck', { deckId: id, deck: name });
      setRenaming(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t rename it.');
    }
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      {popup}
      <header className="sd-head">
        <div>
          {back}
          <h1>{deck.title}</h1>
          <p>{[deck.course, `${deck.cards.length} card${deck.cards.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
        </div>
        <Link className="btn btn-secondary" href={`/study/anki/cards?deck=${deck.id}`}><Icon name="plus" /> Make more</Link>
      </header>

      <section className="sd-card">
        <h2>Get it into Anki</h2>
        {deck.cards.length > unsent && unsent > 0 && (
          <div className="sd-segments" role="radiogroup" aria-label="Which cards">
            <button type="button" role="radio" aria-checked={chosen === 'new'} onClick={() => setScope('new')}>New since last time ({unsent})</button>
            <button type="button" role="radio" aria-checked={chosen === 'all'} onClick={() => setScope('all')}>Every card ({deck.cards.length})</button>
          </div>
        )}
        {sent && <p className="sd-outcome"><Icon name="check" /> {sent}</p>}
        {error && <p className="sd-warning" role="alert">{error}</p>}
        <button type="button" className="btn btn-primary sd-self-start" disabled={busy || !count} onClick={download}>{busy ? 'Making the file…' : <>Download {count} for Anki</>}</button>
        {!unsent && deck.cards.length > 0 && <p className="hb-hint">Every card has been downloaded. Importing them again won’t add second copies.</p>}
        <ol className="sd-howto">
          <li>Download the file on the computer where you use Anki.</li>
          <li>In Anki, choose <strong>File → Import</strong> and pick the file.</li>
          <li>Check it shows note type and deck <strong>from the file</strong>, then click <strong>Import</strong>.</li>
        </ol>
        <p className="hb-hint">Sending a card you edited here? Set <strong>Existing notes</strong> to <strong>Update</strong> in Anki’s import window, which also replaces any changes you made to it there.</p>
        {renaming ? (
          <form className="sd-rename" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input value={name} autoFocus maxLength={120} aria-label="Deck name in Anki" onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="hb-small-btn is-primary" disabled={!name.trim()}>Save</button>
            <button type="button" className="hb-text-btn" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <p className="hb-hint">Goes into “{deck.deck}”. <button type="button" className="hb-text-btn" onClick={() => { setName(deck.deck); setRenaming(true); }}>Change</button></p>
        )}
      </section>

      <section className="sd-card">
        <h2>The cards</h2>
        {deck.cards.length ? (
          <ul className="cd-list">{deck.cards.map((card) => <CardRow key={card.id} card={card} deckId={deck.id} onChanged={load} />)}</ul>
        ) : <p className="hb-hint">No cards left in this deck.</p>}
      </section>

      <button type="button" className="hb-text-btn sd-danger-link sd-self-start" onClick={remove}>Delete this deck</button>
    </div>
  );
}
