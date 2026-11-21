import type { DateKey } from '@/lib/habits/dates';

// Talking something through with an AI, usually while driving: exploring a subject,
// being debated, weighing a decision, brainstorming or looking back on the day. No API
// and no key: the page hands over a prompt for whichever AI app you use (its voice mode
// does the listening and speaking), and you paste back what it writes when you're
// parked, as JSON. Its summary, follow-ups and the rest are kept with that day's entry,
// with the conversation.

export const MAX_TOPIC = 300;
export const MAX_TRANSCRIPT = 100_000;

export type TalkMode = 'explore' | 'debate' | 'decide' | 'brainstorm' | 'reflect';

type ModeInfo = {
  label: string;
  /** Heads the summary in the entry: "Debated: remote work". */
  verb: string;
  blurb: string;
  /** Openers to pick from, besides writing your own. */
  topics: string[];
  placeholder: string;
  /** Who the AI is in this kind of talk. */
  role: string;
  /** How it opens with no topic given. */
  open: string;
  /** What the summary covers; a heading it didn't get to is left out. */
  summary: string[];
};

export const TALK_MODES: Record<TalkMode, ModeInfo> = {
  explore: {
    label: 'Explore a subject',
    verb: 'Explored',
    blurb: 'Dig into something: what you know, what you don’t, and angles you hadn’t thought of.',
    topics: ['Something I read or heard lately', 'How something works', 'An idea I keep coming back to', 'Something I’ve changed my mind about'],
    placeholder: 'e.g. Why bridges don’t fall down',
    role: `Be a curious, well-read partner helping me explore a subject. Find out what I already know and why I think it, then take it further: bring in facts, examples, history and angles I may not have considered, and say how sure you are when you add a fact. Point out gaps in my understanding, and follow whichever thread looks most interesting.`,
    open: 'Open by asking what I’d like to explore today.',
    summary: ['What we covered', 'What I think now', 'What I’m still unsure of', 'Worth looking into'],
  },
  debate: {
    label: 'Debate me',
    verb: 'Debated',
    blurb: 'It argues the other side, properly, and makes you defend your view.',
    topics: ['Something I believe strongly', 'A take I had today', 'A plan I’m confident in', 'Something most people get wrong'],
    placeholder: 'e.g. Remote work is better than the office',
    role: `Debate me. Take the strongest side against my position and argue it the way a sharp, fair opponent would, never a straw man. Make one point at a time and ask me to answer it. Use evidence and reasoning, not just assertion, and call out weak arguments on my side, including appeals to feelings, anecdotes and what “everyone knows”. When I make a good point, concede it plainly and move to your next strongest argument. Don’t drift into agreeing with me to be nice; only switch sides if I ask.`,
    open: 'Open by asking what position I want to defend.',
    summary: ['My position', 'The best case against it', 'Where my argument held up', 'Where I gave ground', 'Where I landed'],
  },
  decide: {
    label: 'Make a decision',
    verb: 'Decided',
    blurb: 'Lay out the options, what matters most, and what would change your mind.',
    topics: ['A decision I’m stuck on', 'Whether to start something', 'Whether to stop something', 'Which of two options'],
    placeholder: 'e.g. Whether to buy or keep renting',
    role: `Help me think through a decision. Get every option on the table, including ones I haven’t mentioned, ask what matters most to me and why, and test each option against that. Ask what I’d need to know to be sure, what would change my mind, and what each option costs in time, money and effort. Don’t decide for me.`,
    open: 'Open by asking what I’m trying to decide.',
    summary: ['The decision', 'The options', 'What matters most', 'What I was assuming', 'Where I landed'],
  },
  brainstorm: {
    label: 'Brainstorm',
    verb: 'Brainstormed',
    blurb: 'Ideas back and forth, building on each other’s, then picking what to try.',
    topics: ['A project idea', 'A problem at work', 'Something to build or make', 'A better way to do something'],
    placeholder: 'e.g. A weekend project with the kids',
    role: `Brainstorm with me. Build on my ideas and add your own, one or two at a time, mixing practical ones with unexpected ones. Hold off judging until we have a handful, then help me pick by asking what each would take and what could go wrong.`,
    open: 'Open by asking what we’re brainstorming.',
    summary: ['What we were solving', 'The best ideas', 'What could go wrong', 'What to try first'],
  },
  reflect: {
    label: 'Look back on the day',
    verb: 'Looked back on',
    blurb: 'What happened, what you made of it, and whether that holds up.',
    topics: ['How today went', 'Something that went well', 'Something I’d do differently', 'A conversation I keep thinking about'],
    placeholder: 'e.g. The meeting this morning',
    role: `Help me look back on my day, the way a friend who asks good questions would. Ask what happened and what I made of it. When someone else is involved, ask how they would tell it. Separate what happened from what I decided it meant.`,
    open: 'Open by asking how the day went.',
    summary: ['What happened', 'What I made of it', 'What I was assuming', 'Another way to see it', 'Where I landed'],
  },
};

export const isTalkMode = (value: unknown): value is TalkMode => typeof value === 'string' && value in TALK_MODES;

const fmtDate = (d: DateKey) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// ── What a talk leaves besides its summary ───────────────────────────────────

export const MAX_HEADLINE = 300;
export const MAX_QUOTE = 500;
/** One follow-up or question. */
export const MAX_ITEM = 300;
export const MAX_TAGS = 8;
export const MAX_PEOPLE = 12;
export const MAX_FOLLOW_UPS = 15;
export const MAX_QUESTIONS = 10;

/** The words a reply gives for mood, worst first: the same 1–5 as the journal's faces. */
export const TALK_MOODS = ['rough', 'meh', 'okay', 'good', 'great'] as const;
const MOOD_WORDS: Record<string, TalkMood> = { awful: 1, bad: 1, terrible: 1, low: 2, down: 2, ok: 3, fine: 3, mixed: 3, neutral: 3, happy: 4, positive: 4, amazing: 5, excellent: 5 };

export type TalkMood = 1 | 2 | 3 | 4 | 5;
export type TalkFollowUp = { text: string; when?: string; done?: boolean };
/** The structured parts of a JSON reply, all optional: old replies and some AIs leave them out. */
export type TalkExtras = {
  headline?: string;
  tags?: string[];
  people?: string[];
  followUps?: TalkFollowUp[];
  questions?: string[];
  quote?: string;
  mood?: TalkMood;
};

const oneLine = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

function moodOf(value: unknown): TalkMood | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 5 ? value as TalkMood : undefined;
  if (typeof value !== 'string') return undefined;
  const word = value.toLowerCase().replace(/[^a-z1-5]/g, '');
  if (/^[1-5]$/.test(word)) return Number(word) as TalkMood;
  const at = (TALK_MOODS as readonly string[]).indexOf(word);
  return at >= 0 ? (at + 1) as TalkMood : MOOD_WORDS[word];
}

/** Short strings, trimmed, without repeats, up to `max` of them. Tags and names may come as "a, b". */
function textList(value: unknown, max: number, len: number, opts: { split?: boolean; clean?: (s: string) => string } = {}) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? (opts.split ? value.split(/[,;\n]/) : [value]) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const s = (opts.clean ?? ((x: string) => x))(oneLine(item, len));
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function followUpsOf(value: unknown): TalkFollowUp[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set<string>();
  const out: TalkFollowUp[] = [];
  for (const item of items) {
    const o = typeof item === 'string' ? { text: item } : item && typeof item === 'object' ? item as Record<string, unknown> : null;
    if (!o) continue;
    const text = oneLine(o.text ?? o.task ?? o.title ?? o.what, MAX_ITEM);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const when = oneLine(o.when ?? o.due, 60);
    out.push({ text, ...(when ? { when } : {}), ...(o.done === true ? { done: true } : {}) });
    if (out.length >= MAX_FOLLOW_UPS) break;
  }
  return out;
}

/**
 * The extras worth keeping from anything (a parsed reply, a request, a stored talk),
 * cut to size. Empty ones are left out, so a talk without them stays as it was.
 */
export function cleanTalkExtras(raw: unknown): TalkExtras {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const headline = oneLine(r.headline, MAX_HEADLINE);
  const tags = textList(r.tags, MAX_TAGS, 40, { split: true, clean: (s) => s.replace(/^#+/, '').trim().toLowerCase() });
  const people = textList(r.people, MAX_PEOPLE, 60, { split: true, clean: (s) => s.replace(/^@/, '').trim() });
  const followUps = followUpsOf(r.followUps);
  const questions = textList(r.questions, MAX_QUESTIONS, MAX_ITEM);
  const quote = oneLine(r.quote, MAX_QUOTE).replace(/^["“”']+|["“”']+$/g, '');
  const mood = moodOf(r.mood);
  return {
    ...(headline ? { headline } : {}),
    ...(tags.length ? { tags } : {}),
    ...(people.length ? { people } : {}),
    ...(followUps.length ? { followUps } : {}),
    ...(questions.length ? { questions } : {}),
    ...(quote ? { quote } : {}),
    ...(mood ? { mood } : {}),
  };
}

/** What's still open from recent talks, for the AI to ask after if it fits. */
export type TalkThreads = { followUps: string[]; questions: string[] };

/**
 * The conversation partner. It's heard, not read, so replies are short and plain.
 * Whatever the kind of talk, it doesn't flatter and it keeps things objective: facts
 * apart from opinions, guesses named as guesses, the other side brought up.
 */
export function buildTalkPrompt({ date, mode, topic, written = '', threads }: { date: DateKey; mode: TalkMode; topic: string; written?: string; threads?: TalkThreads }) {
  const m = TALK_MODES[mode];
  const start = topic.trim() ? `The subject: ${topic.trim().slice(0, MAX_TOPIC)}. Open with one short question about it.` : m.open;
  const today = written.trim() ? `\nWhat I’ve already written in my journal today, for context (don’t repeat it back to me):\n"""\n${written.trim()}\n"""\n` : '';
  const open = [...(threads?.followUps ?? []).slice(0, 6), ...(threads?.questions ?? []).slice(0, 4)].map((t) => t.trim()).filter(Boolean);
  const lately = open.length
    ? `\nThings I said lately that I’d do or think more about. If one fits what we’re talking about, ask me how it’s going, but don’t go through the list:\n${open.map((t) => `- ${t}`).join('\n')}\n`
    : '';
  const pushback = mode === 'debate'
    ? ''
    : '- Don’t be contrary for the sake of it either. Push back because of something I actually said, and if the facts are on my side, say so plainly and move on.\n';
  const q = JSON.stringify;
  const summary = m.summary.map((heading, i) => `    { "heading": ${q(heading)}, "points": [${i === 0 ? '"…", "another point under the same heading, if there is one"' : '"…"'}] }`).join(',\n');

  return `This is a spoken conversation for my journal. I’m usually driving, so I’m listening, not reading. It’s ${fmtDate(date)}.

${m.role}

${start}
${today}${lately}
Keep track of the whole conversation as we go: when we wrap up, I’ll ask you to write all of it out for my journal, so none of it can be lost.

How to talk with me:
- Talk like a sharp, honest friend, not a therapist, coach or teacher. Ask, don’t lecture.
- Keep every reply to one to three short sentences, usually ending in one question. Plain speech only: no lists, headings, emoji or formatting, since it’s read aloud.
- One question or point at a time, and let me do a good share of the talking. If I say “hold on” or go quiet, just say “Sure.” and wait.
- Don’t flatter me. No praise or agreement for its own sake (“great point”, “that makes total sense”, “you’re right”), and don’t repeat back what I just said.
${pushback}- Keep it objective:
  - Separate facts from opinions, and say which is which, including your own.
  - When I treat a guess as a fact, point it out and ask what I actually know.
  - Bring up viewpoints and evidence I haven’t considered, especially ones that cut against what I’m saying.
  - Notice words like always, never, everyone and obviously, and ask if they hold.
  - If you’re not sure of a fact, say so rather than guess.
- Only give advice if I ask, and then give one or two options, each with its downside.
- Never ask me to read, look at or type anything until we’ve wrapped up.

Wrapping up:
- When I say “wrap up” (or “that’s it”, or “let’s stop”), say in one sentence the main thing I seemed to land on, then tell me to type “summary” when I’m parked. Don’t read a summary aloud.
- When I send “summary”, reply with one JSON object shaped like the one below and nothing else: no words before or after it, and not inside a code block. Use straight double quotes, as JSON needs.
- "summary" is my own journal note: first person, my words where you can, concrete and concise. Use the headings in the template, in that order, and leave out any we didn’t get to. Give each as many points as the conversation needs and no more: a short talk might need one, a long one several. Each point says one thing, without filler or repeating itself. You can put the few words that matter most in **bold**; nothing fancier.
- "headline" is one sentence: the main thing I landed on.
- "mood" is how I came across overall: great, good, okay, meh or rough. Leave it out if you can’t tell.
- "tags" are two to five short lowercase subjects (like work, money, health). "people" are the people I talked about, named as I named them.
- "followUps" are things I said I’d do, each with "when" if I said when. "questions" are things I want to think more about, or that we left open. "quote" is one thing I said that’s worth keeping, word for word.
- Leave out any of those you have nothing real for. Never invent follow-ups, people or quotes.
- "conversation" is the whole conversation: every turn, from the very first to the last, in order, with "who" as "me" or "you". Keep what I said in my own words (drop only ums, repeats and false starts) and what you said as you said it. Never summarize, shorten, merge or skip turns, and never put “…” or “[continues]” in place of something that was said. If the voice transcription garbled something I said, keep it as it came through, with [unclear] where words are missing.
- If it won’t all fit in one reply, stop at the end of a turn, close the JSON properly and set "more" to true. When I send “more”, reply with only {"conversation": [the next turns], "more": true or false}, carrying on from the next turn with nothing repeated, until the whole conversation is written out. Otherwise "more" is false.

{
  "topic": "a few words naming what we talked about",
  "headline": "one sentence: the main thing I landed on",
  "summary": [
${summary}
  ],
  "mood": "okay",
  "tags": ["a few one-word topics"],
  "people": ["first names of people who came up"],
  "followUps": [{ "text": "something I said I’d do", "when": "when I said I’d do it, if I did" }],
  "questions": ["Something I want to think more about"],
  "quote": "a line I said that’s worth keeping, word for word",
  "conversation": [
    { "who": "me", "text": "…" },
    { "who": "you", "text": "…" }
  ],
  "more": false
}`;
}

export class TalkReplyError extends Error {}

export type TalkReply = TalkExtras & {
  topic: string;
  summary: string;
  transcript: string;
  /** The AI said there's more of the conversation to come: send "more" and paste that too. */
  more?: boolean;
};

const HEADING = /^[ \t>#*_]*(topic|summary|conversation|transcript)[ \t*_]*:[ \t*_]*(.*)$/gim;

/**
 * The summary as tidy Markdown for the entry: every bullet a "- ", points under a heading
 * indented two spaces under it, and a heading's label in bold even when the AI forgot.
 */
export function tidySummary(text: string) {
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*)(?:[-*+•◦▪]|(\d+[.)]))\s+(.*)$/);
      if (!m) return line.trimEnd();
      const [, indent, number, rest] = m;
      const nested = indent.replace(/\t/g, '  ').length > 0;
      // "- What happened: …" → "- **What happened:** …"
      const body = !nested && !number ? rest.replace(/^([^*:\n]{2,48}):(\s+(?=\S)|\s*$)/, (_, label: string, after: string) => `**${label}:**${after ? ' ' : ''}`) : rest;
      return `${nested ? '  ' : ''}${number ?? '-'} ${body.trimEnd()}`;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const plainLine = (line: string) => line.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => a ?? b).replace(/^[-*_•\s]+|[*_\s]+$/g, '');

/** "MORE" and "(continued)" lines left where a long conversation was split across replies. */
const CONTINUED = /^[ \t*_#]*(?:conversation[ \t]*)?(?:more|\(?cont(?:inued)?\.?\)?)[ \t*_.:]*$/gim;
const ENDS_WITH_MORE = /(?:^|\n)[ \t*_#]*more[ \t*_.:]*$/i;
const FENCE_LINES = /^\s*(?:```|~~~)[\w-]*\s*$/gm;

// ── Reading JSON that came through a chat app ────────────────────────────────

/**
 * The JSON as it should have been: curly quotes used as JSON's quotes made straight,
 * line breaks inside strings escaped, and trailing commas dropped.
 */
function repairJson(src: string) {
  let out = '';
  let closer = '';
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (closer) {
      if (escaped) { escaped = false; out += c; continue; }
      if (c === '\\') { escaped = true; out += c; continue; }
      if (c === closer || (closer === '”' && c === '"')) { closer = ''; out += '"'; continue; }
      if (c === '"') { out += '\\"'; continue; } // a straight quote inside a curly-quoted string
      out += c === '\n' ? '\\n' : c === '\r' ? '' : c === '\t' ? '\\t' : c;
      continue;
    }
    if (c === '"' || c === '“' || c === '”') { closer = c === '"' ? '"' : '”'; out += '"'; continue; }
    if (c === ',' && /^\s*[}\]]/.test(src.slice(i + 1, i + 40))) continue;
    out += c;
  }
  return out;
}

function parseLoose(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    try { return JSON.parse(repairJson(candidate)); } catch { return undefined; }
  }
}

/**
 * Every top-level `{…}` in the text that reads as a JSON object, in order, with where
 * it was. Strings are respected (a brace inside one doesn't count), and prose, code
 * fences or anything else between the objects is skipped.
 */
export function extractJsonObjects(text: string): { value: Record<string, unknown>; start: number; end: number }[] {
  const found: { value: Record<string, unknown>; start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let closer = '';
    let escaped = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (closer) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === closer || (closer === '”' && c === '"')) closer = '';
        continue;
      }
      if (c === '"') closer = '"';
      else if (c === '“') closer = '”';
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = j + 1; break; }
    }
    if (end < 0) break; // never closed: a reply cut short
    const value = parseLoose(text.slice(start, end));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      found.push({ value: value as Record<string, unknown>, start, end });
      i = end;
    } else {
      i = start + 1; // a stray brace in prose: look again just after it
    }
  }
  return found;
}

const TALK_FIELDS = ['topic', 'headline', 'summary', 'conversation', 'transcript', 'more'];
const isTalkJson = (o: Record<string, unknown>) => TALK_FIELDS.some((k) => k in o);

/** `{ "journal": { … } }` and the like: the talk itself, one level down. */
function unwrap(o: Record<string, unknown>): Record<string, unknown> | null {
  if (isTalkJson(o)) return o;
  const values = Object.values(o);
  const inner = values.length === 1 && values[0] && typeof values[0] === 'object' && !Array.isArray(values[0]) ? values[0] as Record<string, unknown> : null;
  return inner && isTalkJson(inner) ? inner : null;
}

const ME = /^(me|i|user|human)$/i;

/** The conversation's turns as "Me: …" / "You: …" lines. */
function turnsOf(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    if (!item || typeof item !== 'object') return [];
    const o = item as Record<string, unknown>;
    let who = o.who ?? o.speaker ?? o.role ?? o.from;
    let said = o.text ?? o.said ?? o.content ?? o.message;
    // { "me": "…" } or { "you": "…" }
    if (who === undefined && said === undefined) {
      const [key, v] = Object.entries(o)[0] ?? [];
      who = key;
      said = v;
    }
    if (typeof said !== 'string' || !said.trim()) return [];
    const text = said.trim().replace(/\n{2,}/g, '\n');
    return [`${typeof who === 'string' && ME.test(who.trim()) ? 'Me' : 'You'}: ${text}`];
  });
}

/** The summary's headings and points as the same Markdown a text reply gives. */
function summaryMarkdown(value: unknown): string {
  if (typeof value === 'string') return tidySummary(value);
  const sections: { heading: string; points: unknown }[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') sections.push({ heading: '', points: [item] });
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        sections.push({ heading: oneLine(o.heading ?? o.title ?? o.label, 80), points: o.points ?? o.bullets ?? o.items ?? o.text });
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [heading, points] of Object.entries(value)) sections.push({ heading: oneLine(heading, 80), points });
  }
  const lines = sections.flatMap(({ heading, points }) => {
    const list = (Array.isArray(points) ? points : [points])
      .map((p) => oneLine(p, 2000).replace(/^[-*•]\s+/, ''))
      .filter(Boolean);
    const label = heading.replace(/[*_]+/g, '').replace(/\s*:\s*$/, '').trim();
    if (!label) return list.map((p) => `- ${p}`);
    if (!list.length) return [];
    return [`- **${label}:** ${list[0]}`, ...list.slice(1).map((p) => `  - ${p}`)];
  });
  return tidySummary(lines.join('\n'));
}

/** Conversation lines pasted outside the JSON (an AI that forgot the format halfway). */
function strayTurns(segment: string): string[] {
  const lines = segment.replace(FENCE_LINES, '').replace(CONTINUED, '').split('\n');
  const first = lines.findIndex((l) => /^\s*\**\s*(me|you)\s*\**\s*:/i.test(l));
  if (first < 0) return [];
  const text = lines.slice(first).join('\n').replace(/\*\*(Me|You):\*\*/gi, '$1:').trim();
  return text ? [text] : [];
}

function readJsonReply(text: string, objects: { value: Record<string, unknown>; start: number; end: number }[], fallbackTopic: string): TalkReply {
  const turns: string[] = [];
  const pick: Record<string, unknown> = {};
  const lists: Record<'tags' | 'people' | 'followUps' | 'questions', unknown[]> = { tags: [], people: [], followUps: [], questions: [] };
  let summary = '';
  let more = false;
  let at = 0;
  for (const { value, start, end } of objects) {
    turns.push(...strayTurns(text.slice(at, start)));
    at = end;
    // The first reply carries the summary; later ones carry on the conversation.
    for (const key of ['topic', 'headline', 'quote', 'mood'] as const) {
      if (pick[key] === undefined && value[key] !== undefined && value[key] !== '') pick[key] = value[key];
    }
    if (!summary && value.summary !== undefined) summary = summaryMarkdown(value.summary);
    for (const key of Object.keys(lists) as (keyof typeof lists)[]) {
      const v = value[key];
      if (Array.isArray(v)) lists[key].push(...v);
      else if (v !== undefined) lists[key].push(v);
    }
    turns.push(...turnsOf(value.conversation ?? value.transcript));
    more = value.more === true || value.more === 'true';
  }
  turns.push(...strayTurns(text.slice(at)));

  const extras = cleanTalkExtras({ ...pick, ...lists });
  const topic = plainLine(oneLine(pick.topic, MAX_TOPIC) || fallbackTopic).replace(/[.\s]+$/, '').slice(0, MAX_TOPIC);
  if (!summary && extras.headline) summary = `- ${extras.headline}`;
  if (!summary) {
    throw new TalkReplyError(turns.length
      ? 'That’s only the rest of the conversation. Paste the first “summary” reply above it, then this one.'
      : 'I couldn’t find the summary in that. Ask your AI for the “summary” reply again and paste all of it.');
  }
  const transcript = turns.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TRANSCRIPT);
  return { topic, summary, transcript, ...extras, ...(more ? { more: true } : {}) };
}

/** The reply in the older TOPIC: / SUMMARY: / CONVERSATION: text form. */
function readTextReply(raw: string, fallbackTopic: string): TalkReply {
  const text = raw.replace(FENCE_LINES, '').trim();
  const marks = [...text.matchAll(HEADING)].map((m) => ({ kind: m[1].toLowerCase() === 'transcript' ? 'conversation' : m[1].toLowerCase(), rest: m[2], at: m.index!, end: m.index! + m[0].length }));
  /** Every part under this label, joined: a long conversation can come back in more than one reply. */
  const section = (kind: string) => {
    const parts = marks.flatMap((m, i) => {
      if (m.kind !== kind) return [];
      const next = marks[i + 1];
      return [`${m.rest}\n${text.slice(m.end, next ? next.at : text.length)}`.trim()];
    });
    return parts.length ? parts.join('\n') : null;
  };

  const topicSection = section('topic');
  const topic = plainLine((topicSection ?? '').split('\n')[0] || fallbackTopic).replace(/[.\s]+$/, '').slice(0, MAX_TOPIC);
  const summary = tidySummary((marks.length ? section('summary') ?? '' : text).replace(CONTINUED, ''));
  const transcript = (section('conversation') ?? '')
    .replace(CONTINUED, '')
    .replace(/\*\*(Me|You):\*\*/g, '$1:')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TRANSCRIPT);

  if (!summary) throw new TalkReplyError('I couldn’t find the summary in that. Ask your AI for the “summary” reply again and paste all of it.');
  return { topic, summary, transcript, ...(ENDS_WITH_MORE.test(text) ? { more: true } : {}) };
}

/**
 * Read what the AI wrote back. The JSON form may come as several objects (a long
 * conversation split across replies), in or out of code fences, with chat between
 * them; they're put back together. The older TOPIC / SUMMARY / CONVERSATION text is
 * still read, and a reply with neither is taken as the summary on its own.
 */
export function parseTalkReply(raw: string, fallbackTopic = ''): TalkReply {
  const text = raw.replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new TalkReplyError('Paste what your AI wrote first.');
  const objects = extractJsonObjects(text).flatMap((o) => {
    const value = unwrap(o.value);
    return value ? [{ ...o, value }] : [];
  });
  if (objects.length) return readJsonReply(text, objects, fallbackTopic);
  if (/["“](?:topic|summary|conversation|headline)["”]\s*:/i.test(text)) {
    throw new TalkReplyError('That looks like the JSON reply, but part of it is broken or cut off. Ask your AI to send the “summary” reply again, then paste all of it.');
  }
  return readTextReply(text, fallbackTopic);
}

/** The summary as it goes into the day's entry, after whatever is written there already. */
export function appendTalkSummary(entry: string, reply: Pick<TalkReply, 'topic' | 'summary'>, mode: TalkMode) {
  const block = `### 🎙 ${TALK_MODES[mode].verb}${reply.topic ? `: ${reply.topic}` : ''}\n\n${reply.summary.trim()}`;
  const before = entry.replace(/\s+$/, '');
  return before ? `${before}\n\n${block}` : block;
}

/** A transcript as speaker turns, for showing it. Lines without a speaker continue the turn before. */
export function transcriptTurns(transcript: string) {
  const turns: { who: 'me' | 'ai'; text: string }[] = [];
  for (const line of transcript.split('\n')) {
    const m = line.match(/^\s*(me|i|you|ai|assistant|partner)\s*:\s*(.*)$/i);
    if (m) turns.push({ who: /^(me|i)$/i.test(m[1]) ? 'me' : 'ai', text: m[2].trim() });
    else if (line.trim() && turns.length) turns[turns.length - 1].text += `\n${line.trim()}`;
    else if (line.trim()) turns.push({ who: 'ai', text: line.trim() });
  }
  return turns;
}
