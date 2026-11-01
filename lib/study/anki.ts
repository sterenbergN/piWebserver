// Missed questions as a file Anki can import (File → Import), since Anki stays
// her flashcard scheduler. Each row carries a fixed GUID so importing the same
// question again doesn't make a second card. Headers need Anki 2.1.54 or later.

import { splitMath } from './math';
import { choiceLetter, type StudyQuestion } from './study';

export const ANKI_DECK = 'PA School::Missed questions';

export type AnkiRow = { question: StudyQuestion; course: string };

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `}}` inside math would close a cloze blank early, so it gets a space, which LaTeX ignores. */
const safeMath = (latex: string) => (latex.includes('{{c') ? latex : latex.replace(/\}\}/g, '} }'));

/** One field's text as Anki HTML, on one line: bold survives, tabs can't split the row, and math uses Anki's delimiters. */
export function ankiField(text: string) {
  return splitMath(text.replace(/\t/g, ' ')).map((part) => {
    if (!part.math) return escapeHtml(part.text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\r?\n/g, '<br>');
    const latex = safeMath(escapeHtml(part.text)).replace(/\r?\n/g, ' ');
    return part.display ? `\\[${latex}\\]` : `\\(${latex}\\)`;
  }).join('');
}
const field = ankiField;

/** A tag can't hold spaces; `::` makes it nest in Anki's tag tree. */
export const ankiTag = (prefix: string, text: string) => {
  const slug = text.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return slug ? `${prefix}::${slug}` : '';
};

function front(q: StudyQuestion) {
  const choices = q.choices.map((c, i) => `${choiceLetter(i)}. ${field(c)}`).join('<br>');
  return `${field(q.stem)}<br><br>${choices}`;
}

function back(q: StudyQuestion) {
  const answers = q.correct.map((i) => `<b>${choiceLetter(i)}. ${field(q.choices[i])}</b>`).join('<br>');
  const parts = [answers];
  if (q.explanation) parts.push(field(q.explanation));
  const wrong = (q.whyWrong ?? []).flatMap((note, i) => (note && !q.correct.includes(i) ? [`${choiceLetter(i)}: ${field(note)}`] : []));
  if (wrong.length) parts.push(wrong.join('<br>'));
  if (q.quote) parts.push(`<i>From your notes: ${field(q.quote)}</i>`);
  return parts.join('<br><br>');
}

export function ankiFile(rows: AnkiRow[]) {
  const lines = rows.map(({ question: q, course }) => {
    const tags = ['missed', ankiTag('course', course), ankiTag('topic', q.topic), q.system ? ankiTag('system', q.system) : ''].filter(Boolean).join(' ');
    return [`study-${q.id}`, front(q), back(q), tags].join('\t');
  });
  return [
    '#separator:tab',
    '#html:true',
    '#notetype:Basic',
    `#deck:${ANKI_DECK}`,
    '#guid column:1',
    '#tags column:4',
    ...lines,
  ].join('\n') + '\n';
}
