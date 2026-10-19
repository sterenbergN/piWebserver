import type { RecapSlide } from './recap';

// Draws the recap's slides as story images (1080×1920, the size Instagram /
// WhatsApp stories use), entirely in the browser — like share-card.ts.

const W = 1080;
const H = 1920;
const PAD = 96;
const font = (weight: number, size: number) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

/** Each slide gets its own colours, Wrapped-style. */
const THEMES: Record<RecapSlide['kind'], { from: string; to: string; accent: string; ink: string }> = {
  cover: { from: '#5b21b6', to: '#db2777', accent: '#fde68a', ink: '#ffffff' },
  'showing-up': { from: '#065f46', to: '#0f172a', accent: '#6ee7b7', ink: '#ffffff' },
  volume: { from: '#c2410c', to: '#7c2d12', accent: '#fed7aa', ink: '#ffffff' },
  'top-lifts': { from: '#1e3a8a', to: '#0f172a', accent: '#93c5fd', ink: '#ffffff' },
  gains: { from: '#15803d', to: '#052e16', accent: '#bbf7d0', ink: '#ffffff' },
  records: { from: '#a16207', to: '#422006', accent: '#fde047', ink: '#ffffff' },
  muscles: { from: '#be123c', to: '#4c0519', accent: '#fecdd3', ink: '#ffffff' },
  summary: { from: '#1e1037', to: '#0b1a2e', accent: '#c4b5fd', ink: '#ffffff' },
};

const num = (n: number) => Math.round(n).toLocaleString();

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Word-wrapped text; returns the y below the last line. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 4) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = fitText(ctx, `${shown[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth);
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return y + shown.length * lineHeight;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function background(ctx: CanvasRenderingContext2D, theme: (typeof THEMES)[keyof typeof THEMES], seed: number) {
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, theme.from);
  bg.addColorStop(1, theme.to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // A couple of soft blobs, placed differently per slide.
  const blobs = [[0.85, 0.12, 420], [0.1, 0.78, 520], [0.95, 0.92, 300]];
  blobs.forEach(([fx, fy, r], i) => {
    const x = ((fx + seed * 0.17 * (i + 1)) % 1) * W;
    const y = fy * H;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  });
}

function kicker(ctx: CanvasRenderingContext2D, text: string, color: string, y = 300) {
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.font = font(800, 40);
  ctx.fillText(text.toUpperCase(), PAD, y);
}

function footer(ctx: CanvasRenderingContext2D, index: number, count: number) {
  // Story-style progress bars along the top.
  const gap = 10;
  const barW = (W - PAD * 2 - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = i <= index ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
    roundRect(ctx, PAD + i * (barW + gap), 90, barW, 8, 4);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = font(600, 30);
  ctx.fillText('noahstuf.com · workout recap', W / 2, H - 90);
}

function statBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, value: string, accent: string) {
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, x, y, w, h, 32);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = font(700, 30);
  ctx.fillText(label.toUpperCase(), x + 36, y + 62);
  ctx.fillStyle = accent;
  ctx.font = font(900, 68);
  ctx.fillText(fitText(ctx, value, w - 72), x + 36, y + h - 48);
}

/** A huge number with a caption under it. Returns the y below the caption. */
function hero(ctx: CanvasRenderingContext2D, value: string, caption: string, y: number, color: string) {
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  let size = 260;
  ctx.font = font(900, size);
  while (ctx.measureText(value).width > W - PAD * 2 && size > 100) { size -= 10; ctx.font = font(900, size); }
  ctx.fillText(value, PAD - 8, y);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(800, 64);
  ctx.fillText(caption, PAD, y + 100);
  return y + 100;
}

function drawSlide(ctx: CanvasRenderingContext2D, slide: RecapSlide, index: number, count: number) {
  const theme = THEMES[slide.kind];
  background(ctx, theme, index);
  footer(ctx, index, count);
  const maxW = W - PAD * 2;
  ctx.textAlign = 'left';

  switch (slide.kind) {
    case 'cover': {
      kicker(ctx, slide.name ? `${slide.name}'s workout recap` : 'Your workout recap', theme.accent, 520);
      ctx.fillStyle = theme.ink;
      ctx.font = font(900, 150);
      const y = wrap(ctx, slide.title, PAD, 700, maxW, 160, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = font(600, 46);
      ctx.fillText(slide.range, PAD, y + 40);
      ctx.font = font(500, 44);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Let’s see how it went →', PAD, H - 300);
      break;
    }
    case 'showing-up': {
      kicker(ctx, 'You showed up', theme.accent);
      hero(ctx, String(slide.workouts), slide.workouts === 1 ? 'workout' : 'workouts', 680, theme.accent);
      const boxW = (maxW - 32) / 2;
      const boxes = [
        ['Hours lifting', slide.hours ? String(slide.hours) : '—'],
        ['Days trained', String(slide.activeDays)],
        ['Best streak', `${slide.bestStreakWeeks} wk${slide.bestStreakWeeks === 1 ? '' : 's'}`],
        ['Favourite day', slide.favouriteDay ? slide.favouriteDay.slice(0, 3) : '—'],
      ];
      boxes.forEach(([label, value], i) => statBox(ctx, PAD + (i % 2) * (boxW + 32), 940 + Math.floor(i / 2) * 252, boxW, 220, label, value, theme.ink));
      if (slide.timeOfDay) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = font(600, 48);
        wrap(ctx, `Mostly in the ${slide.timeOfDay}${slide.favouriteDay ? `, and ${slide.favouriteDay}s were your day` : ''}.`, PAD, 1540, maxW, 64, 3);
      }
      break;
    }
    case 'volume': {
      kicker(ctx, 'In total you lifted', theme.accent);
      hero(ctx, num(slide.volume), 'pounds', 700, theme.accent);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(800, 76);
      const y = wrap(ctx, `That’s like lifting ${slide.comparison}.`, PAD, 1060, maxW, 92, 3);
      const boxW = (maxW - 32) / 2;
      statBox(ctx, PAD, Math.max(y + 80, 1380), boxW, 220, 'Sets', num(slide.sets), theme.accent);
      statBox(ctx, PAD + boxW + 32, Math.max(y + 80, 1380), boxW, 220, 'Reps', num(slide.reps), theme.accent);
      break;
    }
    case 'top-lifts': {
      kicker(ctx, 'Your top lifts', theme.accent);
      slide.lifts.forEach((lift, i) => {
        const y = 480 + i * 260;
        const first = i === 0;
        ctx.fillStyle = first ? theme.accent : 'rgba(255,255,255,0.45)';
        ctx.font = font(900, first ? 120 : 96);
        ctx.fillText(String(i + 1), PAD, y + 100);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(800, first ? 68 : 56);
        ctx.fillText(fitText(ctx, lift.name, maxW - 140), PAD + 140, y + 62);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = font(600, 38);
        ctx.fillText(`${lift.sessions} session${lift.sessions === 1 ? '' : 's'} · ${lift.sets} sets`, PAD + 140, y + 122);
      });
      break;
    }
    case 'gains': {
      kicker(ctx, 'You got stronger', theme.accent);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = font(600, 38);
      ctx.fillText('Estimated one-rep max, start → now', PAD, 370);
      const maxPct = Math.max(...slide.lifts.map((l) => l.pct));
      slide.lifts.forEach((lift, i) => {
        const y = 520 + i * 380;
        ctx.fillStyle = theme.accent;
        ctx.font = font(900, 150);
        ctx.fillText(`+${lift.pct}%`, PAD - 6, y + 120);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(800, 56);
        ctx.fillText(fitText(ctx, lift.name, maxW), PAD, y + 205);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = font(600, 40);
        ctx.fillText(`${num(lift.from)} → ${num(lift.to)} lb`, PAD, y + 262);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        roundRect(ctx, PAD, y + 290, maxW, 16, 8);
        ctx.fill();
        ctx.fillStyle = theme.accent;
        roundRect(ctx, PAD, y + 290, Math.max(24, maxW * (lift.pct / maxPct)), 16, 8);
        ctx.fill();
      });
      break;
    }
    case 'records': {
      kicker(ctx, 'You set new records', theme.accent);
      const y = hero(ctx, String(slide.count), slide.count === 1 ? 'personal record' : 'personal records', 680, theme.accent);
      slide.lifts.forEach((lift, i) => {
        const rowY = y + 120 + i * 160;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        roundRect(ctx, PAD, rowY, maxW, 124, 28);
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = font(700, 46);
        ctx.fillText(fitText(ctx, lift.name, maxW - 360), PAD + 40, rowY + 78);
        ctx.textAlign = 'right';
        ctx.fillStyle = theme.accent;
        ctx.font = font(900, 50);
        ctx.fillText(`${num(lift.weight)} × ${lift.reps}`, W - PAD - 40, rowY + 80);
      });
      break;
    }
    case 'muscles': {
      kicker(ctx, 'What you trained', theme.accent);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(900, 110);
      wrap(ctx, `${slide.muscles[0].muscle} won.`, PAD, 500, maxW, 120, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = font(600, 40);
      ctx.fillText('Share of your working sets', PAD, 600);
      const top = slide.muscles[0].share || 1;
      slide.muscles.forEach((m, i) => {
        const y = 760 + i * 190;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = font(800, 52);
        ctx.fillText(m.muscle, PAD, y);
        const nameW = ctx.measureText(m.muscle).width;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = font(600, 34);
        ctx.fillText(`${num(m.sets)} sets`, PAD + nameW + 24, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = theme.accent;
        ctx.font = font(900, 52);
        ctx.fillText(`${Math.round(m.share * 100)}%`, W - PAD, y);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        roundRect(ctx, PAD, y + 34, maxW, 40, 20);
        ctx.fill();
        ctx.fillStyle = i === 0 ? theme.accent : 'rgba(255,255,255,0.7)';
        roundRect(ctx, PAD, y + 34, Math.max(40, maxW * (m.share / top)), 40, 20);
        ctx.fill();
      });
      break;
    }
    case 'summary': {
      kicker(ctx, 'Your lifter type', theme.accent, 260);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(900, 124);
      let y = wrap(ctx, slide.persona, PAD, 410, maxW, 134, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = font(600, 42);
      y = wrap(ctx, slide.personaWhy, PAD, y + 20, maxW, 56, 3);
      const boxW = (maxW - 32) / 2;
      const boxes: [string, string][] = [
        ['Workouts', String(slide.workouts)],
        ['Pounds lifted', num(slide.volume)],
        ['PRs', String(slide.prs)],
        ['Top muscle', slide.topMuscle || '—'],
      ];
      const top = Math.max(y + 60, 900);
      boxes.forEach(([label, value], i) => statBox(ctx, PAD + (i % 2) * (boxW + 32), top + Math.floor(i / 2) * 252, boxW, 220, label, value, theme.accent));
      if (slide.topLift) statBox(ctx, PAD, top + 504, maxW, 220, 'Top lift', slide.topLift, '#ffffff');
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = font(600, 36);
      ctx.fillText(slide.range, PAD, Math.min(H - 170, top + 820));
      break;
    }
  }
}

/** One PNG per slide. */
export async function renderRecap(slides: RecapSlide[]): Promise<Blob[]> {
  return Promise.all(slides.map((slide, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    drawSlide(canvas.getContext('2d')!, slide, i, slides.length);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the recap'))), 'image/png'));
  }));
}
