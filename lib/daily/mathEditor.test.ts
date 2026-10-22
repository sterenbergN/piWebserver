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
