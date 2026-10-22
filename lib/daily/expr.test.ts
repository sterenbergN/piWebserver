import test from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluate, evaluateValue } from './expr';

const close = (text: string, expected: number, opts?: Parameters<typeof evaluate>[1]) => {
  const r = evaluate(text, opts);
  assert.ok('value' in r, `${text}: ${'error' in r ? r.error : ''}`);
  assert.ok(Math.abs(r.value - expected) < 1e-9 * Math.max(1, Math.abs(expected)), `${text} = ${r.value}, expected ${expected}`);
};

test('evaluate handles numbers, operators and precedence', () => {
  close('1.5', 1.5);
  close('1.2e3', 1200);
  close('2+3*4', 14);
  close('(2+3)*4', 20);
  close('2^3^2', 512);
  close('-2^2', -4);
  close('2^-1', 0.5);
  close('10/4/5', 0.5);
  close('6 − 2 × 3 ÷ 3', 4);
});

test('evaluate handles functions, constants and implied multiplication', () => {
  close('sqrt(2)', Math.SQRT2);
  close('√2', Math.SQRT2);
  close('2√3', 2 * Math.sqrt(3));
  close('3pi/4', (3 * Math.PI) / 4);
  close('1/2pi', 1 / (2 * Math.PI));
  close('2(3+1)', 8);
  close('(1+1)(2+1)', 6);
  close('π', Math.PI);
  close('e', Math.E);
  close('2e', 2 * Math.E);
  close('ln(e^2)', 2);
  close('log(1000)', 3);
  close('log(8, 2)', 3);
  close('sin(pi/6)', 0.5);
  close('sin(30°)', 0.5);
  close('sin(30deg)', 0.5);
  close('sin 30 deg', 0.5);
  close('cos(60degrees)', 0.5);
  close('2sin(30deg)', 1);
  close('sin(30)', 0.5, { angle: 'deg' });
  close('asin(0.5)', 30, { angle: 'deg' });
  close('4²', 16);
  close('ans*2', 10, { vars: { ans: 5 } });
});

test('evaluate rejects junk and unsafe input', () => {
  for (const bad of ['', '2+', '(1', 'foo(2)', 'alert(1)', '1/0', 'sqrt(-1)', '2,3', 'atan2 1']) {
    assert.ok('error' in evaluate(bad), `${bad} should fail`);
  }
  assert.equal(evaluateValue('  '), null);
  assert.equal(evaluateValue('sqrt(4)'), 2);
});
