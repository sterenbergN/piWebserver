// Race audio for the TV: procedural biome-tuned synthwave/arcade soundtrack,
// 4-gear stereo-panned engines per human racer, continuous track/hazard cues,
// and rich event SFX — all synthesised in WebAudio with zero external assets.

import type { KartEvent, KartStyle, KartTelemetrySnapshot } from '@/lib/party/kart-physics';
import type { KartTrack, TrackBiome } from '@/lib/party/kart-tracks';

const midiFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const MAX_ENGINE_VOICES = 4;
const MUSIC_NORMAL_GAIN = 0.30;
const MUSIC_DUCKED_GAIN = 0.09;
const SFX_NORMAL_GAIN = 0.85;

interface EngineVoice {
  osc: OscillatorNode;
  sub: OscillatorNode;
  harm: OscillatorNode;
  oscGain: GainNode;
  subGain: GainNode;
  harmGain: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  style: KartStyle;
  lastSputterAt: number;
}

interface SynthNoteOpts {
  detune?: number;
  cutoff?: number;
  cutoffEnd?: number;
  glideTo?: number;
  fmRatio?: number;
  fmDepth?: number;
}

interface BiomeSynthProfile {
  bassType: OscillatorType;
  bassCutoff: number;
  arpType: OscillatorType;
  arpCutoff: number;
  arpDecay: number;
  leadType: OscillatorType;
  leadDetune: number;
  leadCutoff: number;
  padVol: number;
  fmBell: boolean;
  is808: boolean;
  brassStabs: boolean;
  swing: number;
}

const BIOME_PROFILES: Record<TrackBiome, BiomeSynthProfile> = {
  beach: {
    bassType: 'triangle',
    bassCutoff: 950,
    arpType: 'sine',
    arpCutoff: 4600,
    arpDecay: 1.15,
    leadType: 'sawtooth',
    leadDetune: 9,
    leadCutoff: 2800,
    padVol: 0.08,
    fmBell: false,
    is808: false,
    brassStabs: false,
    swing: 0.1,
  },
  canyon: {
    bassType: 'sawtooth',
    bassCutoff: 900,
    arpType: 'square',
    arpCutoff: 2600,
    arpDecay: 1.3,
    leadType: 'sawtooth',
    leadDetune: 12,
    leadCutoff: 3300,
    padVol: 0.05,
    fmBell: false,
    is808: false,
    brassStabs: false,
    swing: 0.04,
  },
  snow: {
    bassType: 'triangle',
    bassCutoff: 780,
    arpType: 'sine',
    arpCutoff: 5400,
    arpDecay: 2.1,
    leadType: 'triangle',
    leadDetune: 8,
    leadCutoff: 4200,
    padVol: 0.11,
    fmBell: true,
    is808: false,
    brassStabs: false,
    swing: 0,
  },
  space: {
    bassType: 'sawtooth',
    bassCutoff: 1150,
    arpType: 'square',
    arpCutoff: 3800,
    arpDecay: 1.4,
    leadType: 'sawtooth',
    leadDetune: 15,
    leadCutoff: 3900,
    padVol: 0.09,
    fmBell: false,
    is808: false,
    brassStabs: false,
    swing: 0,
  },
  lava: {
    bassType: 'sawtooth',
    bassCutoff: 760,
    arpType: 'sawtooth',
    arpCutoff: 2100,
    arpDecay: 1.1,
    leadType: 'sawtooth',
    leadDetune: 14,
    leadCutoff: 2400,
    padVol: 0.04,
    fmBell: false,
    is808: false,
    brassStabs: true,
    swing: 0,
  },
  city: {
    bassType: 'sine',
    bassCutoff: 850,
    arpType: 'triangle',
    arpCutoff: 4200,
    arpDecay: 1.25,
    leadType: 'square',
    leadDetune: 10,
    leadCutoff: 3600,
    padVol: 0.08,
    fmBell: false,
    is808: true,
    brassStabs: true,
    swing: 0.08,
  },
};

const CHASSIS_TONES: Record<KartStyle, {
  oscType: OscillatorType;
  subType: OscillatorType;
  harmType: OscillatorType;
  harmMult: number;
  oscWeight: number;
  subWeight: number;
  harmWeight: number;
  cutoffScale: number;
}> = {
  classic: {
    oscType: 'sawtooth',
    subType: 'triangle',
    harmType: 'sine',
    harmMult: 2,
    oscWeight: 0.42,
    subWeight: 0.65,
    harmWeight: 0.14,
    cutoffScale: 1,
  },
  rocket: {
    oscType: 'triangle',
    subType: 'sine',
    harmType: 'sine',
    harmMult: 3,
    oscWeight: 0.48,
    subWeight: 0.44,
    harmWeight: 0.28,
    cutoffScale: 1.22,
  },
  cyber: {
    oscType: 'sine',
    subType: 'triangle',
    harmType: 'triangle',
    harmMult: 2,
    oscWeight: 0.56,
    subWeight: 0.36,
    harmWeight: 0.30,
    cutoffScale: 1.15,
  },
  bruiser: {
    oscType: 'sawtooth',
    subType: 'triangle',
    harmType: 'sine',
    harmMult: 1.5,
    oscWeight: 0.44,
    subWeight: 0.85,
    harmWeight: 0.08,
    cutoffScale: 0.72,
  },
};

const STAR_ARP_OFFSETS = [0, 4, 7, 12, 16, 12, 7, 4];

function computeEngineCurve(speed: number, boost: boolean, drifting: boolean, launchRev: number, inCountdown: boolean) {
  if (inCountdown && launchRev > 0) {
    const rev = Math.min(1.6, launchRev);
    return {
      freq: 62 + rev * 115,
      cutoff: 520 + rev * 1400,
      volBoost: 0.65 + Math.min(0.45, rev * 0.3),
      overheat: rev > 1.2,
    };
  }
  const r = Math.max(0, Math.min(1.35, Math.abs(speed) / 68));
  const gears = [0, 0.27, 0.54, 0.82, 1.36];
  let gear = 0;
  for (let i = 0; i < 4; i++) {
    if (r >= gears[i]) gear = i;
  }
  const gMin = gears[gear];
  const gMax = gears[gear + 1];
  const rpm = Math.max(0.08, Math.min(1, (r - gMin) / (gMax - gMin)));
  const gearBase = 54 + gear * 18;
  const freq = gearBase + rpm * 78 + (boost ? 38 : 0) + (drifting ? 14 : 0);
  const cutoff = 380 + rpm * 680 + gear * 120 + (boost ? 550 : 0);
  const volBoost = 0.45 + rpm * 0.42 + (boost ? 0.15 : 0);
  return { freq, cutoff, volBoost, overheat: false };
}

export class KartAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private echoNodes: AudioNode[] = [];
  private noise: AudioBuffer | null = null;
  private voices = new Map<string, EngineVoice>();
  private squealGain: GainNode | null = null;
  private squealSource: AudioBufferSourceNode | null = null;
  private squealFilter: BiquadFilterNode | null = null;
  private slipstreamGain: GainNode | null = null;
  private slipstreamSource: AudioBufferSourceNode | null = null;
  private slipstreamFilter: BiquadFilterNode | null = null;
  private track: KartTrack;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private finalLap = false;
  private starActive = false;
  private musicOn = true;
  private sfxOn = true;
  private ducked = false;
  private lastCountdownSec = -1;
  private wasRoulette = false;
  private nextRouletteAt = 0;
  private nextRadarAt = 0;

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
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.15;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicTargetGain();
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 6800;
      this.musicFilter.Q.value = 0.7;
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.master);

      this.setupMusicEcho(this.ctx, this.musicFilter, this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? SFX_NORMAL_GAIN : 0;
      this.sfxBus.connect(this.master);

      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  private setupMusicEcho(ctx: AudioContext, src: AudioNode, dest: AudioNode) {
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 2800;
    const delayL = ctx.createDelay(1.0);
    delayL.delayTime.value = 0.22;
    const delayR = ctx.createDelay(1.0);
    delayR.delayTime.value = 0.33;
    const fbL = ctx.createGain();
    fbL.gain.value = 0.22;
    const fbR = ctx.createGain();
    fbR.gain.value = 0.20;
    const wet = ctx.createGain();
    wet.gain.value = 0.14;

    src.connect(echoFilter);
    echoFilter.connect(delayL);
    echoFilter.connect(delayR);
    delayL.connect(fbL);
    fbL.connect(delayR);
    delayR.connect(fbR);
    fbR.connect(delayL);

    if (typeof ctx.createChannelMerger === 'function') {
      const merger = ctx.createChannelMerger(2);
      delayL.connect(merger, 0, 0);
      delayR.connect(merger, 0, 1);
      merger.connect(wet);
      this.echoNodes.push(merger);
    } else {
      delayL.connect(wet);
      delayR.connect(wet);
    }
    wet.connect(dest);
    this.echoNodes.push(echoFilter, delayL, delayR, fbL, fbR, wet);
  }

  private musicTargetGain() {
    if (!this.musicOn) return 0;
    return this.ducked ? MUSIC_DUCKED_GAIN : MUSIC_NORMAL_GAIN;
  }

  get running() {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  setPrefs(music: boolean, sfx: boolean) {
    this.musicOn = music;
    this.sfxOn = sfx;
    if (this.ctx && this.musicBus) {
      this.musicBus.gain.setTargetAtTime(this.musicTargetGain(), this.ctx.currentTime, 0.05);
    }
    if (this.ctx && this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(sfx ? SFX_NORMAL_GAIN : 0, this.ctx.currentTime, 0.05);
    }
    if (!sfx) this.stopContinuousSfx();
  }

  /** Smoothly duck race music while the voice narrator speaks. */
  setDucking(down: boolean) {
    this.ducked = down;
    if (!this.ctx || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(this.musicTargetGain(), this.ctx.currentTime, down ? 0.08 : 0.25);
  }

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 55);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  setFinalLap() {
    this.finalLap = true;
  }

  private synthNote(
    when: number,
    freq: number,
    dur: number,
    vol: number,
    type: OscillatorType,
    bus: AudioNode | null,
    opts?: SynthNoteOpts,
  ) {
    if (!this.ctx || !bus) return;
    const ctx = this.ctx;
    const safeFreq = Math.max(20, freq);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.02, dur));

    let outNode: AudioNode = env;
    if (opts?.cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(opts.cutoff, when);
      if (opts.cutoffEnd) lp.frequency.exponentialRampToValueAtTime(Math.max(60, opts.cutoffEnd), when + dur);
      lp.connect(env);
      outNode = lp;
    }
    env.connect(bus);

    const spawnOsc = (detuneCents: number, gainScale: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(safeFreq, when);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, when);
      if (opts?.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glideTo), when + dur);
      if (gainScale < 1) {
        const g = ctx.createGain();
        g.gain.value = gainScale;
        osc.connect(g);
        g.connect(outNode);
      } else {
        osc.connect(outNode);
      }
      osc.start(when);
      osc.stop(when + dur + 0.03);
      return osc;
    };

    if (opts?.detune) {
      spawnOsc(-opts.detune, 0.55);
      spawnOsc(opts.detune, 0.55);
    } else {
      const carrier = spawnOsc(0, 1);
      if (opts?.fmRatio && opts?.fmDepth) {
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        mod.type = 'sine';
        mod.frequency.setValueAtTime(safeFreq * opts.fmRatio, when);
        modGain.gain.setValueAtTime(opts.fmDepth, when);
        modGain.gain.exponentialRampToValueAtTime(0.01, when + dur * 0.75);
        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        mod.start(when);
        mod.stop(when + dur + 0.03);
      }
    }
  }

  private noiseHit(
    when: number,
    dur: number,
    vol: number,
    filterType: BiquadFilterType,
    freq: number,
    bus: AudioNode | null,
    sweepTo?: number,
    q = 1,
  ) {
    if (!this.ctx || !bus || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, freq), when);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), when + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.02, dur));
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(when, Math.random() * 0.5);
    src.stop(when + dur + 0.03);
  }

  // ─── Synthesized Drum Kit ────────────────────────────────────────────────────

  private drumKick(when: number, vol: number, is808 = false) {
    const dur = is808 ? 0.24 : 0.13;
    const endFreq = is808 ? 36 : 42;
    this.synthNote(when, 155, dur, vol, 'sine', this.musicBus, { glideTo: endFreq });
    this.synthNote(when, 165, 0.035, vol * 0.35, 'triangle', this.musicBus, { glideTo: 55 });
  }

  private drumSnare(when: number, vol: number) {
    this.synthNote(when, 200, 0.09, vol * 0.65, 'triangle', this.musicBus, { glideTo: 125 });
    this.noiseHit(when, 0.13, vol * 0.72, 'bandpass', 1850, this.musicBus, 1100, 1.2);
  }

  private drumHat(when: number, vol: number, open = false) {
    this.noiseHit(when, open ? 0.15 : 0.035, vol, 'highpass', 7600, this.musicBus);
  }

  private drumTom(when: number, freq: number, vol: number) {
    this.synthNote(when, freq, 0.15, vol, 'triangle', this.musicBus, { glideTo: freq * 0.52 });
  }

  // ─── Biome-Specific 8-Bar Synth Soundtrack ───────────────────────────────────

  private scheduleMusic() {
    if (!this.ctx || !this.musicBus || !this.musicOn) {
      if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.1;
      return;
    }
    const { root, bpm, chords, lead } = this.track.music;
    const biome = this.track.biome;
    const profile = BIOME_PROFILES[biome] || BIOME_PROFILES.beach;
    const tempo = bpm * (this.finalLap ? 1.13 : 1);
    const stepDur = 60 / tempo / 4; // sixteenth note
    const transpose = this.finalLap ? 2 : 0;

    while (this.nextNoteTime < this.ctx.currentTime + 0.18) {
      const s = this.step;
      const bar = Math.floor(s / 16) % 8;
      const stepInBar = s % 16;
      const isSectionB = bar >= 4;
      const isFill = (bar === 3 || bar === 7) && stepInBar >= 12;
      const swingOffset = stepInBar % 2 === 1 ? profile.swing * stepDur : 0;
      const t = this.nextNoteTime + swingOffset;
      const chord = chords[bar % chords.length];
      const base = root + transpose;

      // 1. Lush pad / chord stabs
      if (stepInBar === 0 && profile.padVol > 0) {
        const padLift = isSectionB ? 12 : 0;
        chord.forEach((semi) => {
          this.synthNote(t, midiFreq(base + semi + padLift), stepDur * 14.5, profile.padVol, 'triangle', this.musicBus, {
            detune: 6,
            cutoff: 2200,
          });
        });
      }
      if (profile.brassStabs && (stepInBar === 0 || stepInBar === 6 || (isSectionB && stepInBar === 10))) {
        chord.slice(0, 3).forEach((semi) => {
          this.synthNote(t, midiFreq(base - (biome === 'lava' ? 12 : 0) + semi), stepDur * 1.9, 0.085, 'sawtooth', this.musicBus, {
            detune: 10,
            cutoff: 2100,
            cutoffEnd: 650,
          });
        });
      }

      // 2. Biome Bassline
      const bassPattern =
        biome === 'canyon' || biome === 'space'
          ? stepInBar % 2 === 0
          : biome === 'city'
            ? stepInBar === 0 || stepInBar === 3 || stepInBar === 6 || stepInBar === 10 || stepInBar === 12
            : stepInBar % 4 === 0 || stepInBar === 10 || (isSectionB && stepInBar === 14);
      if (bassPattern) {
        const octave = stepInBar === 6 || stepInBar === 14 ? -12 : -24;
        const deg = stepInBar === 10 && chord[2] !== undefined ? chord[2] : chord[0];
        this.synthNote(t, midiFreq(base + octave + deg), stepDur * 1.85, 0.36, profile.bassType, this.musicBus, {
          cutoff: profile.bassCutoff,
        });
      }

      // 3. Biome Arpeggio (Marimba / FM Chime / Cosmic / Rock)
      const arpEvery = biome === 'space' || isSectionB ? 2 : stepInBar % 4 === 0 || stepInBar % 4 === 2 ? 2 : 0;
      if (arpEvery && stepInBar % 2 === 0) {
        const arpIdx = (stepInBar / 2 + (isSectionB ? 1 : 0)) % chord.length;
        const arpNote = chord[arpIdx] + (isSectionB && stepInBar % 8 === 6 ? 12 : 0);
        const arpFreq = midiFreq(base + arpNote + (biome === 'snow' ? 12 : 0));
        this.synthNote(t, arpFreq, stepDur * profile.arpDecay, profile.fmBell ? 0.13 : 0.1, profile.arpType, this.musicBus, {
          cutoff: profile.arpCutoff,
          fmRatio: profile.fmBell ? 3.5 : biome === 'beach' ? 2 : undefined,
          fmDepth: profile.fmBell ? arpFreq * 1.8 : biome === 'beach' ? arpFreq * 0.45 : undefined,
        });
      }

      // 4. Lead Hook (A/B progression: alternate phrases in A, full hook in B)
      const leadHit = isSectionB ? stepInBar % 4 === 0 || stepInBar === 10 : bar % 2 === 1 && stepInBar % 4 === 0;
      if (leadHit) {
        const n = lead[(Math.floor(stepInBar / 2) + (isSectionB ? 2 : 0)) % lead.length];
        const leadFreq = midiFreq(base + n + (isSectionB ? 12 : 0));
        this.synthNote(t, leadFreq, stepDur * 3.1, 0.125, profile.leadType, this.musicBus, {
          detune: profile.leadDetune,
          cutoff: profile.leadCutoff,
          cutoffEnd: profile.leadCutoff * 0.55,
          fmRatio: profile.fmBell ? 2 : undefined,
          fmDepth: profile.fmBell ? leadFreq * 0.9 : undefined,
        });
      }

      // 5. Star Power Shimmering Arpeggio Overlay
      if (this.starActive) {
        const starMidi = base + 24 + STAR_ARP_OFFSETS[s % STAR_ARP_OFFSETS.length];
        this.synthNote(t, midiFreq(starMidi), stepDur * 1.3, 0.13, 'square', this.musicBus, {
          cutoff: 5400,
          detune: 6,
        });
      }

      // 6. Real Drum Kit + Bar 4 / Bar 8 Fills
      if (isFill) {
        const fillIdx = stepInBar - 12;
        if (biome === 'canyon' || biome === 'lava') {
          this.drumTom(t, [210, 170, 135, 100][fillIdx], 0.45);
          if (fillIdx === 3) this.drumHat(t, 0.12, true);
        } else {
          if (fillIdx % 2 === 0) this.drumSnare(t, 0.28 + fillIdx * 0.04);
          else this.drumTom(t, 165 - fillIdx * 18, 0.32);
          if (fillIdx === 3) this.drumHat(t, 0.11, true);
        }
      } else {
        const kickHit =
          biome === 'lava'
            ? stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 14
            : biome === 'city'
              ? stepInBar === 0 || stepInBar === 7 || stepInBar === 10
              : stepInBar === 0 || stepInBar === 8 || (isSectionB && stepInBar === 14);
        if (kickHit) this.drumKick(t, 0.68, profile.is808);
        if (stepInBar === 4 || stepInBar === 12) this.drumSnare(t, 0.36);
        if (this.finalLap || biome === 'space' || (biome === 'city' && isSectionB)) {
          this.drumHat(t, stepInBar % 2 === 0 ? 0.07 : 0.04, stepInBar === 14);
        } else if (stepInBar % 2 === 0) {
          this.drumHat(t, stepInBar % 4 === 2 ? 0.075 : 0.05, stepInBar === 14 && isSectionB);
        }
      }

      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 128;
    }
  }

  // ─── Engines, Continuous Cues & Countdown ───────────────────────────────────

  update(snap: KartTelemetrySnapshot) {
    if (!this.ctx || !this.master || !this.sfxBus) return;
    const t = this.ctx.currentTime;

    // Covers a TV that reloads mid-race and missed the green light
    if (!snap.waitingForOrientation && snap.countdownMs <= 0) this.startMusic();

    const inCountdown = !snap.waitingForOrientation && snap.countdownMs > 0;
    if (!snap.waitingForOrientation) {
      const sec = snap.countdownMs > 0 ? Math.min(3, Math.ceil(snap.countdownMs / 1000)) : 0;
      if (sec !== this.lastCountdownSec) {
        if (sec > 0 && this.sfxOn) {
          this.synthNote(t, 440, 0.30, 0.24, 'sawtooth', this.sfxBus, { detune: 8, cutoff: 2400 });
          this.synthNote(t, 220, 0.30, 0.26, 'triangle', this.sfxBus);
        }
        this.lastCountdownSec = sec;
      }
    }

    const humans = snap.karts.filter((k) => !k.isBot && !k.finished).slice(0, MAX_ENGINE_VOICES);
    this.starActive = humans.some((k) => k.starTimer > 0);

    if (!this.sfxOn) return;

    const live = new Set(humans.map((k) => k.id));
    for (const [id, voice] of this.voices) {
      if (!live.has(id)) {
        this.stopVoice(voice, t);
        this.voices.delete(id);
      }
    }

    const perVoice = 0.13 / Math.max(1, Math.sqrt(humans.length));
    let drifting = 0;
    let slipstreaming = false;
    let anyRoulette = false;
    let anyIncoming = false;

    humans.forEach((k, idx) => {
      const style: KartStyle = k.kartStyle || 'classic';
      let v = this.voices.get(k.id);
      if (!v) {
        v = this.createEngineVoice(style);
        this.voices.set(k.id, v);
      } else if (v.style !== style) {
        this.applyChassisTimbre(v, style);
      }

      const boost = k.boostTimer > 0 || k.starTimer > 0 || k.goldenShroomTimer > 0;
      const curve = computeEngineCurve(k.speed, boost, k.drifting, k.launchRev, inCountdown);
      const tone = CHASSIS_TONES[style];
      const wobble = curve.overheat ? Math.sin(t * 56) * 16 : 0;
      const freq = Math.max(30, curve.freq + wobble);

      v.osc.frequency.setTargetAtTime(freq, t, 0.055);
      v.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.055);
      v.harm.frequency.setTargetAtTime(freq * tone.harmMult, t, 0.055);
      v.harmGain.gain.setTargetAtTime(
        tone.harmWeight * (style === 'rocket' && boost ? 1.45 : 1),
        t,
        0.08,
      );
      v.filter.frequency.setTargetAtTime(curve.cutoff * tone.cutoffScale, t, 0.07);
      v.gain.gain.setTargetAtTime(perVoice * curve.volBoost, t, 0.07);

      if (v.panner) {
        const pan = humans.length === 1 ? 0 : ((idx / (humans.length - 1)) * 2 - 1) * 0.55;
        v.panner.pan.setTargetAtTime(pan, t, 0.1);
      }

      if (curve.overheat && t - v.lastSputterAt > 0.095) {
        v.lastSputterAt = t;
        this.noiseHit(t, 0.05, 0.16 / Math.max(1, humans.length), 'bandpass', 720, this.sfxBus, 320, 2.2);
      }

      if (k.drifting && k.airT <= 0) drifting++;
      if (k.slipstreaming) slipstreaming = true;
      if (k.itemRoulette) anyRoulette = true;
      if (k.hasIncomingShell) anyIncoming = true;
    });

    this.updateDriftSqueal(drifting, t);
    this.updateSlipstreamWind(slipstreaming, t);

    // Item roulette ticks + crisp lock-in chime when it settles
    if (anyRoulette) {
      if (t >= this.nextRouletteAt) {
        this.nextRouletteAt = t + 0.085;
        this.synthNote(t, 920 + ((Math.floor(t * 12) % 4) * 110), 0.045, 0.15, 'triangle', this.sfxBus);
      }
    } else if (this.wasRoulette && humans.length > 0 && !snap.celebrating) {
      this.synthNote(t, 1046.5, 0.14, 0.22, 'triangle', this.sfxBus);
      this.synthNote(t + 0.055, 1567.98, 0.22, 0.24, 'sine', this.sfxBus);
    }
    this.wasRoulette = anyRoulette;

    // Incoming shell radar double-beep alarm
    if (anyIncoming && t >= this.nextRadarAt) {
      this.nextRadarAt = t + 0.48;
      this.synthNote(t, 1480, 0.06, 0.20, 'triangle', this.sfxBus);
      this.synthNote(t + 0.085, 1760, 0.07, 0.22, 'triangle', this.sfxBus);
    }
  }

  private createEngineVoice(style: KartStyle): EngineVoice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const harm = ctx.createOscillator();
    const oscGain = ctx.createGain();
    const subGain = ctx.createGain();
    const harmGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 1.2;
    gain.gain.value = 0;

    osc.connect(oscGain);
    sub.connect(subGain);
    harm.connect(harmGain);
    oscGain.connect(filter);
    subGain.connect(filter);
    harmGain.connect(filter);
    filter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(this.sfxBus!);
    } else {
      gain.connect(this.sfxBus!);
    }

    const voice: EngineVoice = {
      osc,
      sub,
      harm,
      oscGain,
      subGain,
      harmGain,
      filter,
      gain,
      panner,
      style,
      lastSputterAt: 0,
    };
    this.applyChassisTimbre(voice, style);
    osc.start();
    sub.start();
    harm.start();
    return voice;
  }

  private applyChassisTimbre(voice: EngineVoice, style: KartStyle) {
    const tone = CHASSIS_TONES[style];
    voice.style = style;
    voice.osc.type = tone.oscType;
    voice.sub.type = tone.subType;
    voice.harm.type = tone.harmType;
    voice.oscGain.gain.value = tone.oscWeight;
    voice.subGain.gain.value = tone.subWeight;
    voice.harmGain.gain.value = tone.harmWeight;
  }

  private stopVoice(voice: EngineVoice, t: number) {
    voice.gain.gain.setTargetAtTime(0, t, 0.06);
    const stopAt = t + 0.35;
    try {
      voice.osc.stop(stopAt);
      voice.sub.stop(stopAt);
      voice.harm.stop(stopAt);
    } catch { /* already stopped */ }
  }

  private updateDriftSqueal(driftingCount: number, t: number) {
    if (!this.ctx || !this.sfxBus || !this.noise) return;
    if (!this.squealGain) {
      this.squealSource = this.ctx.createBufferSource();
      this.squealSource.buffer = this.noise;
      this.squealSource.loop = true;
      this.squealFilter = this.ctx.createBiquadFilter();
      this.squealFilter.type = 'bandpass';
      if (this.track.biome === 'snow') {
        this.squealFilter.frequency.value = 3100;
        this.squealFilter.Q.value = 3.2;
      } else if (this.track.biome === 'space') {
        this.squealFilter.frequency.value = 2650;
        this.squealFilter.Q.value = 10;
      } else {
        this.squealFilter.frequency.value = 1850;
        this.squealFilter.Q.value = 7;
      }
      this.squealGain = this.ctx.createGain();
      this.squealGain.gain.value = 0;
      this.squealSource.connect(this.squealFilter);
      this.squealFilter.connect(this.squealGain);
      this.squealGain.connect(this.sfxBus);
      this.squealSource.start();
    }
    const target = driftingCount > 0 ? Math.min(0.18, 0.08 + driftingCount * 0.03) : 0;
    this.squealGain.gain.setTargetAtTime(target, t, 0.05);
  }

  private updateSlipstreamWind(active: boolean, t: number) {
    if (!this.ctx || !this.sfxBus || !this.noise) return;
    if (!this.slipstreamGain) {
      this.slipstreamSource = this.ctx.createBufferSource();
      this.slipstreamSource.buffer = this.noise;
      this.slipstreamSource.loop = true;
      this.slipstreamFilter = this.ctx.createBiquadFilter();
      this.slipstreamFilter.type = 'bandpass';
      this.slipstreamFilter.frequency.value = 1050;
      this.slipstreamFilter.Q.value = 1.8;
      this.slipstreamGain = this.ctx.createGain();
      this.slipstreamGain.gain.value = 0;
      this.slipstreamSource.connect(this.slipstreamFilter);
      this.slipstreamFilter.connect(this.slipstreamGain);
      this.slipstreamGain.connect(this.sfxBus);
      this.slipstreamSource.start();
    }
    this.slipstreamGain.gain.setTargetAtTime(active ? 0.11 : 0, t, 0.08);
  }

  private stopContinuousSfx() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const voice of this.voices.values()) this.stopVoice(voice, t);
    this.voices.clear();
    this.squealGain?.gain.setTargetAtTime(0, t, 0.04);
    this.slipstreamGain?.gain.setTargetAtTime(0, t, 0.04);
    this.wasRoulette = false;
  }

  // ─── Event Sound Effects ────────────────────────────────────────────────────

  /** `humanInvolved` keeps bot-on-bot action quiet so the mix doesn't turn to mush. */
  event(e: KartEvent, humanInvolved: boolean) {
    if (!this.ctx || !this.sfxBus || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    const bus = this.sfxBus;
    const vol = humanInvolved ? 1 : 0.28;

    switch (e.type) {
      case 'go': {
        [440, 880, 1318.5].forEach((f, i) =>
          this.synthNote(t, f, 0.75, i === 0 ? 0.25 : 0.30, i === 0 ? 'sawtooth' : 'triangle', bus, { detune: 8, cutoff: 3400 }),
        );
        this.startMusic();
        break;
      }
      case 'hop':
        if (humanInvolved) {
          this.synthNote(t, 260, 0.09, 0.24, 'triangle', bus, { glideTo: 560 });
        }
        break;
      case 'drift_tier': {
        if (!humanInvolved) break;
        const tier = Math.max(1, Math.min(3, e.value || 1));
        const chords = [
          [587.33, 880],
          [739.99, 1108.73],
          [880, 1318.51, 1760],
        ];
        chords[tier - 1].forEach((f, i) => {
          this.synthNote(t + i * 0.025, f, 0.16, 0.22, 'triangle', bus);
        });
        break;
      }
      case 'coin': {
        if (!humanInvolved) break;
        const comboScale = 1 + Math.max(0, (e.value || 1) - 1) * 0.015;
        this.synthNote(t, 987.77 * comboScale, 0.08, 0.24, 'sine', bus);
        this.synthNote(t + 0.055, 1318.51 * comboScale, 0.22, 0.26, 'sine', bus);
        break;
      }
      case 'slipstream':
        if (humanInvolved) {
          this.noiseHit(t, 0.42, 0.42, 'bandpass', 420, bus, 2600, 2);
          this.synthNote(t, 320, 0.26, 0.22, 'triangle', bus, { glideTo: 760 });
        }
        break;
      case 'box':
        if (!humanInvolved) break;
        [660, 880, 1100, 1320].forEach((f, i) => this.synthNote(t + i * 0.045, f, 0.13, 0.22, 'triangle', bus));
        break;
      case 'boost':
      case 'pad':
      case 'rocket':
        this.noiseHit(t, 0.48, 0.52 * vol, 'bandpass', 500, bus, 3400, 1.4);
        this.synthNote(t, 220, 0.36, 0.2 * vol, 'sawtooth', bus, { glideTo: 420, cutoff: 2200 });
        break;
      case 'miniturbo': {
        const tier = e.value || 1;
        this.noiseHit(t, 0.30 + tier * 0.1, 0.48 * vol, 'bandpass', 700, bus, 2800 + tier * 900);
        this.synthNote(t, 330 + tier * 110, 0.2, 0.2 * vol, 'triangle', bus, { glideTo: 480 + tier * 130 });
        break;
      }
      case 'stall':
        this.synthNote(t, 115, 0.48, 0.45, 'sawtooth', bus, { glideTo: 52, cutoff: 900 });
        this.noiseHit(t, 0.48, 0.28, 'lowpass', 600, bus);
        break;
      case 'shell':
      case 'drop':
        this.synthNote(t, e.type === 'shell' ? 740 : 310, 0.15, 0.28 * vol, 'triangle', bus, {
          glideTo: e.type === 'shell' ? 460 : 190,
        });
        break;
      case 'hit':
        this.noiseHit(t, 0.32, 0.6 * vol, 'lowpass', 1500, bus);
        [880, 660, 440].forEach((f, i) => this.synthNote(t + i * 0.07, f, 0.16, 0.24 * vol, 'sawtooth', bus, { cutoff: 2000 }));
        break;
      case 'explosion': {
        const isBlue = (e.value || 0) >= 2;
        const scale = (isBlue ? 1 : 0.55) * Math.max(vol, 0.5);
        this.noiseHit(t, isBlue ? 1.15 : 0.45, scale, 'lowpass', isBlue ? 1100 : 850, bus, 90);
        this.synthNote(t, isBlue ? 110 : 80, isBlue ? 0.85 : 0.38, 0.72 * scale, 'sine', bus, { glideTo: isBlue ? 28 : 38 });
        if (isBlue) {
          this.synthNote(t, 165, 0.35, 0.38 * scale, 'triangle', bus, { glideTo: 42 });
        }
        break;
      }
      case 'lightning':
        this.noiseHit(t, 0.22, 0.95, 'highpass', 2200, bus);
        this.synthNote(t, 1850, 0.14, 0.45, 'sawtooth', bus, { glideTo: 240 });
        this.noiseHit(t + 0.08, 0.95, 0.85, 'lowpass', 900, bus, 140);
        this.synthNote(t + 0.06, 95, 0.85, 0.75, 'sawtooth', bus, { glideTo: 32, cutoff: 450 });
        break;
      case 'horn': {
        const big = Boolean(e.value);
        if (big) {
          [261.63, 329.63, 392.0, 523.25].forEach((f) => {
            this.synthNote(t, f, 0.58, 0.30 * vol, 'sawtooth', bus, { detune: 11, cutoff: 2800 });
          });
          this.synthNote(t, 130.81, 0.45, 0.45 * vol, 'sine', bus, { glideTo: 55 });
        } else {
          [392, 494].forEach((f) => this.synthNote(t, f, 0.24, 0.30 * vol, 'sawtooth', bus, { cutoff: 2200 }));
        }
        break;
      }
      case 'wall':
        if (humanInvolved) this.noiseHit(t, 0.14, 0.38, 'bandpass', 900, bus);
        break;
      case 'bump':
        if (humanInvolved) this.synthNote(t, 135, 0.12, 0.42, 'triangle', bus, { glideTo: 70 });
        break;
      case 'jump':
        if (humanInvolved) {
          this.synthNote(t, 300, 0.24, 0.2, 'triangle', bus, { glideTo: 900 });
        }
        break;
      case 'trick':
        [784, 988, 1175].forEach((f, i) => this.synthNote(t + i * 0.045, f, 0.13, 0.24, 'triangle', bus));
        break;
      case 'land':
        if (humanInvolved) this.synthNote(t, 85, 0.15, 0.45, 'sine', bus, { glideTo: 42 });
        break;
      case 'lap':
        if (humanInvolved) {
          [523.25, 659.25, 783.99].forEach((f, i) => this.synthNote(t + i * 0.09, f, 0.2, 0.28, 'triangle', bus));
        }
        break;
      case 'final_lap':
        if (!this.finalLap) {
          this.setFinalLap();
          [523.25, 587.33, 659.25, 783.99, 1046.5].forEach((f, i) => {
            this.synthNote(t + i * 0.105, f, i === 4 ? 0.5 : 0.18, 0.30, 'sawtooth', bus, { detune: 9, cutoff: 3400 });
          });
        }
        break;
      case 'finish':
        if (humanInvolved) {
          const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.51];
          notes.forEach((f, i) => {
            const at = t + i * 0.11;
            const dur = i === notes.length - 1 ? 0.75 : 0.18;
            this.synthNote(at, f, dur, 0.28, 'sawtooth', bus, { detune: 8, cutoff: 3600 });
            this.synthNote(at, f * 0.5, dur, 0.24, 'triangle', bus);
          });
          this.noiseHit(t + 0.1, 1.5, 0.20, 'highpass', 3200, bus);
        }
        break;
      case 'star':
        for (let i = 0; i < 8; i++) {
          this.synthNote(t + i * 0.055, 660 + i * 95, 0.11, 0.2 * vol, 'triangle', bus);
        }
        break;
      case 'clash':
        this.noiseHit(t, 0.48, 0.48, 'bandpass', 1100, bus, 300);
        [440, 330, 440, 330].forEach((f, i) => this.synthNote(t + i * 0.12, f, 0.12, 0.26, 'sawtooth', bus, { cutoff: 2000 }));
        break;
      default:
        break;
    }
  }

  dispose() {
    this.stopMusic();
    this.stopContinuousSfx();
    try { this.squealSource?.stop(); } catch { /* already stopped */ }
    try { this.slipstreamSource?.stop(); } catch { /* already stopped */ }
    for (const node of this.echoNodes) {
      try { node.disconnect(); } catch { /* ignore */ }
    }
    this.echoNodes = [];
    this.squealSource = null;
    this.squealFilter = null;
    this.squealGain = null;
    this.slipstreamSource = null;
    this.slipstreamFilter = null;
    this.slipstreamGain = null;
    this.musicFilter = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.master = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
