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

/** Share the card (phone share sheet) or fall back to downloading it. */
export async function shareWorkoutCard(data: WorkoutCardData) {
  const blob = await renderWorkoutCard(data);
  const file = new File([blob], `workout-${data.date.toISOString().slice(0, 10)}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: data.title });
      return 'shared';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
