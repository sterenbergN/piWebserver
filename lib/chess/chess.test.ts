import test from 'node:test';
import { strict as assert } from 'node:assert';
import { PUZZLES } from './puzzles';
import {
  boardSquares, checkedKing, playerColor, replaysCleanly, retry, showAnswer, showNextMove, solutionSan, solvedCleanly, startPuzzle, targetsFrom, tryMove,
  withPromotion, type Puzzle,
} from './puzzle';
import { emptyChessProgress, normalizeChessProgress, pickPuzzle, recordResult, START_RATING, updatedRating } from './rating';

// Mate in 1 from a real Lichess puzzle: black's queen takes on h1, then Qf7 is mate.
const MATE_IN_1: Puzzle = {
  id: 'm1', fen: 'r4knr/ppp3b1/2np3p/7B/3PPp2/1QPK1P2/PP4q1/RNB4R b - - 1 14', moves: ['g2h1', 'b3f7'], rating: 800, themes: ['mateIn1'],
};
// Black plays a waiting move; white forks king and rook with Bf6+, then takes the rook.
const FORK: Puzzle = {
  id: 'fk', fen: '7r/7P/2p1p1K1/4k1B1/8/8/8/8 b - - 2 59', moves: ['c6c5', 'g5f6', 'e5d5', 'f6h8'], rating: 825, themes: ['fork'],
};
// White promotes on b8 and must pick a knight (the fork); used for the promotion picker.
const UNDERPROMOTE: Puzzle = {
  id: 'up', fen: '3k4/1P6/8/8/2q5/8/8/K7 b - - 0 1', moves: ['d8d7', 'b7b8n'], rating: 1200, themes: [],
};

test('bundled puzzles all replay legally and are short', () => {
  assert.ok(PUZZLES.length >= 10, 'some puzzles are bundled');
  const ids = new Set<string>();
  for (const p of PUZZLES) {
    assert.ok(replaysCleanly(p), `${p.id} replays`);
    assert.ok(p.moves.length >= 2 && p.moves.length <= 5, `${p.id} is short`);
    assert.ok(p.rating >= 600 && p.rating <= 2000, `${p.id} rating ${p.rating}`);
    assert.ok(!ids.has(p.id), `${p.id} is there once`);
    ids.add(p.id);
  }
});

test('replaysCleanly rejects broken puzzles', () => {
  assert.equal(replaysCleanly(MATE_IN_1), true);
  assert.equal(replaysCleanly({ ...MATE_IN_1, moves: ['g2h1', 'b3f8'] }), false);
  assert.equal(replaysCleanly({ ...MATE_IN_1, moves: ['g2h1'] }), false);
  assert.equal(replaysCleanly({ ...MATE_IN_1, fen: 'not a fen' }), false);
});

test('the setup move is played first and the board faces the player', () => {
  const state = startPuzzle(MATE_IN_1);
  assert.equal(playerColor(MATE_IN_1), 'w');
  assert.deepEqual(state.lastMove, ['g2', 'h1']);
  assert.equal(state.fen.split(' ')[1], 'w');
  const squares = boardSquares(state.fen, 'w');
  assert.equal(squares[0].square, 'a8');
  assert.equal(squares[63].square, 'h1');
  assert.equal(boardSquares(state.fen, 'b')[0].square, 'h1');
  assert.equal(squares.find((s) => s.square === 'h1')?.piece?.type, 'q');
});

test('a wrong move is “not quite”, and retry goes back', () => {
  let state = startPuzzle(MATE_IN_1);
  state = tryMove(state, 'b3b7');
  assert.equal(state.status, 'wrong');
  assert.equal(state.mistakes, 1);
  assert.deepEqual(targetsFrom(state, 'b3'), [], 'no moves while wrong');
  state = retry(state);
  assert.equal(state.status, 'playing');
  state = tryMove(state, 'b3f7');
  assert.equal(state.status, 'solved');
  assert.equal(solvedCleanly(state), false, 'a mistake means not clean');
});

test('an illegal move is ignored', () => {
  const state = startPuzzle(MATE_IN_1);
  assert.equal(tryMove(state, 'b3b1'), state);
  assert.equal(tryMove(state, 'zz'), state);
});

test('the opponent replies, and the last move solves it', () => {
  let state = startPuzzle(FORK);
  assert.ok(targetsFrom(state, 'g5').includes('f6'));
  state = tryMove(state, 'g5f6');
  assert.equal(state.status, 'playing');
  assert.equal(state.ply, 3);
  assert.deepEqual(state.lastMove, ['e5', 'd5'], 'reply played');
  assert.deepEqual(state.beforeReply?.lastMove, ['g5', 'f6'], 'the player’s move, to show before the reply');
  state = tryMove(state, 'f6h8');
  assert.equal(state.status, 'solved');
  assert.ok(solvedCleanly(state));
});

test('any mating move is right', () => {
  // A back-rank mate with two rooks: Ra8 is the stored answer, Rb8 mates just as well.
  const twoMates: Puzzle = { id: 'tm', fen: '6k1/2p2ppp/8/8/8/8/8/RR4K1 b - - 0 1', moves: ['c7c6', 'a1a8'], rating: 600, themes: [] };
  assert.ok(replaysCleanly(twoMates));
  assert.equal(tryMove(startPuzzle(twoMates), 'b1b7').status, 'wrong');
  const state = tryMove(startPuzzle(twoMates), 'b1b8');
  assert.equal(state.status, 'solved');
});

test('promotion uses the solution’s piece, else a queen', () => {
  const state = startPuzzle(UNDERPROMOTE);
  assert.equal(withPromotion(state, 'b7', 'b8'), 'b7b8n');
  assert.equal(withPromotion(state, 'a1', 'b1'), 'a1b1');
  const other = { ...state, puzzle: { ...UNDERPROMOTE, moves: ['d8d7', 'a1b1'] } };
  assert.equal(withPromotion(other, 'b7', 'b8'), 'b7b8q');
});

test('showing the answer plays it out and counts as peeking', () => {
  const next = showNextMove(startPuzzle(FORK));
  assert.equal(next.ply, 3);
  assert.equal(next.revealed, true);
  const all = showAnswer(startPuzzle(FORK));
  assert.equal(all.status, 'solved');
  assert.equal(solvedCleanly(all), false);
});

test('solutionSan reads the answer out', () => {
  assert.equal(solutionSan(MATE_IN_1), 'Qf7#');
  assert.equal(solutionSan(FORK), 'Bf6+ Kd5 Bxh8');
});

test('checkedKing finds the king in check', () => {
  const state = tryMove(startPuzzle(MATE_IN_1), 'b3f7');
  assert.equal(checkedKing(state.fen), 'f8');
  assert.equal(checkedKing(startPuzzle(MATE_IN_1).fen), null);
});

test('rating goes up on a clean solve and down otherwise, faster at first', () => {
  const up = updatedRating(1100, 0, 1100, true);
  const down = updatedRating(1100, 0, 1100, false);
  assert.equal(up, 1130);
  assert.equal(down, 1070);
  assert.ok(updatedRating(1100, 50, 1100, true) - 1100 < up - 1100);
  assert.ok(updatedRating(1100, 0, 1600, true) > updatedRating(1100, 0, 800, true), 'harder puzzles are worth more');
  assert.equal(updatedRating(400, 0, 2000, false), 400, 'never below the floor');
});

test('recordResult keeps solved and recent lists', () => {
  let p = emptyChessProgress();
  p = recordResult(p, { id: 'a', rating: 1000 }, true);
  p = recordResult(p, { id: 'b', rating: 1000 }, false);
  p = recordResult(p, { id: 'a', rating: 1000 }, true);
  assert.deepEqual(p.solved, ['a']);
  assert.deepEqual(p.recent, ['b', 'a']);
  assert.equal(p.games, 3);
});

test('normalizeChessProgress copes with junk', () => {
  assert.deepEqual(normalizeChessProgress(null), emptyChessProgress());
  const p = normalizeChessProgress({ rating: 99999, games: -3, solved: ['x', 'x', 5], recent: 'nope' });
  assert.equal(p.rating, 2800);
  assert.equal(p.games, 0);
  assert.deepEqual(p.solved, ['x']);
  assert.deepEqual(p.recent, []);
  assert.equal(emptyChessProgress().rating, START_RATING);
});

test('pickPuzzle stays near the rating and skips solved and recent ones', () => {
  const puzzles = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, rating: 600 + i * 50 }));
  const first = () => 0;
  const picked = pickPuzzle(puzzles, { rating: 1100, solved: [], recent: [] }, { random: first })!;
  assert.ok(Math.abs(picked.rating - 1050) <= 200, `picked ${picked.rating}`);
  const solved = puzzles.filter((p) => Math.abs(p.rating - 1050) <= 200).map((p) => p.id);
  const next = pickPuzzle(puzzles, { rating: 1100, solved, recent: [] }, { random: first })!;
  assert.ok(!solved.includes(next.id));
  assert.equal(pickPuzzle(puzzles, { rating: 1100, solved: [], recent: [] }, { exclude: [picked.id], random: first })!.id === picked.id, false);
  // All solved: it still hands one back rather than nothing.
  assert.ok(pickPuzzle(puzzles, { rating: 1100, solved: puzzles.map((p) => p.id), recent: [] }));
  assert.equal(pickPuzzle([], { rating: 1100, solved: [], recent: [] }), null);
});
