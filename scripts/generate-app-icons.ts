// Makes the home-screen icons for every section in lib/home-apps.ts: the section's
// symbol in white on its room's colour. Run on Windows (npm run icons:apps), whose
// Segoe UI Emoji font draws the symbols as clean outlines; the Pi has no such font,
// so the icons are made here and kept in public/icons.
//
//   npm run icons:apps                 every section's icons
//   npm run icons:apps -- --glyphs     only the white symbols the icon picker uses
//                                      (public/icons/glyphs, laid over a colour on the Pi)
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { appIcon, HOME_APPS } from '../lib/home-apps';
import { ICON_SYMBOLS, shade, symbolId, SYMBOL_SCALE } from '../lib/home-icons';


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

/** A symbol alone, white on clear, placed exactly as on an icon (scale SYMBOL_SCALE.any of a 512 square). */
function glyphSvg(glyph: string) {
  const s = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <text x="${s / 2}" y="${s / 2}" font-size="${Math.round(s * SYMBOL_SCALE.any)}" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI Emoji, Segoe UI Symbol" fill="#fff">${glyph.replace(/️/g, '')}</text>
</svg>`;
}

async function glyphs() {
  await mkdir('public/icons/glyphs', { recursive: true });
  for (const glyph of ICON_SYMBOLS) {
    await sharp(Buffer.from(glyphSvg(glyph))).png().toFile(`public/icons/glyphs/${symbolId(glyph)}.png`);
  }
  console.log(`${ICON_SYMBOLS.length} symbols written to public/icons/glyphs`);
}

async function main() {
  if (process.argv.includes('--glyphs')) return glyphs();
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
