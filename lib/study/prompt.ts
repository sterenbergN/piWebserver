// The prompt she copies into her AI, alongside her notes. No AI runs on the Pi:
// the reply is pasted back and read by parseTestReply, so the format described
// here and that parser have to agree (a test holds them together).

import type { SetBrief } from './sets';
import { PANCE_SYSTEMS, type PromptStyle } from './study';

export type { PromptStyle };
export type PromptSource = 'notes' | 'old-test';
export type PromptOptions = {
  source: PromptSource;
  count: number;
  style: PromptStyle;
  course?: string;
  focus?: string;
  /** Topics she keeps missing: worth asking about again if her notes cover them. */
  weakTopics?: string[];
  /** 1 to 5. */
  difficulty?: number;
  /** For another test in a set: what's been asked, and how it went. */
  brief?: SetBrief;
};

export const DIFFICULTIES = [
  { level: 1, label: 'Foundations', blurb: 'Direct questions on the key facts.', prompt: 'Difficulty: foundations. Test the key facts directly and clearly, with one obviously best answer once you know the fact. Keep any patient scenario short and typical.' },
  { level: 2, label: 'Getting there', blurb: 'One step of applying what you know.', prompt: 'Difficulty: easier than the boards. Ask for one step of applying a fact to a typical, straightforward presentation. Wrong choices should be plausible but easy to rule out with the core facts.' },
  { level: 3, label: 'Board level', blurb: 'What the PANCE itself asks.', prompt: 'Difficulty: PANCE level. Use typical board-style reasoning, like best next step, most likely diagnosis or first-line treatment, with wrong choices a partly prepared student would pick.' },
  { level: 4, label: 'Hard', blurb: 'Several steps, and close competing answers.', prompt: 'Difficulty: harder than the boards. Require two or more steps of reasoning, such as working out the diagnosis in order to choose a treatment. Make wrong choices close competitors that are right in a slightly different situation.' },
  { level: 5, label: 'Brutal', blurb: 'Unusual cases where small details decide it.', prompt: 'Difficulty: very hard. Use atypical presentations, coexisting conditions and contraindications, where a small detail in the case changes the answer. Several choices should look right until that detail is noticed. Stay accurate and fair: the case must contain everything needed to get it right.' },
];

const STYLES: Record<PromptStyle, string> = {
  vignette: 'Write board-style clinical vignettes like the PANCE: a patient with age, presentation and relevant findings, then one question (most likely diagnosis, best next step, first-line treatment, mechanism or adverse effect). Don’t give away the answer in the wording.',
  recall: 'Write short, direct questions that test recall of specific facts from the material.',
  mixed: 'Write about two thirds as board-style clinical vignettes like the PANCE (a patient with age, presentation and relevant findings, then one question) and the rest as short, direct recall questions.',
};

const FORMAT = `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "title": "A short name for this test",
  "course": "The class or module",
  "questions": [
    {
      "stem": "The question text.",
      "choices": ["First choice", "Second choice", "Third choice", "Fourth choice", "Fifth choice"],
      "correct": "B",
      "explanation": "Why the correct answer is right.",
      "whyWrong": { "A": "Why this one is wrong.", "C": "Why this one is wrong.", "D": "Why this one is wrong.", "E": "Why this one is wrong." },
      "quote": "The exact line from the material this question is based on.",
      "topic": "A specific topic, like Heart failure",
      "system": "Cardiovascular"
    }
  ]
}
\`\`\`

Rules for the JSON:
- "correct" is the letter of the right choice, counting A, B, C… through "choices". For a select-all question use a list like ["A", "C"], and say "Select all that apply" in the stem.
- "system" is exactly one of: ${PANCE_SYSTEMS.join(', ')}. Leave it out if none fits.
- The choices get shuffled when shown, so never refer to a choice by letter in "stem", "explanation" or "whyWrong", and don’t use "all of the above".
- Don’t put a letter in front of each choice.
- Write formulas, subscripts and symbols in LaTeX between dollar signs, like $P_{O_2}$ or $HCO_3^-$, always with a closing $. This applies in "choices" too.
- Inside the JSON, double every backslash in LaTeX, like $\\\\frac{a}{b}$.
- Otherwise plain text, with no markdown.
- Use one consistent "topic" name for questions on the same thing.`;

export function buildTestPrompt(options: PromptOptions) {
  const course = options.course?.trim();
  const focus = options.focus?.trim();
  const weak = (options.weakTopics ?? []).slice(0, 8);
  const count = Math.max(1, Math.min(200, Math.round(options.count) || 20));

  if (options.source === 'old-test') {
    return [
      `I’m attaching or pasting a practice test I already took${course ? ` for ${course}` : ''}. Convert it into the format below, keeping every question and its answer.`,
      'Copy the questions and answers faithfully. Don’t rewrite them or add new ones. If a test doesn’t give an explanation, write a short one. If you think an answer key is wrong, keep it as written and start that question’s explanation with "CHECK THIS:" and your reason.',
      'For "quote", use the source line if the test shows one; otherwise leave it out.',
      FORMAT,
    ].join('\n\n');
  }

  const level = DIFFICULTIES.find((d) => d.level === options.difficulty) ?? DIFFICULTIES[2];
  const series = options.brief?.testCount ? seriesSections(options.brief) : [];
  return [
    `You are writing a practice exam for a physician assistant student${course ? ` in ${course}` : ''}. Use the notes I’ve attached or pasted as your only source.`,
    `Write ${count} multiple-choice questions, each with 4 or 5 choices and a single best answer. ${STYLES[options.style] ?? STYLES.mixed}`,
    level.prompt,
    focus ? `Focus on: ${focus}.` : series.length ? '' : 'Cover the material evenly, and spend more questions on what the notes spend more time on.',
    weak.length ? `I’ve been missing these topics, so include them if the notes cover them: ${weak.join(', ')}.` : '',
    ...series,
    'Accuracy matters more than anything else, because I’ll be learning from this. Every question must be supported by the notes, and "quote" must copy the exact line it comes from. If the notes don’t support a question, leave it out, even if that means fewer questions. Wrong choices should be believable but clearly wrong for a stated reason.',
    FORMAT,
  ].filter(Boolean).join('\n\n');
}

const list = (lines: string[]) => lines.join('\n');

/** What makes the next test in a set different: no repeats, and aimed at what she needs. */
function seriesSections(brief: SetBrief) {
  const next = brief.testCount + 1;
  const sections = [
    `This is test ${next} in a series on ${brief.set.title}. Do not repeat any question below, and don’t reword one so it has the same answer. Test facts these haven’t covered, or come at a concept from a different angle, with a different patient and a different task. If the notes don’t have enough new material, write fewer questions rather than repeating.`,
    `Already asked (topic: question → answer):\n${list(brief.asked.map((a) => `- ${a.topic}: ${a.stem} → ${a.answer}`))}${brief.askedLeftOut ? `\n- …and ${brief.askedLeftOut} earlier questions not listed here.` : ''}`,
  ];
  if (brief.scores.length) {
    sections.push(`How I’ve done so far:\n${list(brief.scores.map((s) => `- ${s.title}: ${s.right} of ${s.total} right${s.difficulty ? `, at difficulty ${s.difficulty} of 5` : ''}`))}`);
  }
  if (brief.weak.length) {
    sections.push(`Spend about half of this test on where I’m weakest, in new scenarios:\n${list(brief.weak.slice(0, 10).map((t) => `- ${t.topic} (${t.right} of ${t.total} right)`))}`);
  }
  if (brief.missed.length) {
    sections.push(`I got these wrong. Test the idea behind each one again in a new way, without reusing the question, and use wrong choices that would expose the same mistake:\n${list(brief.missed.map((m) => (m.yours === '(left blank)' ? `- ${m.stem} I left it blank, and it’s "${m.answer}".` : `- ${m.stem} I answered "${m.yours}", but it’s "${m.answer}".`)))}`);
  }
  if (brief.unsure.length) {
    sections.push(`I got these right but wasn’t sure, so test these ideas again:\n${list(brief.unsure.map((u) => `- ${u.topic}: ${u.stem}`))}`);
  }
  if (brief.strong.length) {
    sections.push(`I’m solid on these, so ask less about them, and only at a harder level: ${brief.strong.slice(0, 10).map((t) => t.topic).join(', ')}.`);
  }
  return sections;
}

/** For a syllabus or schedule: its dates, and the work toward them with a rough size. */
export function buildSyllabusPrompt(options: { course?: string; today: string }) {
  const course = options.course?.trim();
  return [
    `I’m attaching or pasting a syllabus or course schedule${course ? ` for ${course}` : ''}. Today is ${options.today}. List its exams, quizzes, practicals and due dates, and the work I’d need to do for each.`,
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "course": "The class or module",
  "deadlines": [
    { "title": "Cardiology exam", "kind": "exam", "dueOn": "2030-11-05" }
  ],
  "tasks": [
    { "title": "Heart failure lectures", "pancakes": 3, "for": "Cardiology exam" }
  ]
}
\`\`\``,
    `Rules for the JSON:
- "kind" is one of: exam, quiz, practical, assignment, other.
- "dueOn" is the real date as YYYY-MM-DD. Work out the year from today’s date. If the syllabus doesn’t give a date, leave that item out rather than guessing.
- Leave out anything already past, and ordinary class meetings.
- Each task is one piece of work, like a block of lectures or a reading, and "for" is the exact title of its deadline.
- "pancakes" is a rough size for how much work it is, from 1 for something quick to 5 for something big. Use whole numbers.
- Copy dates faithfully. I’ll be planning my study time around them.`,
  ].join('\n\n');
}
