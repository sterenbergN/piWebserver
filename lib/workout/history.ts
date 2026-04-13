type WorkoutHistoryItem = Record<string, any>;

export function isCardioHistoryItem(entry: WorkoutHistoryItem) {
  return entry?.type?.name === 'Cardio';
}

export function removeCardioHistoryEntries<T extends { history: WorkoutHistoryItem[] }>(data: T): {
  changed: boolean;
  data: T;
} {
  const filteredHistory = data.history.filter((entry) => !isCardioHistoryItem(entry));
  return {
    changed: filteredHistory.length !== data.history.length,
    data: {
      ...data,
      history: filteredHistory,
    },
  };
}
