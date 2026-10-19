import { calcAverage1RM } from './analytics';
import { exerciseKey } from './exercises';
import { bestE1RMByExercise, bestE1RMByLift, liftSessions } from './session-insights';
import { compareWithLastTime, formatClock, sessionVerdict, workoutTotals, type LoggedSet } from './tracker-utils';
import { isLoadStation, type StationType } from './types';

// Draws a shareable "today's workout" card on a canvas, entirely in the
// browser — see components/party/resultsCard.ts. Two layouts: a 4:5 post
// (1080×1350, for chats and feeds) and a 9:16 story (1080×1920).

export type WorkoutCardData = {
  title: string;
  date: Date;
  gymName?: string;
  duration: string;
  sets: number;
  volume: number;
  verdict: string;
  lifts: { name: string; top: string; change: 'up' | 'same' | 'down' | 'new'; changeText: string; pr?: boolean }[];
  /** Estimated 1RM of the day's main lift over its recent sessions, oldest first. */
  trend?: { name: string; points: number[] };
};

export type CardFormat = 'post' | 'story';

const TREND_SESSIONS = 8;

/**
 * The day's headline lift — a PR if there was one, else the strongest by
 * estimated 1RM — and its last few sessions up to and including this one,
 * for the trend line. Needs 3+ sessions.
 */
export function strengthTrend(
  history: SavedWorkout[],
  lifts: { id: string; name: string; exercise?: string; e1rm: number; pr?: boolean }[],
  until: { timestamp: string; id?: string },
  today?: { e1rm: number },
): WorkoutCardData['trend'] {
  const main = [...lifts].sort((a, b) => Number(!!b.pr) - Number(!!a.pr) || b.e1rm - a.e1rm)[0];
  if (!main || main.e1rm <= 0) return undefined;
  const at = new Date(until.timestamp).getTime();
  const sessions = liftSessions(history.filter((w) => new Date(w.timestamp).getTime() <= at) as any[], main.id, main.exercise || main.name)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const points = sessions.map((s) => Math.round(s.e1rm));
  if (today) points.push(Math.round(today.e1rm));
  const recent = points.slice(-TREND_SESSIONS);
  return recent.length >= 3 ? { name: main.name, points: recent } : undefined;
}

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
    trend: strengthTrend(history, comparisons.map((c) => ({ ...planLifts.find((l) => l.id === c.uid)!, e1rm: c.e1rm, pr: prs.has(c.name) })), workout),
  };
}

const W = 1080;
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

/** The day's main lift over its recent sessions: a line of estimated 1RMs. */
function drawTrend(ctx: CanvasRenderingContext2D, trend: NonNullable<WorkoutCardData['trend']>, y: number, h: number) {
  const x = 80;
  const w = W - 160;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, x, y, w, h, 24);
  ctx.fill();

  const first = trend.points[0];
  const last = trend.points[trend.points.length - 1];
  const delta = last - first;
  ctx.textAlign = 'right';
  ctx.font = font(800, 30);
  ctx.fillStyle = delta > 0 ? '#68d391' : delta < 0 ? '#f6ad55' : 'rgba(255,255,255,0.6)';
  const deltaText = `${first} → ${last} lb`;
  ctx.fillText(deltaText, x + w - 28, y + 52);
  const deltaW = ctx.measureText(deltaText).width;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = font(700, 24);
  ctx.fillText(fitText(ctx, `${trend.name.toUpperCase()} · EST. 1RM`, w - 56 - deltaW - 24), x + 28, y + 50);

  const left = x + 40;
  const right = x + w - 40;
  const top = y + 90;
  const bottom = y + h - 36;
  const min = Math.min(...trend.points);
  const max = Math.max(...trend.points);
  const span = max - min || 1;
  const pts = trend.points.map((v, i) => ({
    x: left + (i / (trend.points.length - 1)) * (right - left),
    y: max === min ? (top + bottom) / 2 : bottom - ((v - min) / span) * (bottom - top),
  }));

  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, 'rgba(196,181,253,0.35)');
  fill.addColorStop(1, 'rgba(196,181,253,0)');
  ctx.beginPath();
  ctx.moveTo(pts[0].x, bottom);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = '#c4b5fd';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  pts.forEach((p, i) => {
    const isLast = i === pts.length - 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, isLast ? 13 : 7, 0, Math.PI * 2);
    ctx.fillStyle = isLast ? '#ffffff' : '#c4b5fd';
    ctx.fill();
  });
}

/** An image the card can be drawn over (a decoded photo). */
export type CardPhoto = CanvasImageSource & { width: number; height: number };

/** Your own photo with the workout over its lower part, Strava-style. */
function drawPhotoCard(ctx: CanvasRenderingContext2D, data: WorkoutCardData, photo: CardPhoto, H: number, story: boolean) {
  // Cover-fit the photo.
  const scale = Math.max(W / photo.width, H / photo.height);
  const pw = photo.width * scale;
  const ph = photo.height * scale;
  ctx.drawImage(photo, (W - pw) / 2, (H - ph) / 2, pw, ph);

  const lifts = data.lifts.slice(0, story ? 4 : 3);
  const bottom = story ? H - 200 : H - 90;
  const contentH = 360 + lifts.length * 64;
  const top = bottom - contentH;

  const shade = ctx.createLinearGradient(0, top - 260, 0, H);
  shade.addColorStop(0, 'rgba(8,6,18,0)');
  shade.addColorStop(0.35, 'rgba(8,6,18,0.7)');
  shade.addColorStop(1, 'rgba(8,6,18,0.92)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, top - 260, W, H - top + 260);
  const topShade = ctx.createLinearGradient(0, 0, 0, 220);
  topShade.addColorStop(0, 'rgba(0,0,0,0.45)');
  topShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, W, 220);

  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = font(700, 28);
  ctx.fillText(data.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase(), 80, story ? 260 : 100);

  let y = top;
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 84);
  ctx.fillText(fitText(ctx, data.title, W - 160), 80, y + 70);
  if (data.gymName) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = font(500, 34);
    ctx.fillText(fitText(ctx, data.gymName, W - 160), 80, y + 120);
  }
  y += 150;
  const stats = [
    { label: 'TIME', value: data.duration },
    { label: 'SETS', value: String(data.sets) },
    { label: 'VOLUME', value: `${Math.round(data.volume).toLocaleString()} lb` },
  ];
  const colW = (W - 160) / 3;
  stats.forEach((stat, i) => {
    const x = 80 + i * colW;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = font(700, 24);
    ctx.fillText(stat.label, x, y + 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(800, 54);
    ctx.fillText(fitText(ctx, stat.value, colW - 20), x, y + 92);
  });
  y += 170;
  ctx.fillStyle = '#c4b5fd';
  ctx.font = font(700, 34);
  ctx.fillText(fitText(ctx, data.verdict, W - 160), 80, y);
  y += 30;
  lifts.forEach((lift, i) => {
    const rowY = y + i * 64;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(700, 32);
    ctx.fillText(fitText(ctx, `${lift.pr ? '🏆 ' : ''}${lift.name}`, 560), 80, rowY + 44);
    ctx.textAlign = 'right';
    ctx.font = font(800, 32);
    ctx.fillText(lift.top, W - 260, rowY + 44);
    ctx.font = font(700, 26);
    ctx.fillStyle = lift.change === 'up' ? '#68d391' : lift.change === 'down' ? '#f6ad55' : 'rgba(255,255,255,0.6)';
    ctx.fillText(lift.change === 'up' ? `▲ ${lift.changeText}` : lift.change === 'down' ? `▼ ${lift.changeText}` : lift.change === 'new' ? 'new' : '=', W - 80, rowY + 44);
  });
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = font(600, 26);
  ctx.fillText(data.lifts.length > lifts.length ? `+ ${data.lifts.length - lifts.length} more · noahstuf.com` : 'noahstuf.com · workout tracker', W / 2, story ? H - 110 : H - 40);
}

export async function renderWorkoutCard(data: WorkoutCardData, format: CardFormat = 'post', photo?: CardPhoto | null): Promise<Blob> {
  const story = format === 'story';
  const H = story ? 1920 : 1350;
  if (photo) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    drawPhotoCard(canvas.getContext('2d')!, data, photo, H, story);
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the card'))), 'image/png'));
  }
  // The trend line fits under up to 4 lifts on a post, 7 on a story.
  const trendRows = story ? 7 : 4;
  const showTrend = !!data.trend && (story || data.lifts.length <= trendRows);
  const rowH = 92;
  const maxRows = Math.min(data.lifts.length, showTrend ? trendRows : story ? 10 : 7);
  const more = data.lifts.length > maxRows ? 50 : 0;
  // Stories keep clear of the app's own header and reply bar, and centre
  // the card's content in what's left.
  const contentH = 580 + maxRows * rowH + more + (showTrend ? 280 : 0);
  const T = story ? 200 + Math.max(0, (H - 400 - contentH) / 2) : 0;
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
  ctx.fillText(data.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase(), 80, T + 120);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 76);
  ctx.fillText(fitText(ctx, data.title, W - 160), 80, T + 210);
  if (data.gymName) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = font(500, 34);
    ctx.fillText(fitText(ctx, data.gymName, W - 160), 80, T + 262);
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
    roundRect(ctx, x, T + 310, boxW, 150, 24);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = font(700, 24);
    ctx.fillText(stat.label, x + 28, T + 362);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(800, 46);
    ctx.fillText(fitText(ctx, stat.value, boxW - 56), x + 28, T + 425);
  });

  ctx.fillStyle = '#c4b5fd';
  ctx.font = font(700, 36);
  ctx.fillText(fitText(ctx, data.verdict, W - 160), 80, T + 530);

  const rowsTop = T + 580;
  data.lifts.slice(0, maxRows).forEach((lift, i) => {
    const y = rowsTop + i * rowH;
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
  let below = rowsTop + maxRows * rowH;
  if (more) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = font(600, 28);
    ctx.fillText(`+ ${data.lifts.length - maxRows} more`, 108, below + 30);
    below += more;
  }
  if (showTrend) drawTrend(ctx, data.trend!, below + 20, story ? 260 : 250);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = font(600, 26);
  ctx.fillText('noahstuf.com · workout tracker', W / 2, story ? H - 110 : H - 50);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the card'))), 'image/png'));
}

export type LiftCardData = {
  name: string;
  subtitle?: string;
  /** The latest session set a record: shown as a PR card. */
  pr?: { weight: number; reps: number; date: Date };
  current: number;
  /** First session's estimated 1RM and when, for "+X% since". */
  first?: { e1rm: number; date: Date };
  sessions: number;
  points: number[];
  records: { label: string; weight: number }[];
};

/** One exercise's progress (or a new PR) as a card, same look as the workout card. */
export async function renderLiftCard(data: LiftCardData, format: CardFormat = 'post'): Promise<Blob> {
  const story = format === 'story';
  const H = story ? 1920 : 1350;
  const T = story ? 300 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, data.pr ? '#3b1d05' : '#1e1037');
  bg.addColorStop(1, '#0b1a2e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'left';
  ctx.fillStyle = data.pr ? '#fde047' : '#c4b5fd';
  ctx.font = font(800, 32);
  ctx.fillText(data.pr ? 'NEW PERSONAL RECORD 🏆' : 'STRENGTH PROGRESS', 80, T + 120);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 80);
  ctx.fillText(fitText(ctx, data.name, W - 160), 80, T + 215);
  if (data.subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = font(500, 34);
    ctx.fillText(fitText(ctx, data.subtitle, W - 160), 80, T + 268);
  }

  // Hero number: the PR set, or current estimated 1RM.
  ctx.fillStyle = data.pr ? '#fde047' : '#ffffff';
  ctx.font = font(900, 150);
  const hero = data.pr ? `${data.pr.weight} × ${data.pr.reps}` : `${Math.round(data.current)} lb`;
  ctx.fillText(fitText(ctx, hero, W - 160), 72, T + 440);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = font(600, 36);
  const caption = data.pr
    ? `${data.pr.date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} · est. 1RM ${Math.round(data.current)} lb`
    : 'estimated one-rep max';
  ctx.fillText(fitText(ctx, caption, W - 160), 80, T + 500);

  let y = T + 560;
  if (data.first && data.sessions > 1 && data.first.e1rm > 0) {
    const pct = Math.round(((data.current - data.first.e1rm) / data.first.e1rm) * 100);
    ctx.fillStyle = pct >= 0 ? '#68d391' : '#f6ad55';
    ctx.font = font(800, 40);
    ctx.fillText(`${pct >= 0 ? '+' : ''}${pct}% since ${data.first.date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} · ${data.sessions} sessions`, 80, y + 10);
    y += 50;
  }
  if (data.points.length >= 2) {
    drawTrend(ctx, { name: data.name, points: data.points }, y, story ? 360 : 300);
    y += (story ? 360 : 300) + 30;
  }

  const records = data.records.slice(0, 4);
  if (records.length) {
    const boxW = (W - 160 - 20 * (records.length - 1)) / records.length;
    records.forEach((r, i) => {
      const x = 80 + i * (boxW + 20);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(ctx, x, y, boxW, 130, 22);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = font(700, 24);
      ctx.fillText(r.label.toUpperCase(), x + 24, y + 46);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(800, 42);
      ctx.fillText(fitText(ctx, `${r.weight} lb`, boxW - 48), x + 24, y + 102);
    });
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = font(600, 26);
  ctx.fillText('noahstuf.com · workout tracker', W / 2, story ? H - 110 : H - 50);
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
