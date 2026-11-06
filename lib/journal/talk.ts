import type { DateKey } from '@/lib/habits/dates';

// Talking something through with an AI, usually while driving: exploring a subject,
// being debated, weighing a decision, brainstorming or looking back on the day. No API
// and no key: the page hands over a prompt for whichever AI app you use (its voice mode
// does the listening and speaking), and you paste back what it writes when you're
// parked. Its summary joins that day's entry; the conversation is kept with the day.

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

/**
 * The conversation partner. It's heard, not read, so replies are short and plain.
 * Whatever the kind of talk, it doesn't flatter and it keeps things objective: facts
 * apart from opinions, guesses named as guesses, the other side brought up.
 */
export function buildTalkPrompt({ date, mode, topic, written = '' }: { date: DateKey; mode: TalkMode; topic: string; written?: string }) {
  const m = TALK_MODES[mode];
  const start = topic.trim() ? `The subject: ${topic.trim().slice(0, MAX_TOPIC)}. Open with one short question about it.` : m.open;
  const today = written.trim() ? `\nWhat I’ve already written in my journal today, for context (don’t repeat it back to me):\n"""\n${written.trim()}\n"""\n` : '';
  const pushback = mode === 'debate'
    ? ''
    : '- Don’t be contrary for the sake of it either. Push back because of something I actually said, and if the facts are on my side, say so plainly and move on.\n';

  return `This is a spoken conversation for my journal. I’m usually driving, so I’m listening, not reading. It’s ${fmtDate(date)}.

${m.role}

${start}
${today}
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
- When I send “summary”, reply with only the block below, nothing before or after it, and not inside a code block. Keep the three labels (TOPIC:, SUMMARY:, CONVERSATION:) exactly as they are, each at the start of its own line.
- The summary is my own journal note: first person, my words where you can, concrete and concise. Make it as long as the conversation needs and no longer: a short talk might need one bullet per heading, a long one several. Each bullet says one thing, without filler or repeating itself. Leave out any heading we didn’t get to.
- Format the summary in Markdown, like the template: each heading is a bullet starting with the heading in bold, and any further points go on their own bullets indented two spaces under it. Put the few words that matter most in **bold**. Nothing fancier: no tables, headings or emoji.
- Under CONVERSATION, write out the whole conversation: every turn, from the very first to the last, in order. Start each turn on a new line with “Me:” or “You:”. Keep what I said in my own words (drop only ums, repeats and false starts) and what you said as you said it. Never summarize, shorten, merge or skip turns, and never put “…” or “[continues]” in place of something that was said. If the voice transcription garbled something I said, keep it as it came through, with [unclear] where words are missing.
- If it won’t all fit in one reply, stop at the end of a turn and put MORE on a line of its own at the very end. When I send “more”, carry on from the next turn with no labels and nothing repeated, and keep going the same way until the whole conversation is written out.

TOPIC: a few words naming what we talked about
SUMMARY:
${m.summary.map((l) => `- **${l}:** …`).join('\n')}
  - another point under the same heading, if there is one
CONVERSATION:
Me: …
You: …`;
}

export class TalkReplyError extends Error {}

export type TalkReply = { topic: string; summary: string; transcript: string };

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

/**
 * Read what the AI wrote back: TOPIC, SUMMARY and CONVERSATION sections. Code
 * fences and markdown are tolerated; a reply with no sections at all is taken
 * as the summary on its own.
 */
export function parseTalkReply(raw: string, fallbackTopic = ''): TalkReply {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\s*```[\w-]*\s*$/gm, '').trim();
  if (!text) throw new TalkReplyError('Paste what your AI wrote first.');

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

  if (!summary) throw new TalkReplyError('I couldn’t find the summary in that. Ask your AI for the “summary” block again and paste all of it.');
  return { topic, summary, transcript };
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
