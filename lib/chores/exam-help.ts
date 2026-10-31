// Exam-week help: with her say-so, chores assigned to the person studying move to
// someone else in the household until the exam, where everyone can see it, and go
// back afterward. Pure; the server keeps it next to the household's chores.

import type { DateKey } from '../habits/dates';
import type { ChoresData } from './chores';

export type ExamHelp = {
  /** The account studying. */
  by: string;
  title: string;
  /** The exam's date; help ends once it's past. */
  until: DateKey;
  /** What moved, to put back. `to` is null when it went to "anyone". */
  moved: { choreId: string; to: string | null }[];
};

/** Move the person's chores due by `until` to the only other member, or to "anyone" if there are several. */
export function startHelp(data: ChoresData, by: string, members: string[], title: string, until: DateKey): ExamHelp {
  const others = members.filter((m) => m !== by);
  const to = others.length === 1 ? others[0] : null;
  const moved: ExamHelp['moved'] = [];
  for (const chore of data.chores) {
    if (chore.archivedOn || chore.assignee !== by || !chore.due || chore.due > until) continue;
    chore.assignee = to;
    moved.push({ choreId: chore.id, to });
  }
  return { by, title, until, moved };
}

/** Put chores back, unless someone has reassigned one in the meantime. */
export function endHelp(data: ChoresData, help: ExamHelp) {
  for (const { choreId, to } of help.moved) {
    const chore = data.chores.find((c) => c.id === choreId);
    if (chore && !chore.archivedOn && chore.assignee === to) chore.assignee = help.by;
  }
}
