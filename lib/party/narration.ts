// What the party narrator says, and which of the device's voices says it.
// Pure functions, so they're tested here and used by components/party/audio.ts.

/** The bits of a speech-engine voice we look at. */
export interface VoiceInfo {
  name: string;
  lang: string;
  localService?: boolean;
}

// Neural / "natural" voices sound like a person; the rest sound like a robot.
const GOOD = /natural|neural|online|enhanced|premium|siri|wavenet|studio/i;
// Novelty voices that sound awful reading a game show (macOS ships plenty).
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|eloquence|espeak|fred|good news|grandma|grandpa|hysterical|jester|junior|kathy|organ|pipe organ|ralph|rocko|shelley|superstar|trinoids|whisper|wobble|zarvox|compact/i;
// Warm, clear voices that suit a host, when the device has them.
const HOST = /ryan|sonia|libby|thomas|daniel|arthur|george|oliver|guy|davis|andrew|brian|emma|aria|jenny|serena|kate|google uk english/i;

/** How good a voice is likely to sound as the narrator (higher is better; below 0 means skip it). */
export function rankVoice(v: VoiceInfo): number {
  if (!/^en([-_]|$)/i.test(v.lang)) return -1;
  if (NOVELTY.test(v.name)) return -1;
  let score = 0;
  if (GOOD.test(v.name)) score += 100;
  else if (/google/i.test(v.name)) score += 60; // Chrome's network voices: far better than the built-in ones
  else if (v.localService === false) score += 40; // Any other cloud/network voice beats robotic local SAPI voices
  if (/^en[-_]GB/i.test(v.lang)) score += 20;
  else if (/^en[-_](US|AU|IE|CA|NZ)/i.test(v.lang)) score += 10;
  if (HOST.test(v.name)) score += 8;
  return score;
}

/** Whether a voice is a human-like (neural/network) voice rather than a built-in local synth. */
export function isQualityVoice(v: VoiceInfo): boolean {
  return rankVoice(v) >= 40;
}

/** Whether the voice list already includes the requested voice, or at least one quality voice. */
export function hasQualityVoice(voices: VoiceInfo[], preferredName?: string | null): boolean {
  if (preferredName) return voices.some((v) => v.name === preferredName);
  return voices.some(isQualityVoice);
}

export interface SpeechVoicesSource {
  getVoices(): VoiceInfo[];
  addEventListener(type: 'voiceschanged', listener: () => void): void;
  removeEventListener(type: 'voiceschanged', listener: () => void): void;
}

/**
 * Wait until the speech engine has loaded the preferred voice or a human-like voice,
 * rather than resolving immediately when Chromium only returns local robotic SAPI voices.
 */
export function waitForVoices(
  source: SpeechVoicesSource,
  preferredName?: string | null,
  timeoutMs = 900,
): Promise<void> {
  if (hasQualityVoice(source.getVoices(), preferredName)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      source.removeEventListener('voiceschanged', onChange);
      resolve();
    };
    const onChange = () => {
      if (hasQualityVoice(source.getVoices(), preferredName)) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    source.addEventListener('voiceschanged', onChange);
  });
}

/** The English voices worth offering, best first. */
export function rankVoices<T extends VoiceInfo>(voices: T[]): T[] {
  return voices
    .map((v, i) => ({ v, i, score: rankVoice(v) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.v);
}

/** The voice to use: the one picked by name if the device still has it, otherwise the best. */
export function chooseVoice<T extends VoiceInfo>(voices: T[], preferredName?: string | null): T | null {
  if (preferredName) {
    const picked = voices.find((v) => v.name === preferredName);
    if (picked) return picked;
  }
  return rankVoices(voices)[0] || null;
}

/** Natural/network voices already pace themselves well; the robotic ones need a nudge. */
export function voiceRate(v: VoiceInfo | null): number {
  return v && (GOOD.test(v.name) || /google/i.test(v.name) || v.localService === false) ? 1.0 : 1.05;
}

/** Turn display text into something that reads well out loud. */
export function speakable(text: string): string {
  return text
    // Emoji would be read out by name ("face with tears of joy").
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu, '')
    .replace(/_{2,}/g, ' blank ')
    .replace(/\s+vs\.?\s+/gi, ' versus ')
    .replace(/\s&\s/g, ' and ')
    .replace(/[“”«»]/g, '"')
    .replace(/…/g, '...')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_CHUNK = 180;

/**
 * Split a line into sentence-sized pieces. Some browsers stop speaking partway
 * through a long utterance, and short pieces also give natural pauses.
 */
export function splitForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) || [];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    // A sentence that's still too long breaks at commas, then at spaces.
    const parts = sentence.length <= MAX_CHUNK ? [sentence] : breakLong(sentence);
    for (const part of parts) {
      const last = chunks[chunks.length - 1];
      // Glue very short bits ("Go!") onto the previous piece so the speech doesn't stutter.
      if (last && (part.length < 12 || last.length < 12) && last.length + part.length + 1 <= MAX_CHUNK) chunks[chunks.length - 1] = `${last} ${part}`;
      else chunks.push(part);
    }
  }
  return chunks;
}

function breakLong(sentence: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of sentence.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > MAX_CHUNK && current) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
    // Prefer to break just after a comma once the piece is a decent length.
    if (/[,;:]$/.test(current) && current.length > MAX_CHUNK / 2) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Keeps the music turned down while the narrator talks. Each line gets an id; only the newest
 * line's end (or its safety timer, for engines that never fire `end`) turns the music back up,
 * and stopping speech outright always does.
 */
export class SpeechDucker {
  private current = 0;
  private guard: ReturnType<typeof setTimeout> | null = null;
  ducked = false;

  constructor(
    private apply: (ducked: boolean) => void,
    private timers: {
      set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clear: (t: ReturnType<typeof setTimeout>) => void;
    } = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) },
  ) {}

  private setDucked(down: boolean) {
    this.ducked = down;
    this.apply(down);
  }

  private armGuard(id: number, ms: number) {
    if (this.guard) this.timers.clear(this.guard);
    this.guard = this.timers.set(() => {
      if (id !== this.current) return;
      this.guard = null;
      this.setDucked(false);
    }, ms);
  }

  /** Line `id` is about to be spoken; `guardMs` un-ducks if its end never arrives. */
  begin(id: number, guardMs: number) {
    this.current = id;
    this.setDucked(true);
    this.armGuard(id, guardMs);
  }

  /** Line `id` actually started (a queued line may wait for the one before it): restart its guard. */
  started(id: number, guardMs: number) {
    if (id === this.current) this.armGuard(id, guardMs);
  }

  /** Line `id` finished. An older line finishing changes nothing. */
  end(id: number) {
    if (id !== this.current) return;
    if (this.guard) this.timers.clear(this.guard);
    this.guard = null;
    this.setDucked(false);
  }

  /** Speech was stopped (paused, voice switched off): bring the music back. */
  release() {
    this.current = -1;
    if (this.guard) this.timers.clear(this.guard);
    this.guard = null;
    if (this.ducked) this.setDucked(false);
  }
}
