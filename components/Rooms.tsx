'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { navGroups, orderRooms, pickSurprise, placesFor, type NavGroup, type NavItem } from './nav-links';
import type { NavBadges } from './nav-badges';
import { useFoundPlaces } from './useNavPins';
import './rooms.css';

// The site as a map of rooms, each named for what you'd be there to do, with every
// page and corner in it on show. The Explore panel and the home page both draw it.

export type RoomContext = {
  signedIn: boolean;
  found: Set<string> | null;
  badges?: NavBadges;
  /** Your pins, in the panel: the home page leaves pinning out. */
  pins?: string[];
  togglePin?: (href: string) => void;
  current?: string;
  onFollow?: (href: string) => (e: React.MouseEvent) => void;
  /** Called when something in a room takes you to another page. */
  onLeave?: () => void;
  /** Better words for a page's line, like how many photos there are. */
  blurbs?: Record<string, string>;
};

const NewDot = () => <i className="rm-new" aria-hidden title="You haven’t been here yet" />;

const PinStar = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
  </svg>
);

const isLocked = (item: NavItem, ctx: RoomContext) => !!item.account && !ctx.signedIn;
const isNew = (item: NavItem, ctx: RoomContext) => !!ctx.found && !isLocked(item, ctx) && !ctx.found.has(item.href);

/** A page: its icon, name and line, what's waiting there, and a star to pin it. */
export function Door({ item, ctx }: { item: NavItem; ctx: RoomContext }) {
  const pinned = !!ctx.pins?.includes(item.href);
  const badge = ctx.badges?.[item.href];
  return (
    <li className="rm-door">
      <Link data-lc href={item.href} onClick={ctx.onFollow?.(item.href)} aria-current={item.href === ctx.current ? 'page' : undefined}>
        <span className="rm-door-icon" aria-hidden>{item.icon}</span>
        <span className="rm-door-text">
          <strong>{item.label}{isNew(item, ctx) && <NewDot />}</strong>
          <small>{ctx.blurbs?.[item.href] ?? item.blurb}</small>
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
  const corners = room.corners ?? [];
  return (
    <section data-room={room.id} className={`rm-room${room.wide ? ' is-wide' : ''}`} style={{ '--room': room.color } as React.CSSProperties} aria-label={room.label}>
      <header className="rm-head">
        <span className="rm-emoji" aria-hidden>{room.icon}</span>
        <div>
          <h3>{room.label}</h3>
          <p>{room.question}</p>
        </div>
      </header>
      <div className="rm-body">
        <div className="rm-main">
          {room.action === 'party-join' && <PartyJoin onLeave={ctx.onLeave} />}
          <ul className="rm-doors">{room.items.map((item) => <Door key={item.href} item={item} ctx={ctx} />)}</ul>
          {room.action === 'grocery-add' && <GroceryAdd />}
        </div>
        {corners.length > 0 && (
          <div className="rm-corners">
            {corners.map((corner) => (
              <div key={corner.label}>
                <h4>{corner.label}</h4>
                <ul>
                  {corner.items.map((item) => (
                    <li key={item.href}>
                      <Link data-lc href={item.href} title={item.blurb} className={isLocked(item, ctx) ? 'is-locked' : ''} onClick={ctx.onFollow?.(item.href)}>
                        <span aria-hidden>{item.icon}</span>{item.label}{isNew(item, ctx) && <NewDot />}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** The things no menu can show you. */
function GettingAround({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="rm-room rm-tips" aria-label="Getting around">
      <header className="rm-head">
        <span className="rm-emoji" aria-hidden>🗺️</span>
        <div>
          <h3>Getting around</h3>
          <p>A few things worth knowing.</p>
        </div>
      </header>
      <ul>
        <li className="rm-tip-keys">Press <kbd>/</kbd> on any page to open this and search everything.</li>
        <li>Type <b>add milk</b> in the search to put it on the grocery list.</li>
        <li>Hover or tap ☆ on a page to keep it in your header and dock.</li>
        <li><i className="rm-new" aria-hidden /> marks somewhere you haven’t been yet.</li>
        {!signedIn && (
          <li>
            🔒 pages need an account, which keeps your streaks and lifts with you.{' '}
            <button type="button" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in</button>
          </li>
        )}
      </ul>
    </section>
  );
}

export function RoomGrid({ groups, ctx }: { groups: NavGroup[]; ctx: RoomContext }) {
  return (
    <div className="rm-grid">
      {orderRooms(groups, ctx.signedIn).map((room) => <Room key={room.id} room={room} ctx={ctx} />)}
      <GettingAround signedIn={ctx.signedIn} />
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
  const [badges, setBadges] = useState<NavBadges>({});
  const groups = navGroups(isAdmin);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    import('./nav-badges').then((m) => m.loadNavBadges()).then((b) => { if (!cancelled) setBadges(b); }).catch(() => { /* no counts, still works */ });
    return () => { cancelled = true; };
  }, [signedIn]);

  const ctx: RoomContext = { signedIn, found, badges, blurbs };
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
