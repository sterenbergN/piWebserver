'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { drawAttract, type AttractId } from '@/lib/games/attract';
import { GAMES, isGameId, type GameId } from '@/lib/games/registry';
import type { LeaderboardEntry } from './leaderboard';

// The arcade's front door: a wall of cabinets, each playing its own little demo.
// Point at one (or use the arrow keys) to see it up close; click or Enter to play.

type Cabinet = { id: AttractId; href: string; emoji: string; label: string; blurb: string; controls: string; tag?: string };

const PARTY: Cabinet = { id: 'party', href: '/party', emoji: '🎉', label: 'Party games', blurb: 'One screen, everyone on their phones: quips, trivia, karts and more.', controls: 'Get a group together', tag: 'Group' };
const CABINETS: Cabinet[] = [
  ...GAMES.map((g) => ({ id: g.id, href: `/game?game=${g.id}`, emoji: g.emoji, label: g.label, blurb: g.blurb, controls: g.controls, tag: g.kind === 'original' ? 'Made here' : undefined })),
  PARTY,
];
/** Older games kept their best score under their own name. */
const BEST_KEYS: Partial<Record<GameId, string>> = { snake: 'snakeBest', '2048': 'best2048' };

function readBest(id: GameId) {
  try {
    return Math.max(Number(localStorage.getItem(`arcadeBest:${id}`)) || 0, Number(localStorage.getItem(BEST_KEYS[id] ?? '')) || 0);
  } catch {
    return 0;
  }
}

/** A canvas that keeps playing a game's demo while it's on screen. */
function Attract({ id, fps }: { id: AttractId; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (now: number) => { if (w && h) drawAttract(id, ctx, still ? 3.2 : now / 1000, w, h); };
    const resize = new ResizeObserver(() => { size(); draw(performance.now()); });
    resize.observe(canvas);
    let visible = true;
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    seen.observe(canvas);
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden || now - last < 1000 / fps) return;
      last = now;
      draw(now);
    };
    if (!still) raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); resize.disconnect(); seen.disconnect(); };
  }, [id, fps]);
  return <canvas ref={ref} className="arc-canvas" aria-hidden />;
}

export default function ArcadeLobby() {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [bests, setBests] = useState<Partial<Record<GameId, number>>>({});
  const [lastPlayed, setLastPlayed] = useState<GameId | null>(null);
  const [boards, setBoards] = useState<Partial<Record<GameId, LeaderboardEntry[]>>>({});
  const gridRef = useRef<HTMLUListElement>(null);
  const cabinet = CABINETS[selected];

  // What this device remembers: its scores, and where you left off.
  useEffect(() => {
    setBests(Object.fromEntries(GAMES.map((g) => [g.id, readBest(g.id)])));
    let saved: string | null = null;
    try { saved = localStorage.getItem('arcadeGame'); } catch { /* ignore */ }
    if (isGameId(saved)) {
      setLastPlayed(saved);
      setSelected(CABINETS.findIndex((c) => c.id === saved));
    }
  }, []);

  // The top scores of the game you're looking at, loaded once each.
  const shownId = cabinet.id;
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!isGameId(shownId) || asked.current.has(shownId)) return;
    // Sweeping across the wall shouldn't ask for every board on the way.
    const t = setTimeout(() => {
      asked.current.add(shownId);
      fetch(`/api/leaderboard?game=${shownId}`).then((r) => r.json()).then((d) => {
        if (d.success) setBoards((b) => ({ ...b, [shownId]: d.leaderboard }));
      }).catch(() => { asked.current.delete(shownId); });
    }, 120);
    return () => clearTimeout(t);
  }, [shownId]);

  // Arrow keys walk the wall, Enter plays. Stays out of the way of open dialogs and inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || document.querySelector('[role="dialog"]') || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      const grid = gridRef.current;
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
      if (step) {
        e.preventDefault();
        setSelected((s) => {
          const next = s + step;
          return next < 0 || next >= CABINETS.length ? s : next;
        });
      } else if (e.key === 'Enter' && !target?.closest('a, button')) {
        e.preventDefault();
        router.push(CABINETS[selected].href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, selected]);

  const board = isGameId(cabinet.id) ? boards[cabinet.id] : undefined;
  const best = isGameId(cabinet.id) ? bests[cabinet.id] ?? 0 : 0;

  return (
    <div className="arc-lobby">
      <header className="arc-marquee">
        <h1>Noah&rsquo;s Arcade</h1>
        <p><span className="arc-blink">Insert coin</span> · free play today · {GAMES.length} cabinets</p>
      </header>

      <div className="arc-floor">
        {/* The cabinet you're looking at, up close. */}
        <section className="arc-feature" aria-live="polite" aria-label={`Selected: ${cabinet.label}`}>
          <div className="arc-screen">
            <Attract key={cabinet.id} id={cabinet.id} fps={45} />
            <span className="arc-scanlines" aria-hidden />
            {lastPlayed === cabinet.id && <span className="arc-resume">Last played</span>}
          </div>
          <div className="arc-feature-body">
            <h2><span aria-hidden>{cabinet.emoji}</span> {cabinet.label}</h2>
            <p>{cabinet.blurb}</p>
            <p className="arc-controls"><span aria-hidden>🕹️</span> {cabinet.controls}</p>
            {isGameId(cabinet.id) && (
              <div className="arc-scores">
                <div className="arc-score-mine">
                  <small>Your best</small>
                  <strong>{best ? best.toLocaleString() : '—'}</strong>
                </div>
                <ol aria-label="Top scores">
                  {board?.length ? board.slice(0, 3).map((entry, i) => (
                    <li key={`${entry.name}-${entry.date}`}>
                      <span>{i + 1}</span><span className="arc-score-name">{entry.name}</span><strong>{entry.score.toLocaleString()}</strong>
                    </li>
                  )) : <li className="arc-score-empty">{board ? 'No scores yet. Be the first.' : 'Loading scores…'}</li>}
                </ol>
              </div>
            )}
            <Link className="arc-start" href={cabinet.href}>▶ Press start</Link>
          </div>
        </section>

        {/* Every cabinet. */}
        <ul className="arc-wall" ref={gridRef}>
          {CABINETS.map((c, i) => {
            const score = isGameId(c.id) ? bests[c.id] : 0;
            return (
              <li key={c.id} className={c.id === 'party' ? 'is-party' : undefined}>
                <Link href={c.href} className={`arc-tile${i === selected ? ' is-selected' : ''}`} data-hue={c.id}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') setSelected(i); }} onFocus={() => setSelected(i)}>
                  <span className="arc-tile-screen"><Attract id={c.id} fps={20} /></span>
                  <span className="arc-tile-label">
                    <strong>{c.label}</strong>
                    <small>{score ? `Best ${score.toLocaleString()}` : c.tag ?? 'Classic'}</small>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="arc-hint" aria-hidden><kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd> to browse · <kbd>Enter</kbd> to play</p>
    </div>
  );
}
