import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeConfirmer, normaliseRead } from './scanner';

test('the self-hosted ZXing .wasm is byte-for-byte the installed package’s', () => {
  const served = readFileSync('public/vendor/zxing/zxing_reader.wasm');
  const installed = readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
  assert.ok(served.equals(installed), 'copy node_modules/zxing-wasm/dist/reader/zxing_reader.wasm to public/vendor/zxing/ again');
});

test('a read counts only when it repeats', () => {
  const confirm = makeConfirmer();
  assert.equal(confirm('0016000275287'), null);
  assert.equal(confirm('0016000275287'), '0016000275287');
  const c2 = makeConfirmer();
  assert.equal(c2('a'), null);
  assert.equal(c2('b'), null);
  assert.equal(c2(null), null);
  assert.equal(c2('b'), null);
});

test('reads are normalised to a GTIN-13, and bad check digits are dropped', () => {
  assert.equal(normaliseRead('016000275287'), '0016000275287');
  assert.equal(normaliseRead('016000275288'), null);
  assert.equal(normaliseRead('hello'), null);
});
