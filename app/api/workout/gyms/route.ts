import { createOwnedCollectionHandlers } from '@/lib/workout/owned-collection';
import { ApiError } from '@/lib/workout/api';

// Repairs emoji that were saved mis-encoded (UTF-8 read as Latin-1) by an older version.
const EMOJI_MAP: Record<string, string> = {
  'ðŸ‹ï¸': '🏋️',
  'ðŸ’ª': '💪',
  'ðŸ ': '🏠',
  'ðŸ¢': '🏢',
  'ðŸŸï¸': '🏟️',
  'ðŸƒ': '🏃',
  'ðŸ”¥': '🔥',
  'âš¡': '⚡',
  'ðŸŽ¯': '🎯',
  'ðŸ†': '🏆',
  'ðŸ¦¾': '🦾',
  'ðŸ§—': '🧗',
  'ðŸ“': '📍',
};

function normalizeEmoji(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return '🏋️';
  return EMOJI_MAP[value] ?? value;
}

function normalizeGym(gym: any) {
  return {
    ...gym,
    name: typeof gym?.name === 'string' ? gym.name.trim() : '',
    emoji: normalizeEmoji(gym?.emoji),
    isPublic: gym?.isPublic === true,
    stations: Array.isArray(gym?.stations) ? gym.stations : [],
  };
}

export const { GET, POST, PUT, DELETE } = createOwnedCollectionHandlers({
  file: 'gyms.json',
  key: 'gyms',
  itemKey: 'gym',
  normalize: normalizeGym,
  buildNew: (payload) => ({
    name: payload.name,
    emoji: payload.emoji || '🏋️',
    stations: payload.stations || [],
  }),
  validate: (gym) => {
    if (!gym.name) throw new ApiError(400, 'Gym name is required');
  },
});
