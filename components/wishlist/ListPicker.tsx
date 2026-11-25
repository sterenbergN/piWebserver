'use client';

import Link from 'next/link';
import type { ListKind, OwnerList } from '@/lib/wishlist/model';
import Menu from './Menu';
import type { SharedWithMe } from './useWishlist';

export type Selection = { src: 'own'; id: string } | { src: 'shared'; ownerId: string; id: string };

const Chevron = () => (
  <svg className="wl-chev" viewBox="0 0 12 8" width="12" height="8" aria-hidden focusable="false">
    <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Option({ emoji, name, detail, count, on, onPick }: { emoji: string; name: string; detail?: string; count: number; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} className={`wl-menu-item${on ? ' is-on' : ''}`} onClick={onPick}>
      <span className="wl-menu-emoji" aria-hidden>{emoji}</span>
      <span className="wl-menu-text">{name}{detail && <small>{detail}</small>}</span>
      <span className="wl-menu-count" aria-label={`${count} item${count === 1 ? '' : 's'}`}>{count}</span>
    </button>
  );
}

/**
 * One picker for every list: mine, gift ideas for others, and lists shared with me.
 * The button shows the list you're on, so it doubles as the list's heading.
 */
export function ListPicker({ lists, shared, selected, current, onPick, heading }: {
  lists: OwnerList[];
  shared: SharedWithMe[];
  selected: Selection | null;
  /** What the button shows; null when no list is open. */
  current: { emoji: string; name: string } | null;
  onPick: (s: Selection) => void;
  /** Show the button as the page's list heading. */
  heading?: boolean;
}) {
  const mine = lists.filter((l) => l.kind === 'mine');
  const forOthers = lists.filter((l) => l.kind === 'for');
  const isOwn = (id: string) => selected?.src === 'own' && selected.id === id;
  const isShared = (ownerId: string, id: string) => selected?.src === 'shared' && selected.ownerId === ownerId && selected.id === id;
  const total = lists.length + shared.reduce((n, s) => n + s.lists.length, 0);

  return (
    <Menu
      label="Your lists"
      heading={heading}
      buttonLabel={current ? `${current.name}: switch list` : 'Lists shared with you'}
      buttonClass={`wl-picker${current ? '' : ' is-empty'}`}
      panelClass="wl-picker-panel"
      button={current
        ? <><span className="wl-picker-emoji" aria-hidden>{current.emoji}</span><span className="wl-picker-name">{current.name}</span><span className="wl-picker-more">{total > 1 ? `${total} lists` : ''}<Chevron /></span></>
        : <><span className="wl-picker-name">Lists shared with you</span><Chevron /></>}
    >
      {mine.length > 0 && (
        <div role="group" aria-label="My lists">
          <div className="wl-menu-label" aria-hidden>My lists</div>
          {mine.map((l) => (
            <Option key={l.id} emoji={l.emoji} name={l.name} detail={l.occasion || undefined} count={l.items.length} on={isOwn(l.id)}
              onPick={() => onPick({ src: 'own', id: l.id })} />
          ))}
        </div>
      )}
      {forOthers.length > 0 && (
        <div role="group" aria-label="Gift ideas">
          <div className="wl-menu-label" aria-hidden>Gift ideas</div>
          {forOthers.map((l) => (
            <Option key={l.id} emoji={l.emoji} name={l.name} detail={l.person ? `for ${l.person}` : 'private'} count={l.items.length} on={isOwn(l.id)}
              onPick={() => onPick({ src: 'own', id: l.id })} />
          ))}
        </div>
      )}
      <div role="group" aria-label="Shared with me">
        <div className="wl-menu-label" aria-hidden>Shared with me</div>
        {shared.flatMap((s) => s.lists.map((l) => (
          <Option key={`${s.ownerId}:${l.id}`} emoji={l.emoji} name={l.name} detail={`${s.ownerName}’s list`} count={l.items.length} on={isShared(s.ownerId, l.id)}
            onPick={() => onPick({ src: 'shared', ownerId: s.ownerId, id: l.id })} />
        )))}
        {shared.length === 0 && <p className="wl-menu-note">Nothing yet. Lists from people in your household show here.</p>}
        <Link href="/household" role="menuitem" className="wl-menu-item wl-menu-foot">
          <span className="wl-menu-emoji" aria-hidden>👪</span>
          <span className="wl-menu-text">Manage household</span>
        </Link>
      </div>
    </Menu>
  );
}

/** "+ New list": a list of my own, or private gift ideas for someone. */
export function NewListMenu({ onNew }: { onNew: (kind: ListKind) => void }) {
  return (
    <Menu label="New list" buttonClass="wl-newlist" button={<>+ New list</>}>
      <button type="button" role="menuitem" className="wl-menu-item" onClick={() => onNew('mine')}>
        <span className="wl-menu-emoji" aria-hidden>🎁</span>
        <span className="wl-menu-text">My list<small>Things you want. You can share it.</small></span>
      </button>
      <button type="button" role="menuitem" className="wl-menu-item" onClick={() => onNew('for')}>
        <span className="wl-menu-emoji" aria-hidden>💡</span>
        <span className="wl-menu-text">Gift ideas for someone<small>Private to you, never shared.</small></span>
      </button>
    </Menu>
  );
}

export { Chevron };
