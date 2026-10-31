import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addTask, eat, noteClean } from './plan';
import { readPlan, updatePlan } from './store';

test('a plan change saves even when it answers false', async () => {
  const original = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-store-'));
  process.chdir(dir);
  try {
    const today = '2026-11-02';
    const task = await updatePlan('alice', (plan) => addTask(plan, { title: 'A', pancakes: 3 }, () => 't1', today));
    const cleaned = await updatePlan('alice', (plan) => {
      eat(plan, task.id, today);
      return noteClean(plan, today, 5, false); // Reviews still due, so not a clean plate.
    });
    assert.equal(cleaned, false);
    const saved = await readPlan('alice');
    assert.equal(saved.tasks[0].eaten, 1);
    assert.equal(saved.eatenOn[today], 1);
  } finally {
    process.chdir(original);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
