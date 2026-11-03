'use client';

import { useState } from 'react';
import { cleanDisc, STARTER_CLUBS } from '@/lib/golf/course';
import { DISC_CATALOG } from '@/lib/golf/disc-catalog';
import { fadeSide } from '@/lib/golf/lost-disc';
import { newId } from '@/lib/golf/round';
import type { Disc, GolfUser, ThrowHand } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import { Seg, Sheet } from './ui';

/**
 * A sketch of the flight from the four numbers, for your throwing hand: high-speed
 * turn one way early, fade the other way late. An illustration, not a simulation.
 */
export function FlightSketch({ disc, hand }: { disc: Pick<Disc, 'speed' | 'glide' | 'turn' | 'fade'>; hand: ThrowHand }) {
  const side = -fadeSide(hand); // which way turn goes on screen: +1 = right
  const length = Math.min(185, 70 + disc.speed * 7 + disc.glide * 4);
  const pts: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const turn = -disc.turn * 9 * Math.sin(Math.min(1, t / 0.75) * Math.PI) * (t < 0.75 ? 1 : 0.6);
    const fade = disc.fade * 11 * Math.max(0, (t - 0.45) / 0.55) ** 2;
    const x = 60 + side * (turn - fade);
    pts.push(`${x.toFixed(1)},${(200 - t * length).toFixed(1)}`);
  }
  return (
    <svg className="golf-flight" viewBox="0 0 120 210" role="img" aria-label={`Flight sketch: ${disc.speed} / ${disc.glide} / ${disc.turn} / ${disc.fade}`}>
      <line x1="60" y1="200" x2="60" y2="10" className="golf-flight-aim" />
      <polyline points={pts.join(' ')} className="golf-flight-path" />
      <circle cx="60" cy="200" r="4" className="golf-flight-start" />
    </svg>
  );
}

function DiscEditor({ disc, hand, onSave, onDelete, onClose }: { disc: Disc; hand: ThrowHand; onSave: (d: Disc) => void; onDelete?: () => void; onClose: () => void }) {
  const [d, setD] = useState(disc);
  const set = (next: Partial<Disc>) => setD({ ...d, ...next });
  const match = DISC_CATALOG.find((c) => c.name.toLowerCase() === d.name.trim().toLowerCase());
  const num = (key: 'speed' | 'glide' | 'turn' | 'fade', label: string, step = 0.5) => (
    <label className="golf-field is-num">{label}
      <input className="golf-input" type="number" step={step} value={d[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <Sheet title={disc.name ? disc.name : 'Add a disc'} onClose={onClose}>
      <label className="golf-field">Name
        <input className="golf-input" list="golf-disc-catalog" value={d.name} maxLength={40} placeholder="e.g. Buzzz" onChange={(e) => {
          const name = e.target.value;
          const c = DISC_CATALOG.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
          setD(c ? { ...d, name, brand: c.brand, speed: c.speed, glide: c.glide, turn: c.turn, fade: c.fade } : { ...d, name });
        }} />
      </label>
      <datalist id="golf-disc-catalog">{DISC_CATALOG.map((c) => <option key={`${c.brand}-${c.name}`} value={c.name}>{c.brand}</option>)}</datalist>
      {match && <p className="golf-hint">Flight numbers filled in for the {match.brand} {match.name}. Change them if your copy flies differently.</p>}
      <div className="golf-flight-edit">
        <div className="golf-flight-nums">
          {num('speed', 'Speed')}{num('glide', 'Glide')}{num('turn', 'Turn')}{num('fade', 'Fade')}
        </div>
        <FlightSketch disc={d} hand={hand} />
      </div>
      <div className="golf-layout-fields">
        <label className="golf-field">Brand<input className="golf-input" value={d.brand || ''} maxLength={40} onChange={(e) => set({ brand: e.target.value })} /></label>
        <label className="golf-field">Plastic<input className="golf-input" value={d.plastic || ''} maxLength={40} onChange={(e) => set({ plastic: e.target.value })} /></label>
        <label className="golf-field">Weight (g)<input className="golf-input" inputMode="numeric" value={d.weight ?? ''} onChange={(e) => set({ weight: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label className="golf-field">Colour<input className="golf-input" value={d.color || ''} maxLength={24} placeholder="so you can spot it" onChange={(e) => set({ color: e.target.value })} /></label>
      </div>
      <label className="golf-check"><input type="checkbox" checked={d.inBag} onChange={(e) => set({ inBag: e.target.checked })} /> In the bag</label>
      {d.lost && <p className="golf-hint">Marked lost on {new Date(d.lost.at).toLocaleDateString()}. <button type="button" className="golf-btn is-small" onClick={() => set({ lost: undefined })}>Found it</button></p>}
      <div className="golf-row-actions">
        {onDelete && <button type="button" className="golf-btn is-danger" onClick={onDelete}>Remove</button>}
        <button type="button" className="golf-btn is-primary" disabled={!d.name.trim()} onClick={() => { const clean = cleanDisc(d); if (clean) onSave(clean); }}>Save</button>
      </div>
    </Sheet>
  );
}

export default function BagView({ golf, go, popup, sunlight, setSunlight }: ScreenProps) {
  const user = golf.data.user;
  const [editing, setEditing] = useState<Disc | null>(null);
  const [club, setClub] = useState('');
  const save = (next: Partial<GolfUser>) => golf.saveUser({ ...user, ...next });

  return (
    <div className="golf-screen animate-fade-in">
      <header className="golf-head">
        <div>
          <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
          <h1>Bag &amp; settings</h1>
        </div>
      </header>

      <section className="golf-card">
        <h2>Settings</h2>
        <label className="golf-field">Distances
          <Seg label="Units" value={user.units} onChange={(units) => save({ units })} options={[['imperial', 'Yards & feet'], ['metric', 'Metres']]} />
        </label>
        <label className="golf-field">Throwing (disc golf)
          <Seg label="Throwing hand" value={user.hand} onChange={(hand) => save({ hand })} options={[['RHBH', 'Right backhand'], ['RHFH', 'Right forehand'], ['LHBH', 'Left backhand'], ['LHFH', 'Left forehand']]} />
        </label>
        <label className="golf-check"><input type="checkbox" checked={user.keepAwake} onChange={(e) => save({ keepAwake: e.target.checked })} /> Keep the screen on during a round</label>
        <label className="golf-check"><input type="checkbox" checked={sunlight} onChange={(e) => setSunlight(e.target.checked)} /> Sunlight mode: black on white (this phone only)</label>
        {golf.mode === 'device' && <p className="golf-hint">Kept on this phone until you sign in.</p>}
      </section>

      <section className="golf-card">
        <h2>Discs</h2>
        {user.discs.length === 0 && <p className="golf-muted">Add your discs to mark which one you threw. Your distances with each, and the lost-disc search, learn from that.</p>}
        <div className="golf-pick-list">
          {[...user.discs].sort((a, b) => Number(b.inBag) - Number(a.inBag) || b.speed - a.speed).map((d) => (
            <button key={d.id} type="button" className={`golf-pick${d.inBag ? '' : ' is-out'}`} onClick={() => setEditing(d)}>
              <strong>{d.name}{d.lost ? ' · lost' : ''}</strong>
              <small>{d.speed} / {d.glide} / {d.turn} / {d.fade}{d.brand ? ` · ${d.brand}` : ''}{d.plastic ? ` ${d.plastic}` : ''}{d.color ? ` · ${d.color}` : ''}{d.inBag ? '' : ' · not in the bag'}</small>
            </button>
          ))}
        </div>
        <button type="button" className="golf-btn" onClick={() => setEditing({ id: newId(8), name: '', speed: 7, glide: 5, turn: 0, fade: 2, inBag: true })}>+ Add a disc</button>
      </section>

      <section className="golf-card">
        <h2>Clubs</h2>
        {user.clubs.length === 0 && (
          <button type="button" className="golf-btn" onClick={() => save({ clubs: STARTER_CLUBS.map((name) => ({ id: newId(8), name })) })}>Start with the usual 14</button>
        )}
        <ul className="golf-clubs">
          {user.clubs.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <button type="button" className="golf-icon-btn" aria-label={`Remove ${c.name}`} onClick={() => save({ clubs: user.clubs.filter((x) => x.id !== c.id) })}>✕</button>
            </li>
          ))}
        </ul>
        <div className="golf-row-actions">
          <input className="golf-input" value={club} maxLength={30} placeholder="Add a club" onChange={(e) => setClub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && club.trim()) { save({ clubs: [...user.clubs, { id: newId(8), name: club.trim() }] }); setClub(''); } }} />
          <button type="button" className="golf-btn" disabled={!club.trim()} onClick={() => { save({ clubs: [...user.clubs, { id: newId(8), name: club.trim() }] }); setClub(''); }}>Add</button>
        </div>
      </section>

      {editing && (
        <DiscEditor disc={editing} hand={user.hand} onClose={() => setEditing(null)}
          onSave={(d) => { save({ discs: user.discs.some((x) => x.id === d.id) ? user.discs.map((x) => (x.id === d.id ? d : x)) : [...user.discs, d] }); setEditing(null); }}
          onDelete={user.discs.some((x) => x.id === editing.id) ? async () => {
            if (await popup.confirm({ title: `Remove ${editing.name}?`, message: 'Shots already marked with it keep their distances.', confirmLabel: 'Remove', danger: true })) {
              save({ discs: user.discs.filter((x) => x.id !== editing.id) });
              setEditing(null);
            }
          } : undefined} />
      )}
    </div>
  );
}
