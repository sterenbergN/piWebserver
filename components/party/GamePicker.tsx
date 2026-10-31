'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { GAME_CATEGORIES, GAME_INFO, GameCategory, GameInfo, PLAYER_BUCKETS, PlayerBucket, fitsBucket, gameLabel, gamePlayersLabel, gamesForRoom } from '@/lib/party/catalog';
import type { GameType } from '@/lib/party/types';

const RECENT_KEY = 'partyRecentGames';
const MAX_RECENT = 3;

/** Remembers a hosted game so it can be offered first next time. */
export function rememberHostedGame(gameType: GameType) {
  try {
    const recent: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    localStorage.setItem(RECENT_KEY, JSON.stringify([gameType, ...recent.filter((g) => g !== gameType)].slice(0, MAX_RECENT)));
  } catch {
    // Storage unavailable: nothing to remember
  }
}

function GameTile({ game, disabled, onHost, onGuide }: { game: GameInfo; disabled: boolean; onHost: () => void; onGuide: () => void }) {
  return (
    <div className={`party-tile party-tile-${game.color === 'purple-lt' ? 'purple' : game.color}`}>
      <button type="button" className="party-tile-main" disabled={disabled} onClick={onHost}>
        <span className="party-tile-emoji">{game.emoji}</span>
        <span className="party-tile-name">{game.name}</span>
        <span className="party-tile-blurb">{game.blurb}</span>
        <span className="party-tile-meta">👥 {gamePlayersLabel(game)}{game.tvOnly ? ' · 📺 TV' : ''}</span>
      </button>
      <button type="button" className="party-tile-help" onClick={onGuide} aria-label={`How to play ${game.name}`}>?</button>
    </div>
  );
}

/** Filterable game browser for the host tab. */
export default function GamePicker({
  phonesOnly,
  loading,
  onHost,
  onGuide,
}: {
  phonesOnly: boolean;
  loading: boolean;
  onHost: (gameType: GameType) => void;
  onGuide: (gameType: GameType) => void;
}) {
  const [bucket, setBucket] = useState<PlayerBucket>('any');
  const [category, setCategory] = useState<GameCategory | 'all'>('all');
  const [recentIds, setRecentIds] = useState<GameType[]>([]);

  useEffect(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      setRecentIds(saved.filter((id): id is GameType => id in GAME_INFO));
    } catch {
      // Storage unavailable: no recents to show
    }
  }, []);

  const available = useMemo(() => gamesForRoom(phonesOnly), [phonesOnly]);
  const matches = useMemo(
    () => available.filter((g) => fitsBucket(g, bucket) && (category === 'all' || g.category === category)),
    [available, bucket, category],
  );
  const recent = recentIds.map((id) => GAME_INFO[id]).filter((g) => available.includes(g));
  const usedCategories = GAME_CATEGORIES.filter((c) => available.some((g) => g.category === c.id));

  const surprise = () => {
    if (matches.length) onHost(matches[Math.floor(Math.random() * matches.length)].id);
  };

  const tiles = (games: GameInfo[]) => (
    <div className="party-tile-grid">
      {games.map((g) => (
        <GameTile key={g.id} game={g} disabled={loading} onHost={() => onHost(g.id)} onGuide={() => onGuide(g.id)} />
      ))}
    </div>
  );

  return (
    <div>
      <div className="party-filter-row">
        <span className="party-filter-label">👥 Players</span>
        {PLAYER_BUCKETS.map((b) => (
          <button key={b.id} type="button" className="party-chip" aria-pressed={bucket === b.id} onClick={() => setBucket(b.id)}>{b.label}</button>
        ))}
      </div>
      <div className="party-filter-row">
        <button type="button" className="party-chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All games</button>
        {usedCategories.map((c) => (
          <button key={c.id} type="button" className="party-chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.emoji} {c.label}</button>
        ))}
      </div>

      {recent.length > 0 && category === 'all' && bucket === 'any' && (
        <div className="party-filter-row">
          <span className="party-filter-label">🔁 Again?</span>
          {recent.map((g) => (
            <button key={g.id} type="button" className="party-chip" disabled={loading} onClick={() => onHost(g.id)}>{gameLabel(g)}</button>
          ))}
        </div>
      )}

      <button type="button" className="party-surprise" disabled={loading || matches.length === 0} onClick={surprise}>
        🎲 Surprise me
      </button>

      {matches.length === 0 ? (
        <p className="party-picker-empty">No games fit that combination. Try another player count.</p>
      ) : category === 'all' ? (
        usedCategories.map((c) => {
          const games = matches.filter((g) => g.category === c.id);
          if (!games.length) return null;
          return (
            <section key={c.id} className="party-picker-section">
              <h3 className="party-picker-heading">{c.emoji} {c.label}</h3>
              {tiles(games)}
            </section>
          );
        })
      ) : (
        tiles(matches)
      )}
    </div>
  );
}

/** Compact "change game" control grouped by category, used in lobbies and after a game. */
export function GameSwitcher({
  current,
  playerCount,
  phonesOnly = false,
  onPick,
}: {
  current?: string;
  playerCount: number;
  phonesOnly?: boolean;
  onPick: (gameType: GameType) => void;
}) {
  const available = gamesForRoom(phonesOnly);
  return (
    <div className="party-switcher">
      {GAME_CATEGORIES.map((c) => {
        const games = available.filter((g) => g.category === c.id);
        if (!games.length) return null;
        return (
          <div key={c.id} className="party-switcher-group">
            <span className="party-filter-label">{c.emoji} {c.label}</span>
            <div className="party-switcher-games">
              {games.map((g) => {
                const active = g.id === current;
                const short = playerCount < g.minPlayers;
                return (
                  <button
                    key={g.id}
                    type="button"
                    className="party-chip"
                    aria-pressed={active}
                    disabled={active}
                    title={short ? `Needs at least ${g.minPlayers} players` : undefined}
                    onClick={() => onPick(g.id)}
                  >
                    {gameLabel(g)}{short ? ` (${g.minPlayers}+)` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
