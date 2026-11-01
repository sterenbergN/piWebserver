import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addCard, addCards, cardFile, cardFileName, cardId, cardKey, clozeParts, cleanDeckName, deckSummary, editCard, editDeck, isCloze, newDeck, parseCardReply, unsentCards } from './cards';
import { ankiField } from './anki';
import { buildCardPrompt } from './prompt';
import { StudyInputError } from './study';

const NOW = '2026-11-02T15:00:00.000Z';
const reply = (cards: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ title: 'Heart failure', course: 'Clin Med', cards, ...extra });
const basic = { kind: 'basic', front: 'First-line drug class for HFrEF that reduces mortality?', back: 'ARNI', topic: 'Heart failure', system: 'Cardiovascular', quote: 'ARNI first line' };
const cloze = { kind: 'cloze', front: 'Inferior STEMI is most often from the {{c1::right coronary artery}}.', back: 'Leads II, III, aVF.', topic: 'ACS', quote: 'RCA' };

test('a reply is read, whether fenced, chatty or a bare list', () => {
  const pack = parseCardReply(`Here you go!\n\`\`\`json\n${reply([basic, cloze])}\n\`\`\`\nGood luck.`);
  assert.equal(pack.title, 'Heart failure');
  assert.deepEqual(pack.cards.map((c) => c.kind), ['basic', 'cloze']);
  assert.equal(pack.cards[0].system, 'Cardiovascular');
  assert.equal(parseCardReply(JSON.stringify([basic])).cards.length, 1);
  assert.equal(parseCardReply(JSON.stringify({ front: 'Q?', back: 'A' })).cards.length, 1, 'one card by itself');
  assert.equal(parseCardReply(JSON.stringify([{ question: 'Q?', answer: 'A' }])).cards[0].back, 'A', 'other words for the same thing');
});

test('a {{blank}} makes it a cloze whatever the AI called it', () => {
  const [card] = parseCardReply(reply([{ kind: 'basic', front: 'The {{c1::RCA}} supplies it.', back: '' }])).cards;
  assert.equal(card.kind, 'cloze');
});

test('bad cards are reported and the rest kept', () => {
  const pack = parseCardReply(reply([basic, { front: 'No answer' }, { kind: 'cloze', front: 'No blank here' }, basic, 'nope']));
  assert.equal(pack.cards.length, 1);
  assert.equal(pack.problems.length, 4);
  assert.match(pack.problems[0], /no answer/);
  assert.match(pack.problems[1], /no \{\{c1::blank\}\}/);
  assert.match(pack.problems[2], /twice/);
  assert.throws(() => parseCardReply(reply([{ front: 'x' }])), StudyInputError);
  assert.throws(() => parseCardReply('  '), /Paste/);
});

test('a reply cut off part way keeps every whole card, blanks and all', () => {
  const full = reply([basic, cloze]);
  const cut = `${full.slice(0, full.length - 2)}, {"kind":"basic","front":"Half a ca`;
  const pack = parseCardReply(cut);
  assert.equal(pack.cards.length, 2);
  assert.match(pack.warnings[0], /cut off/);
});

test('it warns about cards with no quote and long answers', () => {
  const pack = parseCardReply(reply([{ front: 'Q?', back: 'x'.repeat(300), quote: 'q' }, { front: 'R?', back: 'A' }]));
  assert.ok(pack.warnings.some((w) => /1 card doesn’t quote/.test(w)));
  assert.ok(pack.warnings.some((w) => /long answer/.test(w)));
});

test('LaTeX with single backslashes survives', () => {
  const [card] = parseCardReply('{"cards":[{"front":"What is $\\frac{a}{b}$?","back":"A $\\beta$ blocker"}]}').cards;
  assert.equal(card.front, 'What is $\\frac{a}{b}$?');
  assert.equal(card.back, 'A $\\beta$ blocker');
});

test('a deck adds only what it hasn’t got', () => {
  const deck = newDeck({ focus: 'Heart failure' }, 'd1', NOW);
  const { cards } = parseCardReply(reply([basic, cloze]));
  assert.deepEqual(addCards(deck, cards), { added: 2, repeats: 0 });
  const again = parseCardReply(reply([{ ...basic, front: basic.front.toUpperCase() }, { ...cloze, front: 'Inferior STEMI is most often from the right coronary artery.', kind: 'basic', back: 'x' }, { front: 'New?', back: 'Yes' }]));
  assert.deepEqual(addCards(deck, again.cards), { added: 1, repeats: 2 });
  assert.equal(deck.cards.length, 3);
});

test('a card’s id comes from what it asks, and survives an edit', () => {
  assert.equal(cardId('What is it?'), cardId('  what IS it '));
  assert.notEqual(cardId('What is it?'), cardId('What was it?'));
  const deck = newDeck({ title: 'T' }, 'd1', NOW);
  addCards(deck, parseCardReply(reply([basic])).cards);
  const [card] = deck.cards;
  const { id } = card;
  card.exportedAt = NOW;
  editCard(card, { front: 'A better question?', back: 'ARNI' });
  assert.equal(card.id, id);
  assert.equal(card.exportedAt, undefined, 'changed, so it counts as new again');
  editCard(card, { front: 'Now a {{c1::cloze}}', back: '' });
  assert.equal(card.kind, 'cloze');
  assert.throws(() => editCard(card, { front: 'Plain with no answer', back: '' }), /no answer/);
  assert.equal(card.kind, 'cloze', 'a bad edit changes nothing');
});

test('deck names go under PA School unless she’s said otherwise', () => {
  assert.equal(cleanDeckName('Cardiology'), 'PA School::Cardiology');
  assert.equal(cleanDeckName('Boards::Cardio::HF'), 'Boards::Cardio::HF');
  assert.equal(cleanDeckName(' :: ', 'Fallback'), 'PA School::Fallback');
  assert.equal(cleanDeckName('Bad\tname"here'), 'PA School::Bad name here');
  assert.equal(cleanDeckName(undefined), 'PA School::Cards');
});

test('the file names its note type on each row, so Basic and Cloze can share it', () => {
  const deck = newDeck({ title: 'Heart failure', deck: 'Cardiology', course: 'Clin Med' }, 'd1', NOW);
  addCards(deck, parseCardReply(reply([basic, cloze])).cards);
  const lines = cardFile(deck, deck.cards).trim().split('\n');
  assert.deepEqual(lines.slice(0, 6), ['#separator:tab', '#html:true', '#guid column:1', '#notetype column:2', '#deck:PA School::Cardiology', '#tags column:5']);
  const [first, second] = lines.slice(6).map((l) => l.split('\t'));
  assert.equal(first.length, 5);
  assert.equal(first[0], `study-card-${deck.cards[0].id}`);
  assert.equal(first[1], 'Basic');
  assert.match(first[3], /^ARNI<br><br><i>From your notes: ARNI first line<\/i>$/);
  assert.equal(first[4], 'pa-study set::Heart-failure course::Clin-Med topic::Heart-failure system::Cardiovascular');
  assert.equal(second[1], 'Cloze');
  assert.ok(second[2].includes('{{c1::right coronary artery}}'));
  assert.equal(cardFileName(deck), 'heart-failure-anki.txt');
});

test('fields are safe: HTML is escaped, tabs can’t split a row, and money isn’t math', () => {
  assert.equal(ankiField('a < b\tand\nc'), 'a &lt; b and<br>c');
  assert.equal(ankiField('Costs $5 and $10'), 'Costs $5 and $10');
  assert.equal(ankiField('**bold**'), '<b>bold</b>');
  assert.equal(ankiField('$x^2$'), '\\(x^2\\)');
});

test('math in a blank can’t close the blank early', () => {
  assert.equal(ankiField('{{c1::$P_{O_{2}}$}} is low'), '{{c1::\\(P_{O_{2} }\\)}} is low');
  assert.ok(isCloze(ankiField('{{c1::$P_{O_{2}}$}} is low')));
});

test('blanks can be picked out for showing, hints left out', () => {
  assert.deepEqual(clozeParts('The {{c1::RCA::artery}} supplies {{c2::it}}.'), [
    { blank: false, text: 'The ' }, { blank: true, text: 'RCA' }, { blank: false, text: ' supplies ' }, { blank: true, text: 'it' }, { blank: false, text: '.' },
  ]);
});

test('math inside a blank stays whole when it’s shown', () => {
  assert.deepEqual(clozeParts('Low {{c1::$P_{a_{O_2}}$}} here'), [{ blank: false, text: 'Low ' }, { blank: true, text: '$P_{a_{O_2}}$' }, { blank: false, text: ' here' }]);
  assert.deepEqual(clozeParts('An {{c1::open blank'), [{ blank: false, text: 'An {{c1::open blank' }]);
  assert.deepEqual(clozeParts('Nothing to hide'), [{ blank: false, text: 'Nothing to hide' }]);
});

test('the summary counts what hasn’t gone to Anki yet', () => {
  const deck = newDeck({ title: 'T' }, 'd1', NOW);
  addCards(deck, parseCardReply(reply([basic, cloze])).cards);
  deck.cards[0].exportedAt = NOW;
  assert.equal(unsentCards(deck).length, 1);
  const summary = deckSummary(deck);
  assert.deepEqual([summary.count, summary.unsent, summary.cloze], [2, 1, 1]);
  assert.ok(!JSON.stringify(summary).includes('ARNI'), 'no cards in the list');
});

test('a deck’s details can change, and she can write her own cards', () => {
  const deck = newDeck({ title: 'T' }, 'd1', NOW);
  editDeck(deck, { title: 'New name', deck: 'Boards::Heart', course: 'Clin Med' });
  assert.deepEqual([deck.title, deck.deck, deck.course], ['New name', 'Boards::Heart', 'Clin Med']);
  assert.throws(() => editDeck(deck, { title: ' ' }), /Give the deck a name/);
  addCard(deck, { front: 'Mine?', back: 'Yes' });
  addCard(deck, { front: 'A {{c1::blank}}', back: '' });
  assert.deepEqual(deck.cards.map((c) => [c.kind, c.topic]), [['basic', 'General'], ['cloze', 'General']]);
  assert.throws(() => addCard(deck, { front: 'mine', back: 'Again' }), /already has/);
  assert.throws(() => addCard(deck, { front: 'No answer', back: '' }), /no answer/);
});

const exampleOf = (prompt: string) => prompt.match(/```json\n([\s\S]+?)```/)![1];

test('the prompt describes a reply its parser reads', () => {
  const prompt = buildCardPrompt({ source: 'notes', subject: 'Murmurs', course: 'Cardio', count: 20, style: 'mixed', depth: 'high-yield', weakTopics: [], leeches: [], avoid: [] });
  const pack = parseCardReply(exampleOf(prompt));
  assert.deepEqual(pack.cards.map((c) => c.kind), ['basic', 'cloze']);
  assert.match(prompt, /20 Anki flashcards/);
  assert.match(prompt, /Murmurs/);
});

test('the prompt follows the options', () => {
  const base = { source: 'notes' as const, subject: '', course: '', count: 10, style: 'mixed' as const, depth: 'high-yield' as const, weakTopics: [], leeches: [], avoid: [] };
  assert.match(buildCardPrompt({ ...base, style: 'cloze' }), /Make every card fill-in-the-blank/);
  assert.match(buildCardPrompt({ ...base, style: 'basic' }), /Make every card a question and answer/);
  assert.match(buildCardPrompt({ ...base, depth: 'everything' }), /every testable detail/i);
  assert.match(buildCardPrompt({ ...base, weakTopics: ['Asthma', 'ACS'] }), /Asthma, ACS/);
  assert.match(buildCardPrompt({ ...base, avoid: ['Old question?'] }), /Don’t repeat[\s\S]*Old question\?/);
  assert.ok(!/Don’t repeat/.test(buildCardPrompt(base)));
  const leech = buildCardPrompt({ ...base, source: 'leeches', leeches: [{ front: 'What is X?', back: 'Y' }] });
  assert.match(leech, /keep forgetting/);
  assert.match(leech, /What is X\?/);
  assert.ok(!/attached or pasted/.test(leech), 'no notes needed');
});

test('the key ignores blanks and punctuation', () => {
  assert.equal(cardKey('The {{c1::RCA}}, it is!'), 'the rca it is');
});
