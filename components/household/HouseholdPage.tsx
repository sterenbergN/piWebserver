'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import HouseholdPanel from '@/components/chores/HouseholdPanel';
import type { HouseholdInfo } from '@/components/chores/useChores';
import './household-page.css';

type MyList = { id: string; name: string; emoji: string; kind: 'mine' | 'for'; householdHidden: boolean };
type SharedFrom = { ownerId: string; ownerName: string; lists: unknown[] };
type State = 'loading' | 'signed-out' | 'ready' | 'error';

const names = (list: string[]) => new Intl.ListFormat('en').format(list);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** One home for the household: who is in it, and everything it shares. */
export default function HouseholdPage() {
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<State>('loading');
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [lists, setLists] = useState<MyList[]>([]);
  const [shared, setShared] = useState<SharedFrom[]>([]);
  const [error, setError] = useState('');
  // A refresh that was already under way must not undo a switch that is still being saved.
  const saving = useRef(0);
  const saves = useRef(0);

  const load = useCallback(async () => {
    const startedAt = saves.current;
    try {
      const [chores, wish] = await Promise.all([
        fetch(`/api/chores?today=${today()}`, { cache: 'no-store' }),
        fetch('/api/wishlist', { cache: 'no-store' }),
      ]);
      if (chores.status === 401) { setState('signed-out'); return; }
      const c = await chores.json();
      if (!c.success) throw new Error(c.message);
      setHousehold(c.household);
      if (wish.ok) {
        const w = await wish.json();
        if (w.success && !saving.current && saves.current === startedAt) { setLists(w.lists ?? []); setShared(w.shared ?? []); }
      }
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const again = () => { void load(); };
    window.addEventListener('focus', again);
    return () => {
      clearTimeout(first);
      window.removeEventListener('focus', again);
    };
  }, [load]);

  const householdOp = useCallback(async (op: 'invite' | 'invite-off' | 'join' | 'leave', code?: string) => {
    try {
      const res = await fetch('/api/chores/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, code, today: today() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.success) { setError(body.message || 'That didn’t work.'); return false; }
      setError('');
      await load();
      return true;
    } catch {
      setError('Network error. Try again.');
      return false;
    }
  }, [load]);

  const setVisible = async (list: MyList, visible: boolean) => {
    const before = lists;
    setLists((cur) => cur.map((l) => (l.id === list.id ? { ...l, householdHidden: !visible } : l)));
    saving.current++;
    try {
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: { type: 'updateList', id: list.id, fields: { householdHidden: !visible } } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.success) throw new Error(body.message);
      setError('');
    } catch (e) {
      setLists(before);
      setError(e instanceof Error && e.message ? e.message : 'Couldn’t save that. Try again.');
    } finally {
      saving.current--;
      saves.current++;
    }
  };

  const signIn = () => window.dispatchEvent(new Event('site:sign-in'));
  const members = household?.members ?? [];
  const others = members.filter((m) => m.id !== household?.me);
  const mine = lists.filter((l) => l.kind === 'mine');
  const visibleFrom = shared.filter((s) => s.lists.length > 0);
  const canSee = visibleFrom.reduce((n, s) => n + s.lists.length, 0);

  return (
    <div className="hp">
      <h1>🏠 Household</h1>
      <p className="hp-lead">A household is the people you share your home life with. Everyone in it works from the same chores, meal plan and grocery list, and can see the wishlists you choose to show them.</p>

      {state === 'loading' && <p className="hp-note">Loading…</p>}
      {state === 'error' && <p className="hp-error" role="alert">Couldn’t load your household. Try again in a moment.</p>}
      {state === 'signed-out' && (
        <section className="hp-card hp-empty">
          <h3>Sign in to share with your household</h3>
          <p>Sign in with your account, then invite the people you live with.</p>
          <button type="button" className="btn btn-primary" onClick={signIn}>Sign in</button>
        </section>
      )}

      {state === 'ready' && household && (
        <>
          {error && <p className="hp-error" role="alert">{error}</p>}
          {others.length === 0 && (
            <p className="hp-note">You’re on your own for now. Make an invite code for someone, or enter the code they gave you, and you’ll share chores, the meal plan, the grocery list and wishlists.</p>
          )}
          <h2>Members</h2>
          <HouseholdPanel members={members} me={household.me} invite={household.invite} op={householdOp} confirm={confirm} />

          <h2>What’s shared</h2>
          <div className="hp-cards">
            <section className="hp-card">
              <h3>🧹 Chores</h3>
              <p>One chore list for everyone in the household. Anyone can tick things off.</p>
              <Link className="hp-link" href="/chores">Open chores</Link>
            </section>
            <section className="hp-card">
              <h3>📅 Meal plan</h3>
              <p>The week’s meals, shared automatically.</p>
              <Link className="hp-link" href="/recipes?view=week">Open the meal plan</Link>
            </section>
            <section className="hp-card">
              <h3>🛒 Grocery list</h3>
              <p>One list for the household, so nobody buys the milk twice.</p>
              <Link className="hp-link" href="/recipes?view=list">Open the grocery list</Link>
            </section>
            <section className="hp-card">
              <h3>🎁 Wishlists</h3>
              <p>Your own lists show to the household unless you turn them off here.</p>
              {mine.length === 0 ? (
                <p className="hp-note">You don’t have a wishlist of your own yet.</p>
              ) : (
                <ul className="hp-lists">
                  {mine.map((l) => (
                    <li key={l.id}>
                      <span className="hp-list-name"><span aria-hidden>{l.emoji || '🎁'}</span> {l.name}</span>
                      <label className="hp-switch">
                        <input type="checkbox" role="switch" checked={!l.householdHidden} onChange={(e) => setVisible(l, e.target.checked)} />
                        Show to household
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="hp-note">
                {canSee > 0
                  ? <>You can see {canSee} {canSee === 1 ? 'list' : 'lists'} from {names(visibleFrom.map((s) => s.ownerName))}. </>
                  : others.length > 0 ? 'No one else in your household is showing a list right now. ' : ''}
                Gift-idea lists (the ones you keep for other people) are always private and never shown here.
              </p>
              <Link className="hp-link" href="/wishlist">Open wishlists</Link>
            </section>
          </div>
        </>
      )}
      {popup}
    </div>
  );
}
