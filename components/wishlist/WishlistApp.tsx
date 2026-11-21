'use client';

import { useMemo, useState } from 'react';
import type { Suggestion } from '@/lib/wishlist/ai';
import { shoppingSearchUrl } from '@/lib/wishlist/ai';
import {
  formatPrice, listAsText, mustHaveTotal, PRIORITY_LABELS, sortItems, type ItemFields, type ItemView, type ListKind, type OwnerList, type SortMode,
} from '@/lib/wishlist/model';
import GiverList, { Thumb } from './GiverList';
import { IdeasSheet, ItemSheet, ListSheet, ShareSheet } from './Sheets';
import { useWishlist } from './useWishlist';
import './wishlist.css';

type Selection = { src: 'own'; id: string } | { src: 'shared'; ownerId: string; id: string };

const clientId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** /wishlist: my lists (things I want, and private gift ideas for other people) and lists shared with me. */
export default function WishlistApp() {
  const w = useWishlist();
  const [sel, setSel] = useState<Selection | null>(null);
  const [sort, setSort] = useState<SortMode>('mine');
  const [sheet, setSheet] = useState<
    | { type: 'newList'; kind: ListKind } | { type: 'editList' } | { type: 'item'; id: string | null } | { type: 'share' } | { type: 'ideas' } | null
  >(null);
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');

  const own = w.lists.find((l) => sel?.src === 'own' && l.id === sel.id) ?? (sel ? null : w.lists[0] ?? null);
  const shared = sel?.src === 'shared' ? w.shared.find((s) => s.ownerId === sel.ownerId) : undefined;
  const sharedList = shared?.lists.find((l) => sel?.src === 'shared' && l.id === sel.id);

  const items = useMemo(() => (own ? sortItems(own.items, sort) : []), [own, sort]);

  if (w.status === 'loading') return <div className="wl-page"><p className="wl-empty">Loading…</p></div>;
  if (w.status === 'signed-out') {
    return (
      <div className="wl-page animate-fade-in">
        <h1><span aria-hidden>🎁</span> Wishlist</h1>
        <section className="wl-card">
          <p className="wl-empty">Your wishlists are kept on your account. Sign in to start one.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in</button>
        </section>
      </div>
    );
  }
  if (w.status === 'error') return <div className="wl-page"><p className="wl-error">{w.error || 'Couldn’t load your wishlists.'}</p><button className="btn btn-secondary" onClick={() => void w.load()}>Try again</button></div>;

  const mine = w.lists.filter((l) => l.kind === 'mine');
  const forOthers = w.lists.filter((l) => l.kind === 'for');
  const editing: ItemView | null = sheet?.type === 'item' && sheet.id && own ? own.items.find((i) => i.id === sheet.id) ?? null : null;

  const addByLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!own || !link.trim()) return;
    setAdding(true);
    setNotice('');
    try {
      const r = await w.importLink(link.trim());
      const id = clientId();
      const ok = await w.act({
        type: 'addItem', listId: own.id, id,
        item: { url: r.url, title: r.title, description: r.description, price: r.price, currency: r.currency, image: r.image, store: r.store },
      });
      if (ok) {
        setLink('');
        setNotice(
          r.missing.length || r.warning
            ? `Added “${r.title || r.store}”.${r.warning ? ` ${r.warning}` : ''}${r.missing.length ? ` Couldn’t get the ${r.missing.join(', ')}: tap Edit to fill ${r.missing.length > 1 ? 'them' : 'it'} in.` : ''}`
            : `Added “${r.title}”.`,
        );
        if (r.missing.includes('name')) setSheet({ type: 'item', id });
      }
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const saveItem = async (fields: ItemFields) => {
    if (!own) return;
    const ok = sheet?.type === 'item' && sheet.id
      ? await w.act({ type: 'updateItem', listId: own.id, id: sheet.id, fields })
      : await w.act({ type: 'addItem', listId: own.id, item: fields });
    if (ok) setSheet(null);
  };

  const addIdea = (s: Suggestion) => {
    if (!own) return Promise.resolve(false);
    return w.act({
      type: 'addItem', listId: own.id,
      item: { title: s.title, url: s.url || shoppingSearchUrl(s.searchQuery), description: [s.why, s.priceRange ? `About ${s.priceRange}.` : ''].filter(Boolean).join(' '), store: s.url ? '' : 'Web search' },
    });
  };

  const copyText = async () => {
    if (!own) return;
    try { await navigator.clipboard.writeText(listAsText(own)); setNotice('Copied the list as text.'); } catch { setNotice('Couldn’t copy. Try again.'); }
  };

  const select = (s: Selection) => { setSel(s); setNotice(''); setSheet(null); setSort('mine'); };
  const emptyAll = w.lists.length === 0;

  const quickStart = async () => {
    for (const name of [['Wants', '🎁'], ['House', '🏠'], ['Needs', '🛒']]) await w.act({ type: 'addList', kind: 'mine', fields: { name: name[0], emoji: name[1] } });
  };

  return (
    <div className="wl-page animate-fade-in">
      <header className="wl-head">
        <div>
          <h1><span aria-hidden>🎁</span> Wishlist</h1>
          <p className="wl-sub">Things you want, with links and pictures. Share a list so people know what to get you.</p>
        </div>
      </header>

      {w.error && <p className="wl-error" role="alert">{w.error} <button type="button" className="wl-link" onClick={() => w.setError('')}>Dismiss</button></p>}

      <nav className="wl-tabs" aria-label="Lists">
        {mine.map((l) => (
          <button key={l.id} type="button" className={`wl-tab${own?.id === l.id && sel?.src !== 'shared' ? ' is-on' : ''}`} onClick={() => select({ src: 'own', id: l.id })}>
            <span aria-hidden>{l.emoji}</span> {l.name} <em>{l.items.length}</em>
          </button>
        ))}
        <button type="button" className="wl-tab wl-tab-add" onClick={() => setSheet({ type: 'newList', kind: 'mine' })}>+ List</button>
      </nav>
      {(forOthers.length > 0 || w.lists.length > 0) && (
        <nav className="wl-tabs wl-tabs-quiet" aria-label="Gift ideas for others">
          <span className="wl-tabs-label">Gift ideas</span>
          {forOthers.map((l) => (
            <button key={l.id} type="button" className={`wl-tab${own?.id === l.id && sel?.src !== 'shared' ? ' is-on' : ''}`} onClick={() => select({ src: 'own', id: l.id })}>
              <span aria-hidden>{l.emoji}</span> {l.name}{l.person ? ` · ${l.person}` : ''} <em>{l.items.length}</em>
            </button>
          ))}
          <button type="button" className="wl-tab wl-tab-add" onClick={() => setSheet({ type: 'newList', kind: 'for' })}>+ For someone</button>
        </nav>
      )}
      {w.shared.length > 0 && (
        <nav className="wl-tabs wl-tabs-quiet" aria-label="Shared with me">
          <span className="wl-tabs-label">Shared with me</span>
          {w.shared.flatMap((s) => s.lists.map((l) => (
            <button key={`${s.ownerId}:${l.id}`} type="button" className={`wl-tab${sel?.src === 'shared' && sel.id === l.id && sel.ownerId === s.ownerId ? ' is-on' : ''}`} onClick={() => select({ src: 'shared', ownerId: s.ownerId, id: l.id })}>
              <span aria-hidden>{l.emoji}</span> {s.ownerName}: {l.name}
            </button>
          )))}
        </nav>
      )}

      {emptyAll && !sharedList && (
        <section className="wl-card wl-start">
          <h2>Start your first list</h2>
          <p>Keep separate lists for different things, like Wants, House and Needs. You can add things by pasting a link.</p>
          <div className="wl-row">
            <button type="button" className="btn btn-primary" onClick={() => void quickStart()}>Make Wants, House and Needs</button>
            <button type="button" className="btn btn-secondary" onClick={() => setSheet({ type: 'newList', kind: 'mine' })}>Make my own</button>
          </div>
        </section>
      )}

      {sharedList && shared && (
        <section className="wl-card">
          <div className="wl-list-head">
            <div>
              <h2><span aria-hidden>{sharedList.emoji}</span> {sharedList.name}</h2>
              <p className="wl-sub">{shared.ownerName}’s list{sharedList.occasion ? ` · ${sharedList.occasion}` : ''}. {shared.ownerName} can’t see what you claim.</p>
              {sharedList.note && <p className="wl-note">{sharedList.note}</p>}
            </div>
          </div>
          <GiverList
            list={sharedList}
            askName={false}
            onClaim={(itemId, input) => w.householdClaim(shared.ownerId, sharedList.id, itemId, 'claim', input)}
            onUnclaim={(itemId) => w.householdClaim(shared.ownerId, sharedList.id, itemId, 'unclaim')}
          />
        </section>
      )}

      {own && sel?.src !== 'shared' && (
        <section className="wl-card">
          <div className="wl-list-head">
            <div>
              <h2><span aria-hidden>{own.emoji}</span> {own.name}</h2>
              <p className="wl-sub">
                {own.kind === 'for' ? `Private ideas for ${own.person || 'someone'}` : own.shareToken ? 'Shared by link' : 'Not shared'}
                {own.occasion ? ` · ${own.occasion}` : ''}
                {own.date ? ` · ${new Date(`${own.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                {own.items.length ? ` · ${own.items.length} item${own.items.length === 1 ? '' : 's'}` : ''}
                {mustHaveTotal(own) ? ` · must-haves ${mustHaveTotal(own)}` : ''}
              </p>
              {own.note && <p className="wl-note">{own.note}</p>}
            </div>
            <div className="wl-row wl-list-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setSheet({ type: 'editList' })}>Edit list</button>
              {own.kind === 'mine' && <button type="button" className="btn btn-secondary" onClick={() => setSheet({ type: 'share' })}>{own.shareToken ? '🔗 Sharing' : '🔗 Share'}</button>}
            </div>
          </div>

          <form className="wl-addbar" onSubmit={addByLink}>
            <input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link to add it" aria-label="Product link" disabled={adding} />
            <button type="submit" className="btn btn-primary" disabled={adding || !link.trim()}>{adding ? 'Looking…' : 'Add'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setSheet({ type: 'item', id: null })}>No link</button>
          </form>
          {notice && <p className="wl-notice" role="status">{notice}</p>}

          <div className="wl-toolbar">
            <button type="button" className="btn btn-secondary" onClick={() => setSheet({ type: 'ideas' })}>✨ Find more ideas</button>
            <button type="button" className="btn btn-secondary" disabled={!own.items.length} onClick={copyText}>📋 Copy as text</button>
            <label className="wl-sort">Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                <option value="mine">My order</option>
                <option value="priority">Priority</option>
                <option value="price-low">Price, low to high</option>
                <option value="price-high">Price, high to low</option>
              </select>
            </label>
          </div>

          {own.items.length === 0 ? (
            <p className="wl-empty">Nothing here yet. Paste a link above, or find ideas.</p>
          ) : (
            <ul className="wl-items">
              {items.map((item, index) => (
                <li key={item.id} className={`wl-item${item.gotIt ? ' is-got' : ''}`}>
                  <Thumb url={item.imageUrl} title={item.title} />
                  <div className="wl-item-body">
                    <div className="wl-item-top">
                      <h3 className="wl-item-title">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">{item.title}</a> : item.title}</h3>
                      <span className={`wl-pri wl-pri-${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span>
                    </div>
                    <p className="wl-item-meta">
                      {item.price !== null && <strong>{formatPrice(item.price, item.currency)}</strong>}
                      {item.quantity > 1 && <span>x{item.quantity}</span>}
                      {item.store && <span>{item.store}</span>}
                      {item.gotIt && <span className="wl-got">Got it myself</span>}
                    </p>
                    {item.description && <p className="wl-item-desc">{item.description}</p>}
                    {item.note && <p className="wl-item-note">📝 {item.note}</p>}
                    <div className="wl-row wl-item-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => setSheet({ type: 'item', id: item.id })}>Edit</button>
                      {sort === 'mine' && (
                        <>
                          <button type="button" className="wl-icon" aria-label="Move up" disabled={index === 0} onClick={() => void w.act({ type: 'moveItem', listId: own.id, id: item.id, dir: -1 })}>↑</button>
                          <button type="button" className="wl-icon" aria-label="Move down" disabled={index === items.length - 1} onClick={() => void w.act({ type: 'moveItem', listId: own.id, id: item.id, dir: 1 })}>↓</button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="wl-row wl-list-order">
            <button type="button" className="wl-link" disabled={w.lists.indexOf(own) === 0} onClick={() => void w.act({ type: 'moveList', id: own.id, dir: -1 })}>Move list earlier</button>
            <button type="button" className="wl-link" disabled={w.lists.indexOf(own) === w.lists.length - 1} onClick={() => void w.act({ type: 'moveList', id: own.id, dir: 1 })}>Move list later</button>
          </div>
        </section>
      )}

      {sheet?.type === 'newList' && (
        <ListSheet list={null} kind={sheet.kind} onClose={() => setSheet(null)} onSave={async (fields) => {
          const id = clientId();
          if (await w.act({ type: 'addList', id, kind: sheet.kind, fields })) { setSheet(null); setSel({ src: 'own', id }); }
        }} />
      )}
      {sheet?.type === 'editList' && own && (
        <ListSheet list={own} kind={own.kind} onClose={() => setSheet(null)}
          onSave={async (fields) => { if (await w.act({ type: 'updateList', id: own.id, fields })) setSheet(null); }}
          onDelete={async () => {
            if (!confirm(`Delete “${own.name}” and everything on it?${own.shareToken ? ' Its share link stops working.' : ''}`)) return;
            if (await w.act({ type: 'removeList', id: own.id })) { setSheet(null); setSel(null); }
          }} />
      )}
      {sheet?.type === 'item' && own && (
        <ItemSheet key={sheet.id ?? 'new'} item={editing} lists={w.lists} listId={own.id} me={w.me} canGotIt={own.kind === 'mine'} importImage={w.importImage}
          onClose={() => setSheet(null)} onSave={saveItem}
          onMove={async (toListId) => { if (editing && (await w.act({ type: 'transferItem', listId: own.id, id: editing.id, toListId }))) setSheet(null); }}
          onDelete={editing ? async () => { if (confirm(`Delete “${editing.title}”?`) && (await w.act({ type: 'removeItem', listId: own.id, id: editing.id }))) setSheet(null); } : undefined} />
      )}
      {sheet?.type === 'share' && own && own.kind === 'mine' && (
        <ShareSheet list={own} onClose={() => setSheet(null)} onAct={(op) => w.act({ type: 'share', listId: own.id, op })} />
      )}
      {sheet?.type === 'ideas' && own && <IdeasSheet list={own as OwnerList} onAdd={addIdea} onClose={() => setSheet(null)} />}
    </div>
  );
}
