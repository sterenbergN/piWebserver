import test from 'node:test';
import { strict as assert } from 'node:assert';
import { MathEditor } from './mathEditor';
import { evaluate } from './expr';

const value = (ed: MathEditor) => {
  const r = evaluate(ed.toExpression());
  assert.ok('value' in r, `${ed.toExpression()}: ${'error' in r ? r.error : ''}`);
  return r.value;
};

test('a fraction takes the number before it as its numerator', () => {
  const ed = new MathEditor();
  ed.insertText('1+3');
  ed.insertFraction();
  ed.insertText('4');
  assert.equal(value(ed), 1.75);
});

test('fractions nest, and the cursor walks out of them', () => {
  const ed = new MathEditor();
  ed.insertFraction(); // empty: cursor in the numerator
  ed.insertText('1');
  ed.right(); // to the denominator
  ed.insertText('1+');
  ed.insertFraction();
  ed.insertText('1');
  ed.right();
  ed.insertText('2'); // 1 / (1 + 1/2)
  ed.right(); ed.right(); // out of both
  ed.insertText('×3');
  assert.ok(Math.abs(value(ed) - 2) < 1e-12);
});

test('roots, powers and a fraction under a root', () => {
  const ed = new MathEditor();
  ed.insertRoot(2);
  ed.insertText('9');
  ed.insertFraction();
  ed.insertText('4');
  ed.right(); ed.right(); // out of the fraction, out of the root
  ed.insertPower('2');
  assert.equal(value(ed), 2.25);

  const sinx = new MathEditor();
  sinx.insertText('sin(0)');
  sinx.insertFraction(); // takes sin(0) whole
  sinx.insertText('2');
  assert.equal(sinx.toExpression(), '((sin(0))/(2))');
});

test('backspace climbs out of boxes and removes empty ones', () => {
  const ed = new MathEditor();
  ed.insertText('2');
  ed.insertFraction();
  ed.backspace(); // empty denominator: up to the end of the numerator
  assert.equal(ed.cursor.row.length, 1);
  ed.backspace(); // removes the 2
  ed.backspace(); // fraction now empty: gone
  assert.equal(ed.isEmpty(), true);

  const root = new MathEditor();
  root.insertRoot(2);
  root.insertText('4');
  root.home();
  root.backspace(); // takes the root off, keeps the 4
  assert.equal(root.toExpression(), '4');
});

test('load brings back a past sum to edit, without changing the saved copy', () => {
  const ed = new MathEditor();
  ed.insertText('9');
  ed.insertFraction();
  ed.insertText('4');
  const saved = structuredClone(ed.root);
  ed.setText('2.25');
  ed.load(saved);
  ed.left(); ed.backspace(); ed.insertText('3'); // 9/4 → 9/3
  assert.equal(value(ed), 3);
  const check = new MathEditor();
  check.load(saved);
  assert.equal(check.toExpression(), '((9)/(4))', 'the saved sum is unchanged');
});

test('squaring a unary negative wraps it in parentheses while binary minus does not', () => {
  const ed = new MathEditor();
  ed.setText('-5');
  ed.insertPower('2');
  assert.equal(ed.toExpression(), '(-5)^(2)');
  assert.equal(value(ed), 25);

  const sub = new MathEditor();
  sub.setText('2-5');
  sub.insertPower('2');
  assert.equal(sub.toExpression(), '2-5^(2)');
  assert.equal(value(sub), -23);

  const nested = new MathEditor();
  nested.setText('2+-5');
  nested.insertPower('2');
  assert.equal(value(nested), 27);
});

test('fractions take postfix operators (!, %, °), scientific notation, constants, and digit-named functions', () => {
  const fact = new MathEditor();
  fact.insertText('5!');
  fact.insertFraction();
  fact.insertText('2');
  assert.equal(fact.toExpression(), '((5!)/(2))');
  assert.equal(value(fact), 60);

  const parenFact = new MathEditor();
  parenFact.insertText('(2+3)!');
  parenFact.insertFraction();
  parenFact.insertText('10');
  assert.equal(parenFact.toExpression(), '(((2+3)!)/(10))');
  assert.equal(value(parenFact), 12);

  const pct = new MathEditor();
  pct.insertText('50%');
  pct.insertFraction();
  pct.insertText('2');
  assert.equal(pct.toExpression(), '((50%)/(2))');
  assert.equal(value(pct), 0.25);

  const deg = new MathEditor();
  deg.insertText('60°');
  deg.insertFraction();
  deg.insertText('2');
  assert.equal(deg.toExpression(), '((60°)/(2))');

  const sci = new MathEditor();
  sci.insertText('1.5e-3');
  sci.insertFraction();
  sci.insertText('3');
  assert.equal(sci.toExpression(), '((1.5e-3)/(3))');
  assert.ok(Math.abs(value(sci) - 0.0005) < 1e-12);

  const eulerSub = new MathEditor();
  eulerSub.insertText('e-3');
  eulerSub.insertFraction();
  eulerSub.insertText('2');
  assert.equal(eulerSub.toExpression(), 'e-((3)/(2))');

  const logTen = new MathEditor();
  logTen.insertText('2*log10(100)');
  logTen.insertFraction();
  logTen.insertText('4');
  assert.equal(logTen.toExpression(), '2*((log10(100))/(4))');
  assert.equal(value(logTen), 1);

  const piFrac = new MathEditor();
  piFrac.insertText('2π');
  piFrac.insertFraction();
  piFrac.insertText('4');
  assert.equal(piFrac.toExpression(), '((2π)/(4))');
  assert.ok(Math.abs(value(piFrac) - Math.PI / 2) < 1e-12);
});

test('handles abs(, parallel(, ncr(, and variables a, b, x cleanly', () => {
  const fn = new MathEditor();
  fn.insertText('parallel(10,20)');
  fn.insertFraction();
  fn.insertText('2');
  assert.equal(fn.toExpression(), '((parallel(10,20))/(2))');
  assert.ok(Math.abs(value(fn) - 10 / 3) < 1e-12);

  const comb = new MathEditor();
  comb.insertText('ncr(5,2)');
  comb.insertFraction();
  comb.insertText('5');
  assert.equal(comb.toExpression(), '((ncr(5,2))/(5))');
  assert.equal(value(comb), 2);

  const negVar = new MathEditor();
  negVar.insertText('-x');
  negVar.insertPower('2');
  assert.equal(negVar.toExpression(), '(-x)^(2)');
  const r = evaluate(negVar.toExpression(), { vars: { a: 2, b: 3, x: 5 } });
  assert.ok('value' in r && r.value === 25);

  const poly = new MathEditor();
  poly.insertText('abs(-a)+b');
  poly.backspace();
  poly.backspace();
  poly.insertText('*x');
  assert.equal(poly.toExpression(), 'abs(-a)*x');
  const pr = evaluate(poly.toExpression(), { vars: { a: 3, b: 1, x: 4 } });
  assert.ok('value' in pr && pr.value === 12);
});
