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

function sharedContext() {
  if (sharedCtx) return sharedCtx;
  try {
    sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
}

/** True when a beep would actually be heard right now. */
export function audioIsRunning() {
  return sharedCtx?.state === 'running';
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
    if (context.state !== 'running') context.resume().catch(() => {});
    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, 22050);
    silent.connect(context.destination);
    silent.start(0);
    return context;
  } catch {
    return null;
  }
}

/**
 * Re-unlock audio on every tap/key (pointerdown alone doesn't count as a user
 * activation on iOS touch, so click/touchend are needed) and try to resume when
 * the page comes back to the front. Returns the cleanup.
 */
export function watchAudioUnlock() {
  const unlock = () => { unlockAudio(); };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && sharedCtx && sharedCtx.state !== 'running') sharedCtx.resume().catch(() => {});
  };
  const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
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
  const ctx = given ?? sharedCtx;
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
  if (ctx.state === 'running') play();
  else ctx.resume().then(play, () => {});
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
