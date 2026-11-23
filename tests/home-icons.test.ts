import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { HOME_APPS } from '../lib/home-apps';
import { renderHomeIcon } from '../lib/home-icon-render';
import { ART_APPS, ICON_SYMBOLS, KIND_SIZE, choiceFromParam, cleanChoice, cleanHomeIcons, customManifestIcons, iconApp, iconParam, symbolFromId, symbolId } from '../lib/home-icons';

test('every section’s own symbol can be picked, and every symbol has its white drawing', () => {
  for (const app of HOME_APPS) assert.ok(symbolFromId(symbolId(app.glyph)), `${app.slug}'s ${app.glyph} isn't in the list`);
  for (const art of Object.values(ART_APPS)) assert.ok(symbolFromId(symbolId(art.glyph)));
  for (const symbol of ICON_SYMBOLS) {
    assert.ok(fs.existsSync(path.join(process.cwd(), 'public', 'icons', 'glyphs', `${symbolId(symbol)}.png`)), `missing glyph for ${symbol}: npm run icons:apps -- --glyphs`);
  }
  assert.equal(symbolId('🏋️'), '1f3cb');
  assert.equal(new Set(ICON_SYMBOLS.map(symbolId)).size, ICON_SYMBOLS.length);
});

test('choices: only listed symbols and colours, and the section’s own icon is stored as nothing', () => {
  const workout = iconApp('workout')!;
  assert.deepEqual(cleanChoice('workout', { symbol: '1f4aa', color: '3987e5' }), { symbol: '1f4aa', color: '3987e5' });
  assert.equal(cleanChoice('workout', { symbol: workout.symbol, color: workout.color }), null);
  assert.equal(cleanChoice('workout', { symbol: '1f4aa', color: 'ff00ff' }), null);
  assert.equal(cleanChoice('workout', { symbol: '../../etc', color: '3987e5' }), null);
  assert.equal(cleanChoice('nope', { symbol: '1f4aa', color: '3987e5' }), null);
  // A hand-drawn app picking its own symbol and colour is still a change (from the drawing).
  assert.ok(cleanChoice('recipes', { symbol: iconApp('recipes')!.symbol, color: iconApp('recipes')!.color }));
  assert.deepEqual(cleanHomeIcons({ workout: { symbol: '1f4aa', color: '3987e5' }, bogus: { symbol: '1f4aa', color: '3987e5' }, journal: 'x' }), { workout: { symbol: '1f4aa', color: '3987e5' } });
});

test('the manifest address carries the choice and the manifest swaps its icons', () => {
  const choice = { symbol: '1f4aa', color: '3987e5' };
  assert.deepEqual(choiceFromParam(iconParam(choice)), choice);
  assert.equal(choiceFromParam('1f4aa.ff00ff'), null);
  assert.equal(choiceFromParam(null), null);
  const icons = customManifestIcons(choice);
  assert.equal(icons.length, 4);
  assert.ok(icons.every((i) => i.src.startsWith('/apps/icon/1f4aa/3987e5/')));
});

test('the Pi draws a chosen icon the same way the build drew the originals', async () => {
  const workout = iconApp('workout')!;
  const drawn = await renderHomeIcon({ symbol: workout.symbol, color: workout.color }, '512');
  const original = fs.readFileSync(path.join(process.cwd(), 'public', workout.icon('512')));
  const [a, b] = await Promise.all([drawn, original].map((img) => sharp(img).removeAlpha().raw().toBuffer()));
  assert.equal(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  // Same picture, give or take antialiasing.
  assert.ok(diff / a.length < 2, `mean difference ${(diff / a.length).toFixed(2)}`);

  for (const kind of ['192', 'maskable-512', 'apple-touch-icon'] as const) {
    const meta = await sharp(await renderHomeIcon({ symbol: '1f4aa', color: '3987e5' }, kind)).metadata();
    assert.equal(meta.width, KIND_SIZE[kind]);
    assert.equal(meta.height, KIND_SIZE[kind]);
  }
});
