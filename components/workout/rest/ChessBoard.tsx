'use client';

import { boardSquares } from '@/lib/chess/puzzle';

// A tap-to-move board: tap a piece, its moves show as dots, tap one. Pieces are
// the solid Unicode chess glyphs with U+FE0E, so iPhones draw them as text
// rather than turning the pawn into an emoji; CSS colours them white or black.

const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const NAME: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
// One string with the glyph: as a separate text node the selector may not stick to it.
const TEXT = String.fromCharCode(0xfe0e);

type Props = {
  fen: string;
  /** Whose side is at the bottom. */
  orientation: 'w' | 'b';
  lastMove: [string, string] | null;
  selected: string | null;
  targets: string[];
  check: string | null;
  disabled: boolean;
  onSquare: (square: string) => void;
};

export default function ChessBoard({ fen, orientation, lastMove, selected, targets, check, disabled, onSquare }: Props) {
  const squares = boardSquares(fen, orientation);
  return (
    <div className="rest-board" role="group"aria-label={`Chess board, ${orientation === 'w' ? 'white' : 'black'} at the bottom`}>
      {squares.map(({ square, piece, light }, i) => {
        const classes = ['rest-sq', light ? 'is-light' : 'is-dark'];
        if (lastMove?.includes(square)) classes.push('is-last');
        if (square === selected) classes.push('is-selected');
        if (square === check) classes.push('is-check');
        const target = targets.includes(square);
        if (target) classes.push(piece ? 'is-capture' : 'is-target');
        const file = i % 8 === 0;
        const rank = i >= 56;
        return (
          <button key={square} type="button" className={classes.join(' ')} disabled={disabled} onClick={() => onSquare(square)}
            aria-label={`${square}${piece ? `, ${piece.color === 'w' ? 'white' : 'black'} ${NAME[piece.type]}` : ''}${target ? ', move here' : ''}`}
            aria-pressed={square === selected}>
            {piece && <span className={`rest-piece is-${piece.color}`} aria-hidden>{GLYPH[piece.type] + TEXT}</span>}
            {file && <span className="rest-coord is-rank" aria-hidden>{square[1]}</span>}
            {rank && <span className="rest-coord is-file" aria-hidden>{square[0]}</span>}
          </button>
        );
      })}
    </div>
  );
}
