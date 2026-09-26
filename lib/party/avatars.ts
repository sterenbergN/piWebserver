// Characters players pick when they join, and the reactions they can throw
// at the TV. Shared by the server (validation) and the pages.

export const AVATARS = [
  '🦊', '🐸', '🐙', '🦄', '🐼', '🐯', '🐵', '🦖',
  '👽', '🤖', '👻', '🎃', '🦩', '🐧', '🦉', '🐝',
  '🌮', '🍕', '🥑', '🍩', '🌵', '🍄', '🚀', '🎸',
] as const;

export const REACTIONS = ['😂', '🔥', '👏', '😱', '💀', '🤔', '😍', '🍅'] as const;

export const isAvatar = (v: unknown): v is string => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);
export const isReaction = (v: unknown): v is string => typeof v === 'string' && (REACTIONS as readonly string[]).includes(v);
