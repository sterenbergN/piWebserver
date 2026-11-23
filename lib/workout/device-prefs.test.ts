import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertIsTooLate,
  audioIsRunning,
  LATE_ALERT_MS,
  playBeep,
  subscribeAudioState,
  unlockAudio,
  watchAudioUnlock,
} from './device-prefs';

type ListenerRecord = { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions };

function createMockAudioContext(initialState: 'suspended' | 'running' = 'suspended') {
  const oscillators: Array<{ frequency: { value: number }; started: number[]; stopped: number[] }> = [];
  const gains: Array<{ setValueAtTimeCalls: Array<[number, number]>; expRampCalls: Array<[number, number]> }> = [];
  const bufferSources: Array<{ buffer: unknown; started: number[] }> = [];
  const stateListeners: Array<() => void> = [];
  let resumeCalls = 0;

  const ctx: any = {
    state: initialState,
    currentTime: 10,
    sampleRate: 44100,
    destination: { kind: 'destination' },
    addEventListener(type: string, cb: () => void) {
      if (type === 'statechange') stateListeners.push(cb);
    },
    resume() {
      resumeCalls += 1;
      return Promise.resolve().then(() => {
        if (ctx.state !== 'closed') ctx.state = 'running';
      });
    },
    createOscillator() {
      const osc = {
        frequency: { value: 440 },
        started: [] as number[],
        stopped: [] as number[],
        connect(target: unknown) { return target; },
        start(when = 0) { osc.started.push(when); },
        stop(when = 0) { osc.stopped.push(when); },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const record = {
        setValueAtTimeCalls: [] as Array<[number, number]>,
        expRampCalls: [] as Array<[number, number]>,
      };
      gains.push(record);
      return {
        gain: {
          setValueAtTime(value: number, time: number) { record.setValueAtTimeCalls.push([value, time]); },
          exponentialRampToValueAtTime(value: number, time: number) { record.expRampCalls.push([value, time]); },
        },
        connect(target: unknown) { return target; },
      };
    },
    createBuffer(channels: number, length: number, sampleRate: number) {
      return { channels, length, sampleRate };
    },
    createBufferSource() {
      const src = {
        buffer: null as unknown,
        started: [] as number[],
        connect(target: unknown) { return target; },
        start(when = 0) { src.started.push(when); },
      };
      bufferSources.push(src);
      return src;
    },
    emitStateChange() {
      stateListeners.forEach((cb) => cb());
    },
  };

  return {
    ctx,
    oscillators,
    gains,
    bufferSources,
    get resumeCalls() { return resumeCalls; },
  };
}

function installBrowserMocks(AudioContextCtor?: new () => unknown) {
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const added: ListenerRecord[] = [];
  const removed: ListenerRecord[] = [];

  (globalThis as any).window = AudioContextCtor ? { AudioContext: AudioContextCtor } : {};
  (globalThis as any).document = {
    visibilityState: 'visible',
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      added.push({ type, listener, options });
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      removed.push({ type, listener, options });
    },
  };

  return {
    added,
    removed,
    restore() {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
      if (prevDocument === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = prevDocument;
    },
  };
}

test('alerts on time or slightly late still fire', () => {
  assert.equal(alertIsTooLate(1000, 1000), false);
  assert.equal(alertIsTooLate(1000, 1000 + LATE_ALERT_MS), false);
});

test('alerts long after they were due are skipped', () => {
  assert.equal(alertIsTooLate(1000, 1000 + LATE_ALERT_MS + 1), true);
});

test('watchAudioUnlock registers touchend, click, keydown (not pointerdown) and removes them on cleanup', () => {
  const env = installBrowserMocks();
  try {
    const cleanup = watchAudioUnlock();
    const addedTypes = env.added.map((r) => r.type);
    assert.deepEqual(addedTypes, ['touchend', 'click', 'keydown', 'visibilitychange']);
    assert.equal(addedTypes.includes('pointerdown'), false);

    cleanup();
    assert.deepEqual(
      env.removed.map((r) => r.type),
      ['touchend', 'click', 'keydown', 'visibilitychange'],
    );
    assert.equal(env.removed[0].listener, env.added[0].listener);
    assert.equal(env.removed[0].options, true);
  } finally {
    env.restore();
  }
});

test('unlockAudio resumes suspended context, primes oscillator output after resume, and recreates closed context', async () => {
  const first = createMockAudioContext('suspended');
  const second = createMockAudioContext('suspended');
  let activeMock = first;
  const env = installBrowserMocks(function MockAudioContext() {
    return activeMock.ctx;
  } as unknown as new () => unknown);

  let notifications = 0;
  const unsubscribe = subscribeAudioState(() => { notifications += 1; });

  try {
    const returned = unlockAudio();
    assert.equal(returned, first.ctx);
    assert.equal(first.resumeCalls, 1);
    assert.equal(first.bufferSources.length, 1);
    // Oscillator priming must wait until resume() settles with state === 'running'.
    assert.equal(first.oscillators.length, 0);

    await new Promise((r) => setTimeout(r, 0));
    assert.equal(audioIsRunning(), true);
    assert.equal(first.oscillators.length, 1);
    assert.deepEqual(first.gains[0].setValueAtTimeCalls, [[0, 10]]);
    assert.ok(notifications >= 2);

    // Closed contexts must be discarded and recreated on next unlock.
    first.ctx.state = 'closed';
    activeMock = second;
    const recreated = unlockAudio();
    assert.equal(recreated, second.ctx);
    assert.equal(second.resumeCalls, 1);
  } finally {
    unsubscribe();
    first.ctx.state = 'closed';
    second.ctx.state = 'closed';
    env.restore();
  }
});

test('playBeep(null) creates sharedContext when unset and plays after resuming suspended context', async () => {
  const mock = createMockAudioContext('suspended');
  const env = installBrowserMocks(function MockAudioContext() {
    return mock.ctx;
  } as unknown as new () => unknown);

  try {
    playBeep(null, 2);
    assert.equal(mock.resumeCalls, 1);
    assert.equal(mock.oscillators.length, 0);

    await new Promise((r) => setTimeout(r, 0));
    const beepOscillators = mock.oscillators.filter((o) => o.frequency.value === 880);
    assert.equal(beepOscillators.length, 2);
    assert.equal(beepOscillators[0].started.length, 1);
    assert.equal(beepOscillators[0].stopped.length, 1);
  } finally {
    mock.ctx.state = 'closed';
    env.restore();
  }
});
