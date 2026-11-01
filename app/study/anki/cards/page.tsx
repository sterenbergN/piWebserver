'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { SignedOut, studyGet } from '@/components/study/api';
import { CardFace } from '@/components/study/CardFace';
import { Icon } from '@/components/study/Icon';
import { CopyPrompt, PasteReply } from '@/components/study/PromptSteps';
import { cardKey, CARD_COUNTS, cleanDeckName, LONG_BATCH, parseCardReply, type CardDeck, type CardDepth, type CardStyle, type DeckSummary, type ParsedCards } from '@/lib/study/cards';
import { buildCardPrompt, type CardSource } from '@/lib/study/prompt';
import { StudyInputError, type StudySummary } from '@/lib/study/study';

// Make flashcards with her AI: copy a prompt, paste back the reply, take out anything
// she doesn't want, and save it as a deck to download for Anki. A deck remembers its
// cards, so making more from it won't repeat them.

type Leech = { front: string; back: string };

function readPack(text: string): { pack?: ParsedCards; error?: string } {
  if (!text.trim()) return {};
  try {
    return { pack: parseCardReply(text) };
  } catch (error) {
    return { error: error instanceof StudyInputError ? error.message : 'That couldn’t be read.' };
  }
}

async function cardsApi<T>(query: string): Promise<T> {
  const res = await fetch(`/api/study/anki/cards${query}`, { cache: 'no-store' });
  if (res.status === 401) throw new SignedOut();
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'Couldn’t load that.');
  return body as T;
}

function CardMaker() {
  const router = useRouter();
  const deckId = useSearchParams().get('deck');
  const [signedOut, setSignedOut] = useState(false);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [leeches, setLeeches] = useState<Leech[]>([]);
  const [weakTopics, setWeakTopics] = useState<string[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  const [target, setTarget] = useState<CardDeck | null>(null);
  const [source, setSource] = useState<CardSource>('notes');
  const [focus, setFocus] = useState('');
  const [course, setCourse] = useState('');
  const [deckName, setDeckName] = useState('');
  const [count, setCount] = useState(30);
  const [style, setStyle] = useState<CardStyle>('mixed');
  const [depth, setDepth] = useState<CardDepth>('high-yield');
  const [useWeak, setUseWeak] = useState(false);
  const [reply, setReply] = useState('');
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    cardsApi<{ decks: DeckSummary[]; leeches: Leech[] }>('').then((body) => {
      setDecks(body.decks);
      setLeeches(body.leeches);
    }).catch((e) => { if (e instanceof SignedOut) setSignedOut(true); });
    studyGet<{ summary: StudySummary }>().then((body) => {
      setWeakTopics(body.summary.weakTopics.map((t) => t.topic));
      setCourses(body.summary.courses);
    }).catch(() => { /* the options just stay away */ });
  }, []);

  // Making more for a deck picks up its settings, and what it already has.
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    cardsApi<{ deck: CardDeck }>(`?deck=${encodeURIComponent(deckId)}`).then((body) => {
      if (cancelled) return;
      setTarget(body.deck);
      setFocus(body.deck.focus);
      setCourse(body.deck.course);
      setStyle(body.deck.style);
      setDepth(body.deck.depth);
    }).catch(() => { /* a new deck instead */ });
    return () => { cancelled = true; };
  }, [deckId]);

  const prompt = useMemo(() => buildCardPrompt({
    source, subject: focus, course, count, style, depth,
    weakTopics: useWeak ? weakTopics : [],
    leeches: source === 'leeches' ? leeches : [],
    avoid: target ? target.cards.map((c) => c.front) : [],
  }), [source, focus, course, count, style, depth, useWeak, weakTopics, leeches, target]);

  const { pack, error } = useMemo(() => readPack(reply), [reply]);
  const inDeck = useMemo(() => new Set(target?.cards.map((c) => cardKey(c.front)) ?? []), [target]);
  const fresh = pack ? pack.cards.filter((c) => !inDeck.has(cardKey(c.front))) : [];
  const kept = fresh.filter((c) => !removed.includes(c.front));
  const repeats = pack ? pack.cards.length - fresh.length : 0;
  const title = focus.trim() || pack?.title || 'Flashcards';
  const shownDeck = target?.deck ?? cleanDeckName(deckName, title);

  async function save() {
    if (!kept.length || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/study/anki/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save', text: reply, skip: removed,
          ...(target ? { deckId: target.id } : { title, deck: deckName, course: course || pack?.course, focus, style, depth }),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || 'Couldn’t save the deck.');
      router.push(`/study/anki/cards/${body.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Couldn’t save the deck.');
      setSaving(false);
    }
  }

  if (signedOut) return <div className="sd"><SignInPrompt title="Sign in to make cards">Your decks are only shown to your account.</SignInPrompt></div>;

  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href={target ? `/study/anki/cards/${target.id}` : '/study/anki'}><Icon name="left" /> {target ? target.title : 'Anki'}</Link>
          <h1>{target ? 'More cards' : 'Make flashcards'}</h1>
          <p>{target ? `The prompt tells your AI to skip the ${target.cards.length} already in this deck.` : 'Your AI writes them from your notes, you check them, and Anki takes it from there.'}</p>
        </div>
      </header>

      {!target && decks.length > 0 && (
        <section className="sd-card">
          <h2>Your decks</h2>
          <ul className="pr-list">
            {decks.map((d) => (
              <li key={d.id}>
                <Link href={`/study/anki/cards/${d.id}`}>
                  <span className="pr-list-main">
                    <strong>{d.title}</strong>
                    <small>{d.count} card{d.count === 1 ? '' : 's'}{d.course ? ` · ${d.course}` : ''}{d.unsent ? ` · ${d.unsent} not in Anki yet` : ' · all downloaded'}</small>
                  </span>
                  <Icon name="chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CopyPrompt title={source === 'notes' ? 'Copy this into your AI, with your notes' : 'Copy this into your AI'} prompt={prompt}>
        {leeches.length > 0 && !target && (
          <div className="sd-segments" role="radiogroup" aria-label="What the cards come from">
            <button type="button" role="radio" aria-checked={source === 'notes'} onClick={() => setSource('notes')}>From my notes</button>
            <button type="button" role="radio" aria-checked={source === 'leeches'} onClick={() => setSource('leeches')}>Rewrite cards I keep forgetting ({leeches.length})</button>
          </div>
        )}
        <div className="sd-fields">
          {source === 'notes' && (
            <label className="sd-wide">What to cover
              <input value={focus} maxLength={200} placeholder="Heart failure and its drugs" onChange={(e) => setFocus(e.target.value)} />
            </label>
          )}
          {!target && (
            <label>Class or module
              <input list="cd-courses" value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => setCourse(e.target.value)} />
              <datalist id="cd-courses">{courses.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
          )}
          <label>Cards
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {CARD_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>Kind of card
            <select value={style} onChange={(e) => setStyle(e.target.value as CardStyle)}>
              <option value="mixed">Whichever suits each fact</option>
              <option value="basic">Question and answer</option>
              <option value="cloze">Fill in the blank</option>
            </select>
          </label>
          {source === 'notes' && (
            <label>How much of it
              <select value={depth} onChange={(e) => setDepth(e.target.value as CardDepth)}>
                <option value="high-yield">High-yield only</option>
                <option value="thorough">Thorough</option>
                <option value="everything">Every testable detail</option>
              </select>
            </label>
          )}
          {source === 'notes' && weakTopics.length > 0 && (
            <label className="sd-check sd-wide">
              <input type="checkbox" checked={useWeak} onChange={(e) => setUseWeak(e.target.checked)} />
              Lean toward my weakest topics ({weakTopics.slice(0, 3).join(', ')}{weakTopics.length > 3 ? '…' : ''})
            </label>
          )}
        </div>
        {count > LONG_BATCH && <p className="hb-hint">An AI may stop partway through this many. Every whole card still gets saved, or you can make two smaller batches.</p>}
      </CopyPrompt>

      <PasteReply value={reply} onChange={(text) => { setReply(text); setRemoved([]); setSaveError(''); }}>
        {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
        {pack && (
          <div className="sd-preview">
            <p className="sd-found">
              <strong>{kept.length} card{kept.length === 1 ? '' : 's'} ready.</strong>
              {' '}Read through them, since your AI can get things wrong, and take out any you don’t want.
              {repeats > 0 && ` ${repeats} already in this deck ${repeats === 1 ? 'was' : 'were'} left out.`}
            </p>
            {pack.warnings.map((w) => <p key={w} className="sd-warning">{w}</p>)}
            {pack.problems.length > 0 && (
              <details className="sd-problems" open={pack.problems.length <= 3}>
                <summary>{pack.problems.length} couldn’t be used</summary>
                <ul>{pack.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            <ul className="cd-list is-scroll">
              {fresh.map((card) => {
                const out = removed.includes(card.front);
                return (
                  <li key={card.front} className={out ? 'is-out' : ''}>
                    <CardFace card={card} />
                    <button type="button" className="hb-small-btn" aria-pressed={out} aria-label={`${out ? 'Put back' : 'Take out'}: ${card.front.slice(0, 60)}`}
                      onClick={() => setRemoved((list) => (out ? list.filter((f) => f !== card.front) : [...list, card.front]))}>
                      {out ? 'Put back' : 'Take out'}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!target && (
              <div className="sd-fields">
                <label className="sd-wide">Deck name in Anki
                  <input value={deckName} maxLength={120} placeholder={title} onChange={(e) => setDeckName(e.target.value)} />
                  <small className="hb-hint">Goes in as “{shownDeck}”.</small>
                </label>
              </div>
            )}
            {saveError && <div className="hb-banner is-error" role="alert"><span>{saveError}</span></div>}
            <button type="button" className="btn btn-primary" disabled={saving || !kept.length} onClick={save}>{saving ? 'Saving…' : target ? `Add ${kept.length} to the deck` : 'Save the deck'}</button>
          </div>
        )}
      </PasteReply>
    </div>
  );
}

export default function CardMakerPage() {
  return <Suspense><CardMaker /></Suspense>;
}
