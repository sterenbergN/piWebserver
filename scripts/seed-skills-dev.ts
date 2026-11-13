// Local test data for Skills, for the dev "tester" account (see seed-workout-dev.ts):
// one subject you're an expert in, one you're learning with weak and fading
// topics, and one you only want to learn, with a few months of answers.
//
//   npx tsx scripts/seed-skills-dev.ts            (refuses to touch existing data)
//   npx tsx scripts/seed-skills-dev.ts --force    (replaces .data/skills/dev-tester)
//
// Never run this on the Pi.

import fs from 'node:fs/promises';
import path from 'node:path';
import { addDays, localToday } from '../lib/habits/dates';
import { writeJsonAtomic } from '../lib/json-store';
import { addResource, addSubject, addTopic, editResource, importQuestions, rateTopics } from '../lib/skills/edit';
import { nextSchedule } from '../lib/skills/model';
import { emptyProgress, emptySkills, type Subject } from '../lib/skills/types';

const USER_ID = 'dev-tester';
const dir = path.join(process.cwd(), '.data', 'skills', USER_ID);
const today = localToday();
const now = new Date().toISOString();
let n = 0;
const makeId = () => `seed${(++n).toString(36)}`;

const card = (topic: string, front: string, back: string, difficulty = 2) => ({ type: 'card', topic, front, back, difficulty });
const choice = (topic: string, difficulty: number, title: string, prompt: string, options: string[], correct: number, solution: string) => ({
  type: 'graded', topic, difficulty, title, prompt, parts: [{ id: 'a', answer: { type: 'choice', options, correct } }], solution, sources: [{ title: 'Seed data' }],
});
const numeric = (topic: string, difficulty: number, title: string, prompt: string, value: number, unit: string, solution: string) => ({
  type: 'graded', topic, difficulty, title, prompt, parts: [{ id: 'a', answer: { type: 'numeric', value, unit } }], solution, sources: [{ title: 'Seed data' }],
});

async function main() {
  const exists = await fs.access(dir).then(() => true, () => false);
  if (exists && !process.argv.includes('--force')) {
    console.error(`${dir} already exists — re-run with --force to replace it.`);
    process.exit(1);
  }
  const data = emptySkills();
  const progress = emptyProgress();

  // ── PID tuning: an expert, tested recently ──
  const pid = addSubject(data, { name: 'PID tuning', icon: '🎛️', area: 'Controls', status: 'maintaining', target: 5, goal: 'Be the go-to person for loop tuning on site.' }, makeId, now);
  for (const [name, stage] of [['P, I and D actions', 1], ['Tuning rules', 2], ['Cascade control', 3], ['Feedforward', 3], ['Dead time', 4]] as const) addTopic(pid, { name, stage }, makeId, now);
  rateTopics(pid, Object.fromEntries(pid.topics.map((t) => [t.id, 4])), addDays(today, -120), now);
  importQuestions(pid, JSON.stringify({ questions: [
    numeric('Tuning rules', 3, 'Ziegler–Nichols PI gain', 'Ultimate gain $K_u = 4$. Ziegler–Nichols PI gain?', 1.8, '', '$K_c = 0.45 K_u = 1.8$'),
    choice('Cascade control', 4, 'Which loop is tuned first?', 'In a cascade, which loop do you tune first?', ['Outer', 'Inner', 'Either', 'Both together'], 1, 'The inner loop, with the outer in manual.'),
    card('Feedforward', 'When does feedforward help most?', 'When a measurable disturbance acts faster than feedback can correct it.', 3),
    card('Dead time', 'Why is dead time the hardest thing to control?', 'Nothing you do shows up until it passes, so gain has to come down.', 4),
    card('P, I and D actions', 'What does integral action remove?', 'Steady-state offset.', 1),
  ] }), {}, makeId, now);
  history(pid, 14, 0.95, 5);

  // ── Rocket propulsion: learning, mixed ──
  const rocket = addSubject(data, { name: 'Rocket propulsion', icon: '🚀', area: 'Aerospace', status: 'learning', target: 4, goal: 'Understand engines well enough to size one.', background: 'Mechanical engineer; thermo and fluids from school.', hoursPerWeek: 4 }, makeId, now);
  for (const [name, stage] of [['Rocket equation', 1], ['Thermochemistry', 2], ['Nozzle flow', 2], ['Turbopumps', 3], ['Combustion instability', 4]] as const) addTopic(rocket, { name, stage, core: name !== 'Combustion instability' }, makeId, now);
  const book = addResource(rocket, { title: 'Rocket Propulsion Elements', author: 'Sutton & Biblarz', kind: 'book', topicIds: rocket.topics.slice(0, 3).map((t) => t.id), hours: 60, progress: { done: 180, total: 760, unit: 'pages' } }, makeId, today, now);
  editResource(rocket, book, { status: 'doing' }, addDays(today, -40), now);
  addResource(rocket, { title: 'Build a model-motor thrust stand', kind: 'project', detail: 'Load cell + Arduino; plot thrust curves and compare to the datasheet.', topicIds: [rocket.topics[0].id, rocket.topics[2].id], hours: 15 }, makeId, today, now);
  importQuestions(rocket, JSON.stringify({ questions: [
    numeric('Rocket equation', 2, 'Delta-v', 'Isp 300 s, mass ratio $e$. Find $\\Delta v$.', 2942, 'm/s', '$\\Delta v = I_{sp} g_0 \\ln e = 2942$ m/s'),
    choice('Nozzle flow', 2, 'Where is Mach 1?', 'In a choked convergent–divergent nozzle, where is the flow at Mach 1?', ['Inlet', 'Throat', 'Exit', 'Nowhere'], 1, 'At the throat.'),
    card('Thermochemistry', 'Why run engines fuel-rich?', 'Lower molecular weight exhaust raises Isp, and it’s easier on the hardware.', 3),
    card('Turbopumps', 'What is cavitation in a turbopump inducer?', 'Local pressure falls below vapour pressure, forming bubbles that collapse and erode.', 3),
  ] }), {}, makeId, now);
  history(rocket, 6, 0.5, 2);

  // ── Thermodynamics: something to learn one day ──
  addSubject(data, { name: 'Thermodynamics', icon: '🔥', area: 'Mechanical', status: 'want', target: 4 }, makeId, now);

  await writeJsonAtomic(path.join(dir, 'skills.json'), data);
  await writeJsonAtomic(path.join(dir, 'progress.json'), progress);
  console.log(`Seeded ${data.subjects.length} subjects for ${USER_ID} in ${dir}`);

  /** `count` days of answers spread over the last few months, mostly right at `rate`. */
  function history(subject: Subject, count: number, rate: number, difficulty: number) {
    subject.items.forEach((item, i) => {
      for (let k = 0; k < count; k++) {
        const day = addDays(today, -((k * 9 + i * 3) % 150) - 1);
        const score = ((k * 7 + i) % 10) / 10 < rate ? 1 : 0;
        progress.attempts.push({ id: makeId(), subjectId: subject.id, topicId: item.topicId, itemId: item.id, day, at: `${day}T12:00:00.000Z`, score, difficulty });
      }
    });
    progress.attempts.sort((a, b) => a.at.localeCompare(b.at));
    for (const a of progress.attempts.filter((x) => x.subjectId === subject.id)) progress.schedule[a.itemId] = nextSchedule(progress.schedule[a.itemId], a.score, a.day);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
