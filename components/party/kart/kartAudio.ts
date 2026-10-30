// Race audio for the TV: procedural track music, engine notes for each human racer and
// event sound effects, all synthesised so there are no audio files to host.

import type { KartEvent, KartTelemetrySnapshot } from '@/lib/party/kart-physics';
import type { KartTrack } from '@/lib/party/kart-tracks';

const midiFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const MAX_ENGINE_VOICES = 4;

interface EngineVoice {
  osc: OscillatorNode;
  sub: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

export class KartAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<string, EngineVoice>();
  private squealGain: GainNode | null = null;
  private squealSource: AudioBufferSourceNode | null = null;
  private squealFilter: BiquadFilterNode | null = null;
  private track: KartTrack;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private finalLap = false;
  private musicOn = true;
  private sfxOn = true;
  private lastCountdownSec = -1;

  constructor(track: KartTrack) {
    this.track = track;
  }

  /** Browsers need a user gesture at some point; safe to call repeatedly. */
  resume() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.75;
      const compressor = this.ctx.createDynamicsCompressor();
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.3;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);

      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get running() {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  setPrefs(music: boolean, sfx: boolean) {
    this.musicOn = music;
    this.sfxOn = sfx;
    if (this.ctx && this.musicBus) this.musicBus.gain.setTargetAtTime(music ? 0.3 : 0, this.ctx.currentTime, 0.05);
    if (this.ctx && this.sfxBus) this.sfxBus.gain.setTargetAtTime(sfx ? 0.85 : 0, this.ctx.currentTime, 0.05);
    if (!sfx) this.stopEngines();
  }

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 60);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  setFinalLap() {
    this.finalLap = true;
  }

  private tone(when: number, freq: number, dur: number, vol: number, type: OscillatorType, bus: GainNode | null) {
    if (!this.ctx || !bus) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private noiseHit(when: number, dur: number, vol: number, filterType: BiquadFilterType, freq: number, bus: GainNode | null, sweepTo?: number) {
    if (!this.ctx || !bus || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, when);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, when + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(when, Math.random() * 0.5);
    src.stop(when + dur + 0.02);
  }

  private scheduleMusic() {
    if (!this.ctx || !this.musicBus || !this.musicOn) {
      if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.1;
      return;
    }
    const { root, bpm, chords, lead } = this.track.music;
    const tempo = bpm * (this.finalLap ? 1.14 : 1);
    const stepDur = 60 / tempo / 4; // sixteenth notes
    const transpose = this.finalLap ? 2 : 0;
    while (this.nextNoteTime < this.ctx.currentTime + 0.18) {
      const s = this.step;
      const t = this.nextNoteTime;
      const bar = Math.floor(s / 16);
      const chord = chords[bar % chords.length];
      const base = root + transpose;
      // Bass on a driving offbeat pattern
      if (s % 4 === 0 || s % 16 === 10) this.tone(t, midiFreq(base - 24 + chord[0]), stepDur * 2.2, 0.5, 'triangle', this.musicBus);
      if (s % 8 === 6) this.tone(t, midiFreq(base - 12 + chord[0]), stepDur * 1.2, 0.3, 'triangle', this.musicBus);
      // Arpeggio
      if (s % 2 === 0) {
        const note = chord[(s / 2) % chord.length];
        this.tone(t, midiFreq(base + note), stepDur * 1.5, 0.11, 'square', this.musicBus);
      }
      // Lead hook comes in on alternate phrases
      if (bar % 4 >= 2 && s % 4 === 0) {
        const n = lead[(s / 4) % lead.length];
        this.tone(t, midiFreq(base + n), stepDur * 3.4, 0.17, 'sawtooth', this.musicBus);
      }
      // Drums
      if (s % 8 === 0) this.tone(t, 110, 0.13, 0.75, 'sine', this.musicBus);
      if (s % 8 === 4) this.noiseHit(t, 0.11, 0.3, 'highpass', 1400, this.musicBus);
      if (s % 2 === 0) this.noiseHit(t, 0.03, 0.08, 'highpass', 7000, this.musicBus);
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }

  /** Engine note per human, squeal when any of them are drifting, countdown beeps. */
  update(snap: KartTelemetrySnapshot) {
    if (!this.ctx || !this.master || !this.sfxBus) return;

    // Also covers a TV that reloads mid-race and never saw the green light
    if (!snap.waitingForOrientation && snap.countdownMs <= 0) this.startMusic();

    if (!snap.waitingForOrientation) {
      const sec = snap.countdownMs > 0 ? Math.min(3, Math.ceil(snap.countdownMs / 1000)) : 0;
      if (sec !== this.lastCountdownSec) {
        if (sec > 0 && this.sfxOn) this.tone(this.ctx.currentTime, 520, 0.28, 0.5, 'square', this.sfxBus);
        this.lastCountdownSec = sec;
      }
    }

    if (!this.sfxOn) return;
    const humans = snap.karts.filter((k) => !k.isBot && !k.finished).slice(0, MAX_ENGINE_VOICES);
    const live = new Set(humans.map((k) => k.id));
    for (const [id, voice] of this.voices) {
      if (!live.has(id)) {
        voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
        voice.osc.stop(this.ctx.currentTime + 0.5);
        voice.sub.stop(this.ctx.currentTime + 0.5);
        this.voices.delete(id);
      }
    }
    const perVoice = 0.11 / Math.max(1, Math.sqrt(humans.length));
    let drifting = 0;
    for (const k of humans) {
      let v = this.voices.get(k.id);
      if (!v) {
        const osc = this.ctx.createOscillator();
        const sub = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        sub.type = 'square';
        filter.type = 'lowpass';
        filter.frequency.value = 520;
        gain.gain.value = 0;
        osc.connect(filter);
        sub.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxBus);
        osc.start();
        sub.start();
        v = { osc, sub, gain, filter };
        this.voices.set(k.id, v);
      }
      const ratio = Math.max(0, Math.min(1.5, Math.abs(k.speed) / 66));
      const boost = k.boostTimer > 0 || k.starTimer > 0;
      const freq = 58 + ratio * 170 + (boost ? 45 : 0) + (k.drifting ? 22 : 0);
      const t = this.ctx.currentTime;
      v.osc.frequency.setTargetAtTime(freq, t, 0.06);
      v.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.06);
      v.filter.frequency.setTargetAtTime(380 + ratio * 900 + (boost ? 500 : 0), t, 0.08);
      v.gain.gain.setTargetAtTime(perVoice * (0.5 + ratio * 0.5), t, 0.08);
      if (k.drifting && k.airT <= 0) drifting++;
    }

    if (!this.squealGain && this.noise) {
      this.squealSource = this.ctx.createBufferSource();
      this.squealSource.buffer = this.noise;
      this.squealSource.loop = true;
      this.squealFilter = this.ctx.createBiquadFilter();
      this.squealFilter.type = 'bandpass';
      this.squealFilter.frequency.value = 1900;
      this.squealFilter.Q.value = 7;
      this.squealGain = this.ctx.createGain();
      this.squealGain.gain.value = 0;
      this.squealSource.connect(this.squealFilter);
      this.squealFilter.connect(this.squealGain);
      this.squealGain.connect(this.sfxBus);
      this.squealSource.start();
    }
    this.squealGain?.gain.setTargetAtTime(drifting > 0 ? Math.min(0.2, 0.09 + drifting * 0.03) : 0, this.ctx.currentTime, 0.05);
  }

  private stopEngines() {
    if (!this.ctx) return;
    for (const voice of this.voices.values()) {
      voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
      voice.osc.stop(this.ctx.currentTime + 0.3);
      voice.sub.stop(this.ctx.currentTime + 0.3);
    }
    this.voices.clear();
    this.squealGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
  }

  /** `humanInvolved` keeps bot-on-bot action quiet so the mix doesn't turn to mush. */
  event(e: KartEvent, humanInvolved: boolean) {
    if (!this.ctx || !this.sfxBus || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    const bus = this.sfxBus;
    const vol = humanInvolved ? 1 : 0.28;
    switch (e.type) {
      case 'go':
        this.tone(t, 1040, 0.7, 0.6, 'square', bus);
        this.startMusic();
        break;
      case 'box':
        if (!humanInvolved) break;
        [660, 880, 1100, 1320].forEach((f, i) => this.tone(t + i * 0.05, f, 0.14, 0.26, 'square', bus));
        break;
      case 'boost':
      case 'pad':
      case 'rocket': {
        this.noiseHit(t, 0.5, 0.55 * vol, 'bandpass', 500, bus, 3500);
        this.tone(t, 220, 0.4, 0.2 * vol, 'sawtooth', bus);
        break;
      }
      case 'miniturbo': {
        const tier = e.value || 1;
        this.noiseHit(t, 0.32 + tier * 0.1, 0.5 * vol, 'bandpass', 700, bus, 3000 + tier * 900);
        this.tone(t, 330 + tier * 110, 0.2, 0.2 * vol, 'square', bus);
        break;
      }
      case 'stall':
        this.tone(t, 90, 0.5, 0.6, 'sawtooth', bus);
        this.noiseHit(t, 0.5, 0.3, 'lowpass', 600, bus);
        break;
      case 'shell':
      case 'drop':
        this.tone(t, e.type === 'shell' ? 720 : 300, 0.16, 0.3 * vol, 'triangle', bus);
        break;
      case 'hit':
        this.noiseHit(t, 0.32, 0.65 * vol, 'lowpass', 1500, bus);
        [880, 660, 440].forEach((f, i) => this.tone(t + i * 0.07, f, 0.16, 0.26 * vol, 'square', bus));
        break;
      case 'explosion':
        this.noiseHit(t, (e.value || 0) >= 2 ? 1.1 : 0.45, ((e.value || 0) >= 2 ? 1 : 0.5) * Math.max(vol, 0.5), 'lowpass', 900, bus, 120);
        this.tone(t, 70, 0.4, 0.6 * Math.max(vol, 0.5), 'sine', bus);
        break;
      case 'lightning':
        this.noiseHit(t, 0.6, 1, 'highpass', 1600, bus);
        this.tone(t, 55, 0.7, 0.8, 'sawtooth', bus);
        break;
      case 'horn': {
        const big = Boolean(e.value);
        [392, 494].forEach((f) => this.tone(t, f, big ? 0.6 : 0.28, (big ? 0.5 : 0.36) * vol, 'sawtooth', bus));
        break;
      }
      case 'wall':
        if (humanInvolved) this.noiseHit(t, 0.14, 0.4, 'bandpass', 900, bus);
        break;
      case 'bump':
        if (humanInvolved) this.tone(t, 130, 0.12, 0.45, 'triangle', bus);
        break;
      case 'jump':
        if (humanInvolved) {
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(300, t);
          osc.frequency.exponentialRampToValueAtTime(900, t + 0.22);
          g.gain.setValueAtTime(0.16, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
          osc.connect(g);
          g.connect(bus);
          osc.start(t);
          osc.stop(t + 0.3);
        }
        break;
      case 'trick':
        [784, 988, 1175].forEach((f, i) => this.tone(t + i * 0.045, f, 0.12, 0.25, 'triangle', bus));
        break;
      case 'land':
        if (humanInvolved) this.tone(t, 80, 0.16, 0.5, 'sine', bus);
        break;
      case 'lap':
        if (humanInvolved) [523, 659, 784].forEach((f, i) => this.tone(t + i * 0.09, f, 0.2, 0.35, 'square', bus));
        break;
      case 'final_lap':
        if (!this.finalLap) {
          this.setFinalLap();
          [523, 523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.12, f, 0.24, 0.42, 'square', bus));
        }
        break;
      case 'finish':
        if (humanInvolved) {
          [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(t + i * 0.11, f, 0.3, 0.42, 'square', bus));
          this.noiseHit(t + 0.1, 1.6, 0.25, 'highpass', 3000, bus);
        }
        break;
      case 'star':
        for (let i = 0; i < 8; i++) this.tone(t + i * 0.06, 660 + i * 90, 0.1, 0.2 * vol, 'square', bus);
        break;
      case 'clash':
        this.noiseHit(t, 0.5, 0.5, 'bandpass', 1100, bus, 300);
        [440, 330, 440, 330].forEach((f, i) => this.tone(t + i * 0.12, f, 0.12, 0.3, 'sawtooth', bus));
        break;
      default:
        break;
    }
  }

  dispose() {
    this.stopMusic();
    this.stopEngines();
    try {
      this.squealSource?.stop();
    } catch { /* already stopped */ }
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
