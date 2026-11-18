import test from 'node:test';
import { strict as assert } from 'node:assert';
import { publicQuestion } from '@/lib/daily/grade';
import type { Question } from '@/lib/daily/types';
import { layoutQuestionSheet, OPEN_QUESTION, partText, SHEET_PAGE, svgSize, symbolsLatex, type Measure, type SheetText } from './question-sheet';

// Lines of about 0.5 em per character, like the server's estimate.
const measure: Measure = ({ text, w, size }) =>
  text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / Math.floor(w / (size * 0.5)))), 0) * size * 1.3;

const question = {
  id: 'q', track: 'controls', topic: 'Time response', difficulty: 2, title: 'Read the step response',
  prompt: 'A closed loop has $T(s)=\\dfrac{25}{s^2+4s+25}$. A unit step is applied.',
  figure: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>', figureAlt: 'A plot',
  parts: [
    { id: 'a', prompt: 'Damping ratio $\\zeta$', answer: { type: 'numeric', value: 0.4 } },
    { id: 'b', prompt: 'Percent overshoot', answer: { type: 'numeric', value: 25.38, unit: '%' } },
    { id: 'c', prompt: 'Which is it?', answer: { type: 'choice', options: ['Underdamped', 'Overdamped'], correct: 0 } },
    { id: 'd', prompt: 'Stable gains', answer: { type: 'range', min: 0, max: 6 } },
  ],
  solution: 'Secret working: zeta is 0.4', sources: [{ title: 'Nise' }], formulas: ['os'],
} as Question;

test('each part says what it asks and where the answer goes', () => {
  const pub = publicQuestion(question);
  assert.equal(partText(pub.parts[0], 0, 4), '(a) Damping ratio ζ = ________');
  assert.equal(partText(pub.parts[1], 1, 4), '(b) Percent overshoot = ________ %');
  assert.equal(partText(pub.parts[2], 2, 4), '(c) Which is it?\nA. Underdamped\nB. Overdamped');
  assert.equal(partText(pub.parts[3], 3, 4), '(d) Stable gains\n________ < x < ________');
  assert.equal(partText({ input: { type: 'numeric', unit: 'kN' } }, 0, 1), 'Answer = ________ kN');
});

test('the sheet has the link, problem, figure, formulas and one box per part, on the page and not overlapping', () => {
  const pub = publicQuestion(question);
  const formula = { name: 'Overshoot', latex: String.raw`\%OS = 100e^{-\zeta\pi}`, source: 'Nise', note: String.raw`Only for $\zeta < 1$.`, where: [{ symbol: String.raw`\zeta`, meaning: 'damping ratio' }] };
  const { boxes, h } = layoutQuestionSheet(pub, [formula], 'Nov 11', measure, { figure: svgSize(question.figure!) });
  const roles = boxes.map((b) => (b.kind === 'text' ? b.role : b.kind));
  assert.deepEqual(roles, ['heading', 'open', 'prompt', 'figure', 'formulas', 'formulas', 'formulas', 'formulas', 'formulas', 'formulas', 'formulas', 'part', 'part', 'part', 'part']);
  assert.equal((boxes[1] as SheetText).text, OPEN_QUESTION);
  const words = boxes.filter((b): b is SheetText => b.kind === 'text').map((b) => b.text);
  // Without a way to typeset, everything is written out: the formula, what its symbols mean, its note and source.
  for (const line of ['Formulas', 'Overshoot', '%OS = 100e^(-ζπ)', 'where', 'ζ — damping ratio', 'Only for ζ < 1.', 'Source: Nise']) assert.ok(words.includes(line), line);
  assert.ok(h >= SHEET_PAGE.h && h % 18 === 0);
  for (const [i, b] of boxes.entries()) {
    assert.ok(b.y + b.h <= h, `box ${i} runs off the page`);
    for (const later of boxes.slice(i + 1)) assert.ok(later.y >= b.y + b.h, `box ${i} overlaps the next`);
  }
  const figure = boxes[3];
  assert.ok(figure.w <= 320 && figure.h <= 220 && Math.abs(figure.w / figure.h - 2) < 1e-9, 'figure scaled to fit, same shape');
  // Only ever the public question: nothing of the answer key or solution.
  const all = JSON.stringify(boxes);
  assert.doesNotMatch(all, /Secret working|25\.38|"correct"/);
});

test('math is typeset when it can be: display math in the prompt, each formula and its symbols, shrunk to fit', () => {
  const pub = { ...publicQuestion(question), prompt: String.raw`The loop is
$$T(s)=\frac{25}{s^2+4s+25}$$
and a step is applied.` };
  const formula = { name: 'Overshoot', latex: 'OS', where: [{ symbol: String.raw`\zeta`, meaning: 'damping ratio (°)' }] };
  const asked: string[] = [];
  const math = (latex: string, size: number) => { asked.push(latex); return latex === 'OS' ? { w: 2000, h: 40 } : { w: size * 10, h: size * 2 }; };
  const { boxes, h } = layoutQuestionSheet(pub, [formula], 'Nov 11', measure, { math });
  const typeset = boxes.filter((b) => b.kind === 'math');
  assert.deepEqual(typeset.map((b) => (b.kind === 'math' ? b.latex : '')), [String.raw`T(s)=\frac{25}{s^2+4s+25}`, 'OS', symbolsLatex(formula.where)]);
  assert.ok(asked[2].includes(String.raw`\zeta & \text{damping ratio (}{}^{\circ}\text{)}`), asked[2]);
  const wide = typeset[1];
  assert.ok(wide.x + wide.w <= SHEET_PAGE.w - 40 + 1e-9 && Math.abs(wide.w / wide.h - 50) < 1e-9, 'a wide formula is shrunk to the margin, same shape');
  const texts = boxes.filter((b): b is SheetText => b.kind === 'text').map((b) => b.text);
  assert.deepEqual(texts.slice(2, 4), ['The loop is', 'and a step is applied.']);
  for (const [i, b] of boxes.entries()) {
    assert.ok(b.y + b.h <= h);
    for (const later of boxes.slice(i + 1)) assert.ok(later.y >= b.y + b.h, `box ${i} overlaps the next`);
  }
});

test('a long sheet makes the page taller, with room to work every part', () => {
  const pub = publicQuestion(question);
  const many = Array.from({ length: 6 }, (_, i) => ({ name: `F${i}`, latex: 'x', where: [{ symbol: 'x', meaning: 'a thing' }, { symbol: 'y', meaning: 'another' }] }));
  const { boxes, h } = layoutQuestionSheet(pub, many, 'Nov 11', measure, { figure: svgSize(question.figure!) });
  assert.ok(h > SHEET_PAGE.h);
  const parts = boxes.filter((b) => b.kind === 'text' && b.role === 'part');
  for (const [i, p] of parts.slice(0, -1).entries()) assert.ok(parts[i + 1].y - (p.y + p.h) >= 110, `room under part ${i}`);
  const last = parts[parts.length - 1];
  assert.ok(h - (last.y + last.h) >= 220, 'room under the last part');
});

test('svgSize reads width/height, or the viewBox', () => {
  assert.deepEqual(svgSize('<svg width="480" height="280">'), { w: 480, h: 280 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 300 150">'), { w: 300, h: 150 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 300 150" width="600">'), { w: 600, h: 300 });
});
