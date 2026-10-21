// Small per-device settings (rest timer length, sound on/off, dismissed hints)
// and the rest-timer beep. Storage and audio can both be unavailable; nothing
// here throws.

export function readPref(key: string) {
  try { return typeof window === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
}

export function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered, still works */ }
}

/**
 * Browsers only let audio start from a tap, so create/resume the context on
 * one. iPhones also suspend ("interrupt") it when the screen locks, another app
 * plays sound or a call comes in, so this is called on every tap, and a silent
 * sample is played to fully unlock it.
 */
export function unlockAudio(ctx: AudioContext | null) {
  try {
    const context = ctx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
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

/** Two short beeps (one for a quick test). Resumes a suspended context first. */
export function playBeep(ctx: AudioContext | null, count = 2) {
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
