// Blocks: the falling-block puzzle. Pieces drop into a 10 × 20 well; full
// rows clear. Pure logic so the rules are testable; the page draws the state.

export const COLS = 10;
export const ROWS = 20;
export const MAX_BLOCKS_SCORE = 9_999_999;

/** Piece shapes in their spawn rotation (1 = filled). */
const SHAPES: Record<PieceType, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};
export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const rotateCw = (m: number[][]) => m[0].map((_, c) => m.map((row) => row[c]).reverse());
const ROTATIONS: Record<PieceType, number[][][]> = Object.fromEntries(PIECE_TYPES.map((t) => {
  const list = [SHAPES[t]];
  for (let i = 0; i < 3; i++) list.push(rotateCw(list[i]));
  return [t, list];
})) as Record<PieceType, number[][][]>;

/** Points for clearing 1–4 rows at once, times the level. */
export const LINE_POINTS = [0, 100, 300, 500, 800];
const LOCK_DELAY = 0.5;
const MAX_LOCK_RESETS = 15;

export type Piece = { type: PieceType; rot: number; x: number; y: number };
/** A cell holds the piece type that filled it, or null. */
export type Board = (PieceType | null)[][];
export type BlocksState = {
  board: Board;
  piece: Piece;
  queue: PieceType[];
  hold: PieceType | null;
  canHold: boolean;
  score: number;
  lines: number;
  level: number;
  fall: number;
  lock: number;
  lockResets: number;
  status: 'ready' | 'playing' | 'over';
};

export const emptyBoard = (): Board => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

/** The board cells a piece covers. */
export function cells(p: Piece): [number, number][] {
  const out: [number, number][] = [];
  ROTATIONS[p.type][p.rot].forEach((row, r) => row.forEach((v, c) => { if (v) out.push([p.x + c, p.y + r]); }));
  return out;
}

export function collides(board: Board, p: Piece) {
  return cells(p).some(([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x] !== null));
}

/** A shuffled bag of all seven, so droughts are short. */
function bag(rng: () => number) {
  const b = [...PIECE_TYPES];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const spawn = (type: PieceType): Piece => ({ type, rot: 0, x: type === 'O' ? 4 : 3, y: type === 'I' ? -1 : 0 });

/** Seconds per row of falling at this level. */
export const fallInterval = (level: number) => Math.max(0.05, 0.8 * 0.85 ** (level - 1));

export function createGame(rng: () => number = Math.random): BlocksState {
  const queue = [...bag(rng), ...bag(rng)];
  return {
    board: emptyBoard(), piece: spawn(queue.shift()!), queue, hold: null, canHold: true,
    score: 0, lines: 0, level: 1, fall: 0, lock: 0, lockResets: 0, status: 'ready',
  };
}

function nextPiece(s: BlocksState, rng: () => number): BlocksState {
  const queue = s.queue.length < 7 ? [...s.queue, ...bag(rng)] : [...s.queue];
  const piece = spawn(queue.shift()!);
  const status = collides(s.board, piece) ? 'over' : s.status;
  return { ...s, piece, queue, canHold: true, fall: 0, lock: 0, lockResets: 0, status };
}

/** Clear full rows; returns the new board and how many went. */
export function clearRows(board: Board) {
  const kept = board.filter((row) => row.some((c) => c === null));
  const cleared = ROWS - kept.length;
  return { board: [...Array.from({ length: cleared }, () => Array(COLS).fill(null) as (PieceType | null)[]), ...kept], cleared };
}

/** Fix the piece in place, clear rows, score them and bring in the next piece. */
function lockPiece(s: BlocksState, rng: () => number): BlocksState {
  const board = s.board.map((row) => [...row]);
  let above = false;
  for (const [x, y] of cells(s.piece)) {
    if (y < 0) above = true;
    else board[y][x] = s.piece.type;
  }
  if (above) return { ...s, board, status: 'over' };
  const { board: after, cleared } = clearRows(board);
  const lines = s.lines + cleared;
  return nextPiece({
    ...s, board: after, lines,
    score: s.score + LINE_POINTS[cleared] * s.level,
    level: 1 + Math.floor(lines / 10),
  }, rng);
}

const grounded = (s: BlocksState) => collides(s.board, { ...s.piece, y: s.piece.y + 1 });

/** After a successful move or turn on the ground, the lock wait starts over (a few times). */
const moved = (s: BlocksState, piece: Piece): BlocksState => {
  const next = { ...s, piece, status: 'playing' as const };
  if (grounded(s) && s.lockResets < MAX_LOCK_RESETS) return { ...next, lock: 0, lockResets: s.lockResets + 1 };
  return next;
};

export function shift(s: BlocksState, dx: number): BlocksState {
  if (s.status === 'over') return s;
  const piece = { ...s.piece, x: s.piece.x + dx };
  return collides(s.board, piece) ? s : moved(s, piece);
}

/** Turn, nudging sideways (or up, for a stuck I) if the turn would overlap something. */
export function rotate(s: BlocksState, dir: 1 | -1 = 1): BlocksState {
  if (s.status === 'over' || s.piece.type === 'O') return s;
  const rot = (s.piece.rot + dir + 4) % 4;
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]) {
    const piece = { ...s.piece, rot, x: s.piece.x + dx, y: s.piece.y + dy };
    if (!collides(s.board, piece)) return moved(s, piece);
  }
  return s;
}

/** Drop one row now (1 point); locks if it can't. */
export function softDrop(s: BlocksState, rng: () => number = Math.random): BlocksState {
  if (s.status === 'over') return s;
  if (grounded(s)) return lockPiece({ ...s, status: 'playing' }, rng);
  return { ...s, piece: { ...s.piece, y: s.piece.y + 1 }, score: s.score + 1, fall: 0, status: 'playing' };
}

/** Where the piece would land. */
export function ghostY(s: BlocksState) {
  let y = s.piece.y;
  while (!collides(s.board, { ...s.piece, y: y + 1 })) y++;
  return y;
}

/** Drop straight to the bottom (2 points a row) and lock. */
export function hardDrop(s: BlocksState, rng: () => number = Math.random): BlocksState {
  if (s.status === 'over') return s;
  const y = ghostY(s);
  return lockPiece({ ...s, piece: { ...s.piece, y }, score: s.score + 2 * (y - s.piece.y), status: 'playing' }, rng);
}

/** Swap the piece with the held one (once per piece). */
export function holdPiece(s: BlocksState, rng: () => number = Math.random): BlocksState {
  if (s.status === 'over' || !s.canHold) return s;
  if (s.hold) {
    const piece = spawn(s.hold);
    return { ...s, piece, hold: s.piece.type, canHold: false, fall: 0, lock: 0, lockResets: 0, status: collides(s.board, piece) ? 'over' : 'playing' };
  }
  return { ...nextPiece({ ...s, hold: s.piece.type, status: 'playing' }, rng), canHold: false };
}

/** Gravity and the lock wait, for `dt` seconds. */
export function tick(s: BlocksState, dt: number, rng: () => number = Math.random): BlocksState {
  if (s.status !== 'playing') return s;
  if (grounded(s)) {
    const lock = s.lock + dt;
    return lock >= LOCK_DELAY ? lockPiece(s, rng) : { ...s, lock };
  }
  let fall = s.fall + dt;
  let piece = s.piece;
  const every = fallInterval(s.level);
  while (fall >= every && !collides(s.board, { ...piece, y: piece.y + 1 })) {
    piece = { ...piece, y: piece.y + 1 };
    fall -= every;
  }
  return { ...s, piece, fall: Math.min(fall, every), lock: 0 };
}

/** A piece's cells in its spawn rotation, for the next/hold previews. */
export const previewCells = (type: PieceType) => cells({ type, rot: 0, x: 0, y: 0 });
