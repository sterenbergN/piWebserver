import test from 'node:test';
import { strict as assert } from 'node:assert';
import { mathPicture, mathPng } from './math-picture';
import { symbolsLatex } from './question-sheet';

test('a formula is typeset as an SVG sized in points, drawn in ink, and as a sharp PNG', async () => {
  const small = mathPicture(String.raw`t_{on} = \frac{\Delta T_h}{\dot T_{heat}}`, { size: 10 })!;
  const big = mathPicture(String.raw`t_{on} = \frac{\Delta T_h}{\dot T_{heat}}`, { size: 20 })!;
  assert.ok(small.w > 30 && small.h > 10, `${small.w}×${small.h}`);
  assert.ok(Math.abs(big.w / small.w - 2) < 1e-6, 'twice the size, twice as wide');
  assert.match(small.svg, new RegExp(`^<svg[^>]* width="${small.w.toFixed(2)}" height="${small.h.toFixed(2)}"`));
  assert.doesNotMatch(small.svg, /currentColor|<text/);
  const png = (await mathPng(String.raw`t_{on} = \frac{\Delta T_h}{\dot T_{heat}}`, 10))!;
  assert.deepEqual([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
});

test('the symbols table typesets, and broken math gives nothing rather than an error picture', () => {
  const table = mathPicture(symbolsLatex([{ symbol: String.raw`\dot m`, meaning: 'mass flow (kg/s) at 20 °C, or $\rho Q$' }, { symbol: 'I', meaning: 'second moment of area (m⁴), in kΩ·m², ±5 …' }]), { size: 9.5 });
  // Every character drawn as a shape: none left to whatever font the server happens to have.
  assert.ok(table && !table.svg.includes('<text'));
  assert.equal(mathPicture(String.raw`\frac{1}{`), null);
  assert.equal(mathPicture(String.raw`\notacommand x`), null);
});
