// The cards someone has taken off their Today page, kept on their account.

export const TODAY_CARDS = ['question', 'study'] as const;
export type TodayCard = (typeof TODAY_CARDS)[number];

/** Only cards that exist, once each, whatever was stored or sent. */
export function readTodayHidden(value: unknown): TodayCard[] {
  if (!Array.isArray(value)) return [];
  return TODAY_CARDS.filter((card) => value.includes(card));
}
