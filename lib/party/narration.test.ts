import test from 'node:test';
import { strict as assert } from 'node:assert';
import { chooseVoice, rankVoices, speakable, splitForSpeech, voiceRate } from './narration';

const v = (name: string, lang = 'en-GB') => ({ name, lang });

test('the narrator prefers natural English voices and never picks a novelty one', () => {
  const voices = [
    v('Microsoft George - English (United Kingdom)'),
    v('Microsoft Hazel - English (United Kingdom)'),
    v('Zarvox', 'en-US'),
    v('Microsoft Ryan Online (Natural) - English (United Kingdom)'),
    v('Google UK English Female'),
    v('Microsoft Guy Online (Natural) - English (United States)', 'en-US'),
    v('Microsoft Pablo - Spanish (Spain)', 'es-ES'),
  ];
  const ranked = rankVoices(voices).map((x) => x.name);
  assert.equal(ranked[0], 'Microsoft Ryan Online (Natural) - English (United Kingdom)');
  assert.equal(ranked[1], 'Microsoft Guy Online (Natural) - English (United States)');
  assert.equal(ranked[2], 'Google UK English Female', 'Chrome’s network voices beat the built-in ones');
  assert.ok(!ranked.includes('Zarvox') && !ranked.includes('Microsoft Pablo - Spanish (Spain)'));

  assert.equal(chooseVoice(voices)?.name, ranked[0]);
  assert.equal(chooseVoice(voices, 'Microsoft Hazel - English (United Kingdom)')?.name, 'Microsoft Hazel - English (United Kingdom)', 'a picked voice wins');
  assert.equal(chooseVoice(voices, 'A voice from another TV')?.name, ranked[0], 'a picked voice that is gone falls back to the best');
  assert.equal(chooseVoice([v('Pablo', 'es-ES')]), null, 'no English voice: leave it to the browser');

  assert.equal(voiceRate(voices[3]), 1);
  assert.ok(voiceRate(voices[0]) > 1, 'robotic voices get a little more pace');
});

test('display text is cleaned up before it is read out', () => {
  assert.equal(speakable('🐄 Moo! Ava 🦊 got the Pink Cow 🎉'), 'Moo! Ava got the Pink Cow');
  assert.equal(speakable('A group of crows is a _____.'), 'A group of crows is a blank.');
  assert.equal(speakable('Cats vs. Dogs & “friends”'), 'Cats versus Dogs and "friends"');
  assert.equal(speakable('🇬🇧 👍🏽 ❤️'), '');
});

test('long lines are spoken in sentence-sized pieces, short bits stay together', () => {
  assert.deepEqual(splitForSpeech('Three. Two. One. Go! And freeze!'), ['Three. Two. One. Go! And freeze!'], 'short bits stay one utterance');
  assert.deepEqual(
    splitForSpeech('The motion is that pirates deserve a holiday. Ava argues for it, and Ben argues against it.'),
    ['The motion is that pirates deserve a holiday.', 'Ava argues for it, and Ben argues against it.'],
  );
  assert.deepEqual(splitForSpeech('No punctuation at all'), ['No punctuation at all']);
  const long = `${'word '.repeat(60)}end, ${'more '.repeat(30)}done.`;
  const pieces = splitForSpeech(long);
  assert.ok(pieces.length > 1 && pieces.every((p) => p.length <= 180), 'a run-on sentence is broken up');
  assert.equal(pieces.join(' ').replace(/\s+/g, ' '), long.trim().replace(/\s+/g, ' '), 'nothing is lost');
  assert.deepEqual(splitForSpeech(''), []);
});
