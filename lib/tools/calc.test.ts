import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, ExprError, loan, ohms, unitPrices } from './calc';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('expressions: precedence, powers, implied multiplication and symbols', () => {
  assert.equal(evaluate('2 + 3 × 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('10 ÷ 4'), 2.5);
  assert.equal(evaluate('50% * 80'), 40);
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('√16 + 1'), 5);
  close(evaluate('2pi'), 2 * Math.PI);
  assert.equal(evaluate('3(4+1)'), 15);
  assert.equal(evaluate('1,250 + 1'), 1251);
  assert.equal(evaluate('(2+3'), 5); // a missing ) is forgiven
  assert.equal(evaluate('ans * 2', { ans: 21 }), 42);
});

test('expressions: functions in degrees or radians, and clear errors', () => {
  close(evaluate('sin(30)'), 0.5);
  close(evaluate('cos(pi)', { deg: false }), -1);
  close(evaluate('atan(1)'), 45);
  assert.equal(evaluate('log(1000)'), 3);
  close(evaluate('ln(e)'), 1);
  assert.equal(evaluate('sqrt(9)^2'), 9);
  assert.throws(() => evaluate('1/0'), ExprError);
  assert.throws(() => evaluate('2 +'), ExprError);
  assert.throws(() => evaluate('foo(2)'), /Unknown/);
  assert.throws(() => evaluate('2 $ 3'), ExprError);
  assert.throws(() => evaluate(''), ExprError);
});

test('loan: standard amortisation, zero interest and extra payments', () => {
  const l = loan(300000, 6.5, 30)!;
  close(l.payment, 1896.2, 1e-4);
  assert.equal(l.months, 360);
  close(l.interest, 1896.2041 * 360 - 300000, 1e-3);
  assert.equal(l.yearly.length, 30);
  close(loan(1200, 0, 1)!.payment, 100);
  const extra = loan(300000, 6.5, 30, 200)!.extra!;
  assert.ok(extra.monthsSaved > 50 && extra.interestSaved > 80000);
  assert.equal(loan(0, 5, 10), null);
});

test('ohm’s law from any two values, and price per unit', () => {
  assert.deepEqual(ohms({ v: 12, i: 2 }), { v: 12, i: 2, r: 6, p: 24 });
  const fromRp = ohms({ r: 6, p: 24 })!;
  close(fromRp.v, 12);
  close(fromRp.i, 2);
  assert.equal(ohms({ v: 5 }), null);
  assert.deepEqual(unitPrices([{ price: 4, size: 16 }, { price: 3, size: 10 }, { price: null, size: 5 }]), { per: [0.25, 0.3, null], best: 0 });
});
