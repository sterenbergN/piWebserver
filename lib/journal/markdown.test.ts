import test from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJournalFormat } from './markdown';

test('applyJournalFormat places collapsed caret after H2, ul and quote prefixes on empty or single lines', () => {
  assert.deepEqual(applyJournalFormat('', 0, 0, 'h2'), { text: '## ', selStart: 3, selEnd: 3 });
  assert.deepEqual(applyJournalFormat('', 0, 0, 'ul'), { text: '- ', selStart: 2, selEnd: 2 });
  assert.deepEqual(applyJournalFormat('', 0, 0, 'quote'), { text: '> ', selStart: 2, selEnd: 2 });

  const mid = applyJournalFormat('hello\nworld', 5, 5, 'h2');
  assert.deepEqual(mid, { text: '## hello\nworld', selStart: 8, selEnd: 8 });
});

test('applyJournalFormat bold wraps inline without merging neighboring lines', () => {
  const empty = applyJournalFormat('first\n', 6, 6, 'bold');
  assert.deepEqual(empty, { text: 'first\n**bold text**', selStart: 8, selEnd: 17 });

  // Whole-line selection including trailing newline must not absorb '\n'.
  const lineWithBreak = applyJournalFormat('hello\nworld', 0, 6, 'bold');
  assert.deepEqual(lineWithBreak, { text: '**hello**\nworld', selStart: 2, selEnd: 7 });

  // Multi-line selection wraps each line cleanly without crossing line breaks.
  const multi = applyJournalFormat('one\ntwo', 0, 7, 'bold');
  assert.deepEqual(multi, { text: '**one**\n**two**', selStart: 0, selEnd: 15 });
});
