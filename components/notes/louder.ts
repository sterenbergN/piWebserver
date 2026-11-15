'use client';

// Making a quiet recording loud enough to hear. A lecture recorded from across a room comes
// out far below the level of anything else a phone plays, and a player's volume only goes up
// to "as recorded". So playback goes through a gain that listens to the sound and lifts it
// to a normal speaking level, with a limiter after it so a cough or a door doesn't blast.
// It only ever lifts: a recording that's already loud is left alone.
//
// Browsers only let a page shape sound once it has been tapped, and some never do. If that
// isn't allowed the recording just plays as it is, as it did before.

/** Where speech should sit, as RMS (about −17 dB): the level of a voice in a podcast. */
const TARGET = 0.14;
/** At most this much louder (about +26 dB). Past it, it's mostly the room's hiss. */
const MAX_GAIN = 20;
/** Quieter than this is a pause, not speech: the level isn't judged from it. */
const FLOOR = 0.0015;
const LOOK_MS = 100;

type Attach = (audio: HTMLAudioElement) => { close: () => void };

let context: AudioContext | null = null;

/**
 * The gain to play at, given how loud the speech has been. Never below 1, never above the limit,
 * and it moves a step at a time so a loud word doesn't make the next one drop away.
 */
export function gainFor(level: number) {
  if (level <= 0) return 1;
  return Math.max(1, Math.min(MAX_GAIN, TARGET / level));
}

/**
 * Follow how loud the speech is: up quickly when it gets louder (so the gain comes down before
 * it hurts), down slowly when it gets quieter (so pauses between sentences don't pump).
 */
export function followLevel(level: number, heard: number) {
  if (heard < FLOOR) return level;
  if (!level) return heard;
  return heard > level ? level + (heard - level) * 0.5 : level + (heard - level) * 0.03;
}

/**
 * Get ready to lift a recording's sound. Call it straight from the tap that starts playback;
 * it answers with something to attach the player to, or null if this browser won't allow it.
 */
export async function boostSound(): Promise<Attach | null> {
  const Context = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    context ??= new Context();
    const ctx = context;
    // A page that hasn't been tapped is never let through: don't wait on it for ever.
    if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 400))]);
    if (ctx.state !== 'running') return null;

    return (audio) => {
      const source = ctx.createMediaElementSource(audio);
      const listen = ctx.createAnalyser();
      listen.fftSize = 2048;
      const gain = ctx.createGain();
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -3;
      limit.knee.value = 3;
      limit.ratio.value = 20;
      limit.attack.value = 0.002;
      limit.release.value = 0.2;
      source.connect(listen);
      source.connect(gain).connect(limit).connect(ctx.destination);

      const samples = new Uint8Array(listen.fftSize);
      let level = 0;
      const timer = setInterval(() => {
        // The phone took the sound away (a call, the screen locking): ask for it back.
        if (ctx.state !== 'running') { void ctx.resume().catch(() => {}); return; }
        if (audio.paused) return;
        listen.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += ((value - 128) / 128) ** 2;
        level = followLevel(level, Math.sqrt(sum / samples.length));
        gain.gain.setTargetAtTime(gainFor(level), ctx.currentTime, 0.25);
      }, LOOK_MS);
      // Coming back to Notes: the sound may have been stopped while it was away.
      const onShow = () => { if (document.visibilityState === 'visible' && ctx.state !== 'running') void ctx.resume().catch(() => {}); };
      document.addEventListener('visibilitychange', onShow);

      return {
        close: () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onShow);
          try { source.disconnect(); gain.disconnect(); limit.disconnect(); listen.disconnect(); } catch { /* Already gone. */ }
        },
      };
    };
  } catch {
    return null;
  }
}
