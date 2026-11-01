import { isDark, type TemplateId } from './items';

// What's printed on the paper, as plain lines, dots and labels in points, so the same marks
// go on the screen, on a thumbnail and into an exported PDF.

export type TemplateMarks = {
  /** x1, y1, x2, y2, and how heavy: 0 for ordinary rules, 1 for major ones, 2 for an accent like a margin. */
  lines: [number, number, number, number, 0 | 1 | 2][];
  dots: [number, number][];
  /** Circles drawn as outlines, for checkboxes. */
  boxes: [number, number, number][];
  labels: { x: number; y: number; text: string; size: number }[];
};

export const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'ruled', label: 'College ruled' },
  { id: 'ruled-narrow', label: 'Narrow ruled' },
  { id: 'ruled-wide', label: 'Wide ruled' },
  { id: 'grid', label: 'Grid' },
  { id: 'grid-small', label: 'Small grid' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'dots', label: 'Dots' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'cornell', label: 'Cornell' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'music', label: 'Music' },
  { id: 'daily', label: 'Daily plan' },
  { id: 'weekly', label: 'Week' },
];

export const PAPER_COLORS: { color: string; label: string }[] = [
  { color: '#ffffff', label: 'White' },
  { color: '#fbf6e9', label: 'Cream' },
  { color: '#fdf3b4', label: 'Legal pad' },
  { color: '#eef1f4', label: 'Cool grey' },
  { color: '#2b2f38', label: 'Slate' },
  { color: '#14161c', label: 'Night' },
];

export const PAGE_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: 'letter', label: 'US Letter', w: 612, h: 792 },
  { id: 'a4', label: 'A4', w: 595, h: 842 },
  { id: 'a5', label: 'A5', w: 420, h: 595 },
  { id: 'legal', label: 'Legal', w: 612, h: 1008 },
  { id: 'ipad', label: 'iPad screen', w: 768, h: 1024 },
];

const MM = 72 / 25.4;
const SIDE_MARGIN = 54;
const HEAD = 62;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function rules(marks: TemplateMarks, w: number, h: number, gap: number, margin = true) {
  for (let y = HEAD; y < h - 18; y += gap) marks.lines.push([0, y, w, y, 0]);
  if (margin) marks.lines.push([SIDE_MARGIN, 0, SIDE_MARGIN, h, 2]);
}

function grid(marks: TemplateMarks, w: number, h: number, gap: number, majorEvery = 0) {
  // From the middle out, so the page's edges come out even on both sides.
  const startX = (w / 2) % gap;
  const startY = (h / 2) % gap;
  const first = (start: number, size: number) => Math.round((size / 2 - start) / gap);
  const major = (i: number, middle: number) => (majorEvery && (i - middle) % majorEvery === 0 ? 1 : 0);
  for (let i = 0, x = startX; x < w; i++, x += gap) marks.lines.push([x, 0, x, h, major(i, first(startX, w))]);
  for (let i = 0, y = startY; y < h; i++, y += gap) marks.lines.push([0, y, w, y, major(i, first(startY, h))]);
}

export function templateMarks(id: TemplateId, w: number, h: number): TemplateMarks {
  const marks: TemplateMarks = { lines: [], dots: [], boxes: [], labels: [] };
  switch (id) {
    case 'ruled-narrow': rules(marks, w, h, 6.35 * MM); break;
    case 'ruled': rules(marks, w, h, 7.1 * MM); break;
    case 'ruled-wide': rules(marks, w, h, 8.7 * MM); break;
    case 'grid-small': grid(marks, w, h, 4 * MM); break;
    case 'grid': grid(marks, w, h, 6.35 * MM); break;
    case 'engineering': grid(marks, w, h, 5 * MM, 5); break;
    case 'dots':
      for (let y = (h / 2) % (5 * MM); y < h; y += 5 * MM) {
        for (let x = (w / 2) % (5 * MM); x < w; x += 5 * MM) marks.dots.push([x, y]);
      }
      break;
    case 'isometric': {
      const gap = 6 * MM;
      for (let y = gap; y < h; y += gap * 2) marks.lines.push([0, y, w, y, 0]);
      for (let x = 0; x < w; x += gap * Math.sqrt(3)) marks.lines.push([x, 0, x, h, 0]);
      const run = h / Math.tan(Math.PI / 6);
      for (let x = -run; x < w; x += gap * 2 * Math.sqrt(3)) {
        marks.lines.push([x, 0, x + run, h, 0]);
        marks.lines.push([x + run, 0, x, h, 0]);
      }
      break;
    }
    case 'cornell': {
      const cue = w * 0.3;
      const summary = h * 0.8;
      const gap = 7.1 * MM;
      for (let y = HEAD + gap; y < summary; y += gap) marks.lines.push([cue, y, w, y, 0]);
      marks.lines.push([0, HEAD, w, HEAD, 1]);
      marks.lines.push([cue, HEAD, cue, summary, 1]);
      marks.lines.push([0, summary, w, summary, 1]);
      marks.labels.push({ x: 10, y: HEAD + 15, text: 'Cues', size: 9 }, { x: 10, y: summary + 15, text: 'Summary', size: 9 });
      break;
    }
    case 'checklist': {
      const gap = 10 * MM;
      for (let y = HEAD + gap; y < h - 18; y += gap) {
        marks.lines.push([SIDE_MARGIN - 14, y, w - 24, y, 0]);
        marks.boxes.push([SIDE_MARGIN - 26, y - gap / 2 + 1, 6]);
      }
      break;
    }
    case 'music': {
      const line = 2.1 * MM;
      for (let top = HEAD; top + line * 4 < h - 24; top += line * 10) {
        for (let i = 0; i < 5; i++) marks.lines.push([30, top + i * line, w - 30, top + i * line, 0]);
        marks.lines.push([30, top, 30, top + line * 4, 0], [w - 30, top, w - 30, top + line * 4, 0]);
      }
      break;
    }
    case 'daily': {
      const hours = 16;
      const top = HEAD + 14;
      const row = (h - top - 24) / hours;
      for (let i = 0; i <= hours; i++) {
        const y = top + i * row;
        marks.lines.push([SIDE_MARGIN, y, w - 24, y, i === 0 ? 1 : 0]);
        if (i < hours) marks.labels.push({ x: 18, y: y + 13, text: `${((i + 5) % 12) + 1}${i + 6 < 12 || i + 6 === 24 ? 'a' : 'p'}`, size: 9 });
      }
      marks.lines.push([SIDE_MARGIN, top, SIDE_MARGIN, top + hours * row, 2]);
      break;
    }
    case 'weekly': {
      const top = HEAD;
      const row = (h - top - 24) / 4;
      const middle = w / 2;
      marks.lines.push([middle, top, middle, top + row * 4, 1]);
      for (let i = 0; i <= 4; i++) marks.lines.push([24, top + i * row, w - 24, top + i * row, 1]);
      DAYS.forEach((day, i) => {
        const column = i < 4 ? 0 : 1;
        const place = i < 4 ? i : i - 4;
        marks.labels.push({ x: (column ? middle : 24) + 8, y: top + place * row + 15, text: day, size: 10 });
      });
      marks.labels.push({ x: middle + 8, y: top + 3 * row + 15, text: 'Notes', size: 10 });
      break;
    }
    default: break;
  }
  return marks;
}

/** The colours printed marks take on a paper, so they stay faint on any of them. */
export function markColors(paper: string) {
  return isDark(paper)
    ? { minor: 'rgba(255,255,255,0.14)', major: 'rgba(255,255,255,0.3)', accent: 'rgba(255,130,130,0.42)', label: 'rgba(255,255,255,0.55)', dot: 'rgba(255,255,255,0.3)' }
    : { minor: 'rgba(60,90,140,0.22)', major: 'rgba(60,90,140,0.42)', accent: 'rgba(210,60,60,0.42)', label: 'rgba(40,50,70,0.62)', dot: 'rgba(40,60,100,0.38)' };
}
