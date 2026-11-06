import test from 'node:test';
import { strict as assert } from 'node:assert';
import { continueList } from './markdown';
import { markdownToPlain, wordCount } from './journal';

const enterAtEnd = (text: string) => continueList(text, text.length);

test('Enter on a list line starts the next item', () => {
  assert.deepEqual(enterAtEnd('Groceries\n- milk'), { text: 'Groceries\n- milk\n- ', selStart: 19, selEnd: 19 });
  assert.equal(enterAtEnd('1. wake up')?.text, '1. wake up\n2. ');
  assert.equal(enterAtEnd('  * nested')?.text, '  * nested\n  * ');
  assert.equal(enterAtEnd('- [x] done')?.text, '- [x] done\n- [ ] ');
  assert.equal(enterAtEnd('> a quote')?.text, '> a quote\n> ');
});

test('Enter on an empty item ends the list; plain lines are left alone', () => {
  assert.deepEqual(enterAtEnd('- milk\n- '), { text: '- milk\n\n', selStart: 8, selEnd: 8 });
  assert.equal(enterAtEnd('Just a sentence.'), null);
  assert.equal(enterAtEnd('-not a list'), null);
  // In the middle of an item, the rest of it moves to the new item.
  assert.equal(continueList('- milk and eggs', 6)?.text, '- milk\n-  and eggs');
  // Before the bullet itself, it's an ordinary new line.
  assert.equal(continueList('- milk', 0), null);
});

test('previews and word counts read past the Markdown', () => {
  assert.equal(markdownToPlain('### 🎙 Debated: Work\n\n- **My position:** _remote_ wins\n  1. see [notes](https://x.y)\n> quoted `code`'),
    '🎙 Debated: Work\n\nMy position: remote wins\nsee notes\nquoted code');
  assert.equal(markdownToPlain('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(wordCount('- **Bold** words\n1. two more\n- [ ] task'), 5);
  assert.equal(wordCount('   '), 0);
});
