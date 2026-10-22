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
import { GAMES, gameInfo, isGameId, type GameId } from '@/lib/games/registry';

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

const SHELVES = [
  { kind: 'original', title: 'Made here', note: 'Games you won’t find anywhere else' },
  { kind: 'classic', title: 'Classics', note: 'The old favourites' },
] as const;

/**
 * Arcade: the game being played, with a bar to switch to another. The game
 * comes from ?game=, or the last one played on this device.
 */
export default function ArcadeClient({ initialGame }: { initialGame?: string }) {
  const fromUrl = isGameId(initialGame);
  const [game, setGame] = useState<GameId>(fromUrl ? initialGame : 'snake');

  useEffect(() => {
    if (fromUrl) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem('arcadeGame'); } catch { /* ignore */ }
    if (isGameId(saved)) setGame(saved);
  }, [fromUrl]);

  // The game shelf, opened from the bar; Escape closes it.
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const choose = (id: GameId) => {
    setGame(id);
    setPicking(false);
    try { localStorage.setItem('arcadeGame', id); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set('game', id);
    window.history.replaceState(null, '', url);
  };

  const Game = COMPONENTS[game];
  const current = gameInfo(game);
  return (
    <div>
      <div className="arcade-bar">
        <span className="arcade-bar-emoji" aria-hidden>{current.emoji}</span>
        <span className="arcade-bar-text">
          <strong>{current.label}</strong>
          <small>{current.blurb}</small>
        </span>
        <button type="button" className="btn btn-secondary arcade-bar-switch" aria-expanded={picking} aria-controls="arcade-shelf" onClick={() => setPicking((v) => !v)}>
          {picking ? 'Close' : <>🎮 <span>All {GAMES.length} games</span></>}
        </button>
      </div>

      {picking && (
        <div id="arcade-shelf" className="arcade-shelf animate-fade-in">
          {SHELVES.map((shelf) => (
            <section key={shelf.kind} aria-label={shelf.title}>
              <h2 className="arcade-shelf-title">{shelf.title} <small>{shelf.note}</small></h2>
              <div className="arcade-cards">
                {GAMES.filter((g) => g.kind === shelf.kind).map((g) => (
                  <button key={g.id} type="button" className={`arcade-card${game === g.id ? ' is-active' : ''}`} aria-current={game === g.id} onClick={() => choose(g.id)}>
                    <span className="arcade-card-emoji" aria-hidden>{g.emoji}</span>
                    <strong>{g.label}</strong>
                    <small>{g.blurb}</small>
                    {game === g.id && <span className="arcade-card-tag">Playing</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Game key={game} />
    </div>
  );
}
