// Draws a shareable end-of-game card (1080×1350, a good size for chats and
// stories) on a canvas, entirely in the browser.

export type ResultsCardData = {
  gameName: string;
  roomCode: string;
  standings: { name: string; score: number; color: string }[];
  awards: { emoji: string; title: string; detail: string; names: string[] }[];
};

const W = 1080;
const H = 1350;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export async function renderResultsCard(data: ResultsCardData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1e1037');
  bg.addColorStop(1, '#0b1a2e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const font = (weight: number, size: number) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 64);
  ctx.fillText(data.gameName, W / 2, 120);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = font(600, 30);
  ctx.fillText(`Room ${data.roomCode} · ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`, W / 2, 170);

  // Podium: top three, winner in the middle and tallest.
  const podium = [data.standings[1], data.standings[0], data.standings[2]];
  const heights = [200, 280, 150];
  const medals = ['🥈', '🥇', '🥉'];
  const colW = 280;
  const baseY = 620;
  podium.forEach((p, i) => {
    if (!p) return;
    const x = W / 2 + (i - 1) * (colW + 20);
    const h = heights[i];
    ctx.fillStyle = p.color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - colW / 2, baseY - h, colW, h);
    ctx.globalAlpha = 1;
    ctx.font = font(400, 72);
    ctx.fillText(medals[i], x, baseY - h - 90);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(800, 40);
    ctx.fillText(fitText(ctx, p.name, colW - 20), x, baseY - h - 30);
    ctx.fillStyle = '#0b0b12';
    ctx.font = font(900, 44);
    ctx.fillText(String(p.score), x, baseY - h + 60);
  });

  // Everyone else, compactly.
  const rest = data.standings.slice(3, 9);
  ctx.font = font(600, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  if (rest.length) {
    const line = rest.map((p, i) => `${i + 4}. ${p.name} ${p.score}`).join('   ');
    ctx.fillText(fitText(ctx, line, W - 120), W / 2, baseY + 60);
  }

  // Awards.
  ctx.textAlign = 'left';
  let y = baseY + 140;
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 40);
  if (data.awards.length) ctx.fillText('Awards', 80, y);
  y += 30;
  for (const award of data.awards.slice(0, 5)) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(70, y, W - 140, 96);
    ctx.font = font(400, 52);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(award.emoji, 95, y + 66);
    ctx.font = font(800, 34);
    ctx.fillText(fitText(ctx, `${award.title} — ${award.names.join(' & ')}`, W - 320), 180, y + 45);
    ctx.font = font(500, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(fitText(ctx, award.detail, W - 320), 180, y + 80);
    y += 112;
  }

  ctx.textAlign = 'center';
  ctx.font = font(600, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(`🎉 ${window.location.host}/party`, W / 2, H - 50);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw image'))), 'image/png'));
}

/** Share the card (phones) or download it (desktop). */
export async function shareResultsCard(data: ResultsCardData) {
  const blob = await renderResultsCard(data);
  const file = new File([blob], `party-${data.roomCode}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `${data.gameName} results` });
      return;
    } catch {
      // Share sheet dismissed — fall through to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
