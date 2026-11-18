import test from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluate, evaluateValue, formatCalcValue, type CalcDisplayMode } from './expr';

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
  close('sin(30°)', 0.5, { angle: 'deg' });
  close('sin(30 deg)', 0.5, { angle: 'deg' });
  close('cos(60°)', 0.5, { angle: 'deg' });
  close('tan(45 deg)', 1, { angle: 'deg' });
  close('sin(2 * 15°)', 0.5, { angle: 'deg' });
  close('sin(-30°)', -0.5, { angle: 'deg' });
  close('sin(30°)', 0.5, { angle: 'rad' });
  close('sin(pi/6)', 0.5, { angle: 'rad' });
  close('asin(0.5)', 30, { angle: 'deg' });
  close('4²', 16);
  close('ans*2', 10, { vars: { ans: 5 } });
});

test('evaluate rejects junk and unsafe input', () => {
  for (const bad of ['', '2+', '(1', 'foo(2)', 'alert(1)', '1/0', 'sqrt(-1)', '2,3', 'atan2 1', 'constructor', 'toString']) {
    assert.ok('error' in evaluate(bad), `${bad} should fail`);
  }
  assert.equal(evaluateValue('  '), null);
  assert.equal(evaluateValue('sqrt(4)'), 2);
});

test('tokenizer splits function+number while preserving known alphanumeric ids', () => {
  close('sin30', Math.sin(30));
  close('SIN30', 0.5, { angle: 'deg' });
  close('sin30°', 0.5);
  close('sin30deg', 0.5);
  close('cos60', 0.5, { angle: 'deg' });
  close('tan45', 1, { angle: 'deg' });
  close('sqrt2', Math.SQRT2);
  close('2sqrt2', 2 * Math.SQRT2);
  close('ln2', Math.LN2);
  close('cbrt8', 2);
  close('log10(100)', 2);
  close('log100', 2);
  close('log2(8)', 3);
  close('atan2(1, 1)', 45, { angle: 'deg' });
  close('db10(100)', 20);
  close('db20', 20 * Math.log10(20));
  assert.ok('error' in evaluate('foo2(1)'));
});

test('postfix factorial and percentage', () => {
  close('0!', 1);
  close('1!', 1);
  close('5!', 120);
  close('(2+3)!', 120);
  close('5! + 3!', 126);
  close('-5!', -120);
  close('2^3!', 64);
  close('(2^3)!', 40320);
  const maxFact = evaluate('170!');
  assert.ok('value' in maxFact && Number.isFinite(maxFact.value));

  for (const [bad, msg] of [
    ['(-5)!', /whole number/i],
    ['2.5!', /whole number/i],
    ['171!', /Too big/i],
  ] as const) {
    const r = evaluate(bad);
    assert.ok('error' in r && msg.test(r.error), `${bad} -> ${JSON.stringify(r)}`);
  }

  close('50%', 0.5);
  close('200 * 15%', 30);
  close('50%%', 0.005);
  close('1 / 50%', 2);
});

test('expanded scientific, number theory, combinatorics, and engineering functions', () => {
  close('sec(60)', 2, { angle: 'deg' });
  close('sec(pi/3)', 2);
  close('csc(30)', 2, { angle: 'deg' });
  close('csc(pi/6)', 2);
  close('cot(45)', 1, { angle: 'deg' });
  close('cot(pi/4)', 1);
  close('asec(2)', 60, { angle: 'deg' });
  close('asec(2)', Math.PI / 3);
  close('acsc(2)', 30, { angle: 'deg' });
  close('acot(1)', 45, { angle: 'deg' });
  close('acot(0)', 90, { angle: 'deg' });
  close('arcsec(2)', 60, { angle: 'deg' });
  assert.ok('error' in evaluate('csc(0)'));
  assert.ok('error' in evaluate('asec(0.5)'));

  close('asinh(sinh(2))', 2);
  close('acosh(cosh(2))', 2);
  close('atanh(tanh(0.5))', 0.5);
  close('arcsinh(0)', 0);
  assert.ok('error' in evaluate('acosh(0.5)'));

  close('floor(3.9)', 3);
  close('floor(-3.1)', -4);
  close('ceil(3.1)', 4);
  close('round(3.5)', 4);
  close('sign(-7)', -1);
  close('sign(0)', 0);
  close('mod(10, 3)', 1);
  close('mod(-1, 5)', 4);
  close('mod(-6, 3)', 0);
  close('gcd(12, 18)', 6);
  close('gcd(-12, 18)', 6);
  close('lcm(4, 6)', 12);
  close('lcm(0, 6)', 0);
  assert.ok('error' in evaluate('gcd(2.5, 5)'));
  assert.ok('error' in evaluate('lcm(2.5, 5)'));

  close('ncr(5, 2)', 10);
  close('ncr(52, 5)', 2598960);
  close('ncr(5, 0)', 1);
  close('ncr(5, 6)', 0);
  close('npr(5, 2)', 20);
  close('npr(5, 5)', 120);
  close('npr(5, 6)', 0);
  assert.ok('error' in evaluate('ncr(-1, 2)'));
  assert.ok('error' in evaluate('npr(5, 1.5)'));

  close('hypot(3, 4)', 5);
  close('hypot(1, 2, 2)', 3);
  close('parallel(10, 10)', 5);
  close('parallel(30, 60)', 20);
  close('parallel(100, 100, 100)', 100 / 3);
  close('parallel(0, 10)', 0);
  assert.ok('error' in evaluate('parallel(10, -10)'));
  assert.ok('error' in evaluate('hypot(1)'));
  close('db(10)', 20);
  close('db(0.1)', -20);
  close('db10(100)', 20);
  close('db10(1)', 0);
  assert.ok('error' in evaluate('db(0)'));
});

test('constants and vars precedence', () => {
  close('phi', (1 + Math.sqrt(5)) / 2);
  close('φ', (1 + Math.sqrt(5)) / 2);
  close('g', 9.80665);
  close('c', 299792458);
  close('na', 6.02214076e23);
  close('kb', 1.380649e-23);
  close('qe', 1.602176634e-19);
  close('rgas', 8.314462618);

  const vars = { a: 2, b: 3, x: 4, ans: 10 };
  close('a*x^2 + b + ans', 45, { vars });
  close('c', 299792458, { vars });
  close('c', 42, { vars: { ...vars, c: 42 } });
  close('A + B', 5, { vars });
});

test('formatCalcValue formats dec, frac, sci, and eng modes', () => {
  const modes: CalcDisplayMode[] = ['dec', 'frac', 'sci', 'eng'];
  for (const m of modes) {
    assert.equal(formatCalcValue(NaN, m), 'Error');
    assert.equal(formatCalcValue(Infinity, m), 'Error');
    assert.equal(formatCalcValue(-0, m), '0');
  }

  assert.equal(formatCalcValue(0.75, 'dec'), '0.75');
  assert.equal(formatCalcValue(0.1 + 0.2, 'dec'), '0.3');

  assert.equal(formatCalcValue(12345, 'sci'), '1.2345×10⁴');
  assert.equal(formatCalcValue(0.001, 'sci'), '1×10⁻³');
  assert.equal(formatCalcValue(-0.00045, 'sci'), '-4.5×10⁻⁴');
  assert.equal(formatCalcValue(6.02214076e23, 'sci'), '6.02214076×10²³');

  assert.equal(formatCalcValue(12000, 'eng'), '12×10³ (k)');
  assert.equal(formatCalcValue(12345, 'eng'), '12.345×10³ (k)');
  assert.equal(formatCalcValue(0.00045, 'eng'), '450×10⁻⁶ (µ)');
  assert.equal(formatCalcValue(1e-12, 'eng'), '1×10⁻¹² (p)');
  assert.equal(formatCalcValue(1e12, 'eng'), '1×10¹² (T)');
  assert.equal(formatCalcValue(5, 'eng'), '5×10⁰');
  assert.equal(formatCalcValue(6.02214076e23, 'eng'), '602.214076×10²¹');

  assert.equal(formatCalcValue(0.75, 'frac'), '3/4');
  assert.equal(formatCalcValue(-7 / 12, 'frac'), '-7/12');
  assert.equal(formatCalcValue(5, 'frac'), '5');
  assert.equal(formatCalcValue(0.0001, 'frac'), '1/10000');
  assert.equal(formatCalcValue((3 * Math.PI) / 4, 'frac'), '3π/4');
  assert.equal(formatCalcValue(Math.PI / 2, 'frac'), 'π/2');
  assert.equal(formatCalcValue(-Math.PI / 2, 'frac'), '-π/2');
  assert.equal(formatCalcValue(2 * Math.PI, 'frac'), '2π');
  assert.equal(formatCalcValue(Math.PI, 'frac'), 'π');
  assert.equal(formatCalcValue(-Math.PI, 'frac'), '-π');
  assert.equal(formatCalcValue(Math.SQRT2, 'frac'), formatCalcValue(Math.SQRT2, 'dec'));
  assert.equal(formatCalcValue(1.602176634e-19, 'frac'), formatCalcValue(1.602176634e-19, 'dec'));
});
