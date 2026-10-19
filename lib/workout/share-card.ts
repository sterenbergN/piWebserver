import { calcAverage1RM } from './analytics';
import { exerciseKey } from './exercises';
import { bestE1RMByExercise, bestE1RMByLift } from './session-insights';
import { compareWithLastTime, formatClock, sessionVerdict, workoutTotals, type LoggedSet } from './tracker-utils';
import { isLoadStation, type StationType } from './types';

// Draws a shareable "today's workout" card (1080×1350, sized for chats and
// stories) on a canvas, entirely in the browser — see components/party/resultsCard.ts.

export type WorkoutCardData = {
  title: string;
  date: Date;
  gymName?: string;
  duration: string;
  sets: number;
  volume: number;
  verdict: string;
  lifts: { name: string; top: string; change: 'up' | 'same' | 'down' | 'new'; changeText: string; pr?: boolean }[];
};

type SavedWorkout = {
  id?: string;
  timestamp: string;
  name?: string;
  type?: { name?: string };
  gymName?: string;
  duration?: string;
  durationSecs?: number;
  logs?: Record<string, LoggedSet[] | undefined>;
  liftMeta?: Record<string, { name?: string; exercise?: string; stationType?: string } | undefined>;
};

/**
 * The card for a workout already in history, compared with the workouts
 * before it — the same numbers the finish screen showed on the day.
 */
export function cardDataForWorkout(workout: SavedWorkout, history: SavedWorkout[], opts: { gymName?: string; lifts?: Record<string, { name?: string }> } = {}): WorkoutCardData {
  const at = new Date(workout.timestamp).getTime();
  const earlier = history.filter((w) => w !== workout && (!workout.id || w.id !== workout.id) && new Date(w.timestamp).getTime() < at);
  const logs: Record<string, LoggedSet[]> = {};
  for (const [id, sets] of Object.entries(workout.logs || {})) {
    const valid = (sets || []).filter((s) => Number(s.reps) > 0).map((s) => ({ ...s, weight: Number(s.weight) || 0, reps: Number(s.reps) }));
    if (valid.length) logs[id] = valid;
  }
  const planLifts = Object.keys(logs).map((id) => {
    const meta = workout.liftMeta?.[id];
    return { id, uniquePlanId: id, name: meta?.name || opts.lifts?.[id]?.name || 'Lift', exercise: meta?.exercise, stationType: meta?.stationType };
  });
  const comparisons = compareWithLastTime({ id: workout.id || '', name: workout.name || '', lifts: planLifts }, logs, earlier as any[]);

  const bestByLift = bestE1RMByLift(earlier as any[]);
  const bestByExercise = bestE1RMByExercise(earlier as any[]);
  const prs = new Set(planLifts.filter((lift) => {
    const best = Math.max(...logs[lift.id].map((s) => calcAverage1RM(s.weight, s.reps)));
    const previous = (isLoadStation(lift.stationType as StationType) ? bestByLift[lift.id] : bestByExercise[exerciseKey(lift) || lift.id]) || 0;
    return previous > 0 && best > previous + 0.5;
  }).map((lift) => lift.name));

  const { sets, volume } = workoutTotals(logs);
  return {
    title: workout.type?.name || workout.name || 'Workout',
    date: new Date(workout.timestamp),
    gymName: workout.gymName || opts.gymName,
    duration: workout.durationSecs ? formatClock(workout.durationSecs) : workout.duration || '—',
    sets,
    volume,
    verdict: sessionVerdict(comparisons, prs.size),
    lifts: comparisons.map((c) => ({ name: c.name, top: `${c.top.weight}×${c.top.reps}`, change: c.change, changeText: c.changeText, pr: prs.has(c.name) })),
  };
}

const W = 1080;
const H = 1350;
const font = (weight: number, size: number) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
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

export async function renderWorkoutCard(data: WorkoutCardData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1e1037');
  bg.addColorStop(1, '#0b1a2e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = font(700, 30);
  ctx.fillText(data.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase(), 80, 120);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 76);
  ctx.fillText(fitText(ctx, data.title, W - 160), 80, 210);
  if (data.gymName) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = font(500, 34);
    ctx.fillText(fitText(ctx, data.gymName, W - 160), 80, 262);
  }

  // Three headline stats.
  const stats = [
    { label: 'TIME', value: data.duration },
    { label: 'SETS', value: String(data.sets) },
    { label: 'VOLUME', value: `${Math.round(data.volume).toLocaleString()} lb` },
  ];
  const boxW = (W - 160 - 40) / 3;
  stats.forEach((stat, i) => {
    const x = 80 + i * (boxW + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(ctx, x, 310, boxW, 150, 24);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = font(700, 24);
    ctx.fillText(stat.label, x + 28, 362);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(800, 46);
    ctx.fillText(fitText(ctx, stat.value, boxW - 56), x + 28, 425);
  });

  ctx.fillStyle = '#c4b5fd';
  ctx.font = font(700, 36);
  ctx.fillText(fitText(ctx, data.verdict, W - 160), 80, 530);

  // One row per lift: name, top set, change vs last time.
  const rowH = 92;
  const maxRows = Math.min(data.lifts.length, 7);
  data.lifts.slice(0, maxRows).forEach((lift, i) => {
    const y = 580 + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)';
    roundRect(ctx, 80, y, W - 160, rowH - 12, 18);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(700, 34);
    ctx.fillText(fitText(ctx, `${lift.pr ? '🏆 ' : ''}${lift.name}`, 520), 108, y + 52);
    ctx.font = font(800, 34);
    ctx.fillText(lift.top, 640, y + 52);
    ctx.textAlign = 'right';
    ctx.font = font(700, 28);
    ctx.fillStyle = lift.change === 'up' ? '#68d391' : lift.change === 'down' ? '#f6ad55' : 'rgba(255,255,255,0.55)';
    ctx.fillText(lift.change === 'up' ? `▲ ${lift.changeText}` : lift.change === 'down' ? `▼ ${lift.changeText}` : lift.change === 'new' ? 'new' : '=', W - 108, y + 52);
  });
  if (data.lifts.length > maxRows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = font(600, 28);
    ctx.fillText(`+ ${data.lifts.length - maxRows} more`, 108, 580 + maxRows * rowH + 30);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = font(600, 26);
  ctx.fillText('noahstuf.com · workout tracker', W / 2, H - 60);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the card'))), 'image/png'));
}

/** Share images through the phone's share sheet, or download them. */
export async function shareImages(blobs: Blob[], baseName: string, title: string) {
  const files = blobs.map((blob, i) => new File([blob], blobs.length > 1 ? `${baseName}-${i + 1}.png` : `${baseName}.png`, { type: 'image/png' }));
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> };
  if (nav.canShare?.({ files }) && nav.share) {
    try {
      await nav.share({ files, title });
      return 'shared';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  files.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    // Browsers may block a burst of downloads; stagger them a little.
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, i * 250);
  });
  return 'downloaded';
}

/** Whether this browser can hand image files to the phone's share sheet (else they download). */
export function canShareImages() {
  if (typeof navigator === 'undefined' || typeof File === 'undefined') return false;
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  try {
    return !!nav.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }) && 'share' in navigator;
  } catch {
    return false;
  }
}

/** Whether images can be put on the clipboard (desktop browsers mostly). */
export function canCopyImages() {
  return typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write;
}

export async function copyImage(blob: Blob) {
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
}
