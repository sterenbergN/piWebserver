import data from './data/puzzles.json';
import type { Puzzle } from './puzzle';

// The bundled puzzles (from the Lichess puzzle database, CC0; rebuilt by
// scripts/chess-puzzles-from-dump.mjs). Only the server reads this file, so the
// browser never downloads the whole set.

export const PUZZLES = data as Puzzle[];

export const puzzleById = (id: unknown) => (typeof id === 'string' ? PUZZLES.find((p) => p.id === id) ?? null : null);
