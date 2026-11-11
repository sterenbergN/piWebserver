import type { PublicInput } from '@/lib/daily/grade';
import { mathToPlain } from './plain-math';

// A daily question laid out as the top of a Notes page: everything needed to work it there
// (a link back, the problem, its figure, the formulas it uses), with each part in a text box of
// its own so it can be moved next to its working. Both places that make the page use this: the
// server (from the questions page) and Notes itself (which also works offline), each measuring
// text its own way. Built from the public question only, so no answer ever lands on the page.

export type SheetQuestion = {
  title: string;
  prompt: string;
  parts: { prompt?: string; input: PublicInput }[];
};
export type SheetFormula = { name: string; latex: string };

/** The words of the visible link back to the question, which a link mark goes over. */
export const OPEN_QUESTION = 'Open this question on the site ↗';

export const SHEET_PAGE = { w: 612, h: 792 };
const MARGIN = 40;
const TEXT_W = SHEET_PAGE.w - MARGIN * 2;
const PART_W = 360;
const INK = '#1d1f27';

export type SheetText = { kind: 'text'; role: 'heading' | 'open' | 'prompt' | 'formulas' | 'part'; x: number; y: number; w: number; h: number; text: string; size: number; bold?: boolean; color: string };
export type SheetFigure = { kind: 'figure'; x: number; y: number; w: number; h: number };
export type SheetBox = SheetText | SheetFigure;

/** How tall a text box comes out: lines × size × line height, measured however the caller can. */
export type Measure = (box: { text: string; w: number; size: number; bold?: boolean }) => number;

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
      return `${asked}\nNumerator (highest power first): ${BLANK}\nDenominator: ${BLANK}`;
    case 'order':
      return [`${asked}\nPut in order:`, ...input.items.map((item) => `• ${mathToPlain(item)}`)].join('\n');
  }
}

export function formulasText(formulas: SheetFormula[]) {
  return ['Formulas', ...formulas.map((f) => `• ${f.name}: ${mathToPlain(`$${f.latex}$`)}`)].join('\n');
}

/**
 * Where everything goes. `figure` is the picture's natural size, if the question has one; it is
 * scaled to fit beside the margin. The parts share what's left of the page, spaced out so each
 * has room under it for working.
 */
export function layoutQuestionSheet(q: SheetQuestion, formulas: SheetFormula[], dateLabel: string, measure: Measure, figure?: { w: number; h: number }): SheetBox[] {
  const boxes: SheetBox[] = [];
  let y = MARGIN;
  const add = (role: SheetText['role'], text: string, size: number, opts: { w?: number; bold?: boolean; color?: string; after?: number } = {}) => {
    const w = opts.w ?? TEXT_W;
    const h = measure({ text, w, size, bold: opts.bold });
    boxes.push({ kind: 'text', role, x: MARGIN, y, w, h, text, size, color: opts.color ?? INK, ...(opts.bold ? { bold: true } : {}) });
    y += h + (opts.after ?? 10);
  };

  add('heading', `${q.title}  ·  ${dateLabel}`, 13, { bold: true, after: 4 });
  add('open', OPEN_QUESTION, 10, { w: 220, color: '#1f6fd1', after: 12 });
  const prompt = mathToPlain(q.prompt);
  if (prompt) add('prompt', prompt, 10.5, { after: 12 });
  if (figure && figure.w > 0 && figure.h > 0) {
    const scale = Math.min(1, 320 / figure.w, 220 / figure.h);
    const w = figure.w * scale;
    const h = figure.h * scale;
    boxes.push({ kind: 'figure', x: MARGIN, y, w, h });
    y += h + 12;
  }
  if (formulas.length) add('formulas', formulasText(formulas), 9.5, { color: '#374151', after: 18 });

  const parts = q.parts.map((p, i) => {
    const text = partText(p, i, q.parts.length);
    return { text, h: measure({ text, w: PART_W, size: 11, bold: false }) };
  });
  const room = SHEET_PAGE.h - MARGIN - y - parts.reduce((sum, p) => sum + p.h, 0);
  // Room under every part but the last, which has the rest of the page below it anyway.
  const gap = parts.length > 1 ? Math.min(140, Math.max(28, room / parts.length)) : 0;
  for (const p of parts) {
    boxes.push({ kind: 'text', role: 'part', x: MARGIN, y, w: PART_W, h: p.h, text: p.text, size: 11, color: '#1f4e8c' });
    y += p.h + gap;
  }
  return boxes;
}

/** A figure's natural size from its SVG, for when the picture itself can't say. */
export function svgSize(svg: string) {
  const attr = (name: string) => Number(new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)`).exec(svg)?.[1]);
  const box = /<svg[^>]*\sviewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(svg);
  const w = attr('width') || Number(box?.[1]) || 480;
  const h = attr('height') || (box ? (Number(box[2]) * w) / Number(box[1]) : 0) || 300;
  return { w, h };
}
