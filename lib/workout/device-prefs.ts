// Small per-device settings (rest timer length, sound on/off, dismissed hints)
// and the rest-timer beep. Storage and audio can both be unavailable; nothing
// here throws.

export function readPref(key: string) {
  try { return typeof window === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
}

export function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered, still works */ }
}

/** Browsers only let audio start from a tap, so create/resume the context on one. */
export function unlockAudio(ctx: AudioContext | null) {
  try {
    const context = ctx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

/** Two short beeps. */
export function playBeep(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    [0, 0.25].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
  } catch {
    // No audio output — vibration still fires.
  }
}

export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(pattern);
}
