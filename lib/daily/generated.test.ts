import test from 'node:test';
import { strict as assert } from 'node:assert';
import { GENERATORS, generatedQuestion, isGeneratedId, newGeneratedId } from './generated';
import { gradeQuestion, isPartCorrect } from './grade';
import { validateDay } from './validate';
import type { Answer, PartResponse } from './types';

function rightAnswer(a: Answer): PartResponse {
  switch (a.type) {
    case 'numeric': return { type: 'numeric', value: a.value };
    case 'choice': return { type: 'choice', option: a.correct };
    case 'multi': return { type: 'multi', options: a.correct };
    case 'range': return { type: 'range', min: a.min, max: a.max };
    case 'coefficients': return { type: 'coefficients', numerator: a.numerator, denominator: a.denominator };
    case 'order': return { type: 'order', items: a.items };
  }
}

test('every generator makes valid, gradeable questions whose slips never pass', () => {
  for (const gen of GENERATORS) {
    for (let seed = 1; seed <= 40; seed++) {
      const id = `gen-${gen.key}-${seed.toString(36)}`;
      const made = generatedQuestion(id)!;
      assert.ok(made, id);
      const { day, errors } = validateDay({ date: '2026-10-21', core: made.question, bonus: [], formulas: made.formulas });
      assert.deepEqual(errors, [], id);
      assert.ok(day, id);
      const q = day!.core;
      const responses = Object.fromEntries(q.parts.map((p) => [p.id, rightAnswer(p.answer)]));
      assert.equal(gradeQuestion(q, responses).status, 'solved', id);
      for (const part of q.parts) {
        if (part.answer.type === 'numeric') assert.ok(Number.isFinite(part.answer.value), `${id}/${part.id} answer`);
        for (const m of part.mistakes ?? []) {
          if (m.value === undefined) continue;
          assert.equal(isPartCorrect(part.answer, { type: 'numeric', value: m.value }), false, `${id}/${part.id}: slip ${m.value} passes as right`);
        }
      }
      assert.ok(!q.solution.includes('NaN') && !q.prompt.includes('NaN') && !q.solution.includes('undefined'), id);
    }
  }
});

test('generated ids rebuild the same question; other ids are not generated', () => {
  const id = newGeneratedId('beam-reaction', () => 0.42);
  assert.ok(isGeneratedId(id));
  assert.deepEqual(generatedQuestion(id), generatedQuestion(id));
  assert.equal(generatedQuestion('gen-nope-abc'), null);
  assert.equal(isGeneratedId('2026-10-21-beam'), false);
});
