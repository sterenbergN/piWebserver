// Makes the home-screen icons for every section in lib/home-apps.ts: the section's
// symbol in white on its room's colour. Run on Windows (npm run icons:apps), whose
// Segoe UI Emoji font draws the symbols as clean outlines; the Pi has no such font,
// so the icons are made here and kept in public/icons.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { appIcon, HOME_APPS } from '../lib/home-apps';

function shade(hex: string, by: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * by))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** `scale`: how much of the square the symbol fills (maskable icons keep it inside the safe zone). */
function svg(glyph: string, color: string, scale: number) {
  const s = 512;
  const symbol = glyph.replace(/\uFE0F/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(color, 1.15)}"/><stop offset="1" stop-color="${shade(color, 0.7)}"/></linearGradient></defs>
  <rect width="${s}" height="${s}" fill="url(#g)"/>
  <text x="${s / 2}" y="${s / 2}" font-size="${Math.round(s * scale)}" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI Emoji, Segoe UI Symbol" fill="#fff">${symbol}</text>
</svg>`;
}

async function main() {
  await mkdir('public/icons', { recursive: true });
  for (const app of HOME_APPS) {
    const out = (kind: Parameters<typeof appIcon>[1]) => `public${appIcon(app.slug, kind)}`;
    for (const size of [192, 512] as const) {
      await sharp(Buffer.from(svg(app.glyph, app.color, 0.56))).resize(size, size).png().toFile(out(`${size}`));
      await sharp(Buffer.from(svg(app.glyph, app.color, 0.4))).resize(size, size).png().toFile(out(`maskable-${size}`));
    }
    await sharp(Buffer.from(svg(app.glyph, app.color, 0.56))).resize(180, 180).png().toFile(out('apple-touch-icon'));
  }
  console.log(`icons written for ${HOME_APPS.map((a) => a.slug).join(', ')}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
