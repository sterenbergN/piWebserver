// The prompts to copy into an AI app: planning a subject, and writing questions
// for it. Their replies are read by parse.ts, so the JSON shapes asked for here
// and read there must stay in step.

import { LEVELS, RESOURCE_KINDS, STAGES, itemTitle, type Item, type Subject } from './types';
import type { SubjectStats, TopicStats } from './model';

const levelScale = () => LEVELS.map((l) => `${l.level} ${l.name}: ${l.meaning}`).join('\n');
const fmt = (v: number) => v.toFixed(1);

export const LEARNING_STYLES = ['Books', 'Online courses', 'Videos', 'Hands-on projects', 'Papers and standards', 'Teaching it to others'] as const;

export type PlanOptions = {
  subject: Pick<Subject, 'name' | 'goal' | 'target' | 'background' | 'hoursPerWeek' | 'topics' | 'resources' | 'area'>;
  /** Where things stand, for planning again. Leave out for a first plan. */
  stats?: SubjectStats;
  styles: string[];
  /** Anything else to tell the AI. */
  extra?: string;
};

function standing(subject: PlanOptions['subject'], stats: SubjectStats) {
  const topics = stats.topics.map((t) => `- ${t.name} (stage ${t.stage}${t.core ? '' : ', optional'}): level ${fmt(t.level)}, ${describeState(t)}`).join('\n');
  const resources = subject.resources.map((r) => `- ${r.kind}: ${r.title}${r.author ? ` (${r.author})` : ''}, ${r.status}`).join('\n');
  return `Where I stand now (subject level ${fmt(stats.level)} of 5):
${topics || '- no topics yet'}

What I already have lined up or done:
${resources || '- nothing yet'}

Plan the next steps from here. Keep the topics above (use their exact names when a resource covers them) and only add topics that are missing. Add resources and projects aimed at my weak, fading and untested topics and at getting from where I am to my target. Don't list anything I already have.`;
}

export function describeState(t: TopicStats) {
  switch (t.state) {
    case 'strong': return 'strong';
    case 'weak': return `weak${t.recentTotal ? ` (${t.recentRight} of last ${t.recentTotal} right)` : ''}`;
    case 'fading': return `fading (last practised ${t.lastPractice})`;
    case 'untested': return `self-rated ${t.selfRating ?? 0}, never tested`;
    case 'gap': return 'not started';
    default: return t.answers ? 'okay' : 'not tested';
  }
}

export function buildPlanPrompt({ subject, stats, styles, extra }: PlanOptions) {
  const replan = !!stats && subject.topics.length > 0;
  return `You are helping me plan how to learn a subject properly: the way a senior engineer who knows it inside out and a good teacher would plan it together.

Subject: ${subject.name}${subject.area ? ` (area: ${subject.area})` : ''}
Why I want it: ${subject.goal || 'not given'}
Where I want to get: level ${subject.target} of 5 on this scale:
${levelScale()}
What I already know: ${subject.background || 'not given'}
Time I can give it: ${subject.hoursPerWeek ? `about ${subject.hoursPerWeek} hours a week` : 'not given'}
I like learning from: ${styles.length ? styles.join(', ') : 'a mix'}
${extra ? `\nAlso: ${extra}\n` : ''}
${replan ? standing(subject, stats!) : `Plan it from the start.`}

Write three things:

1. Topics. ${replan ? 'Only the missing ones.' : 'Between 8 and 20 for the whole subject, up to my target level.'} Each is a teachable chunk that can be tested on its own (not "Introduction"). Put each in a stage: 1 Foundations, 2 Core, 3 Applied, 4 Mastery. Set "core": false for nice-to-haves that an expert wouldn't need.

2. Resources, tied to the topics they cover:
   - the specific books (title, author, which chapters), courses, videos, papers and standards that people who know this field actually recommend. Only ones you are confident exist. Leave "url" out unless you are sure of it;
   - 2 to 5 hands-on projects with a concrete deliverable that proves each stage (what to build, measure or write, and what "done" looks like);
   - activities that build the skill (teach it, write a one-page summary, solve a problem set, review real work).
   Give rough hours for each. "kind" is one of: ${RESOURCE_KINDS.join(', ')}.

3. A roadmap in markdown: phases at my pace with rough weeks, what to read and build in each, and how I'll know I'm ready to move on (a test I could pass, a thing I could build).

Reply with one JSON code block in exactly this shape and nothing after it:

\`\`\`json
{
  "summary": "Two or three sentences on the approach.",
  "roadmap": "## Phase 1: ... (weeks 1-4)\\n- ...",
  "topics": [
    { "key": "t1", "name": "Short topic name", "stage": 1, "core": true, "description": "What it covers, one or two sentences." }
  ],
  "resources": [
    { "kind": "book", "title": "Exact title", "author": "Author", "detail": "Why, and which chapters", "topics": ["t1", "Exact name of a topic I already have"], "hours": 20 },
    { "kind": "project", "title": "Short project name", "detail": "What to build and what done looks like", "topics": ["t1"], "hours": 10 }
  ]
}
\`\`\`

"topics" in a resource lists topic keys from your list or exact names of my existing topics. Stages are ${STAGES.map((s) => `${s.stage} ${s.name}`).join(', ')}.`;
}

// ── Questions ────────────────────────────────────────────────────────────────

export const QUESTION_STYLES = [
  { id: 'mixed', label: 'Mixed', blurb: 'Graded questions and recall cards' },
  { id: 'calc', label: 'Worked problems', blurb: 'Numbers and units, like the daily questions' },
  { id: 'concept', label: 'Concept checks', blurb: 'Multiple choice, select all, put in order' },
  { id: 'cards', label: 'Recall cards', blurb: 'Explain it, then check yourself' },
  { id: 'placement', label: 'Placement test', blurb: 'Difficulty 1 to 5 per topic, to find your level fast' },
] as const;
export type QuestionStyle = (typeof QUESTION_STYLES)[number]['id'];

const STYLE_TEXT: Record<QuestionStyle, string> = {
  mixed: 'A mix: about half graded questions (worked calculations where the topic has math, concept checks where it doesn\'t) and half recall cards.',
  calc: 'Worked problems like a PE exam or a real design calculation: realistic numbers with units, answered as a number (or several parts). Use concept checks only for topics with no math at all.',
  concept: 'Concept checks: multiple choice, select-all-that-apply, or put-in-order. Wrong options must be the misconceptions people really have, not filler.',
  cards: 'Recall cards only: a question on the front that makes me retrieve something worth knowing (a why, a how, a comparison, a rule of thumb), and a short complete answer on the back.',
  placement: 'A placement test: for every topic, three graded questions at difficulty 1, 3 and 5, so my level can be found quickly.',
};

/** What the prompt needs to know about questions already written: a full item or a row from the subject's list. */
export type QuestionHistory = { title: string; retired?: boolean; feedback?: Item['feedback'] | null };
export const historyOf = (items: Item[]): QuestionHistory[] => items.map((i) => ({ title: itemTitle(i), retired: i.retired, feedback: i.feedback }));

export type QuestionPromptOptions = {
  subject: Pick<Subject, 'name' | 'resources'> & { items: QuestionHistory[] };
  topics: (Pick<TopicStats, 'name' | 'stage' | 'level' | 'state' | 'recentRight' | 'recentTotal' | 'lastPractice' | 'selfRating' | 'answers'> & { description?: string })[];
  count: number;
  style: QuestionStyle;
  /** 'auto' aims one level above where each topic is. */
  difficulty: 'auto' | number;
  extra?: string;
};

/** What the votes on this subject's questions said, so the next batch is pitched better. */
function feedbackNote(items: QuestionHistory[]) {
  const votes = { easy: 0, right: 0, hard: 0, down: 0 };
  for (const i of items) {
    if (i.feedback?.difficulty) votes[i.feedback.difficulty]++;
    if (i.feedback?.rating === 'down') votes.down++;
  }
  const lines: string[] = [];
  if (votes.easy + votes.right + votes.hard >= 3) lines.push(`My votes on earlier questions: ${votes.easy} too easy, ${votes.right} about right, ${votes.hard} too hard. Adjust.`);
  if (votes.down) lines.push(`${votes.down} earlier question${votes.down === 1 ? ' was' : 's were'} rated poor; avoid wordy, ambiguous or tedious ones.`);
  const reported = items.filter((i) => i.retired && i.feedback?.report).slice(-5);
  if (reported.length) lines.push(`Questions I reported as wrong: ${reported.map((i) => `"${i.title}" (${i.feedback!.report!.kind}${i.feedback!.report!.note ? `: ${i.feedback!.report!.note}` : ''})`).join('; ')}. Don't repeat those mistakes.`);
  return lines.join('\n');
}

export function aimFor(level: number) {
  return Math.min(5, Math.max(1, Math.round(level) + 1));
}

export function buildQuestionsPrompt({ subject, topics, count, style, difficulty, extra }: QuestionPromptOptions) {
  const topicLines = topics.map((t) => {
    const aim = difficulty === 'auto' ? aimFor(t.level) : difficulty;
    return `- "${t.name}" (stage ${t.stage}${t.description ? `: ${t.description}` : ''}). My level ${fmt(t.level)}, ${describeState(t as TopicStats)}.${style === 'placement' ? '' : ` Aim for difficulty ${aim}.`}`;
  }).join('\n');
  const existing = subject.items.filter((i) => !i.retired).map((i) => `- ${i.title}`).slice(-80).join('\n');
  const read = subject.resources.filter((r) => r.status === 'done' || r.status === 'doing').map((r) => `${r.title}${r.author ? ` (${r.author})` : ''}`).slice(0, 10);
  const notes = feedbackNote(subject.items);
  const total = style === 'placement' ? topics.length * 3 : count;

  return `Write ${total} practice questions to test me on ${subject.name}, so I can find out what I really know and keep it fresh.

Topics (use these exact names in "topic"):
${topicLines}

Spread the questions across the topics, more on weak and fading ones.
Style: ${STYLE_TEXT[style]}

Difficulty is 1 to 5 on the same scale as my levels: a difficulty-d question is one that someone at level d gets right about 70% of the time.
${levelScale()}
${read.length ? `\nI have studied: ${read.join('; ')}. You may cite them.` : ''}
${notes ? `\n${notes}\n` : ''}${existing ? `\nI already have these; don't repeat them:\n${existing}\n` : ''}${extra ? `\nAlso: ${extra}\n` : ''}
Rules:
- Be correct above all. Work every numeric answer out fully before writing it, and put that full working in "solution". If you're not sure of a fact, don't ask about it.
- Questions should test understanding and use, not trivia: realistic situations, design decisions, troubleshooting, "what happens if".
- Math in $...$ (inline) or $$...$$ (display) LaTeX. Inside JSON strings, every backslash is doubled: "$\\\\frac{a}{b}$".
- Give 1 to 3 real sources per graded question (book and section, standard and clause, or a well-known reference).
- Up to 3 short hints that help without giving the answer away.

Reply with one JSON code block in exactly this shape and nothing after it:

\`\`\`json
{
  "questions": [
    {
      "type": "graded",
      "topic": "Exact topic name",
      "difficulty": 3,
      "title": "Short title",
      "prompt": "The question, in markdown.",
      "parts": [
        { "id": "a", "prompt": "Optional text for this part", "answer": { "type": "numeric", "value": 12.5, "unit": "kN", "tolerance": 0.02 } }
      ],
      "hints": ["A nudge"],
      "solution": "The full worked solution in markdown.",
      "sources": [{ "title": "Book or standard", "detail": "Chapter or section" }]
    },
    { "type": "card", "topic": "Exact topic name", "difficulty": 2, "front": "Question", "back": "Short complete answer" }
  ]
}
\`\`\`

Answer types for a graded part (one per part, up to 8 parts):
- { "type": "numeric", "value": 12.5, "unit": "kN", "tolerance": 0.02 }  (tolerance is relative, default 0.02; an answer of 0 needs "abs": 0.01 instead)
- { "type": "choice", "options": ["...", "...", "...", "..."], "correct": 2 }  (correct is the 0-based index)
- { "type": "multi", "options": ["...", "...", "..."], "correct": [0, 2] }
- { "type": "order", "items": ["first", "second", "third"] }  (listed in the correct order; I see them shuffled)
- { "type": "range", "min": 0, "max": 6 }  (an interval like 0 < K < 6; null for unbounded)
- { "type": "coefficients", "numerator": [1], "denominator": [1, 3, 2] }  (polynomials, highest power first)`;
}
