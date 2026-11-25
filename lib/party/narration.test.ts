import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  chooseVoice,
  hasQualityVoice,
  rankVoices,
  speakable,
  splitForSpeech,
  voiceRate,
  waitForVoices,
  SpeechDucker,
  type SpeechVoicesSource,
  type VoiceInfo,
} from './narration';

const v = (name: string, lang = 'en-GB', localService?: boolean): VoiceInfo =>
  localService === undefined ? { name, lang } : { name, lang, localService };

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

test('cloud/network voices beat local robotic voices and keep natural pace', () => {
  const david = v('Microsoft David - English (United States)', 'en-US', true);
  const cloudHost = v('Edge Cloud Voice', 'en-US', false);
  const google = v('Google US English', 'en-US', false);
  const natural = v('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB', false);

  const ranked = rankVoices([david, cloudHost, google, natural]).map((x) => x.name);
  assert.deepEqual(ranked, [
    'Microsoft Ryan Online (Natural) - English (United Kingdom)',
    'Google US English',
    'Edge Cloud Voice',
    'Microsoft David - English (United States)',
  ]);

  assert.equal(voiceRate(natural), 1.0);
  assert.equal(voiceRate(google), 1.0);
  assert.equal(voiceRate(cloudHost), 1.0);
  assert.ok(voiceRate(david) > 1.0);
});

test('hasQualityVoice ignores initial local SAPI voices until natural/network or preferred arrives', () => {
  const localOnly = [
    v('Microsoft David - English (United States)', 'en-US', true),
    v('Microsoft Mark - English (United States)', 'en-US', true),
    v('Microsoft Zira - English (United States)', 'en-US', true),
  ];
  assert.equal(hasQualityVoice(localOnly), false);
  assert.equal(hasQualityVoice(localOnly, 'Google US English'), false);
  assert.equal(hasQualityVoice(localOnly, 'Microsoft Zira - English (United States)'), true);

  const withNetwork = [...localOnly, v('Google US English', 'en-US', false)];
  assert.equal(hasQualityVoice(withNetwork), true);
  assert.equal(hasQualityVoice(withNetwork, 'Google US English'), true);
});

test('waitForVoices waits past initial local voices until voiceschanged delivers natural/network voices', async () => {
  const david = v('Microsoft David - English (United States)', 'en-US', true);
  const zira = v('Microsoft Zira - English (United States)', 'en-US', true);
  const google = v('Google UK English Male', 'en-GB', false);

  let currentVoices: VoiceInfo[] = [david, zira];
  const listeners = new Set<() => void>();
  const source: SpeechVoicesSource = {
    getVoices: () => currentVoices,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };

  let resolved = false;
  const p = waitForVoices(source, undefined, 500).then(() => {
    resolved = true;
  });

  await new Promise((r) => setTimeout(r, 15));
  assert.equal(resolved, false, 'must not settle immediately when only local SAPI voices are present');
  assert.equal(listeners.size, 1);

  currentVoices = [david, zira, google];
  for (const fn of [...listeners]) fn();
  await p;
  assert.equal(resolved, true);
  assert.equal(listeners.size, 0, 'cleans up voiceschanged listener after resolving');

  // Local-only device with no voiceschanged still settles cleanly after timeout
  let fallbackResolved = false;
  currentVoices = [david];
  await waitForVoices(source, undefined, 25).then(() => {
    fallbackResolved = true;
  });
  assert.equal(fallbackResolved, true);
  assert.equal(listeners.size, 0);
});

/** A SpeechDucker on fake timers, recording every duck/un-duck it applies. */
function fakeDucker() {
  const applied: boolean[] = [];
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  const ducker = new SpeechDucker((d) => applied.push(d), {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (t) => {
      pending.delete(t as unknown as number);
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, p] of [...pending]) {
      if (p.at <= now) {
        pending.delete(id);
        p.fn();
      }
    }
  };
  return { ducker, applied, advance };
}

test('pausing or muting the narrator mid-line brings the music back up', () => {
  const { ducker, applied, advance } = fakeDucker();
  ducker.begin(1, 5000);
  assert.equal(ducker.ducked, true);
  // hush() and switching Voice off both cancel speech; the cancelled line never reports its end
  ducker.release();
  assert.equal(ducker.ducked, false, 'music is no longer ducked');
  advance(6000);
  ducker.end(1);
  assert.deepEqual(applied, [true, false], 'nothing more happens once released');
});

test("an older line finishing doesn't un-duck or disarm the safety timer of the line after it", () => {
  const { ducker, applied, advance } = fakeDucker();
  ducker.begin(1, 5000); // commentary A
  ducker.begin(2, 5000); // the lap-record line, queued behind A
  ducker.end(1); // A finishes
  assert.equal(ducker.ducked, true, "B is still to be spoken, so the music stays down");
  // B's end event is lost (speech engines do this); its guard must still bring the music back
  advance(5001);
  assert.equal(ducker.ducked, false, 'the newest line’s guard un-ducks');
  assert.deepEqual(applied, [true, true, false]);
});

test('a queued line’s safety timer counts from when it actually starts speaking', () => {
  const { ducker, advance } = fakeDucker();
  ducker.begin(1, 5000);
  advance(4000); // still waiting for the line before it
  ducker.started(1, 5000);
  advance(2000); // 6s after begin, 2s into speech
  assert.equal(ducker.ducked, true, 'not cut short while it is still being spoken');
  advance(3001);
  assert.equal(ducker.ducked, false);
  ducker.started(7, 5000); // a stale id changes nothing
  assert.equal(ducker.ducked, false);
});
