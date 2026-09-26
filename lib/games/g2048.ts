// 2048: slide tiles on a 4×4 board; equal tiles merge and add to the score.
// Pure functions (with an injectable random source) so the rules are testable.

export const SIZE = 4;
export const WIN_TILE = 2048;
export type Board = number[][]; // 0 = empty
export type Direction = 'up' | 'down' | 'left' | 'right';
export type G2048State = { board: Board; score: number; won: boolean; over: boolean };
type Rng = () => number;

export const emptyBoard = (): Board => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

/** Put a 2 (90%) or 4 (10%) on a random empty cell. */
export function spawnTile(board: Board, rng: Rng = Math.random): Board {
  const empty: [number, number][] = [];
  board.forEach((row, r) => row.forEach((v, c) => { if (v === 0) empty.push([r, c]); }));
  if (empty.length === 0) return board;
  const [r, c] = empty[Math.floor(rng() * empty.length)];
  const next = board.map((row) => [...row]);
  next[r][c] = rng() < 0.9 ? 2 : 4;
  return next;
}

export function createGame(rng: Rng = Math.random): G2048State {
  return { board: spawnTile(spawnTile(emptyBoard(), rng), rng), score: 0, won: false, over: false };
}

/** Slide one line toward index 0, merging each pair once. */
export function slideLine(line: number[]): { line: number[]; gained: number } {
  const tiles = line.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] * 2);
      gained += tiles[i] * 2;
      i++;
    } else {
      out.push(tiles[i]);
    }
  }
  while (out.length < line.length) out.push(0);
  return { line: out, gained };
}

function linesFor(board: Board, dir: Direction): number[][] {
  const idx = [...Array(SIZE).keys()];
  switch (dir) {
    case 'left': return board.map((row) => [...row]);
    case 'right': return board.map((row) => [...row].reverse());
    case 'up': return idx.map((c) => idx.map((r) => board[r][c]));
    case 'down': return idx.map((c) => idx.map((r) => board[SIZE - 1 - r][c]));
  }
}

function boardFrom(lines: number[][], dir: Direction): Board {
  const board = emptyBoard();
  lines.forEach((line, i) => line.forEach((v, j) => {
    if (dir === 'left') board[i][j] = v;
    else if (dir === 'right') board[i][SIZE - 1 - j] = v;
    else if (dir === 'up') board[j][i] = v;
    else board[SIZE - 1 - j][i] = v;
  }));
  return board;
}

export function canMove(board: Board): boolean {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) return true;
      if (c + 1 < SIZE && board[r][c] === board[r][c + 1]) return true;
      if (r + 1 < SIZE && board[r][c] === board[r + 1][c]) return true;
    }
  }
  return false;
}

/** Apply a move; returns the same state object when nothing moved. */
export function move(state: G2048State, dir: Direction, rng: Rng = Math.random): G2048State {
  if (state.over) return state;
  let gained = 0;
  const lines = linesFor(state.board, dir).map((line) => {
    const res = slideLine(line);
    gained += res.gained;
    return res.line;
  });
  const slid = boardFrom(lines, dir);
  const moved = slid.some((row, r) => row.some((v, c) => v !== state.board[r][c]));
  if (!moved) return state;
  const board = spawnTile(slid, rng);
  return {
    board,
    score: state.score + gained,
    won: state.won || board.some((row) => row.some((v) => v >= WIN_TILE)),
    over: !canMove(board),
  };
}

export const maxTile = (board: Board) => Math.max(...board.flat());

/** Highest score the leaderboard accepts (well beyond any realistic game). */
export const MAX_2048_SCORE = 4_000_000;
