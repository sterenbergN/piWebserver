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

const SOURCE_RULES = 'Use the notes I’ve attached or pasted as your only source. Accuracy matters more than anything else, because I’ll be learning from this. If the notes don’t cover something, leave it out rather than guessing.';
const JSON_RULES = 'Write formulas and subscripts in LaTeX between dollar signs, like $P_{O_2}$, always with a closing $, and double every backslash inside the JSON. Otherwise plain text, with no markdown.';

/** A comparison grid: things that are easy to mix up, side by side. */
export function buildGridPrompt(options: { subject: string; course?: string; rows: number }) {
  const course = options.course?.trim();
  return [
    `Make a comparison grid for a physician assistant student${course ? ` in ${course}` : ''}, on: ${options.subject.trim() || 'the conditions or drugs my notes cover that are easiest to confuse'}. ${SOURCE_RULES}`,
    `Use about ${options.rows} rows of conditions or drugs that are easy to mix up, and 3 to 6 columns of what tells them apart, like presentation, key finding, gold-standard test, first-line treatment, mechanism or adverse effects. Keep each cell to a few words, since I’ll be filling them in from memory.`,
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "title": "A short name for this grid",
  "course": "The class or module",
  "columns": ["Timing", "Location"],
  "rows": [
    { "name": "Aortic stenosis", "cells": ["Systolic", "Right upper sternal border"] },
    { "name": "Mitral regurgitation", "cells": ["Holosystolic", "Apex"] }
  ]
}
\`\`\``,
    `Rules for the JSON:\n- Every row has exactly one cell per column, in the same order.\n- ${JSON_RULES}`,
  ].join('\n\n');
}

/** Mock patients for OSCE practice, with a script for whoever plays the patient. */
export function buildCasePrompt(options: { subject?: string; course?: string; count: number }) {
  const course = options.course?.trim();
  const subject = options.subject?.trim();
  return [
    `Write ${options.count} mock patient case${options.count === 1 ? '' : 's'} for a physician assistant student practicing for an OSCE${course ? ` in ${course}` : ''}${subject ? `, on: ${subject}` : ''}. ${SOURCE_RULES} Every patient is made up, with no details from anyone real.`,
    'Someone with no medical training will play the patient by reading your script. Write what the patient says in everyday words, not medical terms. They will only share something if I ask about it, so cover what a good history would ask: onset, character, severity, what makes it better or worse, associated symptoms, past history, medications, allergies, family and social history. Include answers that are normal or negative too, so they know what to say.',
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "cases": [
    {
      "course": "The class or module",
      "door": { "age": 58, "sex": "man", "complaint": "chest pain", "vitals": "BP 150/90, HR 100, RR 18, T 98.6, SpO2 97%" },
      "opening": "What the patient says first, in their own words. Doctor, my chest has been hurting.",
      "script": [
        { "ask": "When it started", "say": "About an hour ago, while I was shoveling." },
        { "ask": "Where it spreads", "say": "Down my left arm." },
        { "ask": "Smoking", "say": "A pack a day for 30 years." }
      ],
      "exam": [
        { "maneuver": "Listening to the heart", "finding": "Regular rhythm, no murmur." }
      ],
      "checklist": ["Asks about onset", "Asks about radiation", "Asks about risk factors", "Says the likely diagnosis"],
      "diagnosis": "The most likely diagnosis",
      "teaching": "A few sentences on what mattered in this case and what shouldn't be missed."
    }
  ]
}
\`\`\``,
    `Rules for the JSON:\n- "checklist" is what a good student should do, one observable action per item, 8 to 15 items, including a respectful introduction and naming the diagnosis.\n- Never put the diagnosis in "door" or "opening".\n- ${JSON_RULES}`,
  ].join('\n\n');
}

/** Cases for Differential: clues that start vague and get more specific. */
export function buildDifferentialPrompt(options: { subject?: string; count: number; used: string[] }) {
  const subject = options.subject?.trim();
  return [
    `Write ${options.count} cases for a clue-by-clue diagnosis puzzle for a physician assistant student${subject ? `, on: ${subject}` : ', using what’s in my notes'}. ${SOURCE_RULES} Every patient is made up, with no details from anyone real.`,
    'Each case has 4 or 5 clues that start vague and get more specific: the complaint first, then history, vitals, exam, and labs or imaging last. The first clue should fit several diagnoses, and the last should make it clear. Give several believable other diagnoses to choose from, the ones the case could really be confused with.',
    options.used.length ? `Don’t use these as answers, since I’ve already had them: ${options.used.slice(-80).join(', ')}.` : '',
    `Reply with one JSON code block and nothing else, in exactly this shape:

\`\`\`json
{
  "cases": [
    {
      "answer": "Pulmonary embolism",
      "clues": [
        { "label": "Complaint", "text": "A 34-year-old has sudden shortness of breath." },
        { "label": "History", "text": "She flew home from overseas yesterday and takes birth control pills." },
        { "label": "Vitals", "text": "HR 118, RR 26, SpO2 90% on room air." },
        { "label": "Tests", "text": "Clear lungs on chest X-ray, and an elevated D-dimer." }
      ],
      "options": ["Pneumonia", "Asthma exacerbation", "Pneumothorax", "Panic attack", "Acute coronary syndrome"],
      "explanation": "Why the clues point here, and what ruled out the others.",
      "topic": "Dyspnea",
      "system": "Pulmonary"
    }
  ]
}
\`\`\``,
    `Rules for the JSON:\n- "options" holds only the wrong diagnoses, 4 to 7 of them. The answer gets added by itself.\n- Never name the answer in a clue.\n- "system" is exactly one of: ${PANCE_SYSTEMS.join(', ')}.\n- ${JSON_RULES}`,
  ].filter(Boolean).join('\n\n');
}
