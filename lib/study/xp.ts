// Study's share of the site-wide level, worked out from what's stored, like habits
// and chores. Retaking a test doesn't farm XP: each question counts once.

import type { PlanData } from './plan';
import type { PracticeData } from './practice';
import { isRight, type ProgressData, type TestsData } from './study';

export const STUDY_XP = {
  /** First time she answers a question. */
  answered: 1,
  /** The first time she gets a question right. */
  right: 3,
  /** Getting a missed question right on review. */
  reviewRight: 2,
  /** A missed question gone all the way through the schedule. */
  cleared: 10,
  pancake: 2,
  cleanPlate: 10,
  nightShift: 5,
  nightShiftSurvived: 15,
  gridSession: 5,
  patientRun: 15,
  puzzleSolved: 5,
};

export function studyXp(tests: TestsData, progress: ProgressData, plan: PlanData, practice: PracticeData) {
  const byId = new Map(tests.tests.flatMap((t) => t.questions.map((q) => [q.id, q] as const)));
  const answered = new Set<string>();
  const right = new Set<string>();
  const note = (id: string, answer: number[] | undefined) => {
    const question = byId.get(id);
    if (!question || !answer?.length) return;
    answered.add(id);
    if (isRight(question, answer)) right.add(id);
  };
  for (const attempt of progress.attempts) {
    if (!attempt.finishedAt) continue;
    for (const id of attempt.questionIds) note(id, attempt.answers[id]);
  }
  for (const [id, game] of Object.entries(progress.gameAnswers)) {
    note(id, game.answer);
    // Someone quizzing her marks a wrong answer without saying which it was.
    if (byId.has(id)) answered.add(id);
  }

  const misses = Object.values(progress.misses);
  const games = progress.games;
  return Math.round(
    answered.size * STUDY_XP.answered
    + right.size * STUDY_XP.right
    + misses.reduce((n, m) => n + m.rights, 0) * STUDY_XP.reviewRight
    + misses.filter((m) => m.state === 'cleared').length * STUDY_XP.cleared
    + Object.values(plan.eatenOn).reduce((n, v) => n + v, 0) * STUDY_XP.pancake
    + plan.cleanDays.length * STUDY_XP.cleanPlate
    + (games ? games.runs * STUDY_XP.nightShift + games.survived * STUDY_XP.nightShiftSurvived : 0)
    + practice.grids.reduce((n, g) => n + g.sessions.length, 0) * STUDY_XP.gridSession
    + practice.cases.reduce((n, c) => n + c.runs.length, 0) * STUDY_XP.patientRun
    + Object.values(practice.plays).filter((p) => p.solved).length * STUDY_XP.puzzleSolved,
  );
}
