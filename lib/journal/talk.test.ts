import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addTalk, emptyJournal, JournalInputError, listEntries, normalizeJournal, removeTalk, saveEntry } from './journal';
import { appendTalkSummary, buildTalkPrompt, parseTalkReply, TalkReplyError, transcriptTurns } from './talk';

const TODAY = '2026-11-04';
const NOW = '2026-11-04T18:00:00.000Z';

test('prompt: starts from the topic, asks for short spoken replies and pushback without contrarianism', () => {
  const p = buildTalkPrompt({ date: TODAY, topic: 'A decision I’m stuck on' });
  assert.match(p, /Wednesday, November 4, 2026/);
  assert.match(p, /I want to talk through: A decision I’m stuck on\./);
  assert.match(p, /one to three short sentences/);
  assert.match(p, /Don’t be a cheerleader/);
  assert.match(p, /Don’t be contrary either/);
  assert.match(p, /how they would tell it/);
  assert.match(p, /TOPIC:[\s\S]*SUMMARY:[\s\S]*CONVERSATION:/);
  assert.doesNotMatch(p, /already written/);

  const open = buildTalkPrompt({ date: TODAY, topic: '  ', written: 'Long day at work.' });
  assert.match(open, /asking what’s on my mind/);
  assert.match(open, /"""\nLong day at work\.\n"""/);
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

test('reply: reads topic, summary and conversation, tidying markdown', () => {
  const r = parseTalkReply(REPLY);
  assert.equal(r.topic, 'Friction with Sam over the move');
  assert.equal(r.summary.split('\n').length, 4);
  assert.ok(r.summary.startsWith('• What happened: Sam booked'));
  assert.match(r.summary, /• The other side: Sam may/);
  assert.match(r.transcript, /^Me: Sam booked/);

  const turns = transcriptTurns(r.transcript);
  assert.deepEqual(turns.map((t) => t.who), ['me', 'ai', 'me']);
  assert.equal(turns[2].text, 'Probably that I was swamped.\nThat\'s fair, honestly.');
});

test('reply: copes with code fences, bold headings and a bare summary', () => {
  const fenced = parseTalkReply('```\n**TOPIC:** Work\n**SUMMARY:**\n* Where I landed: talk to my boss.\n**CONVERSATION:**\n**Me:** hi\n```');
  assert.equal(fenced.topic, 'Work');
  assert.equal(fenced.summary, '• Where I landed: talk to my boss.');
  assert.equal(fenced.transcript, 'Me: hi');

  const bare = parseTalkReply('I realised I was tired, not angry.', 'How today went');
  assert.equal(bare.topic, 'How today went');
  assert.equal(bare.summary, 'I realised I was tired, not angry.');
  assert.equal(bare.transcript, '');

  assert.throws(() => parseTalkReply('   '), TalkReplyError);
  assert.throws(() => parseTalkReply('TOPIC: x\nCONVERSATION:\nMe: hi'), TalkReplyError);
});

test('summary is appended under a heading after what is written', () => {
  const reply = { topic: 'Work', summary: '• Where I landed: rest.' };
  assert.equal(appendTalkSummary('', reply), '🎙 Talked through: Work\n• Where I landed: rest.');
  assert.equal(appendTalkSummary('Morning was fine.\n\n', reply), 'Morning was fine.\n\n🎙 Talked through: Work\n• Where I landed: rest.');
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
