import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addTalk, emptyJournal, JournalInputError, listEntries, normalizeJournal, removeTalk, saveEntry } from './journal';
import { appendTalkSummary, buildTalkPrompt, parseTalkReply, TalkReplyError, TALK_MODES, transcriptTurns, type TalkMode } from './talk';

const TODAY = '2026-11-04';
const NOW = '2026-11-04T18:00:00.000Z';

test('prompt: each kind of talk has its own role and summary, with the same objective rules', () => {
  for (const mode of Object.keys(TALK_MODES) as TalkMode[]) {
    const p = buildTalkPrompt({ date: TODAY, mode, topic: '' });
    assert.ok(p.includes(TALK_MODES[mode].role), mode);
    assert.ok(p.includes(TALK_MODES[mode].open), mode);
    for (const heading of TALK_MODES[mode].summary) assert.ok(p.includes(`- **${heading}:** …`), `${mode}: ${heading}`);
    assert.match(p, /Wednesday, November 4, 2026/);
    assert.match(p, /one to three short sentences/);
    assert.match(p, /Don’t flatter me/);
    assert.match(p, /Separate facts from opinions/);
    assert.match(p, /not a therapist/);
    assert.match(p, /TOPIC:[\s\S]*SUMMARY:[\s\S]*CONVERSATION:/);
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
  assert.match(p, /- \*\*What we covered:\*\* …/);
  assert.match(p, /Keep track of the whole conversation/);
  assert.match(p, /every turn, from the very first to the last/);
  assert.match(p, /Never summarize, shorten, merge or skip turns/);
  assert.match(p, /put MORE on a line of its own/);
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
