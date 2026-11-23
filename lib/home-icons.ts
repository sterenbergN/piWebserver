import { HOME_APPS, appIcon } from './home-apps';

// Choosing a section's home-screen icon: a symbol drawn in white on a colour,
// like the generated icons. The symbols are drawn once on Windows (npm run
// icons:apps, which has the emoji font the Pi lacks) as white-on-clear PNGs in
// public/icons/glyphs; the Pi lays one over the chosen colour when asked
// (app/apps/icon/...). Choices are kept on the account (homeIcons).

export type IconKind = '192' | '512' | 'maskable-192' | 'maskable-512' | 'apple-touch-icon';
export const ICON_KINDS: IconKind[] = ['192', '512', 'maskable-192', 'maskable-512', 'apple-touch-icon'];

/** Every section's own symbol first (so the current icons stay choosable), then extras. */
export const ICON_SYMBOLS = [
  '☀️', '🧠', '🎯', '✅', '🧹', '📓', '🗒️', '🎁', '🎉', '🕹️', '🏋️', '🎛️', '📊', '🔧', '⛳', '📄', '📝', '🖼️', '🧊', '🧰',
  '🍳', '✏️', '📖', '🩺',
  '💪', '🏃', '🏊', '🧘', '🔥', '❤️', '🌙', '🌱', '🏠', '📚', '🎵', '🍎', '🥗', '🏆', '💡', '📅', '🧭', '♟️', '🎨',
];

/** A symbol's id, used in file names and addresses: its code points in hex, without the emoji variation selector. */
export const symbolId = (symbol: string) => [...symbol].filter((c) => c !== '️').map((c) => c.codePointAt(0)!.toString(16)).join('-');

const BY_ID = new Map(ICON_SYMBOLS.map((s) => [symbolId(s), s]));
export const symbolFromId = (id: string) => BY_ID.get(id) ?? null;

/** The rooms' colours, then a few more. Stored without '#'. */
export const ICON_COLORS = [
  { hex: '3987e5', name: 'Blue' }, { hex: '4f46e5', name: 'Indigo' }, { hex: '9085e9', name: 'Lavender' }, { hex: 'd55181', name: 'Pink' },
  { hex: 'e66767', name: 'Red' }, { hex: 'd95926', name: 'Orange' }, { hex: 'c98500', name: 'Amber' }, { hex: '008300', name: 'Green' },
  { hex: '199e70', name: 'Teal green' }, { hex: '0e8a92', name: 'Teal' }, { hex: '4a5568', name: 'Slate' }, { hex: '1f2329', name: 'Black' },
];
const COLOR_HEXES = new Set(ICON_COLORS.map((c) => c.hex));
export const isIconColor = (hex: unknown): hex is string => typeof hex === 'string' && COLOR_HEXES.has(hex);

/** Sections with their own hand-drawn icons: these keep their art unless a symbol is chosen. */
export const ART_APPS: Record<string, { name: string; glyph: string; color: string; icon: (kind: IconKind) => string }> = {
  recipes: { name: 'Recipes', glyph: '🍳', color: '199e70', icon: (k) => `/icons/recipes-${k}.png` },
  notes: { name: 'Notes', glyph: '✏️', color: 'c98500', icon: (k) => `/icons/notes-${k}.png` },
  reader: { name: 'Reader', glyph: '📖', color: '3987e5', icon: (k) => `/icons/reader-${k}.png` },
  study: { name: 'PA Study', glyph: '🩺', color: 'd55181', icon: (k) => `/icons/study-${k}.png` },
};

export type IconChoice = { symbol: string; color: string };

/** A section that can have its own icon: its default look and what its icon files are. */
export function iconApp(slug: string): { slug: string; name: string; symbol: string; color: string; art: boolean; icon: (kind: IconKind) => string } | null {
  const art = ART_APPS[slug];
  if (art) return { slug, name: art.name, symbol: symbolId(art.glyph), color: art.color, art: true, icon: art.icon };
  const app = HOME_APPS.find((a) => a.slug === slug);
  if (!app) return null;
  return { slug, name: app.short, symbol: symbolId(app.glyph), color: app.color.replace('#', ''), art: false, icon: (k) => appIcon(slug, k) };
}

/** A clean choice, or null when it's invalid or the same as the section's own icon (nothing to store). */
export function cleanChoice(slug: string, raw: unknown): IconChoice | null {
  const app = iconApp(slug);
  if (!app || !raw || typeof raw !== 'object') return null;
  const { symbol, color } = raw as Partial<IconChoice>;
  if (typeof symbol !== 'string' || !symbolFromId(symbol) || !isIconColor(color)) return null;
  if (!app.art && symbol === app.symbol && color === app.color) return null;
  return { symbol, color };
}

/** What's stored on an account: only valid, non-default choices for real sections. */
export function cleanHomeIcons(raw: unknown): Record<string, IconChoice> {
  const out: Record<string, IconChoice> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    const choice = cleanChoice(slug, value);
    if (choice) out[slug] = choice;
  }
  return out;
}

export const customIconUrl = (choice: IconChoice, kind: IconKind) => `/apps/icon/${choice.symbol}/${choice.color}/${kind}.png`;
export const glyphUrl = (symbol: string) => `/icons/glyphs/${symbol}.png`;
/** The `?icon=` a manifest address carries for a chosen icon. */
export const iconParam = (choice: IconChoice) => `${choice.symbol}.${choice.color}`;

/** Read a manifest's `?icon=` back into a choice (null when absent or invalid). */
export function choiceFromParam(param: string | null): IconChoice | null {
  if (!param) return null;
  const [symbol, color] = param.split('.');
  return symbolFromId(symbol ?? '') && isIconColor(color) ? { symbol, color } : null;
}

/** A manifest's icons for a chosen symbol and colour. */
export function customManifestIcons(choice: IconChoice) {
  return [
    { src: customIconUrl(choice, '192'), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: customIconUrl(choice, '512'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: customIconUrl(choice, 'maskable-192'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: customIconUrl(choice, 'maskable-512'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
}

// ── Drawing (shared by the build script and the Pi) ─────────────────────────────

export function shade(hex: string, by: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * by))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** The icon's background: the colour as a diagonal gradient, 512 square. No text, so it draws without fonts. */
export function backgroundSvg(hex: string, size = 512) {
  const color = `#${hex.replace('#', '')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(color, 1.15)}"/><stop offset="1" stop-color="${shade(color, 0.7)}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
</svg>`;
}

/** How much of the square the symbol fills: maskable icons keep it inside the safe zone. */
export const SYMBOL_SCALE = { any: 0.56, maskable: 0.4 };
export const KIND_SIZE: Record<IconKind, number> = { '192': 192, '512': 512, 'maskable-192': 192, 'maskable-512': 512, 'apple-touch-icon': 180 };
