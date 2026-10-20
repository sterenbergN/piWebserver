'use client';

import type { DateKey } from '@/lib/habits/dates';
import { isActive, type Habit, type HabitLog } from '@/lib/habits/habits';
import { plantState, PLANT_STAGES } from '@/lib/habits/stats';
import { habitColor } from './HabitCard';

// Plants are drawn from a few shapes: the stage decides how tall the stem is,
// how many leaves it has and whether it flowers or becomes a tree. The pot
// wears the habit's color; leaves droop and fade when it's wilting.

const BASE = 104; // soil line

function Leaf({ x, y, side, size = 1 }: { x: number; y: number; side: 1 | -1; size?: number }) {
  return (
    <ellipse className="pl-leaf" cx={x + side * 8 * size} cy={y} rx={8 * size} ry={3.6 * size}
      transform={`rotate(${side * -28} ${x} ${y})`} />
  );
}

function Flower({ x, y, r = 4 }: { x: number; y: number; r?: number }) {
  return (
    <g className="pl-flower">
      {[0, 72, 144, 216, 288].map((a) => (
        <circle key={a} cx={x + Math.cos((a * Math.PI) / 180) * r} cy={y + Math.sin((a * Math.PI) / 180) * r} r={r * 0.75} />
      ))}
      <circle className="pl-flower-heart" cx={x} cy={y} r={r * 0.55} />
    </g>
  );
}

/** Stem with alternating leaves, `height` px above the soil. */
function Stem({ height, leaves, x = 60, lean = 0 }: { height: number; leaves: number; x?: number; lean?: number }) {
  const top = BASE - height;
  return (
    <g>
      <path className="pl-stem" d={`M${x} ${BASE} Q ${x + lean} ${BASE - height / 2} ${x + lean * 1.5} ${top}`} />
      {Array.from({ length: leaves }, (_, i) => {
        const y = BASE - ((i + 1) / (leaves + 1)) * height;
        return <Leaf key={i} x={x + lean * ((BASE - y) / height)} y={y} side={i % 2 ? 1 : -1} size={0.7 + (i / Math.max(1, leaves)) * 0.5} />;
      })}
    </g>
  );
}

export function Plant({ stage, mood, watered, label }: { stage: number; mood: 'thriving' | 'okay' | 'wilting'; watered: boolean; label: string }) {
  return (
    <svg className={`pl is-${mood}`} viewBox="0 0 120 140" role="img" aria-label={label}>
      <g className="pl-growth">
        {stage === 0 && <ellipse className="pl-seed" cx="60" cy={BASE - 3} rx="5" ry="3.5" />}
        {stage === 1 && <Stem height={16} leaves={2} />}
        {stage === 2 && <Stem height={30} leaves={4} />}
        {stage === 3 && <Stem height={46} leaves={6} />}
        {(stage === 4 || stage === 5) && (
          <>
            <Stem height={40} leaves={4} x={50} lean={-8} />
            <Stem height={52} leaves={6} />
            <Stem height={40} leaves={4} x={70} lean={8} />
            <g className="pl-bush">
              <circle cx="44" cy="62" r="13" /><circle cx="60" cy="52" r="15" /><circle cx="76" cy="62" r="13" /><circle cx="60" cy="70" r="14" />
            </g>
            {stage === 5 && <><Flower x={46} y={56} /><Flower x={62} y={44} /><Flower x={76} y={58} /><Flower x={56} y={68} r={3.4} /></>}
          </>
        )}
        {stage === 6 && (
          <>
            <path className="pl-trunk" d={`M54 ${BASE} C 56 80, 52 64, 58 46 L 62 46 C 68 64, 64 80, 66 ${BASE} Z`} />
            <g className="pl-bush">
              <circle cx="40" cy="44" r="18" /><circle cx="60" cy="30" r="22" /><circle cx="80" cy="44" r="18" />
              <circle cx="50" cy="56" r="15" /><circle cx="70" cy="56" r="15" />
            </g>
            <Flower x={44} y={38} /><Flower x={62} y={22} /><Flower x={80} y={40} /><Flower x={54} y={52} r={3.4} /><Flower x={72} y={54} r={3.4} />
          </>
        )}
      </g>
      {watered && (
        <g className="pl-sparkle" aria-hidden>
          <path d="M100 18 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" />
          <path d="M18 40 l1.4 4 4 1.4 -4 1.4 -1.4 4 -1.4 -4 -4 -1.4 4 -1.4 z" />
        </g>
      )}
      <ellipse className="pl-soil" cx="60" cy={BASE + 1} rx="30" ry="5" />
      <path className="pl-pot" d={`M28 ${BASE} H92 L86 136 Q85 139 82 139 H38 Q35 139 34 136 Z`} />
      <rect className="pl-rim" x="25" y={BASE - 1} width="70" height="9" rx="3" />
    </svg>
  );
}

const MOOD_TEXT = { thriving: '🌞 Thriving', okay: '🌤 Doing okay', wilting: '🥀 Needs water' };

export default function Garden({ habits, log, today, frozen }: { habits: Habit[]; log: HabitLog; today: DateKey; frozen: Set<DateKey> }) {
  const plants = habits.filter(isActive).map((habit) => ({ habit, plant: plantState(habit, log, today, frozen) }));
  if (!plants.length) return <p className="hb-hint">Add a habit to plant your first seed.</p>;

  return (
    <>
      <p className="hb-hint hb-garden-intro">
        Each habit is a plant. Every check-in helps it grow; miss days and it starts to wilt, but it always recovers.
      </p>
      <ul className="hb-garden">
        {plants.map(({ habit, plant }) => {
          const next = PLANT_STAGES[plant.stage + 1];
          return (
            <li key={habit.id} className="hb-plant" style={habitColor(habit)}>
              <Plant stage={plant.stage} mood={plant.mood} watered={plant.wateredToday}
                label={`${habit.name}: ${plant.stageName}, ${MOOD_TEXT[plant.mood].slice(2).toLowerCase()}`} />
              <strong><span aria-hidden>{habit.emoji}</span> {habit.name}</strong>
              <span className="hb-plant-stage">{plant.stageName}</span>
              <span className="hb-plant-mood">{MOOD_TEXT[plant.mood]}</span>
              <div className="hb-plant-bar" aria-hidden>
                <span style={{ width: next ? `${Math.round(((plant.total - PLANT_STAGES[plant.stage].at) / (next.at - PLANT_STAGES[plant.stage].at)) * 100)}%` : '100%' }} />
              </div>
              <span className="hb-meta">
                {plant.total} check-in{plant.total === 1 ? '' : 's'}{next ? ` · ${plant.toNext} to ${next.name.toLowerCase()}` : ' · fully grown'}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
