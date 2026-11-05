import type { DateKey } from '@/lib/habits/dates';

// Talking a day through with an AI, usually while driving. No API and no key: the
// page hands over a prompt for whichever AI app you use (its voice mode does the
// listening and speaking), and you paste back what it writes when you're parked.
// Its summary joins that day's entry; the conversation is kept with the day.

export const MAX_TOPIC = 300;
export const MAX_TRANSCRIPT = 100_000;
/** What the AI is asked to fill in; a line it didn't get to is left out. */
export const SUMMARY_LINES = ['What happened', 'How I felt', 'What I was assuming', 'The other side', 'Where I landed'] as const;

/** Openers to pick from, besides writing your own. */
export const TALK_TOPICS = [
  'How today went',
  'Something that’s bothering me',
  'A decision I’m stuck on',
  'A conversation that didn’t go well',
  'What I’m worried about',
  'Something that went well, and why',
] as const;

const fmtDate = (d: DateKey) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/**
 * The conversation partner. It's heard, not read, so replies are short and plain.
 * It isn't a cheerleader and isn't contrary for the sake of it: it pushes for the
 * other side, names assumptions and separates what happened from what it meant.
 */
export function buildTalkPrompt({ date, topic, written = '' }: { date: DateKey; topic: string; written?: string }) {
  const start = topic.trim()
    ? `I want to talk through: ${topic.trim().slice(0, MAX_TOPIC)}. Open with one short question about it.`
    : 'Open by asking what’s on my mind, in one short question.';
  const today = written.trim() ? `\nWhat I’ve already written in my journal today, for context (don’t repeat it back to me):\n"""\n${written.trim()}\n"""\n` : '';

  return `Be my journaling partner for a spoken conversation. I’m usually driving, so I’m listening, not reading. It’s ${fmtDate(date)}.

${start}
${today}
How to talk with me:
- Keep every reply to one to three short sentences, usually ending in one question. Plain speech only: no lists, headings, emoji or formatting, since it’s read aloud.
- One question at a time. Let me do most of the talking. If I say “hold on” or go quiet, just say “Sure.” and wait.
- Don’t be a cheerleader. No praise or agreement for its own sake (“great point”, “that makes total sense”, “you’re right”). Don’t repeat back what I just said, and don’t tell me how I feel.
- Don’t be contrary either. Push back only because of something I actually said, and if the facts are on my side, say so plainly and move on.
- Help me see it straight:
  - When someone else is involved, ask how they would tell it, or what might explain what they did.
  - When I treat a guess as a fact (“they don’t care”, “it’s going to fail”), point out that it’s a guess and ask what I actually know.
  - Separate what happened from how I felt about it and what I decided it meant.
  - Notice words like always, never, everyone and can’t, and ask if they’re true.
  - If I’m only seeing one option, ask what else I could do, or what I’d tell a friend in my place.
- Ask, don’t lecture. Don’t give advice unless I ask; then give one or two options, each with its downside. No therapy talk or diagnoses. If something sounds like real danger to me or someone else, say so directly and point me to real help.
- Never ask me to read, look at or type anything until we’ve wrapped up.

Wrapping up:
- When I say “wrap up” (or “that’s it”, or “let’s stop”), say in one sentence the main thing I seemed to land on, then tell me to type “summary” when I’m parked. Don’t read a summary aloud.
- When I send “summary”, reply with only the block below, with nothing before or after it. Write the summary as my own journal note: first person, my words where you can, concrete, under 100 words. Leave out any line we didn’t get to. Then write out the whole conversation turn by turn, close to the words we used, tidying false starts and filler but adding nothing.

TOPIC: a few words naming what we talked about
SUMMARY:
${SUMMARY_LINES.map((l) => `- ${l}: …`).join('\n')}
CONVERSATION:
Me: …
You: …`;
}

export class TalkReplyError extends Error {}

export type TalkReply = { topic: string; summary: string; transcript: string };

const HEADING = /^[ \t>#*_]*(topic|summary|conversation|transcript)[ \t*_]*:[ \t*_]*(.*)$/gim;

/** Tidy markdown the AI may add, so the summary reads cleanly in a plain-text entry. */
function plain(text: string) {
  return text
    .split('\n')
    .map((line) => line
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => a ?? b)
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '• ')
      .trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Read what the AI wrote back: TOPIC, SUMMARY and CONVERSATION sections. Code
 * fences and markdown are tolerated; a reply with no sections at all is taken
 * as the summary on its own.
 */
export function parseTalkReply(raw: string, fallbackTopic = ''): TalkReply {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\s*```[\w-]*\s*$/gm, '').trim();
  if (!text) throw new TalkReplyError('Paste what your AI wrote first.');

  const marks = [...text.matchAll(HEADING)].map((m) => ({ kind: m[1].toLowerCase(), rest: m[2], at: m.index!, end: m.index! + m[0].length }));
  const section = (kind: string) => {
    const i = marks.findIndex((m) => m.kind === kind || (kind === 'conversation' && m.kind === 'transcript'));
    if (i < 0) return null;
    const m = marks[i];
    const next = marks.slice(i + 1).find((n) => n.at > m.at);
    return `${m.rest}\n${text.slice(m.end, next ? next.at : text.length)}`.trim();
  };

  const topicSection = section('topic');
  const topic = plain((topicSection ?? '').split('\n')[0] || fallbackTopic).replace(/^•\s*/, '').replace(/[.\s]+$/, '').slice(0, MAX_TOPIC);
  const summary = plain(marks.length ? section('summary') ?? '' : text);
  const transcript = (section('conversation') ?? '').replace(/\*\*(Me|You):\*\*/g, '$1:').trim().slice(0, MAX_TRANSCRIPT);

  if (!summary) throw new TalkReplyError('I couldn’t find the summary in that. Ask your AI for the “summary” block again and paste all of it.');
  return { topic, summary, transcript };
}

/** The summary as it goes into the day's entry, after whatever is written there already. */
export function appendTalkSummary(entry: string, reply: Pick<TalkReply, 'topic' | 'summary'>) {
  const block = `🎙 Talked through${reply.topic ? `: ${reply.topic}` : ''}\n${reply.summary}`;
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
