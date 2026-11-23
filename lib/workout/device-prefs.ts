// Small per-device settings (rest timer length, sound on/off, dismissed hints)
// and the rest-timer beep. Storage and audio can both be unavailable; nothing
// here throws.

export function readPref(key: string) {
  try { return typeof window === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
}

export function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered, still works */ }
}

// One audio context for the whole page session. It used to live in a component
// ref, so navigating away and back gave a fresh, locked one until the next tap.
let sharedCtx: AudioContext | null = null;
let primedCtx: AudioContext | null = null;
const audioListeners = new Set<() => void>();
const stateWatched = new WeakSet<AudioContext>();

function notifyAudioListeners() {
  audioListeners.forEach((listener) => {
    try { listener(); } catch { /* ignore listener errors */ }
  });
}

/** Subscribe to shared audio context state changes (created, resumed, interrupted). */
export function subscribeAudioState(onChange: () => void): () => void {
  audioListeners.add(onChange);
  return () => { audioListeners.delete(onChange); };
}

function sharedContext() {
  if (sharedCtx && (sharedCtx.state as string) === 'closed') {
    sharedCtx = null;
    primedCtx = null;
  }
  if (sharedCtx) return sharedCtx;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    sharedCtx = new AudioCtx();
    if (sharedCtx && !stateWatched.has(sharedCtx)) {
      stateWatched.add(sharedCtx);
      sharedCtx.addEventListener?.('statechange', notifyAudioListeners);
    }
    notifyAudioListeners();
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
}

/**
 * Once the context is actually running, push both a silent oscillator graph and
 * a 1-frame buffer through the destination so iOS Safari routes audio properly.
 */
function primeOutput(context: AudioContext) {
  if ((context.state as string) !== 'running' || primedCtx === context) return;
  try {
    const now = context.currentTime || 0;
    const osc = context.createOscillator();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.02);

    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, context.sampleRate || 22050);
    silent.connect(context.destination);
    silent.start(0);

    primedCtx = context;
  } catch {
    // No audio output.
  }
}

/** True when a beep would actually be heard right now. */
export function audioIsRunning() {
  return (sharedCtx?.state as string) === 'running';
}

/**
 * Browsers only let audio start from a user activation, so create/resume the
 * context on one. iPhones also suspend ("interrupt") it when the screen locks,
 * another app plays sound or a call comes in, so this is called on every tap,
 * and a silent sample is played to fully unlock it. The argument is kept for
 * older callers; the shared context is always the one used.
 */
export function unlockAudio(_ctx?: AudioContext | null) {
  try {
    const context = sharedContext();
    if (!context) return null;
    const state = context.state as string;
    if (state !== 'running') {
      primedCtx = null;
      Promise.resolve(context.resume()).then(() => {
        primeOutput(context);
        notifyAudioListeners();
      }, () => {});
      // Older WebKit also expects a silent buffer scheduled synchronously in the gesture.
      const silent = context.createBufferSource();
      silent.buffer = context.createBuffer(1, 1, context.sampleRate || 22050);
      silent.connect(context.destination);
      silent.start(0);
    } else if (primedCtx !== context) {
      primeOutput(context);
    }
    return context;
  } catch {
    return null;
  }
}

/**
 * Re-unlock audio on every tap/key (pointerdown alone doesn't count as a user
 * activation on iOS touch, so touchend/click/keydown are used) and try to
 * resume when the page comes back to the front. Returns the cleanup.
 */
export function watchAudioUnlock() {
  const unlock = () => { unlockAudio(); };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && sharedCtx && (sharedCtx.state as string) !== 'running') {
      if ((sharedCtx.state as string) === 'closed') {
        sharedCtx = null;
        primedCtx = null;
        notifyAudioListeners();
        return;
      }
      const ctx = sharedCtx;
      Promise.resolve(ctx.resume()).then(() => {
        primeOutput(ctx);
        notifyAudioListeners();
      }, () => {});
    }
  };
  const events = ['touchend', 'click', 'keydown'] as const;
  events.forEach((e) => document.addEventListener(e, unlock, true));
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    events.forEach((e) => document.removeEventListener(e, unlock, true));
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** A rest alert that fires more than this long after it was due is skipped (you were away). */
export const LATE_ALERT_MS = 15_000;

export function alertIsTooLate(due: number, now: number) {
  return now - due > LATE_ALERT_MS;
}

/** Two short beeps (one for a quick test). Resumes a suspended context first. */
export function playBeep(given: AudioContext | null, count = 2) {
  const ctx = given ?? sharedContext();
  if (!ctx) return;
  const play = () => {
    try {
      for (let i = 0; i < count; i++) {
        const offset = 0.05 + i * 0.25;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.2);
      }
    } catch {
      // No audio output.
    }
  };
  if ((ctx.state as string) === 'running') play();
  else Promise.resolve(ctx.resume()).then(() => {
    primeOutput(ctx);
    notifyAudioListeners();
    play();
  }, () => {});
}

export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(pattern);
}

/** Starting intensity chosen for today only (e.g. from a low readiness day); null if none. */
export function readTodayIntensity(): number | null {
  try {
    const saved = JSON.parse(readPref('workout:todayIntensity') || 'null');
    const d = new Date();
    const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    return saved && saved.date === today && typeof saved.value === 'number' ? saved.value : null;
  } catch {
    return null;
  }
}

export function saveTodayIntensity(value: number | null) {
  const d = new Date();
  savePref('workout:todayIntensity', JSON.stringify(value === null ? null : { date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, value }));
}
