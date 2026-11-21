import type { CSSProperties } from 'react';

/** A steady colour per area name, so an area looks the same in every section. */
export function areaColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 58% 55%)`;
}

export const chipStyle = (name: string) => ({ '--chip': areaColor(name) }) as CSSProperties;

export default function AreaChip({ name, on, count, onClick }: { name: string; on?: boolean; count?: number; onClick?: () => void }) {
  if (!onClick) return <span className="sh-chip static" style={chipStyle(name)}>{name}</span>;
  return (
    <button type="button" className={`sh-chip${on ? ' on' : ''}`} style={chipStyle(name)} onClick={onClick} aria-pressed={!!on}>
      {name}{count !== undefined && <i>{count}</i>}
    </button>
  );
}
