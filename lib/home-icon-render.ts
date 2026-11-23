import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { backgroundSvg, KIND_SIZE, SYMBOL_SCALE, type IconChoice, type IconKind } from './home-icons';

// Drawing a chosen home-screen icon on the Pi: the colour's gradient (an SVG
// with no text, so no fonts are needed) with the symbol's white PNG on top.
// The result depends only on the address, so it's kept and cached for good.

const cache = new Map<string, Buffer>();
const CACHE_MAX = 300;

export async function renderHomeIcon(choice: IconChoice, kind: IconKind, root = process.cwd()): Promise<Buffer> {
  const key = `${choice.symbol}/${choice.color}/${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const glyphFile = path.join(root, 'public', 'icons', 'glyphs', `${choice.symbol}.png`);
  let glyph: Buffer = await fs.readFile(glyphFile);
  // The symbol PNGs are drawn at the regular icon's scale; maskable icons shrink it into the safe zone.
  if (kind.startsWith('maskable')) {
    const side = Math.round(512 * (SYMBOL_SCALE.maskable / SYMBOL_SCALE.any));
    const inset = Math.round((512 - side) / 2);
    glyph = await sharp(glyph).resize(side, side).extend({ top: inset, bottom: 512 - side - inset, left: inset, right: 512 - side - inset, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  const size = KIND_SIZE[kind];
  const full = await sharp(Buffer.from(backgroundSvg(choice.color))).composite([{ input: glyph }]).png().toBuffer();
  const out = size === 512 ? full : await sharp(full).resize(size, size).png().toBuffer();

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
