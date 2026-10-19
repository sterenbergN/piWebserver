'use client';

import { useEffect, useState } from 'react';
import SnakeGame from '@/components/games/SnakeGame';
import Game2048 from '@/components/games/Game2048';

const GAMES = [
  { id: 'snake', label: '🐍 Snake' },
  { id: '2048', label: '🔢 2048' },
] as const;
type GameId = (typeof GAMES)[number]['id'];
const isGameId = (g: string | null | undefined): g is GameId => GAMES.some((x) => x.id === g);

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

  const choose = (id: GameId) => {
    setGame(id);
    try { localStorage.setItem('arcadeGame', id); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set('game', id);
    window.history.replaceState(null, '', url);
  };

  return (
    <div>
      <div role="tablist" aria-label="Games" style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
        {GAMES.map((g) => (
          <button key={g.id} role="tab" aria-selected={game === g.id} className={game === g.id ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => choose(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      {game === 'snake' ? <SnakeGame /> : <Game2048 />}
    </div>
  );
}
