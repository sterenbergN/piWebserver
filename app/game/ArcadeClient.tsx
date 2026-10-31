'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import ArcadeLobby from '@/components/games/ArcadeLobby';
import SnakeGame from '@/components/games/SnakeGame';
import Game2048 from '@/components/games/Game2048';
import BreakoutGame from '@/components/games/BreakoutGame';
import BlocksGame from '@/components/games/BlocksGame';
import FlapGame from '@/components/games/FlapGame';
import SetpointGame from '@/components/games/SetpointGame';
import ChainGame from '@/components/games/ChainGame';
import MergeSnakeGame from '@/components/games/MergeSnakeGame';
import { GAMES, isGameId, type GameId } from '@/lib/games/registry';

const COMPONENTS: Record<GameId, () => React.ReactElement> = {
  snake: SnakeGame,
  '2048': Game2048,
  breakout: BreakoutGame,
  blocks: BlocksGame,
  flap: FlapGame,
  setpoint: SetpointGame,
  chain: ChainGame,
  merge: MergeSnakeGame,
};

/**
 * Arcade: ?game= is the game being played, with a strip to hop to another; no
 * game is the lobby. Each is its own URL, so the back button returns to the lobby.
 */
export default function ArcadeClient({ initialGame }: { initialGame?: string }) {
  if (!isGameId(initialGame)) return <ArcadeLobby />;
  return <Playing game={initialGame} />;
}

function Playing({ game }: { game: GameId }) {
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem('arcadeGame', game); } catch { /* ignore */ }
    strip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    // Game pads need the bottom of the phone screen, so the site's dock steps aside.
    document.body.classList.add('arcade-playing');
    return () => document.body.classList.remove('arcade-playing');
  }, [game]);

  const Game = COMPONENTS[game];
  return (
    <div>
      <nav className="arc-playbar" aria-label="Arcade">
        <Link href="/game" className="arc-playbar-back"><span aria-hidden>◀</span> Lobby</Link>
        <div className="arc-playbar-strip" ref={strip}>
          {GAMES.map((g) => (
            <Link key={g.id} href={`/game?game=${g.id}`} aria-current={g.id === game ? 'page' : undefined} title={g.label}>
              <span aria-hidden>{g.emoji}</span><span>{g.label}</span>
            </Link>
          ))}
        </div>
      </nav>
      <Game key={game} />
    </div>
  );
}
