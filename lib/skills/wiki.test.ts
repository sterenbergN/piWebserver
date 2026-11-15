import test from 'node:test';
import { strict as assert } from 'node:assert';
import { completeLink, openLink, suggestNames } from '../../components/skills/WikiTextarea';

// The [[link]] suggestions under a Skills text box: when to show them, which names, and what choosing one writes.

test('suggestions show inside an unfinished [[link]] only', () => {
  assert.equal(openLink('see [['), '');
  assert.equal(openLink('see [[Loop tu'), 'Loop tu');
  assert.equal(openLink('see [[Loop tuning]] and'), null, 'a finished link');
  assert.equal(openLink('see [Loop'), null);
  assert.equal(openLink('a [[first\nline'), null, 'not across lines');
  assert.equal(openLink('[[Alias|shown'), null, 'not in the shown text after |');
});

test('names starting with what was typed come first, then ones containing it', () => {
  const names = [
    { name: 'Root locus', kind: 'topic' as const },
    { name: 'Loop tuning', kind: 'topic' as const },
    { name: 'Control loops', kind: 'subject' as const },
    { name: 'Thermodynamics', kind: 'subject' as const },
  ];
  assert.deepEqual(suggestNames(names, 'lo').map((n) => n.name), ['Loop tuning', 'Root locus', 'Control loops']);
  assert.equal(suggestNames(names, '').length, 4, 'everything for a bare [[');
  assert.equal(suggestNames(names, 'zzz').length, 0);
});

test('choosing a name finishes the link, without doubling a ]] already there', () => {
  assert.deepEqual(completeLink('see [[Lo and more', 8, 'Loop tuning'), { value: 'see [[Loop tuning]] and more', cursor: 19 });
  assert.deepEqual(completeLink('see [[Lo]] and more', 8, 'Loop tuning'), { value: 'see [[Loop tuning]] and more', cursor: 19 });
});
