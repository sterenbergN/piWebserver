'use client';

import { useEffect, useState } from 'react';
import SnakeGame from '@/components/games/SnakeGame';
import Game2048 from '@/components/games/Game2048';

const GAMES = [
  { id: 'snake', label: '🐍 Snake' },
  { id: '2048', label: '🔢 2048' },
] as const;
type GameId = (typeof GAMES)[number]['id'];

/** Arcade: pick a game (remembered on this device, or set by ?game=). */
export default function ArcadePage() {
  const [game, setGame] = useState<GameId>('snake');

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('game');
    let saved: string | null = null;
    try { saved = localStorage.getItem('arcadeGame'); } catch { /* ignore */ }
    const pick = [fromUrl, saved].find((g) => GAMES.some((x) => x.id === g));
    if (pick) setGame(pick as GameId);
  }, []);

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
