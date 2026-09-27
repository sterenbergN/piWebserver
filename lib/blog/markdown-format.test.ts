import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFormat } from './markdown-format';

const sel = (r: { text: string; selStart: number; selEnd: number }) => r.text.slice(r.selStart, r.selEnd);

test('bold wraps the selection and toggles off', () => {
  const on = applyFormat('say hello now', 4, 9, 'bold');
  assert.equal(on.text, 'say **hello** now');
  assert.equal(sel(on), 'hello');
  const off = applyFormat(on.text, on.selStart, on.selEnd, 'bold');
  assert.equal(off.text, 'say hello now');
});

test('bold with nothing selected inserts a placeholder to type over', () => {
  const r = applyFormat('ab', 1, 1, 'bold');
  assert.equal(r.text, 'a**bold text**b');
  assert.equal(sel(r), 'bold text');
});

test('link selects the URL part', () => {
  const r = applyFormat('see docs', 4, 8, 'link');
  assert.equal(r.text, 'see [docs](https://)');
  assert.equal(sel(r), 'https://');
});

test('headings apply to the whole line and replace another level', () => {
  assert.equal(applyFormat('one\ntwo', 5, 5, 'h2').text, 'one\n## two');
  assert.equal(applyFormat('### two', 2, 2, 'h2').text, '## two');
  assert.equal(applyFormat('## two', 0, 0, 'h2').text, 'two', 'toggles off');
});

test('lists number or bullet every selected line', () => {
  assert.equal(applyFormat('a\nb\nc', 0, 5, 'ol').text, '1. a\n2. b\n3. c');
  assert.equal(applyFormat('a\nb', 0, 3, 'ul').text, '- a\n- b');
  assert.equal(applyFormat('- a\n- b', 0, 7, 'ul').text, 'a\nb');
  assert.equal(applyFormat('x\ny', 2, 3, 'quote').text, 'x\n> y');
});

test('code on several lines makes a fenced block', () => {
  assert.equal(applyFormat('a\nb', 0, 3, 'code').text, '```\na\nb\n```');
  assert.equal(applyFormat('run npm', 4, 7, 'code').text, 'run `npm`');
});
