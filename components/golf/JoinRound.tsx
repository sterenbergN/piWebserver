'use client';

import { useEffect, useState } from 'react';
import type { Round } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import { shortDate } from './ui';

/** Opened from a friend's join link: pick which name on their card is you. */
export default function JoinRound({ golf, go, roundId, code }: ScreenProps & { roundId: string; code: string }) {
  const [round, setRound] = useState<Round | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (golf.mode !== 'account') return;
    golf.peekRound(roundId, code)
      .then(({ round, member }) => (member ? go(`round/${round.id}`, true) : setRound(round)))
      .catch((e) => setError((e as Error).message));
    // Once, for this link.
  }, [golf.mode, roundId, code]);

  const join = async (playerId: string | null) => {
    setBusy(true);
    try {
      await golf.joinRound(roundId, code, playerId);
      go(`round/${roundId}`, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="golf-screen animate-fade-in">
      <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
      <h1>Join a round</h1>
      {golf.mode !== 'account' && (
        <div className="golf-banner">
          <span>Sign in to join, so the round counts in your stats.</span>
          <button type="button" className="golf-btn is-small is-primary" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in</button>
        </div>
      )}
      {error && <p className="golf-banner is-error">{error}</p>}
      {round && (
        <section className="golf-card">
          <h2>{round.courseName}</h2>
          <p className="golf-muted">{shortDate(round.date)} · {round.pars.length} holes</p>
          <p>Which one is you?</p>
          <div className="golf-pick-list">
            {round.players.map((p) => (
              <button key={p.id} type="button" className="golf-pick" disabled={busy || !!p.userId} onClick={() => join(p.id)}>
                <strong>{p.name}</strong>
                {p.userId && <small>Already joined</small>}
              </button>
            ))}
            <button type="button" className="golf-pick" disabled={busy} onClick={() => join(null)}>
              <strong>I&apos;m not on the card</strong><small>Add me as a new player</small>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
