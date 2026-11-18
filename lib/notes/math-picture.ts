import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import sharp from 'sharp';

// Math typeset as a picture, for a Notes page: a text box there can only hold plain text, so a
// formula goes on the page the way the question's figure does. MathJax draws it as SVG made of
// paths alone (no fonts to load), which the server turns into a PNG with sharp.

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams', 'boldsymbol', 'noundefined'] }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

export type MathPicture = { svg: string; w: number; h: number };

const cache = new Map<string, MathPicture | null>();

/**
 * `latex` drawn at `size` points, its size in points to match; nothing if it doesn't typeset
 * (the page then has the formula as text instead).
 */
export function mathPicture(latex: string, { size = 12, display = true, color = '#1d1f27' } = {}): MathPicture | null {
  const key = `${size}|${display}|${color}|${latex}`;
  if (cache.has(key)) return cache.get(key)!;
  let made: MathPicture | null = null;
  try {
    const node = doc.convert(latex, { display, em: 16, ex: 8, containerWidth: 2000 });
    let svg = adaptor.innerHTML(node);
    // A TeX error is flagged; an unknown command is drawn in red instead.
    if (!svg.includes('data-mjx-error') && !svg.includes('fill="red"')) {
      // MathJax sizes it in ex; an ex is half the font size.
      const ex = (name: string) => Number(new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)ex"`).exec(svg)?.[1]);
      const w = ex('width') * (size / 2);
      const h = ex('height') * (size / 2);
      if (w > 0 && h > 0) {
        svg = svg
          .replace(/^<svg([^>]*)\swidth="[\d.]+ex"/, `<svg$1 width="${w.toFixed(2)}"`)
          .replace(/^<svg([^>]*)\sheight="[\d.]+ex"/, `<svg$1 height="${h.toFixed(2)}"`)
          .replace(/^<svg([^>]*)\sstyle="[^"]*"/, '<svg$1')
          .replaceAll('currentColor', color);
        made = { svg, w, h };
      }
    }
  } catch {
    made = null;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, made);
  return made;
}

/** The same as a PNG, at three times its size so it stays sharp when zoomed in on. */
export async function mathPng(latex: string, size: number) {
  const made = mathPicture(latex, { size });
  if (!made) return null;
  return sharp(Buffer.from(made.svg), { density: 72 * 3 }).flatten({ background: '#ffffff' }).png().toBuffer();
}
