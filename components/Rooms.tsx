'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AttractId } from '@/lib/games/attract';
import { navGroups, orderRooms, pickSurprise, placesFor, type NavGroup, type NavItem } from './nav-links';
import type { NavInfo } from './nav-badges';
import { useFoundPlaces } from './useNavPins';
import './rooms.css';

// The site as a map of rooms, each named for what you'd be there to do and laid
// out like folders on a phone: everything on show, one tap away, with its name
// under it and more about it when you point at it. The Explore panel and the home
// page both draw it.

export type RoomContext = {
  signedIn: boolean;
  /** This account starts on PA Today, so its room leads. */
  studyFirst?: boolean;
  found: Set<string> | null;
  info?: NavInfo;
  /** Your pins, in the panel: the home page leaves pinning out. */
  pins?: string[];
  togglePin?: (href: string) => void;
  /** Choosing shortcuts: tapping an icon pins it instead of opening it. */
  editing?: boolean;
  current?: string;
  onFollow?: (href: string) => (e: React.MouseEvent) => void;
  /** Called when something in a room takes you to another page. */
  onLeave?: () => void;
  /** Better words for a page's line, like how many photos there are. */
  blurbs?: Record<string, string>;
};

const PinStar = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
  </svg>
);

const isLocked = (item: NavItem, ctx: RoomContext) => !!item.account && !ctx.signedIn;
const blurbOf = (item: NavItem, ctx: RoomContext) => ctx.blurbs?.[item.href] ?? item.blurb;

/** A page as a row with its line of text, for search results. */
export function Door({ item, ctx }: { item: NavItem; ctx: RoomContext }) {
  const pinned = !!ctx.pins?.includes(item.href);
  const badge = ctx.info?.badges[item.href];
  return (
    <li className="rm-door">
      <Link data-lc href={item.href} onClick={ctx.onFollow?.(item.href)} aria-current={item.href === ctx.current ? 'page' : undefined}>
        <span className="rm-door-icon" aria-hidden>{item.icon}</span>
        <span className="rm-door-text">
          <strong>{item.label}</strong>
          <small>{blurbOf(item, ctx)}</small>
        </span>
        {isLocked(item, ctx)
          ? <span className="rm-lock" title="Needs an account">🔒<span className="rm-sr"> Needs an account</span></span>
          : badge && <span className="rm-badge">{badge}</span>}
      </Link>
      {ctx.togglePin && (
        <button type="button" className={`rm-pin${pinned ? ' is-on' : ''}`} aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`} title={pinned ? 'Unpin' : 'Pin to your header and dock'} onClick={() => ctx.togglePin?.(item.href)}>
          <PinStar on={pinned} />
        </button>
      )}
    </li>
  );
}

/** A place in a room: an icon with its name under it. */
function Icon({ item, ctx, small, onPeek }: { item: NavItem; ctx: RoomContext; small?: boolean; onPeek: (item: NavItem | null) => void }) {
  const locked = isLocked(item, ctx);
  const pinned = !!ctx.pins?.includes(item.href);
  const badge = ctx.info?.badges[item.href];
  const face = (
    <>
      <span className="rm-tile" aria-hidden>
        {item.icon}
        {ctx.editing
          ? <span className={`rm-tile-star${pinned ? ' is-on' : ''}`}><PinStar on={pinned} /></span>
          : locked ? <span className="rm-tile-lock">🔒</span> : badge && <span className="rm-tile-badge">{badge}</span>}
      </span>
      <span className="rm-label">{item.label}</span>
      <span className="rm-sr">{`${blurbOf(item, ctx) ?? ''}${locked ? '. Needs an account.' : ''}${badge ? `. ${badge}.` : ''}`}</span>
    </>
  );
  const peek = { onPointerEnter: () => onPeek(item), onPointerLeave: () => onPeek(null), onFocus: () => onPeek(item), onBlur: () => onPeek(null) };
  return (
    <li className={`rm-icon${small ? ' is-small' : ''}${locked ? ' is-locked' : ''}`}>
      {ctx.editing ? (
        <button type="button" data-lc aria-pressed={pinned} onClick={() => ctx.togglePin?.(item.href)} {...peek}>{face}</button>
      ) : (
        <Link data-lc href={item.href} onClick={ctx.onFollow?.(item.href)} aria-current={item.href === ctx.current ? 'page' : undefined} {...peek}>{face}</Link>
      )}
    </li>
  );
}

const DEMOS: AttractId[] = ['party', 'snake', 'breakout', 'flap', 'chain', 'blocks', 'merge', '2048', 'setpoint'];

/** The game a place would show: its own, or the party for anything party. */
function demoFor(item: NavItem | null): AttractId | null {
  const game = item?.href.match(/^\/game\?game=([\w-]+)/)?.[1];
  if (game) return game as AttractId;
  return item?.href.startsWith('/party') ? 'party' : null;
}

/** The arcade's demos on a loop in the room, switching to whichever game you point at. */
function GameStage({ peek }: { peek: NavItem | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [turn, setTurn] = useState(0);
  const showing = demoFor(peek) ?? DEMOS[turn % DEMOS.length];
  const shown = useRef(showing);
  useEffect(() => { shown.current = showing; }, [showing]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    let visible = true;
    let stopped = false;
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
    const resize = new ResizeObserver(size);
    resize.observe(canvas);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    seen.observe(canvas);
    const cycle = still ? 0 : window.setInterval(() => { if (visible && !document.hidden) setTurn((n) => n + 1); }, 4200);
    // Loaded here so the games' drawing code only comes with the room that shows it.
    void import('@/lib/games/attract').then(({ drawAttract }) => {
      if (stopped) return;
      size();
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (!visible || document.hidden || now - last < 1000 / 24 || !w || !h) return;
        last = now;
        drawAttract(shown.current, ctx, now / 1000, w, h);
      };
      if (still) drawAttract(shown.current, ctx, 3.2, w, h);
      else raf = requestAnimationFrame(tick);
    });
    return () => { stopped = true; cancelAnimationFrame(raf); clearInterval(cycle); resize.disconnect(); seen.disconnect(); };
  }, []);

  return <canvas ref={ref} className="rm-stage" aria-hidden />;
}

/** A room code gets you straight to choosing a nickname. */
function PartyJoin({ onLeave }: { onLeave?: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  return (
    <form className="rm-form" onSubmit={(e) => {
      e.preventDefault();
      onLeave?.();
      router.push(`/party?code=${code}`);
    }}>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} className="rm-code"
        placeholder="ROOM CODE" aria-label="Party room code" autoCapitalize="characters" autoComplete="off" spellCheck={false} enterKeyHint="go" />
      <button type="submit" className="btn btn-primary" disabled={code.length < 4}>Join</button>
    </form>
  );
}

function GroceryAdd() {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  return (
    <form className="rm-form" onSubmit={async (e) => {
      e.preventDefault();
      const item = text.trim();
      if (!item) return;
      // Loaded here: it brings the recipe code along, which most visits don't need.
      const { addGroceryItem } = await import('@/lib/recipes/grocery-client');
      const ok = await addGroceryItem(item);
      setNote(ok ? `✓ ${item} is on the list` : 'Couldn’t reach the list. Try again.');
      if (ok) setText('');
    }}>
      <input value={text} onChange={(e) => { setText(e.target.value); setNote(''); }} maxLength={120} placeholder="Add to the grocery list…" aria-label="Add to the grocery list" enterKeyHint="done" />
      <button type="submit" className="btn btn-secondary" disabled={!text.trim()}>Add</button>
      {note && <p className="rm-note" role="status">{note}</p>}
    </form>
  );
}

function Room({ room, ctx }: { room: NavGroup; ctx: RoomContext }) {
  const [peek, setPeek] = useState<NavItem | null>(null);
  const corners = room.corners ?? [];
  const places = [...room.items, ...corners.flatMap((c) => c.items)].filter((p) => !isLocked(p, ctx));
  const found = places.filter((p) => ctx.found?.has(p.href)).length;
  const status = ctx.info?.status[room.id];
  const peekLine = peek ? blurbOf(peek, ctx) : null;

  return (
    <section data-room={room.id} className={`rm-room${room.wide ? ' is-wide' : ''}`} style={{ '--room': room.color } as React.CSSProperties} aria-label={room.label}>
      <header className="rm-head">
        <span className="rm-emoji" aria-hidden>{room.icon}</span>
        <div className="rm-title">
          <h3>{room.label}</h3>
          {/* What you're pointing at, or the question the room answers. */}
          <p aria-hidden={!!peek}>{peek ? <><b>{peek.label}</b>{peekLine ? ` · ${peekLine}` : ''}</> : room.question}</p>
        </div>
        {ctx.found && places.length > 0 && (
          found === places.length
            ? <span className="rm-stamp" title="You’ve been everywhere in this room">🏅</span>
            : <span className="rm-count" title="Places you’ve found in this room">{found}/{places.length}</span>
        )}
      </header>
      {status && <p className="rm-status">{status}</p>}
      <div className="rm-body">
        {room.action === 'party-join' && (
          <div className="rm-side">
            <GameStage peek={peek} />
            <PartyJoin onLeave={ctx.onLeave} />
          </div>
        )}
        <div className="rm-main">
          <ul className="rm-icons">{room.items.map((item) => <Icon key={item.href} item={item} ctx={ctx} onPeek={setPeek} />)}</ul>
          {corners.map((corner) => (
            <div key={corner.label} className="rm-corner">
              <h4>{corner.label}</h4>
              <ul className="rm-icons is-small">{corner.items.map((item) => <Icon key={item.href} item={item} ctx={ctx} small onPeek={setPeek} />)}</ul>
            </div>
          ))}
          {room.action === 'grocery-add' && <GroceryAdd />}
        </div>
      </div>
    </section>
  );
}

/** The things no menu can show you. */
function GettingAround({ ctx }: { ctx: RoomContext }) {
  return (
    <section className="rm-room rm-tips" aria-label="Getting around">
      <header className="rm-head">
        <span className="rm-emoji" aria-hidden>🗺️</span>
        <div className="rm-title">
          <h3>Getting around</h3>
          <p>A few things worth knowing.</p>
        </div>
      </header>
      <ul>
        <li className="rm-tip-keys">Press <kbd>/</kbd> on any page to open this and search everything.</li>
        <li>Type <b>add milk</b> in the search to put it on the grocery list.</li>
        {ctx.togglePin && <li><b>Choose shortcuts</b>, down below, puts your favourites in your header and dock.</li>}
        <li>🧭 Every new place you find counts. Try to find them all.</li>
        {!ctx.signedIn && (
          <li>
            🔒 places need an account, which keeps your streaks and lifts with you.{' '}
            <button type="button" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in</button>
          </li>
        )}
      </ul>
    </section>
  );
}

export function RoomGrid({ groups, ctx }: { groups: NavGroup[]; ctx: RoomContext }) {
  return (
    <div className={`rm-grid${ctx.editing ? ' is-editing' : ''}`}>
      {orderRooms(groups, ctx.signedIn, ctx.studyFirst).map((room) => <Room key={room.id} room={room} ctx={ctx} />)}
      <GettingAround ctx={ctx} />
    </div>
  );
}

/** How much of the site you've found, and a roll of the dice to find more. */
export function ExploreMeter({ groups, ctx }: { groups: NavGroup[]; ctx: RoomContext }) {
  const router = useRouter();
  const [destination, setDestination] = useState<NavItem | null>(null);
  const places = placesFor(groups, ctx.signedIn);
  const found = places.filter((p) => ctx.found?.has(p.href)).length;
  const everywhere = found === places.length;

  const surprise = () => {
    const place = pickSurprise(places, ctx.found ?? [], ctx.current);
    if (!place || destination) return;
    setDestination(place);
    // A moment for the dice to land.
    setTimeout(() => {
      setDestination(null);
      ctx.onLeave?.();
      const [path, hash] = place.href.split('#');
      if (hash && path === window.location.pathname) window.location.hash = hash;
      else router.push(place.href);
    }, 650);
  };

  return (
    <div className="rm-meter">
      {ctx.found && (
        <div className="rm-progress" role="img" aria-label={`You’ve found ${found} of ${places.length} places`}>
          <span>{everywhere ? <>🏆 <b>You’ve been everywhere</b></> : <>🧭 <b>{found}</b> of {places.length} places found</>}</span>
          <div className="rm-bar"><i style={{ width: `${(found / Math.max(places.length, 1)) * 100}%` }} /></div>
        </div>
      )}
      <button type="button" className={`rm-dice${destination ? ' is-rolling' : ''}`} onClick={surprise}>
        <span aria-hidden>🎲</span>{destination ? `Off to ${destination.label}…` : 'Surprise me'}
      </button>
    </div>
  );
}

/** The rooms on the home page, where someone new to the site starts looking around. */
export function HomeRooms({ isAdmin, signedIn, blurbs }: { isAdmin: boolean; signedIn: boolean; blurbs?: Record<string, string> }) {
  const found = useFoundPlaces();
  const [info, setInfo] = useState<NavInfo | undefined>();
  const groups = navGroups(isAdmin);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    import('./nav-badges').then((m) => m.loadNavInfo()).then((i) => { if (!cancelled) setInfo(i); }).catch(() => { /* no counts, still works */ });
    return () => { cancelled = true; };
  }, [signedIn]);

  const ctx: RoomContext = { signedIn, found, info, blurbs };
  return (
    <section id="explore" className="rm-home" aria-label="Explore the site">
      <div className="rm-home-head">
        <div>
          <h2>What are you up to?</h2>
          <p>Everything on this site, by what you’d come here for. Have a wander.</p>
        </div>
        <ExploreMeter groups={groups} ctx={ctx} />
      </div>
      <RoomGrid groups={groups} ctx={ctx} />
    </section>
  );
}
