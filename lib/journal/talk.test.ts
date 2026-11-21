import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addTalk, emptyJournal, JournalInputError, listEntries, normalizeJournal, removeTalk, saveEntry } from './journal';
import { appendTalkSummary, buildTalkPrompt, cleanTalkExtras, parseTalkReply, TalkReplyError, TALK_MODES, transcriptTurns, type TalkMode } from './talk';

const TODAY = '2026-11-04';
const NOW = '2026-11-04T18:00:00.000Z';

test('prompt: each kind of talk has its own role and summary, with the same objective rules', () => {
  for (const mode of Object.keys(TALK_MODES) as TalkMode[]) {
    const p = buildTalkPrompt({ date: TODAY, mode, topic: '' });
    assert.ok(p.includes(TALK_MODES[mode].role), mode);
    assert.ok(p.includes(TALK_MODES[mode].open), mode);
    for (const heading of TALK_MODES[mode].summary) assert.ok(p.includes(`{ "heading": ${JSON.stringify(heading)}, "points": [`), `${mode}: ${heading}`);
    assert.match(p, /Wednesday, November 4, 2026/);
    assert.match(p, /one to three short sentences/);
    assert.match(p, /Don’t flatter me/);
    assert.match(p, /Separate facts from opinions/);
    assert.match(p, /not a therapist/);
    assert.match(p, /reply with one JSON object/);
    assert.match(p, /"topic":[\s\S]*"summary":[\s\S]*"followUps":[\s\S]*"conversation":[\s\S]*"more": false\n\}$/);
    assert.doesNotMatch(p, /How I felt|therapy talk/);
  }
});

test('prompt: a debate argues the other side; the rest don’t argue for the sake of it', () => {
  const debate = buildTalkPrompt({ date: TODAY, mode: 'debate', topic: 'Remote work is better' });
  assert.match(debate, /The subject: Remote work is better\. Open with one short question about it\./);
  assert.match(debate, /strongest side against my position/);
  assert.doesNotMatch(debate, /contrary for the sake of it/);
  assert.match(buildTalkPrompt({ date: TODAY, mode: 'explore', topic: 'Bridges' }), /contrary for the sake of it/);

  const withEntry = buildTalkPrompt({ date: TODAY, mode: 'reflect', topic: '', written: 'Long day at work.' });
  assert.match(withEntry, /"""\nLong day at work\.\n"""/);
  assert.doesNotMatch(buildTalkPrompt({ date: TODAY, mode: 'reflect', topic: '' }), /already written/);
});

const REPLY = `TOPIC: Friction with Sam over the move
SUMMARY:
- What happened: Sam booked the movers without asking me.
- How I felt: Annoyed and left out.
- **The other side**: Sam may have been trying to take something off my plate.
- Where I landed: Ask before assuming it was about control.
CONVERSATION:
Me: Sam booked the movers without asking.
You: What do you think Sam would say about why?
Me: Probably that I was swamped.
That's fair, honestly.`;

test('reply: reads topic, summary and conversation, as Markdown', () => {
  const r = parseTalkReply(REPLY);
  assert.equal(r.topic, 'Friction with Sam over the move');
  assert.equal(r.summary, [
    '- **What happened:** Sam booked the movers without asking me.',
    '- **How I felt:** Annoyed and left out.',
    '- **The other side**: Sam may have been trying to take something off my plate.',
    '- **Where I landed:** Ask before assuming it was about control.',
  ].join('\n'));
  assert.match(r.transcript, /^Me: Sam booked/);

  const turns = transcriptTurns(r.transcript);
  assert.deepEqual(turns.map((t) => t.who), ['me', 'ai', 'me']);
  assert.equal(turns[2].text, 'Probably that I was swamped.\nThat\'s fair, honestly.');
});

test('reply: copes with code fences, bold labels, other bullets and a bare summary', () => {
  const fenced = parseTalkReply('```\n**TOPIC:** **Work**\n**SUMMARY:**\n* **Where I landed:** talk to my **boss**.\n**CONVERSATION:**\n**Me:** hi\n```');
  assert.equal(fenced.topic, 'Work');
  assert.equal(fenced.summary, '- **Where I landed:** talk to my **boss**.');
  assert.equal(fenced.transcript, 'Me: hi');

  // Points under a heading stay nested under it, whatever bullets and indents the AI used.
  const nested = parseTalkReply('SUMMARY:\n• The best ideas:\n    ◦ A treehouse\n\t* A go-kart\n- What to try first: the go-kart\n1. first\n2. second');
  assert.equal(nested.summary, '- **The best ideas:**\n  - A treehouse\n  - A go-kart\n- **What to try first:** the go-kart\n1. first\n2. second');

  const bare = parseTalkReply('I realised I was tired, not angry.', 'How today went');
  assert.equal(bare.topic, 'How today went');
  assert.equal(bare.summary, 'I realised I was tired, not angry.');
  assert.equal(bare.transcript, '');

  assert.throws(() => parseTalkReply('   '), TalkReplyError);
  assert.throws(() => parseTalkReply('TOPIC: x\nCONVERSATION:\nMe: hi'), TalkReplyError);
});

test('reply: a conversation that came back in parts is put back together', () => {
  // The first reply ends with MORE; the second carries on, sometimes repeating the label.
  const parts = parseTalkReply('TOPIC: Bridges\nSUMMARY:\n- What we covered: arches\nCONVERSATION:\nMe: one\nYou: two\nMORE\n'
    + 'Me: three\nYou: four\n**MORE**\n'
    + 'CONVERSATION (continued):\nMe: five\n\nCONVERSATION:\nYou: six');
  assert.deepEqual(transcriptTurns(parts.transcript).map((t) => t.text), ['one', 'two', 'three', 'four', 'five', 'six']);
  assert.doesNotMatch(parts.transcript, /MORE|continued/i);
});

test('summary goes in the entry under its own heading, after what is written', () => {
  const reply = { topic: 'Work', summary: '- **Where I landed:** rest.' };
  assert.equal(appendTalkSummary('', reply, 'reflect'), '### 🎙 Looked back on: Work\n\n- **Where I landed:** rest.');
  assert.equal(appendTalkSummary('Morning was fine.\n\n', reply, 'debate'), 'Morning was fine.\n\n### 🎙 Debated: Work\n\n- **Where I landed:** rest.');
});

test('the prompt asks for Markdown and for every turn of the conversation', () => {
  const p = buildTalkPrompt({ date: TODAY, mode: 'explore', topic: '' });
  assert.match(p, /"heading": "What we covered", "points": \["…", "another point/);
  assert.match(p, /Keep track of the whole conversation/);
  assert.match(p, /every turn, from the very first to the last/);
  assert.match(p, /Never summarize, shorten, merge or skip turns/);
  assert.match(p, /set "more" to true/);
  assert.match(p, /reply with only \{"conversation": \[the next turns\], "more": true or false\}/);
});

test('conversations are kept with the day and survive saving the text', () => {
  const data = emptyJournal();
  const talk = addTalk(data, TODAY, ' Work ', 'Me: hi\nYou: hello', TODAY, NOW, 't1');
  assert.equal(talk.topic, 'Work');
  // A day with only a kept conversation is still an entry.
  assert.equal(listEntries(data)[0].talks, 1);

  saveEntry(data, TODAY, 'Wrote a bit.', null, TODAY, NOW);
  assert.equal(data.entries[TODAY].talks?.length, 1);
  // Clearing the words keeps the day while a conversation is kept.
  assert.ok(saveEntry(data, TODAY, '', null, TODAY, NOW));

  const reread = normalizeJournal(JSON.parse(JSON.stringify(data)));
  assert.equal(reread.entries[TODAY].talks?.[0].transcript, 'Me: hi\nYou: hello');

  assert.equal(removeTalk(data, TODAY, 'nope'), false);
  assert.equal(removeTalk(data, TODAY, 't1'), true);
  assert.equal(data.entries[TODAY], undefined);

  assert.throws(() => addTalk(data, '2026-11-05', 'x', 'Me: hi', TODAY, NOW, 't2'), JournalInputError);
  assert.throws(() => addTalk(data, TODAY, 'x', '  ', TODAY, NOW, 't2'), JournalInputError);
});

// ── The JSON reply ──────────────────────────────────────────────────────────────

const JSON_REPLY = {
  topic: 'Friction with Sam over the move.',
  headline: 'Ask before assuming it was about control.',
  summary: [
    { heading: 'What happened', points: ['Sam booked the movers **without asking** me.'] },
    { heading: 'Where I landed:', points: ['Ask first.', 'Say thanks for the help.'] },
    { heading: 'Another way to see it', points: [] },
  ],
  mood: 'Okay',
  tags: ['#Family', 'move', 'family'],
  people: ['Sam', '@Sam'],
  followUps: [{ text: 'Talk to Sam about the move', when: 'tonight' }, 'Cancel the second quote', { text: '' }],
  questions: ['Why does this bother me so much?'],
  quote: '“I was swamped, honestly.”',
  conversation: [
    { who: 'me', text: 'Sam booked the movers without asking.' },
    { who: 'you', text: 'What do you think Sam would say about why?' },
  ],
  more: true,
};

test('json reply: summary as Markdown, transcript as turns, and the extras cleaned', () => {
  const r = parseTalkReply(JSON.stringify(JSON_REPLY, null, 2));
  assert.equal(r.topic, 'Friction with Sam over the move');
  assert.equal(r.summary, [
    '- **What happened:** Sam booked the movers **without asking** me.',
    '- **Where I landed:** Ask first.',
    '  - Say thanks for the help.',
  ].join('\n'));
  assert.equal(r.transcript, 'Me: Sam booked the movers without asking.\nYou: What do you think Sam would say about why?');
  assert.equal(r.headline, 'Ask before assuming it was about control.');
  assert.equal(r.mood, 3);
  assert.deepEqual(r.tags, ['family', 'move']);
  assert.deepEqual(r.people, ['Sam']);
  assert.deepEqual(r.followUps, [{ text: 'Talk to Sam about the move', when: 'tonight' }, { text: 'Cancel the second quote' }]);
  assert.deepEqual(r.questions, ['Why does this bother me so much?']);
  assert.equal(r.quote, 'I was swamped, honestly.');
  assert.equal(r.more, true);
});

test('json reply: parts pasted one after another, fenced or not, with chat between, are merged', () => {
  const first = { ...JSON_REPLY, conversation: [{ who: 'me', text: 'one' }, { who: 'you', text: 'two' }], more: true };
  const pasted = [
    'Here’s your summary:',
    '```json', JSON.stringify(first, null, 2), '```',
    'Sure, here’s the rest:',
    JSON.stringify({ conversation: [{ who: 'me', text: 'three { with a brace }' }, { who: 'you', text: 'four' }], more: true }),
    '~~~',
    // Trailing commas and a line break inside a string, as some apps send them.
    '{ "conversation": [ { "who": "me", "text": "five\nand more" }, ], "more": false, }',
    '~~~',
  ].join('\n');
  const r = parseTalkReply(pasted);
  assert.deepEqual(transcriptTurns(r.transcript).map((t) => t.text), ['one', 'two', 'three { with a brace }', 'four', 'five\nand more']);
  assert.equal(r.more, undefined, 'the last part said there’s no more');
  assert.equal(r.topic, 'Friction with Sam over the move');
});

test('json reply: smart quotes, a wrapper object, and conversation lines left outside the JSON', () => {
  const smart = parseTalkReply('{“topic”: “Bridges”, “summary”: {“What we covered”: [“arches”, “trusses”]}, “conversation”: [{“me”: “hi”}]}');
  assert.equal(smart.topic, 'Bridges');
  assert.equal(smart.summary, '- **What we covered:** arches\n  - trusses');
  assert.equal(smart.transcript, 'Me: hi');

  const wrapped = parseTalkReply(JSON.stringify({ journal: { topic: 'Work', summary: ['Rest more.'] } }));
  assert.equal(wrapped.summary, '- Rest more.');

  const mixed = parseTalkReply(`${JSON.stringify({ topic: 'Work', summary: '- Where I landed: rest', more: true })}\nMORE\nMe: three\nYou: four`);
  assert.equal(mixed.summary, '- **Where I landed:** rest');
  assert.deepEqual(transcriptTurns(mixed.transcript).map((t) => t.text), ['three', 'four']);
});

test('json reply: only the rest of a conversation, broken JSON, or no summary are explained', () => {
  assert.throws(() => parseTalkReply('{"conversation": [{"who": "me", "text": "hi"}], "more": false}'), /first “summary” reply/);
  assert.throws(() => parseTalkReply('{"topic": "x", "summary": ["a"'), /broken or cut off/);
  const headlineOnly = parseTalkReply('{"topic": "x", "headline": "Rest more."}', 'fallback');
  assert.equal(headlineOnly.summary, '- Rest more.');
  assert.equal(parseTalkReply('{"headline": "Rest."}', 'How today went').topic, 'How today went');
});

test('the old text reply still reads, and says when there’s more to come', () => {
  assert.equal(parseTalkReply(REPLY).more, undefined);
  assert.equal(parseTalkReply(`${REPLY}\nMORE`).more, true);
  assert.equal(parseTalkReply(`${REPLY}\nMORE`).transcript.includes('MORE'), false);
});

test('extras are cut to size; odd values are dropped', () => {
  const e = cleanTalkExtras({
    headline: 'x'.repeat(400),
    tags: 'work, money; health',
    people: Array.from({ length: 20 }, (_, i) => `P${i}`),
    followUps: [{ text: 'Done one', done: true }, { task: 'Old shape', due: 'Friday' }, 42],
    questions: 'Only one, as a string, with, commas',
    quote: 7,
    mood: 'amazing',
  });
  assert.equal(e.headline?.length, 300);
  assert.deepEqual(e.tags, ['work', 'money', 'health']);
  assert.equal(e.people?.length, 12);
  assert.deepEqual(e.followUps, [{ text: 'Done one', done: true }, { text: 'Old shape', when: 'Friday' }]);
  assert.deepEqual(e.questions, ['Only one, as a string, with, commas']);
  assert.equal(e.quote, undefined);
  assert.equal(e.mood, 5);
  assert.deepEqual(cleanTalkExtras({ mood: 'sideways', tags: [], headline: '  ' }), {});
  assert.deepEqual(cleanTalkExtras(null), {});
  assert.equal(cleanTalkExtras({ mood: 2 }).mood, 2);
  assert.equal(cleanTalkExtras({ mood: 9 }).mood, undefined);
});

test('the prompt brings up what’s still open, only when there is something', () => {
  const p = buildTalkPrompt({ date: TODAY, mode: 'reflect', topic: '', threads: { followUps: ['Call the bank'], questions: ['Is the job right?'] } });
  assert.match(p, /Things I said lately[\s\S]*- Call the bank\n- Is the job right\?/);
  assert.doesNotMatch(buildTalkPrompt({ date: TODAY, mode: 'reflect', topic: '', threads: { followUps: [], questions: [] } }), /Things I said lately/);
});

test('a talk keeps its extras through saving and reading back', () => {
  const data = emptyJournal();
  const { topic, summary, transcript, more: _more, ...extras } = parseTalkReply(JSON.stringify(JSON_REPLY));
  const talk = addTalk(data, TODAY, topic, transcript, TODAY, NOW, 't1', { mode: 'reflect', summary, extras });
  assert.deepEqual(talk.tags, ['family', 'move']);
  assert.equal(talk.mood, 3);
  const reread = normalizeJournal(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(reread.entries[TODAY].talks?.[0], talk);
});
