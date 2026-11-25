// Party sound: a small WebAudio synth for the TV — a looping game-show groove
// plus sound effects — and a narrator voice via the browser's speech engine.
// No audio files, so nothing to download or license.

import { chooseVoice, hasQualityVoice, rankVoices, speakable, splitForSpeech, voiceRate, waitForVoices } from '@/lib/party/narration';

type Sfx = 'pop' | 'whoosh' | 'tick' | 'ding' | 'buzzer' | 'fanfare' | 'drumroll' | 'slam' | 'boo' | 'cheer';

const PREFS_KEY = 'partySound';
/** `voiceName` is the narrator voice picked on this TV; unset means the best one available. */
export type SoundPrefs = { music: boolean; sfx: boolean; voice: boolean; voiceName?: string };

export function loadPrefs(): SoundPrefs {
  try {
    return { music: true, sfx: true, voice: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { music: true, sfx: true, voice: true };
  }
}

export function savePrefs(prefs: SoundPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// Chord progressions (semitones from the root) and tempo per mood.
const MOODS = {
  lobby: { root: 57, bpm: 112, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], swing: 0.12 },
  play: { root: 55, bpm: 124, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], swing: 0.08 },
  tense: { root: 52, bpm: 96, chords: [[0, 3, 7], [1, 4, 8], [0, 3, 7], [-1, 3, 6]], swing: 0 },
  results: { root: 60, bpm: 132, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], swing: 0.1 },
} as const;
export type Mood = keyof typeof MOODS;

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

class PartyAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mood: Mood | null = null;
  private step = 0;
  private nextTime = 0;
  private speakingListeners = new Set<(speaking: boolean) => void>();
  private activeUtterances = new Set<SpeechSynthesisUtterance>();
  private duckGuard: ReturnType<typeof setTimeout> | null = null;
  prefs: SoundPrefs = { music: true, sfx: true, voice: true };

  onSpeaking(fn: (speaking: boolean) => void): () => void {
    this.speakingListeners.add(fn);
    return () => { this.speakingListeners.delete(fn); };
  }

  private emitSpeaking(speaking: boolean) {
    this.speakingListeners.forEach((fn) => fn(speaking));
  }

  private clearSpeechTracking() {
    this.activeUtterances.clear();
    if (this.duckGuard) {
      clearTimeout(this.duckGuard);
      this.duckGuard = null;
    }
  }

  /** Browsers only allow audio after a user gesture; call from a click. */
  unlock() {
    if (typeof window === 'undefined') return;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.22;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  private tone(f: number, start: number, dur: number, type: OscillatorType, vol: number, dest?: AudioNode, glideTo?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(dest || this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private noise(start: number, dur: number, vol: number, dest?: AudioNode, highpass = 1000) {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(dest || this.master!);
    src.start(start);
  }

  sfx(name: Sfx) {
    if (!this.prefs.sfx || !this.ready) return;
    const t = this.ctx!.currentTime + 0.01;
    switch (name) {
      case 'pop': this.tone(520, t, 0.12, 'sine', 0.35, undefined, 1040); break;
      case 'whoosh': this.noise(t, 0.45, 0.25, undefined, 600); this.tone(200, t, 0.4, 'sine', 0.1, undefined, 900); break;
      case 'tick': this.tone(1500, t, 0.04, 'square', 0.12); break;
      case 'ding': this.tone(1318, t, 0.35, 'triangle', 0.3); this.tone(1976, t + 0.05, 0.3, 'sine', 0.15); break;
      case 'buzzer': this.tone(110, t, 0.6, 'sawtooth', 0.25); this.tone(116, t, 0.6, 'square', 0.12); break;
      case 'slam': this.noise(t, 0.15, 0.4, undefined, 200); this.tone(90, t, 0.25, 'sine', 0.5, undefined, 40); break;
      case 'boo': this.tone(220, t, 0.7, 'sawtooth', 0.12, undefined, 110); break;
      case 'cheer': for (let i = 0; i < 6; i++) this.noise(t + i * 0.05, 0.5, 0.08, undefined, 2000); break;
      case 'drumroll': for (let i = 0; i < 24; i++) this.noise(t + i * 0.05, 0.05, 0.12 + i * 0.006, undefined, 300); this.noise(t + 1.25, 0.4, 0.5, undefined, 100); break;
      case 'fanfare': [72, 76, 79, 84].forEach((n, i) => { this.tone(freq(n), t + i * 0.12, i === 3 ? 0.9 : 0.14, 'square', 0.14); this.tone(freq(n - 12), t + i * 0.12, i === 3 ? 0.9 : 0.14, 'triangle', 0.18); }); break;
    }
  }

  /** Loop background music in a mood (null stops it). */
  music(mood: Mood | null) {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (!mood || !this.prefs.music || !this.ctx) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    // Schedule a little ahead on a timer (the usual WebAudio sequencer pattern).
    this.timer = setInterval(() => this.schedule(), 50);
  }

  private schedule() {
    if (!this.ctx || !this.mood) return;
    const m = MOODS[this.mood];
    const eighth = 60 / m.bpm / 2;
    while (this.nextTime < this.ctx.currentTime + 0.2) {
      const bar = Math.floor(this.step / 8) % m.chords.length;
      const chord = m.chords[bar];
      const beat = this.step % 8;
      const t = this.nextTime + (beat % 2 ? m.swing * eighth : 0);
      const dest = this.musicGain!;
      if (beat % 4 === 0) this.tone(freq(m.root - 24 + chord[0]), t, eighth * 1.8, 'triangle', 0.5, dest);          // bass
      if (beat === 2 || beat === 6) this.tone(freq(m.root - 24 + chord[2]), t, eighth * 0.9, 'triangle', 0.35, dest);
      const arp = chord[[0, 1, 2, 1, 0, 2, 1, 2][beat]];
      this.tone(freq(m.root + 12 + arp), t, eighth * 0.8, 'square', 0.07, dest);                                     // arpeggio
      if (beat % 2 === 0) this.noise(t, 0.03, 0.05, dest, 7000);                                                     // hi-hat
      if (beat === 4) this.noise(t, 0.12, 0.12, dest, 1500);                                                         // snare-ish
      this.nextTime += eighth;
      this.step++;
    }
  }

  setPrefs(prefs: SoundPrefs) {
    this.prefs = prefs;
    savePrefs(prefs);
    if (!prefs.music) { const m = this.mood; this.music(null); this.mood = m; }
    if (!prefs.voice && typeof speechSynthesis !== 'undefined') {
      this.sayId++;
      this.clearSpeechTracking();
      speechSynthesis.cancel();
      this.emitSpeaking(false);
    }
  }

  /** Quiet the room for a pause. `resumeMusic` picks the music back up. */
  hush() {
    const m = this.mood;
    this.music(null);
    this.mood = m;
    this.sayId++;
    this.clearSpeechTracking();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
      this.emitSpeaking(false);
    }
  }

  resumeMusic() {
    const m = this.mood;
    this.mood = null;
    this.music(m);
  }

  // ─── Narrator ────────────────────────────────────────────────────────────────
  // Bumped by every new line, so pieces of an interrupted line stop.
  private sayId = 0;

  /** Narrator: speak a line (drops anything still queued so it stays in sync). */
  say(text: string, { interrupt = true } = {}) {
    if (!this.prefs.voice || typeof speechSynthesis === 'undefined') return;
    const chunks = splitForSpeech(speakable(text));
    if (!chunks.length) return;
    const id = ++this.sayId;
    if (interrupt) {
      this.clearSpeechTracking();
      speechSynthesis.cancel();
    }
    // Chrome/Edge load network/natural voices after local SAPI voices; wait briefly for them.
    whenVoicesReady(this.prefs.voiceName).then(() => {
      if (id !== this.sayId || !this.prefs.voice) return;
      // Chrome can drop a line spoken in the same tick as cancel(), so give it a beat.
      setTimeout(() => this.speakChunks(id, chunks), interrupt ? 60 : 0);
    });
  }

  private speakChunks(id: number, chunks: string[]) {
    if (id !== this.sayId || !this.prefs.voice) return;
    const voice = chooseVoice(speechSynthesis.getVoices(), this.prefs.voiceName);
    const duck = (down: boolean) => {
      this.emitSpeaking(down);
      if (!this.musicGain || !this.ctx) return;
      this.musicGain.gain.setTargetAtTime(down ? 0.07 : 0.22, this.ctx.currentTime, down ? 0.1 : 0.3);
    };
    duck(true);
    if (this.duckGuard) clearTimeout(this.duckGuard);
    this.duckGuard = setTimeout(() => {
      if (id === this.sayId) {
        this.duckGuard = null;
        duck(false);
      }
    }, Math.max(5000, chunks.join(' ').length * 140));
    speechSynthesis.resume(); // Chrome sometimes leaves the engine paused
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = voiceRate(voice);
      u.pitch = 1;
      // Keep a strong reference until completion so Chromium doesn't GC the utterance mid-speech.
      this.activeUtterances.add(u);
      const cleanup = () => {
        this.activeUtterances.delete(u);
        if (i === chunks.length - 1) {
          if (this.duckGuard) {
            clearTimeout(this.duckGuard);
            this.duckGuard = null;
          }
          if (id === this.sayId) duck(false);
        }
      };
      u.onend = cleanup;
      u.onerror = cleanup;
      speechSynthesis.speak(u);
    });
  }

  /** English voices on this device, best first, for a voice picker. */
  voices(): SpeechSynthesisVoice[] {
    return typeof speechSynthesis === 'undefined' ? [] : rankVoices(speechSynthesis.getVoices());
  }
}

let voicesSettled = false;
let pendingVoicesWait: Promise<void> | null = null;

/** Resolves once a human-like / preferred voice is available (or once settled after timeout). */
export function whenVoicesReady(preferredName?: string): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  if (hasQualityVoice(speechSynthesis.getVoices(), preferredName)) {
    voicesSettled = true;
    return Promise.resolve();
  }
  if (voicesSettled) return Promise.resolve();
  pendingVoicesWait ||= waitForVoices(speechSynthesis, preferredName, 900).then(() => {
    voicesSettled = true;
    pendingVoicesWait = null;
  });
  return pendingVoicesWait;
}

export const partyAudio = new PartyAudio();

/** Pick one of several lines, filling {placeholders}. */
export function line(options: string[], vars: Record<string, string | number> = {}) {
  const text = options[Math.floor(Math.random() * options.length)];
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
