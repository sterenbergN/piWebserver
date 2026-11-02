// Finding the lines in a page of handwriting, for reading. Ink is kept as strokes, not as a
// picture, which makes this easier than it is on paper: each stroke already knows where it is.
// Strokes that sit at the same height go together as a line, and a wide gap splits a line in
// two, so two columns (Cornell notes, a week planner) come out as separate pieces of writing.
// Each piece is drawn as a picture of black ink on white, the way the reading model learned.

import { boundsOf, type Box } from './geometry';

export type InkStroke = { id: string; pts: number[]; width: number };
export type InkLine = { ids: string[]; box: Box; unit: number };

/** Gaps wider than this many letter-heights start a new piece of writing. */
const SPLIT_GAP = 2.6;
/** Strokes taller than this many letter-heights are drawings, not writing. */
const TOO_TALL = 5;
const TOO_WIDE = 45;

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function findLines(strokes: InkStroke[]): InkLine[] {
  const boxes = strokes.map((stroke) => ({ stroke, box: boundsOf(stroke.pts) }));
  // A letter's height: most strokes are about one letter, so the middle one is a good measure.
  const unit = Math.max(4, median(boxes.map(({ box }) => box.h).filter((h) => h > 2)) || 12);
  const writing = boxes.filter(({ box }) => box.h <= unit * TOO_TALL && box.w <= unit * TOO_WIDE);

  // Lines are matched on the middle half of each stroke: loops above and below the letters
  // (an f, a g, a capital) reach into the lines either side, but their middles don't.
  // `top` and `bottom` are the shared middle; `low` and `high` reach to the tops and tails of the letters.
  type Line = { top: number; bottom: number; low: number; high: number; members: typeof writing };
  const core = (box: Box) => ({ top: box.y + box.h * 0.25, bottom: box.y + box.h * 0.75 });
  const lines: Line[] = [];
  // Big strokes first, so dots and dashes find the line their letters already made.
  const ordered = [...writing].sort((a, b) => b.box.h - a.box.h);
  for (const item of ordered) {
    const { box } = item;
    const middle = core(box);
    const centre = (middle.top + middle.bottom) / 2;
    const small = box.h < unit * 0.5;
    let best: Line | null = null;
    let bestScore = 0;
    for (const line of lines) {
      const lineCentre = (line.top + line.bottom) / 2;
      // A dot belongs to a line it's just above or inside; a letter has to share its middle.
      const score = small
        ? (centre >= line.low - unit * 0.5 && centre <= line.high + unit * 0.2 ? 1 - Math.abs(centre - lineCentre) / (unit * 4) : 0)
        : (Math.min(line.bottom, middle.bottom) - Math.max(line.top, middle.top)) / Math.max(0.5, Math.min(middle.bottom - middle.top, line.bottom - line.top));
      if (score > bestScore && (small || score > 0.15)) {
        best = line;
        bestScore = score;
      }
    }
    // Nothing shares its middle, but it's within a line's letters (a connector, the cross of a
    // t, the swash on a capital): part of that line, not a line of its own.
    let joinedNearby = false;
    if (!best) {
      let nearest = unit * 0.5;
      for (const line of lines) {
        const away = Math.max(line.low - centre, centre - line.high, 0);
        if (away < nearest) {
          nearest = away;
          best = line;
          joinedNearby = true;
        }
      }
    }
    if (best) {
      best.members.push(item);
      best.low = Math.min(best.low, box.y);
      best.high = Math.max(best.high, box.y + box.h);
      if (!small && !joinedNearby) {
        best.top = Math.min(best.top, middle.top);
        best.bottom = Math.max(best.bottom, middle.bottom);
      }
    } else {
      lines.push({ ...middle, low: box.y, high: box.y + box.h, members: [item] });
    }
  }

  const out: InkLine[] = [];
  for (const line of lines) {
    const members = [...line.members].sort((a, b) => a.box.x - b.box.x);
    let piece: typeof members = [];
    let right = -Infinity;
    const finish = () => {
      if (!piece.length) return;
      const x = Math.min(...piece.map((m) => m.box.x));
      const y = Math.min(...piece.map((m) => m.box.y));
      const w = Math.max(...piece.map((m) => m.box.x + m.box.w)) - x;
      const h = Math.max(...piece.map((m) => m.box.y + m.box.h)) - y;
      out.push({ ids: piece.map((m) => m.stroke.id), box: { x, y, w, h }, unit });
      piece = [];
    };
    for (const member of members) {
      if (piece.length && member.box.x - right > unit * SPLIT_GAP) finish();
      piece.push(member);
      right = Math.max(right, member.box.x + member.box.w);
    }
    finish();
  }
  // Reading order: down the page, and across where two pieces share a line.
  return out.sort((a, b) => {
    const sameLine = Math.abs((a.box.y + a.box.h / 2) - (b.box.y + b.box.h / 2)) < Math.min(a.box.h, b.box.h) / 2;
    return sameLine ? a.box.x - b.box.x : a.box.y - b.box.y;
  });
}

/** One piece of writing as an SVG of black ink on white, `height` pixels tall. */
export function lineSvg(strokes: InkStroke[], line: InkLine, height = 96) {
  const pad = line.unit * 0.45;
  const box = { x: line.box.x - pad, y: line.box.y - pad, w: line.box.w + pad * 2, h: line.box.h + pad * 2 };
  const scale = height / box.h;
  const width = Math.max(8, Math.min(2400, Math.round(box.w * scale)));
  // Ink the thickness of a pen relative to the letters, whatever the pen really was, as the model learned from.
  const ink = Math.max(line.unit * 0.09, 0.6) * scale;
  const ids = new Set(line.ids);
  const paths = strokes.filter((stroke) => ids.has(stroke.id)).map((stroke) => {
    const { pts } = stroke;
    const at = (i: number) => `${((pts[i] - box.x) * scale).toFixed(1)} ${((pts[i + 1] - box.y) * scale).toFixed(1)}`;
    let d = `M${at(0)}`;
    if (pts.length === 3) d += ` L${at(0)}`;
    for (let i = 3; i < pts.length; i += 3) d += ` L${at(i)}`;
    return `<path d="${d}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#000" stroke-width="${ink.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g></svg>`;
}

/** The same piece of writing gets the same key, so it's only ever read once. */
export function lineKey(line: InkLine, stamps: Map<string, number>) {
  return [...line.ids].sort().map((id) => `${id}@${stamps.get(id) ?? 0}`).join('|');
}
