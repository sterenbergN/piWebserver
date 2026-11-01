// Flashcards her AI writes from her notes, kept as decks here so each new batch knows
// what's already been made, and handed to Anki as a file. Anki stays the scheduler:
// nothing here reviews these cards. Pure, so the server, the browser and the tests
// share it.

import { ankiField, ankiTag } from './anki';
import { readReply, readSystem, StudyInputError, type PanceSystem } from './study';

export const CARD_COUNTS = [10, 20, 30, 50, 75, 100, 150, 200];
/** Past this, a reply is likely to get cut off. Whole cards are still kept. */
export const LONG_BATCH = 100;
const LIMITS = { front: 800, back: 1500, quote: 300, topic: 60, title: 120, deck: 120, cards: 2000, decks: 200 };

export type CardKind = 'basic' | 'cloze';
export type CardStyle = 'mixed' | 'basic' | 'cloze';
export type CardDepth = 'high-yield' | 'thorough' | 'everything';

export type AnkiCard = {
  /** Stays the same if the card is edited, so importing again can't add a second copy to Anki. */
  id: string;
  kind: CardKind;
  /** The question, or the text with its {{c1::blanks}}. */
  front: string;
  /** The answer, or for a cloze the extra shown afterward. */
  back: string;
  topic: string;
  system?: PanceSystem;
  quote?: string;
  exportedAt?: string;
};
export type DraftCard = Omit<AnkiCard, 'id' | 'exportedAt'>;

export type CardDeck = {
  id: string;
  title: string;
  /** Its name in Anki. `::` nests it. */
  deck: string;
  course: string;
  focus: string;
  style: CardStyle;
  depth: CardDepth;
  cards: AnkiCard[];
  createdAt: string;
};

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const CLOZE = /\{\{c\d+::[\s\S]+?\}\}/;
export const isCloze = (text: string) => CLOZE.test(text);
/** Each piece of a cloze in order, blanks marked, for showing it on a page. */
export function clozeParts(text: string) {
  const parts: { blank: boolean; text: string }[] = [];
  const open = /\{\{c\d+::/g;
  let at = 0;
  for (let found = open.exec(text); found; found = open.exec(text)) {
    // Math inside a blank has braces of its own, so the blank ends at the first }} outside them.
    const start = found.index + found[0].length;
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length && end < 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && depth > 0) depth--;
      else if (text[i] === '}' && text[i + 1] === '}') end = i;
    }
    if (end < 0) break;
    if (found.index > at) parts.push({ blank: false, text: text.slice(at, found.index) });
    parts.push({ blank: true, text: text.slice(start, end).replace(/::[^{}$]*$/, '') });
    at = end + 2;
    open.lastIndex = at;
  }
  if (at < text.length) parts.push({ blank: false, text: text.slice(at) });
  return parts;
}

/** What makes two cards the same card, whatever the capitals, spacing or blanks. */
export const cardKey = (front: string) => front.toLowerCase().replace(/\{\{c\d+::|\}\}/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A short id from a card's front, the same every time, so downloading a reply twice can't make two cards. */
export function cardId(front: string) {
  const text = cardKey(front);
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}

/** A problem with this card, or nothing. */
function checkCard(kind: CardKind, front: string, back: string) {
  if (!front) return 'it has no front';
  if (kind === 'cloze') {
    if (!isCloze(front)) return 'it has no {{c1::blank}}';
    if ((front.match(/\{\{c\d+::/g)?.length ?? 0) !== (front.match(/\}\}/g)?.length ?? 0) && !front.includes('$')) return 'its blanks aren’t closed';
    return '';
  }
  return back ? '' : 'it has no answer';
}

export type ParsedCards = { title: string; course: string; cards: DraftCard[]; problems: string[]; warnings: string[] };

export function parseCardReply(text: unknown): ParsedCards {
  if (typeof text !== 'string' || !text.trim()) throw new StudyInputError('Paste the AI’s reply first.');
  const { value, cutOff } = readReply(text);
  const root = isRecord(value) ? value : {};
  const list: unknown[] = Array.isArray(value) ? value : Array.isArray(root.cards) ? root.cards : Array.isArray(root.questions) ? root.questions : isRecord(value) ? [value] : [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const cards = list.flatMap((raw, i): DraftCard[] => {
    if (!isRecord(raw)) { problems.push(`Card ${i + 1}: not a card.`); return []; }
    const front = clip(raw.front ?? raw.text ?? raw.question, LIMITS.front);
    const back = clip(raw.back ?? raw.extra ?? raw.answer, LIMITS.back);
    const kind: CardKind = raw.kind === 'cloze' || raw.type === 'cloze' || isCloze(front) ? 'cloze' : 'basic';
    const problem = checkCard(kind, front, back);
    if (problem) { problems.push(`Card ${i + 1}: ${problem}.`); return []; }
    const key = cardKey(front);
    if (seen.has(key)) { problems.push(`Card ${i + 1}: it’s in there twice.`); return []; }
    seen.add(key);
    const system = readSystem(raw.system);
    const quote = clip(raw.quote, LIMITS.quote);
    return [{ kind, front, back, topic: clip(raw.topic, LIMITS.topic) || 'General', ...(system ? { system } : {}), ...(quote ? { quote } : {}) }];
  });
  if (!cards.length) throw new StudyInputError(`No cards could be used. ${problems.slice(0, 3).join(' ')}`);

  const warnings: string[] = [];
  if (cutOff) warnings.push('The reply looks cut off. Every whole card was kept; ask the AI to continue if you want the rest.');
  const noQuote = cards.filter((c) => !c.quote).length;
  if (noQuote) warnings.push(`${noQuote} card${noQuote === 1 ? ' doesn’t' : 's don’t'} quote your notes, so check ${noQuote === 1 ? 'it' : 'them'} with extra care.`);
  const long = cards.filter((c) => c.kind === 'basic' && c.back.length > 220).length;
  if (long) warnings.push(`${long} card${long === 1 ? ' has' : 's have'} a long answer, which is harder to remember. Consider splitting ${long === 1 ? 'it' : 'them'}.`);
  return { title: clip(root.title, LIMITS.title), course: clip(root.course, 80), cards, problems, warnings };
}

/** A deck's name as Anki takes it. A plain name goes under PA School; one with `::` is left where she put it. */
export function cleanDeckName(name: unknown, fallback = 'Cards') {
  const parts = (typeof name === 'string' ? name : '').replace(/[\t\r\n"]/g, ' ').split('::').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) parts.push(fallback.replace(/[\t\r\n"]/g, ' ').replace(/::/g, ' ').trim() || 'Cards');
  return (parts.length > 1 ? parts : ['PA School', parts[0]]).join('::').slice(0, LIMITS.deck);
}

const readStyle = (value: unknown): CardStyle => (value === 'basic' || value === 'cloze' ? value : 'mixed');
const readDepth = (value: unknown): CardDepth => (value === 'thorough' || value === 'everything' ? value : 'high-yield');

export function newDeck(input: { title?: unknown; deck?: unknown; course?: unknown; focus?: unknown; style?: unknown; depth?: unknown }, id: string, now: string): CardDeck {
  const title = clip(input.title, LIMITS.title) || clip(input.focus, LIMITS.title) || 'Flashcards';
  return {
    id, title, deck: cleanDeckName(input.deck, title), course: clip(input.course, 80), focus: clip(input.focus, 200),
    style: readStyle(input.style), depth: readDepth(input.depth), cards: [], createdAt: now,
  };
}

/** Add cards, leaving out any the deck already has. */
export function addCards(deck: CardDeck, drafts: DraftCard[]) {
  const have = new Set(deck.cards.map((c) => cardKey(c.front)));
  let repeats = 0;
  let added = 0;
  for (const draft of drafts) {
    const key = cardKey(draft.front);
    if (have.has(key)) { repeats++; continue; }
    if (deck.cards.length >= LIMITS.cards) throw new StudyInputError('That’s as many cards as one deck can hold. Start another.');
    have.add(key);
    deck.cards.push({ ...draft, id: cardId(draft.front) });
    added++;
  }
  return { added, repeats };
}

/** Change a deck's details. Cards already in Anki stay in the deck they were imported to. */
export function editDeck(deck: CardDeck, input: { title?: unknown; deck?: unknown; course?: unknown }) {
  const title = clip(input.title, LIMITS.title);
  if (!title) throw new StudyInputError('Give the deck a name.');
  Object.assign(deck, { title, deck: cleanDeckName(input.deck, title), course: clip(input.course, 80) });
}

/** A card she's written herself. */
export function addCard(deck: CardDeck, input: { front?: unknown; back?: unknown; topic?: unknown }) {
  const front = clip(input.front, LIMITS.front);
  const back = clip(input.back, LIMITS.back);
  const kind: CardKind = isCloze(front) ? 'cloze' : 'basic';
  const problem = checkCard(kind, front, back);
  if (problem) throw new StudyInputError(`That card won’t work: ${problem}.`);
  const { added } = addCards(deck, [{ kind, front, back, topic: clip(input.topic, LIMITS.topic) || 'General' }]);
  if (!added) throw new StudyInputError('This deck already has that card.');
}

export function editCard(card: AnkiCard, input: { front?: unknown; back?: unknown }) {
  const front = clip(input.front, LIMITS.front);
  const back = clip(input.back, LIMITS.back);
  const kind: CardKind = isCloze(front) ? 'cloze' : 'basic';
  const problem = checkCard(kind, front, back);
  if (problem) throw new StudyInputError(`That card won’t work: ${problem}.`);
  Object.assign(card, { kind, front, back });
  // Changed, so it counts as new again and can go back to Anki.
  delete card.exportedAt;
}

export const unsentCards = (deck: CardDeck) => deck.cards.filter((c) => !c.exportedAt);

export function deckSummary(deck: CardDeck) {
  return {
    id: deck.id, title: deck.title, deck: deck.deck, course: deck.course, createdAt: deck.createdAt,
    count: deck.cards.length, unsent: unsentCards(deck).length, cloze: deck.cards.filter((c) => c.kind === 'cloze').length,
  };
}
export type DeckSummary = ReturnType<typeof deckSummary>;

/**
 * The file for File → Import. A GUID on each row means importing again can't add a
 * second copy, and whether it overwrites is Anki's "Existing notes" setting. The note
 * type is per row since a deck can mix Basic and Cloze. Headers need Anki 2.1.54 or later.
 */
export function cardFile(deck: CardDeck, cards: AnkiCard[]) {
  const deckTag = ankiTag('set', deck.title);
  const lines = cards.map((card) => {
    const back = [card.back ? ankiField(card.back) : '', card.quote ? `<i>From your notes: ${ankiField(card.quote)}</i>` : ''].filter(Boolean).join('<br><br>');
    const tags = ['pa-study', deckTag, ankiTag('course', deck.course), ankiTag('topic', card.topic), card.system ? ankiTag('system', card.system) : ''].filter(Boolean).join(' ');
    return [`study-card-${card.id}`, card.kind === 'cloze' ? 'Cloze' : 'Basic', ankiField(card.front), back, tags].join('\t');
  });
  return [
    '#separator:tab',
    '#html:true',
    '#guid column:1',
    '#notetype column:2',
    `#deck:${deck.deck}`,
    '#tags column:5',
    ...lines,
  ].join('\n') + '\n';
}

/** A file name from the deck, safe everywhere. */
export const cardFileName = (deck: Pick<CardDeck, 'title'>) => `${deck.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cards'}-anki.txt`;

export const MAX_DECKS = LIMITS.decks;
