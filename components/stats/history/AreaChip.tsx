'use client';

import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

/** The colour of any area outside the palette: neutral, so the eight coloured ones stand out. */
export const NEUTRAL = 'var(--muted)';

const Colors = createContext<Record<string, string>>({});

/** Shares one colour per area with every chart on the page (from areaPalette), so an area looks the same everywhere. */
export function AreaColors({ palette, children }: { palette: Record<string, string>; children: ReactNode }) {
  return <Colors.Provider value={palette}>{children}</Colors.Provider>;
}

export function useAreaColor() {
  const palette = useContext(Colors);
  return (name: string) => palette[name] ?? NEUTRAL;
}

export const chipStyle = (color: string) => ({ '--chip': color }) as CSSProperties;

export default function AreaChip({ name, on, count, onClick }: { name: string; on?: boolean; count?: number; onClick?: () => void }) {
  const color = useAreaColor();
  if (!onClick) return <span className="sh-chip static" style={chipStyle(color(name))}>{name}</span>;
  return (
    <button type="button" className={`sh-chip${on ? ' on' : ''}`} style={chipStyle(color(name))} onClick={onClick} aria-pressed={!!on}>
      {name}{count !== undefined && <i>{count}</i>}
    </button>
  );
}
