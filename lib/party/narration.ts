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
  if (/^en[-_]GB/i.test(v.lang)) score += 20;
  else if (/^en[-_](US|AU|IE|CA|NZ)/i.test(v.lang)) score += 10;
  if (HOST.test(v.name)) score += 8;
  return score;
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

/** Natural voices already pace themselves well; the robotic ones need a nudge. */
export function voiceRate(v: VoiceInfo | null): number {
  return v && GOOD.test(v.name) ? 1.0 : 1.05;
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
