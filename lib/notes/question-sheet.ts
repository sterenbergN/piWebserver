import type { PublicInput } from '@/lib/daily/grade';
import type { FormulaSymbol } from '@/lib/daily/types';
import { mathToPlain } from './plain-math';

// A daily question laid out as the top of a Notes page: everything needed to work it there
// (a link back, the problem, its figure, the formulas it uses with what each symbol stands for),
// with each part in a box of its own so it can be moved next to its working. Both places that
// make the page use this: the server (from the questions page, and for Notes when it's online)
// and Notes itself (offline), each measuring text its own way. Math goes on as typeset pictures
// when the caller can draw them (the server can), and as plain text when it can't. Built from the
// public question only, so no answer ever lands on the page.

export type SheetQuestion = {
  title: string;
  prompt: string;
  parts: { prompt?: string; input: PublicInput }[];
};
export type SheetFormula = { name: string; latex: string; note?: string; source?: string; where?: FormulaSymbol[] };

/** The words of the visible link back to the question, which a link mark goes over. */
export const OPEN_QUESTION = 'Open this question on the site ↗';

export const SHEET_PAGE = { w: 612, h: 792 };
const MARGIN = 40;
const TEXT_W = SHEET_PAGE.w - MARGIN * 2;
const PART_W = 360;
const INDENT = 14;
const INK = '#1d1f27';
/** Room to work under each part. The page stays letter size, so a long sheet gets less of it. */
const ROOM = { min: 28, max: 160 };

export type SheetText = { kind: 'text'; role: 'heading' | 'open' | 'prompt' | 'formulas' | 'part'; x: number; y: number; w: number; h: number; text: string; size: number; bold?: boolean; color: string };
export type SheetFigure = { kind: 'figure'; x: number; y: number; w: number; h: number };
/** Math to draw as a picture: `latex` typeset at `size` points, scaled into w × h. */
export type SheetMath = { kind: 'math'; latex: string; size: number; x: number; y: number; w: number; h: number };
export type SheetBox = SheetText | SheetFigure | SheetMath;
/** The boxes, and how tall the page needs to be to hold them with room to work. */
export type SheetLayout = { boxes: SheetBox[]; h: number };

/** How tall a text box comes out: lines × size × line height, measured however the caller can. */
export type Measure = (box: { text: string; w: number; size: number; bold?: boolean }) => number;
/** How big `latex` comes out typeset at `size` points, or nothing if the caller can't draw it. */
export type MathSize = (latex: string, size: number) => { w: number; h: number } | null;

const BLANK = '________';

/** One part, ready to work: its label, what it asks, and where the answer goes. */
export function partText(part: SheetQuestion['parts'][number], index: number, count: number) {
  const label = count > 1 ? `(${String.fromCharCode(97 + index)}) ` : '';
  const asked = `${label}${part.prompt ? mathToPlain(part.prompt) : count > 1 ? '' : 'Answer'}`.trim();
  const input = part.input;
  switch (input.type) {
    case 'numeric':
      return `${asked} = ${BLANK}${input.unit ? ` ${input.unit}` : ''}`;
    case 'choice':
    case 'multi':
      return [`${asked}${input.type === 'multi' ? ' (pick all that apply)' : ''}`, ...input.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${mathToPlain(o)}`)].join('\n');
    case 'range':
      return `${asked}\n${BLANK} < x < ${BLANK}`;
    case 'coefficients':
      return `${asked}\nNumerator in ${input.variable ?? 's'} (highest power first): ${BLANK}\nDenominator: ${BLANK}`;
    case 'order':
      return [`${asked}\nPut in order:`, ...input.items.map((item) => `• ${mathToPlain(item)}`)].join('\n');
  }
}

/** Characters the text font hasn't got (units like m⁴ and kΩ), and the math that draws them. */
const AS_MATH: Record<string, string> = {
  '°': '{}^{\\circ}', '·': '{\\cdot}', '±': '{\\pm}', '…': '{\\ldots}', '×': '{\\times}', '−': '{-}', 'Ω': '{\\Omega}', 'μ': '{\\mu}', 'µ': '{\\mu}',
  ...Object.fromEntries([...'⁰¹²³⁴⁵⁶⁷⁸⁹'].map((c, i) => [c, `{}^{${i}}`])), '⁻': '{}^{-}',
  ...Object.fromEntries([...'₀₁₂₃₄₅₆₇₈₉'].map((c, i) => [c, `{}_{${i}}`])),
};
const MATH_CHAR = new RegExp(`([${Object.keys(AS_MATH).join('')}])`);

/** A $math$ and text mix as LaTeX: the words go in \text{}, the math stays as it is. */
export function textToLatex(text: string) {
  // \text{} takes its words as they are, so only its braces need keeping balanced.
  const words = (bit: string) => bit.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).split(MATH_CHAR)
    .map((piece, i) => (i % 2 ? AS_MATH[piece] : piece ? `\\text{${piece}}` : '')).join('');
  return text.split(/(\$[^$]+\$)/).filter(Boolean)
    .map((bit) => (bit.startsWith('$') && bit.endsWith('$') && bit.length > 2 ? `{${bit.slice(1, -1)}}` : words(bit)))
    .join('');
}

/** "where …" as a two-column table: each symbol typeset, beside what it stands for. */
export function symbolsLatex(symbols: FormulaSymbol[]) {
  return `\\begin{array}{r@{\\quad}l} ${symbols.map((s) => `${s.symbol} & ${textToLatex(s.meaning)}`).join(' \\\\[2pt] ')} \\end{array}`;
}

/** The same, as text, for when it can't be drawn. */
export const symbolsText = (symbols: FormulaSymbol[]) =>
  symbols.map((s) => `${mathToPlain(`$${s.symbol}$`)} — ${mathToPlain(s.meaning)}`).join('\n');

/** A prompt in pieces: its words, and the $$display math$$ between them. */
export function promptPieces(prompt: string) {
  const pieces: { math: boolean; text: string }[] = [];
  for (const [i, bit] of prompt.split(/\$\$([\s\S]+?)\$\$/).entries()) {
    const text = bit.trim();
    if (text) pieces.push({ math: i % 2 === 1, text });
  }
  return pieces;
}

/** How much the formulas (and then the figure) shrink, step by step, until the parts fit on the page. */
const SHRINK_STEPS = [1, 0.88, 0.78, 0.68, 0.6, 0.52];

/**
 * Where everything goes. `figure` is the picture's natural size, if the question has one; it is
 * scaled to fit beside the margin. `math` sizes typeset math; without it, math is written as
 * text. The parts share what's left of the page, spaced out so each has room under it for
 * working. The page is always letter size, so a long sheet leaves less room under each part,
 * and when the formulas would push the parts off the page they're drawn smaller (then the
 * figure too) until every part fits with at least a little room to work under it.
 */
export function layoutQuestionSheet(q: SheetQuestion, formulas: SheetFormula[], dateLabel: string, measure: Measure, options: { figure?: { w: number; h: number }; math?: MathSize } = {}): SheetLayout {
  const parts = q.parts.map((p, i) => {
    const text = partText(p, i, q.parts.length);
    return { text, h: measure({ text, w: PART_W, size: 11, bold: false }) };
  });
  const partsNeed = parts.reduce((sum, p) => sum + p.h, 0) + ROOM.min * Math.max(0, parts.length - 1);
  const bottom = SHEET_PAGE.h - MARGIN;

  let laid = topOfSheet(q, formulas, dateLabel, measure, options, 1, 1);
  for (const scale of SHRINK_STEPS.slice(1)) {
    if (laid.y + partsNeed <= bottom) break;
    laid = topOfSheet(q, formulas, dateLabel, measure, options, scale, 1);
  }
  // Still too much: the figure gives way as well.
  for (const figureScale of [0.75, 0.55]) {
    if (laid.y + partsNeed <= bottom) break;
    laid = topOfSheet(q, formulas, dateLabel, measure, options, SHRINK_STEPS[SHRINK_STEPS.length - 1], figureScale);
  }

  const { boxes } = laid;
  let { y } = laid;
  const room = SHEET_PAGE.h - MARGIN - y - parts.reduce((sum, p) => sum + p.h, 0);
  // Room under every part but the last, which has the rest of the page below it anyway.
  const gap = Math.min(ROOM.max, Math.max(ROOM.min, room / Math.max(1, parts.length)));
  for (const [i, p] of parts.entries()) {
    boxes.push({ kind: 'text', role: 'part', x: MARGIN, y, w: PART_W, h: p.h, text: p.text, size: 11, color: '#1f4e8c' });
    y += p.h + (i < parts.length - 1 ? gap : 0);
  }
  // Always a regular page: one taller page makes Notes zoom the whole notebook out to fit it.
  return { boxes, h: SHEET_PAGE.h };
}

/** Everything above the parts, with the formulas drawn at `scale` and the figure at most `figureScale` of its usual size. */
function topOfSheet(q: SheetQuestion, formulas: SheetFormula[], dateLabel: string, measure: Measure, options: { figure?: { w: number; h: number }; math?: MathSize }, scale: number, figureScale: number) {
  const boxes: SheetBox[] = [];
  let y = MARGIN;
  const add = (role: SheetText['role'], text: string, size: number, opts: { x?: number; w?: number; bold?: boolean; color?: string; after?: number } = {}) => {
    const x = opts.x ?? MARGIN;
    const w = opts.w ?? MARGIN + TEXT_W - x;
    const h = measure({ text, w, size, bold: opts.bold });
    boxes.push({ kind: 'text', role, x, y, w, h, text, size, color: opts.color ?? INK, ...(opts.bold ? { bold: true } : {}) });
    y += h + (opts.after ?? 10);
  };
  /** Typeset math, shrunk to fit the width if it must; false if it can't be drawn. */
  const addMath = (latex: string, size: number, x: number, after: number) => {
    const natural = options.math?.(latex, size);
    if (!natural || !(natural.w > 0) || !(natural.h > 0)) return false;
    const fit = Math.min(1, (MARGIN + TEXT_W - x) / natural.w);
    boxes.push({ kind: 'math', latex, size, x, y, w: natural.w * fit, h: natural.h * fit });
    y += natural.h * fit + after;
    return true;
  };

  add('heading', `${q.title}  ·  ${dateLabel}`, 13, { bold: true, after: 4 });
  add('open', OPEN_QUESTION, 10, { w: 220, color: '#1f6fd1', after: 12 });
  const pieces = promptPieces(q.prompt);
  for (const [i, piece] of pieces.entries()) {
    const after = i === pieces.length - 1 ? 12 : 6;
    if (piece.math && addMath(piece.text, 12, MARGIN + INDENT * 2, after)) continue;
    const text = mathToPlain(piece.math ? `$${piece.text}$` : piece.text);
    if (text) add('prompt', text, 10.5, { after, ...(piece.math ? { x: MARGIN + INDENT * 2 } : {}) });
  }
  const { figure } = options;
  if (figure && figure.w > 0 && figure.h > 0) {
    const fit = Math.min(1, 320 / figure.w, 220 / figure.h) * figureScale;
    const w = figure.w * fit;
    const h = figure.h * fit;
    boxes.push({ kind: 'figure', x: MARGIN, y, w, h });
    y += h + 12;
  }

  if (formulas.length) {
    // Sizes and spacing shrink together, so a smaller formulas block keeps its look.
    const k = (n: number) => Math.round(n * scale * 100) / 100;
    add('formulas', 'Formulas', k(10.5), { bold: true, color: '#374151', after: k(6) });
    const x = MARGIN + INDENT;
    for (const f of formulas) {
      add('formulas', f.name, k(9.5), { x, bold: true, color: '#374151', after: k(4) });
      if (!addMath(f.latex, k(12), x + INDENT, k(6))) add('formulas', mathToPlain(`$${f.latex}$`), k(10.5), { x: x + INDENT, after: k(6) });
      if (f.where?.length) {
        add('formulas', 'where', k(8.5), { x, color: '#6b7280', after: k(2) });
        if (!addMath(symbolsLatex(f.where), k(9.5), x + INDENT, k(6))) add('formulas', symbolsText(f.where), k(9.5), { x: x + INDENT, after: k(6) });
      }
      if (f.note) add('formulas', mathToPlain(f.note), k(9), { x, color: '#4b5563', after: k(2) });
      if (f.source) add('formulas', `Source: ${f.source}`, k(8), { x, color: '#6b7280', after: k(4) });
      y += k(8);
    }
    y += k(6);
  }
  return { boxes, y };
}

/** A figure's natural size from its SVG, for when the picture itself can't say. */
export function svgSize(svg: string) {
  const attr = (name: string) => Number(new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)`).exec(svg)?.[1]);
  const box = /<svg[^>]*\sviewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(svg);
  const w = attr('width') || Number(box?.[1]) || 480;
  const h = attr('height') || (box ? (Number(box[2]) * w) / Number(box[1]) : 0) || 300;
  return { w, h };
}
