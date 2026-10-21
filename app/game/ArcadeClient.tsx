'use client';

import { useEffect, useState } from 'react';
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

/** Arcade: pick a game (set by ?game=, or remembered on this device). */
export default function ArcadeClient({ initialGame }: { initialGame?: string }) {
  const fromUrl = isGameId(initialGame);
  const [game, setGame] = useState<GameId>(fromUrl ? initialGame : 'snake');

  useEffect(() => {
    if (fromUrl) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem('arcadeGame'); } catch { /* ignore */ }
    if (isGameId(saved)) setGame(saved);
  }, [fromUrl]);

  // Keep the chosen game's chip in view (the picker scrolls sideways on phones).
  useEffect(() => {
    document.querySelector('.arcade-pick.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [game]);

  const choose = (id: GameId) => {
    setGame(id);
    try { localStorage.setItem('arcadeGame', id); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set('game', id);
    window.history.replaceState(null, '', url);
  };

  const Game = COMPONENTS[game];
  return (
    <div>
      <div role="tablist" aria-label="Games" className="arcade-picker">
        {GAMES.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={game === g.id} className={`arcade-pick${game === g.id ? ' is-active' : ''}`} onClick={() => choose(g.id)} title={g.blurb}>
            <span className="arcade-pick-emoji" aria-hidden>{g.emoji}</span>
            <span className="arcade-pick-name">{g.label}</span>
            {g.kind === 'original' && <span className="arcade-pick-tag">new</span>}
          </button>
        ))}
      </div>
      <Game key={game} />
    </div>
  );
}
