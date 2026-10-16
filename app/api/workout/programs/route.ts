import { createOwnedCollectionHandlers } from '@/lib/workout/owned-collection';
import { ApiError } from '@/lib/workout/api';

// Programs: an ordered rotation of workout days (see lib/workout/programs.ts).

function normalizeProgram(program: any) {
  const weeks = Math.round(Number(program?.deloadEveryWeeks));
  return {
    ...program,
    name: typeof program?.name === 'string' ? program.name.trim().slice(0, 120) : '',
    days: Array.isArray(program?.days)
      ? program.days
          .filter((day: any) => day && typeof day.typeId === 'string' && day.typeId)
          .slice(0, 14)
          .map((day: any) => ({
            typeId: day.typeId.slice(0, 80),
            name: typeof day.name === 'string' && day.name.trim() ? day.name.trim().slice(0, 80) : undefined,
            lifts: Number.isFinite(Number(day.lifts)) ? Math.min(12, Math.max(1, Math.round(Number(day.lifts)))) : undefined,
          }))
      : [],
    deloadEveryWeeks: Number.isFinite(weeks) && weeks >= 2 && weeks <= 16 ? weeks : undefined,
    gymId: typeof program?.gymId === 'string' && program.gymId ? program.gymId.slice(0, 80) : undefined,
    isPublic: program?.isPublic === true,
  };
}

export const { GET, POST, PUT, DELETE } = createOwnedCollectionHandlers({
  file: 'programs.json',
  key: 'programs',
  itemKey: 'program',
  normalize: normalizeProgram,
  buildNew: (payload) => ({ name: payload.name, days: payload.days, deloadEveryWeeks: payload.deloadEveryWeeks, gymId: payload.gymId }),
  validate: (program) => {
    if (!program.name) throw new ApiError(400, 'Give the program a name');
    if (program.days.length === 0) throw new ApiError(400, 'Add at least one day');
  },
});
