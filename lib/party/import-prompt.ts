import type { BluffFact, PromptLists, SpyfallLocation, TriviaQuestion, WavelengthSpectrum } from './prompts';

// The party admin's bulk import: a prompt to give an AI (copy it, or Generate when
// the site has one connected) and the reader for the lines that come back. Both
// use the import box's own line formats, so a reply pastes straight in.

export type ImportKey = keyof PromptLists;

type ListSpec = {
  /** What the game is, for the AI. */
  game: string;
  /** What one entry is and what makes a good one. */
  entry: string;
  /** The line format, shown to the AI and in the import box. */
  format: string;
  examples: string[];
};

export const IMPORT_SPECS: Record<ImportKey, ListSpec> = {
  quipClash: {
    game: 'Quip Clash: two players each write a funny answer to the same prompt, then everyone votes for the funnier one.',
    entry: 'an open-ended, fill-in-the-blank style prompt that invites a short funny answer',
    format: 'Prompt',
    examples: ['A bad name for a pet dog', 'The worst thing to say at a funeral'],
  },
  theFaker: {
    game: 'The Faker: everyone gets the same secret task to act out at the same moment, except one player who must fake it without knowing the task. Players then vote on who the faker is.',
    entry: 'a short task everyone does at once with their hands, fingers or face (raise your hand if…, point to the person who…, hold up the number of…, make a face that…). The answers should vary between people so the faker can blend in',
    format: 'Task',
    examples: ['Raise your hand if you have ever broken a bone.', 'Point to the person who is most likely to survive a zombie apocalypse.'],
  },
  bracketBattles: {
    game: 'Bracket Battles: each player writes an answer to a prompt and the answers face off head to head in a knockout bracket.',
    entry: 'an open-ended prompt that invites a short, funny or bold answer',
    format: 'Prompt',
    examples: ['The most useless superpower you could possibly have', 'An awful idea for a new reality TV show'],
  },
  triviaQuestions: {
    game: 'Trivia Death: multiple-choice trivia with exactly four choices and one correct answer.',
    entry: 'a trivia question with four plausible choices, exactly one of them correct, and a short category. Vary which position holds the correct answer',
    format: 'Question | Choice A | Choice B | Choice C | Choice D | CorrectIndex(0-3) | Category',
    examples: ['What is the largest planet in our solar system? | Mars | Jupiter | Saturn | Neptune | 1 | Space'],
  },
  herdMentality: {
    game: 'Herd Mentality: everyone answers the same question and scores by giving the same answer as most of the group.',
    entry: 'a question with many reasonable answers but a few popular ones, answerable in a word or two',
    format: 'Question',
    examples: ['What is the best dipping sauce?', 'Name a movie that almost everyone has seen.'],
  },
  emojiTelephone: {
    game: 'Emoji Telephone: a player retells a phrase using only emoji, the next player turns the emoji back into words, and so on down the line.',
    entry: 'a short, vivid, silly scene (3 to 7 words) that can be drawn in emoji',
    format: 'Phrase',
    examples: ['Aliens abducting the wrong cow', 'A T-Rex trying to make a bed'],
  },
  spyfallLocations: {
    game: 'Spyfall: everyone but the spy is told the same location and a role there; players question each other to find the spy, who tries to guess the location.',
    entry: 'a recognizable location with an emoji and 5 to 8 distinct roles of people found there',
    format: 'Emoji | Location | role, role, role',
    examples: ['🚒 | Fire Station | Fire Chief, Rookie, Dalmatian, Dispatcher, Mechanic'],
  },
  wavelengthSpectrums: {
    game: 'Wavelength: one player gives a clue that sits at a hidden spot between two opposite ends; the others guess where on the spectrum it falls.',
    entry: 'a pair of opposite ends (one to three words each) that lots of things can be placed between',
    format: 'Left end | Right end',
    examples: ['Underrated | Overrated', 'Hot | Cold'],
  },
  bluffFacts: {
    game: 'Bluff Clash: players see a true fact with a blank, each writes a believable fake answer, then everyone tries to pick the real answer from the fakes.',
    entry: 'a surprising but true fact written with "_____" where the answer goes, the true answer (a word or short phrase), and 3 to 5 believable wrong answers ("house lies")',
    format: 'Fact with _____ | Truth | House lie | House lie | House lie',
    examples: ['A group of crows is called a _____. | murder | party | flock | crew'],
  },
};

export type ImportPromptOptions = {
  /** What the entries should be about ("90s movies", "family friendly"). Blank means anything goes. */
  theme?: string;
  count?: number;
  /** Entries already in the list, so the AI doesn't repeat them. */
  existing?: string[];
};

export const IMPORT_COUNT = { min: 5, max: 100, default: 25 };
export function clampCount(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return IMPORT_COUNT.default;
  return Math.min(IMPORT_COUNT.max, Math.max(IMPORT_COUNT.min, v));
}

/** One line per existing entry, so the AI can see what's taken. */
export function describeExisting(key: ImportKey, lists: PromptLists): string[] {
  switch (key) {
    case 'triviaQuestions': return lists.triviaQuestions.map((q) => q.question);
    case 'spyfallLocations': return lists.spyfallLocations.map((l) => l.name);
    case 'wavelengthSpectrums': return lists.wavelengthSpectrums.map((s) => `${s.left} | ${s.right}`);
    case 'bluffFacts': return lists.bluffFacts.map((f) => f.prompt);
    default: return lists[key];
  }
}

export function buildImportPrompt(key: ImportKey, opts: ImportPromptOptions = {}): string {
  const spec = IMPORT_SPECS[key];
  const count = clampCount(opts.count ?? IMPORT_COUNT.default);
  const theme = opts.theme?.trim();
  // All of them: any left out could come back as a repeat. Entries are short, so even a few hundred stay well within what an AI takes.
  const existing = [...new Set((opts.existing || []).map((e) => e.trim()).filter(Boolean))];
  const lines = [
    `Write ${count} new entries for a party game played in a room with friends, on a TV and phones.`,
    '',
    `The game: ${spec.game}`,
    `Each entry is ${spec.entry}.`,
    theme ? `Theme: ${theme}. Every entry should fit it.` : 'Any topic is fine; mix them up.',
    'Keep them fun, clear to read aloud, and suitable for a mixed group unless the theme says otherwise.',
    '',
    'Reply with only the entries, one per line, in exactly this format:',
    spec.format,
    '',
    'For example:',
    ...spec.examples,
    '',
    'No numbering, bullets, headings, blank lines, code blocks or comments.',
  ];
  if (existing.length) {
    lines.push('', 'These are already in the list. Don\'t repeat them or write close variations:');
    lines.push(...existing.map((e) => `- ${e}`));
  }
  return lines.join('\n');
}

/** The lines of a pasted file or AI reply, without the chatter AIs tend to add. */
function replyLines(text: string, plain: boolean): string[] {
  return text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('```'))
    // "1. ", "2) ", "- ", "* ", "• " in front of a line.
    .map((l) => l.replace(/^(?:\d{1,3}[.)]\s+|[-*•]\s+)/, ''))
    // A plain prompt list has no other way to tell "Here are 25 prompts:" from a prompt.
    .filter((l) => !(plain && /:$/.test(l)))
    .map((l) => (plain ? l.replace(/^(["“])(.*)(["”])$/, '$2') : l).trim())
    .filter(Boolean);
}

const cells = (line: string) => line.split('|').map((p) => p.trim());
const commaList = (text: string) => text.split(',').map((r) => r.trim()).filter(Boolean);

/** Reads import text in the list's line format. Lines that don't fit are skipped. */
export function parseImport<K extends ImportKey>(key: K, text: string): PromptLists[K] {
  switch (key) {
    case 'spyfallLocations': {
      // Emoji | Name | role, role, …   (the emoji is optional)
      const out: SpyfallLocation[] = replyLines(text, false).map(cells).filter((c) => c.length >= 2).map((c) => c.length >= 3
        ? { emoji: c[0], name: c[1], roles: commaList(c[2]) }
        : { emoji: '', name: c[0], roles: commaList(c[1]) });
      return out as PromptLists[K];
    }
    case 'wavelengthSpectrums': {
      const out: WavelengthSpectrum[] = replyLines(text, false).map(cells).filter((c) => c.length >= 2 && c[0] && c[1]).map((c) => ({ left: c[0], right: c[1] }));
      return out as PromptLists[K];
    }
    case 'bluffFacts': {
      const out: BluffFact[] = replyLines(text, false).map(cells).filter((c) => c.length >= 2 && c[0] && c[1])
        .map((c) => ({ prompt: c[0], truth: c[1], decoys: c.slice(2).filter(Boolean) }));
      return out as PromptLists[K];
    }
    case 'triviaQuestions': {
      const out: TriviaQuestion[] = [];
      for (const parts of replyLines(text, false).map(cells)) {
        if (parts.length < 6) continue;
        const ans = parseInt(parts[5], 10);
        if (isNaN(ans) || ans < 0 || ans > 3) continue;
        out.push({ question: parts[0], choices: [parts[1], parts[2], parts[3], parts[4]], answer: ans, ...(parts[6] ? { category: parts[6] } : {}) });
      }
      return out as PromptLists[K];
    }
    default:
      return replyLines(text, true) as PromptLists[K];
  }
}

/** For Generate: a message when a reply has nothing to import, null when it does. */
export function checkImport(key: ImportKey, text: string): string | null {
  if (parseImport(key, text).length) return null;
  return `No lines in the "${IMPORT_SPECS[key].format}" format.`;
}
