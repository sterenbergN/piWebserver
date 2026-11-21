// The jobs Generate does, each of which can have its own model (Admin → AI).

export const AI_TASKS = {
  'meal-plan': 'Weekly meal plans',
  recipes: 'New recipes and recipe edits',
  'study-tests': 'Practice tests and flashcards',
  'study-practice': 'Grids, mock patients and differentials',
  syllabus: 'Dates from a syllabus',
  skills: 'Skills plans, schedules, questions and answers',
  notes: 'Recording summaries',
  wishlist: 'Wishlist gift ideas',
} as const;

export type AiTask = keyof typeof AI_TASKS;

export const AI_TASK_IDS = Object.keys(AI_TASKS) as AiTask[];

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AI_TASKS, value);
}
