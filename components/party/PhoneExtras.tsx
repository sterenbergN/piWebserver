'use client';

import { useEffect, useRef } from 'react';
import { REACTIONS } from '@/lib/party/avatars';

/** Emoji bar at the bottom of a phone: tap to throw a reaction onto the TV. */
export function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="party-reaction-bar" role="toolbar" aria-label="Send a reaction to the TV">
      {REACTIONS.map((e) => (
        <button key={e} aria-label={`React ${e}`} onClick={() => { navigator.vibrate?.(15); onReact(e); }}>{e}</button>
      ))}
    </div>
  );
}

// Canned answers for when your brain is empty (Jackbox's "safety quip").
const SAFETY_QUIPS = [
  'A suspiciously damp sock', 'My ex', 'Three raccoons in a trench coat', 'Taxes, but spicy', 'The Wi-Fi password',
  'A disappointed goose', 'Grandma’s secret recipe (it’s ketchup)', 'Crocs with socks', 'An emotional support cactus',
  'Whatever is in the office fridge', 'A motivational poster about naps', 'Nicolas Cage', 'Soup, but in a shoe',
  'Your browser history', 'A haunted Roomba', 'Mild disappointment', 'A llama with a lawyer', 'Gas station sushi',
];

export function safetyQuip() {
  return SAFETY_QUIPS[Math.floor(Math.random() * SAFETY_QUIPS.length)];
}

/** Buzz the phone when it's this player's turn to do something. */
export function useTurnBuzz(key: string | null, needsInput: boolean) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!key || key === last.current) return;
    const first = last.current === null;
    last.current = key;
    if (!first && needsInput) navigator.vibrate?.([60, 40, 60]);
  }, [key, needsInput]);
}
