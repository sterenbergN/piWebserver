import test from 'node:test';
import { strict as assert } from 'node:assert';
import { buildImportPrompt, checkImport, clampCount, describeExisting, IMPORT_SPECS, parseImport } from './import-prompt';
import type { PromptLists } from './prompts';

const lists: PromptLists = {
  quipClash: ['A bad name for a pet dog'], theFaker: [], bracketBattles: [], herdMentality: [], emojiTelephone: [],
  triviaQuestions: [{ question: 'What is 2+2?', choices: ['3', '4', '5', '6'], answer: 1 }],
  spyfallLocations: [{ emoji: '🚒', name: 'Fire Station', roles: ['Chief'] }],
  wavelengthSpectrums: [{ left: 'Hot', right: 'Cold' }],
  bluffFacts: [{ prompt: 'A group of crows is a _____.', truth: 'murder', decoys: [] }],
};

test('every list has a prompt whose examples read back with its own parser', () => {
  for (const key of Object.keys(IMPORT_SPECS) as (keyof PromptLists)[]) {
    const prompt = buildImportPrompt(key, { theme: '90s movies', count: 12 });
    assert.match(prompt, /Write 12 new entries/);
    assert.match(prompt, /Theme: 90s movies/);
    assert.ok(prompt.includes(IMPORT_SPECS[key].format), key);
    assert.equal(parseImport(key, IMPORT_SPECS[key].examples.join('\n')).length, IMPORT_SPECS[key].examples.length, key);
  }
});

test('the prompt lists everything already there, so none of it comes back', () => {
  const existing = Array.from({ length: 250 }, (_, i) => `Prompt ${i}`);
  const prompt = buildImportPrompt('quipClash', { existing: [...existing, 'Prompt 3', '  '] });
  const listed = prompt.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  assert.deepEqual(listed, existing, 'every entry, once each, with nothing cut off');
  assert.doesNotMatch(prompt, /more\)/);
  assert.doesNotMatch(buildImportPrompt('quipClash'), /already in the list/);
  assert.deepEqual(describeExisting('triviaQuestions', lists), ['What is 2+2?']);
  assert.deepEqual(describeExisting('wavelengthSpectrums', lists), ['Hot | Cold']);
  assert.deepEqual(describeExisting('quipClash', lists), ['A bad name for a pet dog']);
});

test('counts stay within limits', () => {
  assert.equal(clampCount(1), 5);
  assert.equal(clampCount(500), 100);
  assert.equal(clampCount('abc'), 25);
  assert.equal(clampCount(30), 30);
});

test('AI chatter around plain prompts is dropped', () => {
  const reply = [
    'Here are 4 prompts:',
    '```',
    '1. The worst thing to find in a sandwich',
    '- "A terrible name for a boat"',
    '* What a cat dreams about',
    '',
    '• A bad slogan for a dentist',
    '```',
  ].join('\n');
  assert.deepEqual(parseImport('quipClash', reply), [
    'The worst thing to find in a sandwich', 'A terrible name for a boat', 'What a cat dreams about', 'A bad slogan for a dentist',
  ]);
});

test('formatted lists keep their old rules', () => {
  assert.deepEqual(parseImport('triviaQuestions', [
    'What is 2+2? | 3 | 4 | 5 | 6 | 1',
    '2. Capital of France? | Rome | Paris | Oslo | Bern | 1 | Geography',
    'Bad answer index | a | b | c | d | 7',
    'Too short | a | b',
  ].join('\n')), [
    { question: 'What is 2+2?', choices: ['3', '4', '5', '6'], answer: 1 },
    { question: 'Capital of France?', choices: ['Rome', 'Paris', 'Oslo', 'Bern'], answer: 1, category: 'Geography' },
  ]);
  assert.deepEqual(parseImport('spyfallLocations', '🚒 | Fire Station | Chief, Rookie\nBank | Teller, Robber'), [
    { emoji: '🚒', name: 'Fire Station', roles: ['Chief', 'Rookie'] },
    { emoji: '', name: 'Bank', roles: ['Teller', 'Robber'] },
  ]);
  assert.deepEqual(parseImport('wavelengthSpectrums', 'Hot | Cold\nno bar here'), [{ left: 'Hot', right: 'Cold' }]);
  assert.deepEqual(parseImport('bluffFacts', 'Crows are a _____. | murder | party | | flock'), [
    { prompt: 'Crows are a _____.', truth: 'murder', decoys: ['party', 'flock'] },
  ]);
});

test('Generate is told when a reply has nothing to import', () => {
  assert.equal(checkImport('quipClash', 'A bad name for a boat'), null);
  assert.match(checkImport('triviaQuestions', 'Just a question?') || '', /Question \| Choice A/);
  assert.ok(checkImport('herdMentality', 'Here you go:\n```\n```'));
});
