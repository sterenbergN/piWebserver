import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, convert, formatNumber } from './units';

const cat = (id: string) => CATEGORIES.find((c) => c.id === id)!;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('length and weight use exact factors', () => {
  close(convert(1, cat('length'), 'mi', 'ft'), 5280);
  close(convert(12, cat('length'), 'in', 'ft'), 1);
  close(convert(1, cat('weight'), 'kg', 'lb'), 2.2046226218487757);
  close(convert(16, cat('weight'), 'oz', 'lb'), 1);
});

test('temperature goes through Celsius', () => {
  close(convert(100, cat('temperature'), 'c', 'f'), 212);
  close(convert(-40, cat('temperature'), 'f', 'c'), -40);
  close(convert(0, cat('temperature'), 'k', 'c'), -273.15);
});

test('volume, speed and area', () => {
  close(convert(1, cat('volume'), 'gal', 'cup'), 16);
  close(convert(3, cat('volume'), 'tsp', 'tbsp'), 1);
  close(convert(100, cat('speed'), 'kph', 'mph'), 62.13711922373339);
  close(convert(1, cat('area'), 'acre', 'ft2'), 43560);
});

test('formatNumber trims float noise', () => {
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(5280), '5,280');
  assert.equal(formatNumber(2.2046226218), '2.20462');
  assert.equal(formatNumber(NaN), '—');
});
