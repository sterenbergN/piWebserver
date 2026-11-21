import { Chess, type Square } from 'chess.js';

// One Lichess puzzle, stored the way the Lichess database stores them: `fen` is
// the position before the opponent's last move, and `moves` (UCI) starts with
// that move, which the board plays by itself. The player's moves are then every
// other one, each answered by the opponent's reply.

export type Puzzle = { id: string; fen: string; moves: string[]; rating: number; themes: string[] };

export type PuzzleStatus = 'playing' | 'wrong' | 'solved';

/** Where a puzzle has got to. Plain data, so it can be kept between rests. */
export type PuzzleState = {
  puzzle: Puzzle;
  fen: string;
  /** Index into puzzle.moves of the player's next move. */
  ply: number;
  lastMove: [string, string] | null;
  status: PuzzleStatus;
  /** Wrong moves so far (any one means it doesn't count as a clean solve). */
  mistakes: number;
  /** The answer was shown. */
  revealed: boolean;
  /** The position just after the player's move, before the reply (to show it for a moment). */
  beforeReply?: { fen: string; lastMove: [string, string] };
};

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function play(chess: Chess, uci: string) {
  if (!UCI.test(uci)) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

/** Every move legal in turn, from a valid start, with at least one move for the player. */
export function replaysCleanly(puzzle: Puzzle): boolean {
  if (!puzzle || typeof puzzle.fen !== 'string' || !Array.isArray(puzzle.moves) || puzzle.moves.length < 2) return false;
  let chess: Chess;
  try {
    chess = new Chess(puzzle.fen);
  } catch {
    return false;
  }
  return puzzle.moves.every((uci) => play(chess, uci));
}

/** The player's side: the opposite of whoever plays the setup move. */
export function playerColor(puzzle: Puzzle): 'w' | 'b' {
  return puzzle.fen.split(' ')[1] === 'w' ? 'b' : 'w';
}

/** The opponent's setup move played, waiting for the player. */
export function startPuzzle(puzzle: Puzzle): PuzzleState {
  const chess = new Chess(puzzle.fen);
  const setup = play(chess, puzzle.moves[0]);
  return {
    puzzle,
    fen: chess.fen(),
    ply: 1,
    lastMove: setup ? [setup.from, setup.to] : null,
    status: 'playing',
    mistakes: 0,
    revealed: false,
  };
}

/** Legal target squares for the piece on `from` (empty when it isn't the player's turn or piece). */
export function targetsFrom(state: PuzzleState, from: string): string[] {
  if (state.status !== 'playing') return [];
  const chess = new Chess(state.fen);
  return chess.moves({ square: from as Square, verbose: true }).map((m) => m.to);
}

/** A promotion needs a piece: the one the solution uses on that square, else a queen. */
export function withPromotion(state: PuzzleState, from: string, to: string): string {
  const chess = new Chess(state.fen);
  const move = chess.moves({ square: from as Square, verbose: true }).find((m) => m.to === to);
  if (!move?.promotion) return `${from}${to}`;
  const expected = state.puzzle.moves[state.ply];
  if (expected?.slice(0, 4) === `${from}${to}` && expected.length === 5) return expected;
  return `${from}${to}q`;
}

/**
 * The player tries `uci`. The expected move is right; so is any other move that
 * mates (as on Lichess). A right move is played with the opponent's reply; a
 * wrong one leaves the position as it was.
 */
export function tryMove(state: PuzzleState, uci: string): PuzzleState {
  if (state.status !== 'playing') return state;
  const chess = new Chess(state.fen);
  const moved = play(chess, uci);
  if (!moved) return state; // not even legal: ignore it, like a mis-tap
  const expected = state.puzzle.moves[state.ply];
  const right = uci === expected || chess.isCheckmate();
  if (!right) return { ...state, status: 'wrong', mistakes: state.mistakes + 1 };
  return advance(state, chess, [moved.from, moved.to], chess.isCheckmate());
}

function advance(state: PuzzleState, chess: Chess, lastMove: [string, string], mated: boolean): PuzzleState {
  let ply = state.ply + 1;
  let last = lastMove;
  let beforeReply: PuzzleState['beforeReply'];
  if (!mated && ply < state.puzzle.moves.length) {
    beforeReply = { fen: chess.fen(), lastMove };
    const reply = play(chess, state.puzzle.moves[ply]);
    if (reply) last = [reply.from, reply.to];
    ply++;
  }
  const solved = mated || ply >= state.puzzle.moves.length;
  return { ...state, fen: chess.fen(), ply, lastMove: last, status: solved ? 'solved' : 'playing', beforeReply };
}

/** Back to the position before the wrong move, to try again. */
export function retry(state: PuzzleState): PuzzleState {
  return state.status === 'wrong' ? { ...state, status: 'playing' } : state;
}

/** Play the next right move (and the reply) for them. Counts as having seen the answer. */
export function showNextMove(state: PuzzleState): PuzzleState {
  if (state.status === 'solved') return state;
  const chess = new Chess(state.fen);
  const moved = play(chess, state.puzzle.moves[state.ply]);
  if (!moved) return state;
  return { ...advance({ ...state, status: 'playing' }, chess, [moved.from, moved.to], false), revealed: true };
}

/** The whole solution played out. */
export function showAnswer(state: PuzzleState): PuzzleState {
  let next = state;
  for (let guard = 0; next.status !== 'solved' && guard < 20; guard++) {
    const after = showNextMove(next);
    if (after === next) break;
    next = after;
  }
  return { ...next, revealed: true };
}

/** The solution in algebraic notation, from the player's first move ("Qf7#", or "Bf6+ Kd5 Bxh8"). */
export function solutionSan(puzzle: Puzzle): string {
  const chess = new Chess(puzzle.fen);
  const sans: string[] = [];
  puzzle.moves.forEach((uci, i) => {
    const moved = play(chess, uci);
    if (moved && i > 0) sans.push(moved.san);
  });
  return sans.join(' ');
}

/** A clean solve: no wrong moves and no peeking. */
export const solvedCleanly = (state: PuzzleState) => state.status === 'solved' && !state.mistakes && !state.revealed;

export type BoardSquare = { square: string; piece: { type: string; color: 'w' | 'b' } | null; light: boolean };

/** The 64 squares in the order to draw them, from the player's side. */
export function boardSquares(fen: string, from: 'w' | 'b'): BoardSquare[] {
  const rows = new Chess(fen).board();
  const out: BoardSquare[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const rank = from === 'w' ? r : 7 - r;
      const file = from === 'w' ? c : 7 - c;
      const cell = rows[rank][file];
      const square = `${'abcdefgh'[file]}${8 - rank}`;
      out.push({ square, piece: cell ? { type: cell.type, color: cell.color } : null, light: (rank + file) % 2 === 0 });
    }
  }
  return out;
}

/** Is the side to move in check (for a red king square)? */
export function checkedKing(fen: string): string | null {
  const chess = new Chess(fen);
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of chess.board()) for (const cell of row) if (cell && cell.type === 'k' && cell.color === turn) return cell.square;
  return null;
}
