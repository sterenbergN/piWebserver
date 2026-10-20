'use client';

import { useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { AddExerciseForGym } from '@/components/workout/AddExerciseFlow';
import { uidOf } from '@/lib/workout/tracker-utils';
import type { SwapGroup } from '@/lib/workout/related-exercises';
import type { Gym, Lift, Station } from '@/lib/workout/types';
import InlineGymEditor from '../InlineGymEditor';

// The tracker's secondary screens, each a sheet over the workout.

type MenuProps = {
  onClose: () => void;
  onPause: () => void;
  onFinish: () => void;
  onDelete: () => void;
  partner: {
    active: boolean;
    code: string | null;
    inviteLink: string;
    loading: boolean;
    error: string;
    onStart: () => void;
    onLeave: () => void;
  };
};

export function WorkoutMenu({ onClose, onPause, onFinish, onDelete, partner }: MenuProps) {
  const [copied, setCopied] = useState(false);
  const shareInvite = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: 'Lift with me', text: `Join my workout with code ${partner.code}`, url: partner.inviteLink }); return; } catch { /* fall back to copy */ }
    }
    await navigator.clipboard?.writeText(partner.inviteLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet title="Workout" onClose={onClose}>
      <div className="workout-stack is-loose">
        <button className="workout-button is-block" onClick={onPause}>⏸ Pause — resume later from the home page</button>
        <button className="workout-button is-block" onClick={onFinish}>🏁 Finish workout</button>

        <div className="workout-tile" style={{ margin: 0 }}>
          <strong style={{ display: 'block', marginBottom: '0.25rem' }}>👥 Partner mode</strong>
          {partner.active ? (<>
            <p className="workout-hint" style={{ margin: '0 0 0.5rem' }}>You each log your own sets and see each other&apos;s progress live.</p>
            {partner.code && (
              <div style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '0.25rem', color: 'var(--accent)', margin: '0.25rem 0 0.5rem' }}>{partner.code}</div>
            )}
            <div className="workout-grid-2">
              <button className="workout-button" onClick={shareInvite} disabled={!partner.inviteLink}>{copied ? '✅ Link copied' : '📤 Invite'}</button>
              <button className="workout-button" onClick={partner.onLeave}>Leave</button>
            </div>
          </>) : (<>
            <p className="workout-hint" style={{ margin: '0 0 0.5rem' }}>Training with someone? They join with a code (or link) and get the same lifts.</p>
            <button className="workout-button is-primary is-block" disabled={partner.loading} onClick={partner.onStart}>{partner.loading ? 'Starting…' : 'Start partner mode'}</button>
          </>)}
          {partner.error && <p className="workout-error" style={{ margin: '0.5rem 0 0' }}>{partner.error}</p>}
        </div>

        <button className="workout-button is-danger is-block" onClick={onDelete}>Delete workout</button>
      </div>
    </Sheet>
  );
}

type ListProps = {
  plan: any;
  activeIndex: number;
  logs: Record<string, unknown[]>;
  targetSets: (lift: any) => number;
  partnerOf: (lift: any) => any;
  startAdding: boolean;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onAdd: (entries: { lift: Lift; station: Station }[]) => void;
  onGymUpdated: (gym: Gym) => void;
  onClose: () => void;
};

/** Every lift in the workout, adding exercises, and the gym's equipment. */
export function WorkoutListSheet({ plan, activeIndex, logs, targetSets, partnerOf, startAdding, onSelect, onRemove, onAdd, onGymUpdated, onClose }: ListProps) {
  const [adding, setAdding] = useState(startAdding);
  const [editingGym, setEditingGym] = useState(false);
  return (
    <Sheet title="Workout plan" subtitle={plan.name} onClose={onClose}>
      <div className="workout-stack" style={{ marginBottom: '1rem' }}>
        {plan.lifts.map((lift: any, i: number) => {
          const done = (logs[uidOf(lift)] || []).length;
          const target = targetSets(lift);
          const partner = partnerOf(lift);
          return (
            <div key={uidOf(lift)} style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" className={`workout-lift-row${i === activeIndex ? ' is-current' : ''}${done >= target ? ' is-done' : ''}`} onClick={() => onSelect(i)}>
                <span className="workout-card-text">
                  <span className="workout-card-title">{i + 1}. {lift.name}{partner ? ' · SS' : ''}</span>
                  <span className="workout-card-meta">{lift.station?.name} · {done}/{target} sets{partner ? ` · with ${partner.name}` : ''}</span>
                </span>
                {done >= target && <span aria-hidden>✓</span>}
              </button>
              <button type="button" className="workout-icon-btn" style={{ alignSelf: 'center', color: 'var(--danger)' }} aria-label={`Remove ${lift.name}`} disabled={plan.lifts.length <= 1} onClick={() => onRemove(i)}>✕</button>
            </div>
          );
        })}
      </div>
      {adding ? (
        <AddExerciseForGym
          gymId={plan.gymId}
          onGymUpdated={onGymUpdated}
          inWorkout={new Set(plan.lifts.map((l: any) => l.id))}
          onAdd={onAdd}
          onCancel={() => setAdding(false)}
        />
      ) : (<>
        <button className="workout-btn-primary" style={{ margin: '0 0 0.6rem' }} onClick={() => setAdding(true)}>＋ Add exercise</button>
        {/* Per-lift edits are on the lift screen (✏️ / ⚙️); this is for bigger changes. */}
        <button type="button" className="workout-text-btn" style={{ display: 'block', margin: '0.25rem auto 0', textDecoration: 'underline' }} onClick={() => setEditingGym(true)}>
          ⚙️ Edit all equipment at {plan.gymName || 'this gym'}
        </button>
      </>)}
      {editingGym && (
        <Sheet title="Equipment" subtitle={plan.gymName} onClose={() => setEditingGym(false)}>
          <InlineGymEditor gymId={plan.gymId} onGymUpdated={onGymUpdated} />
        </Sheet>
      )}
    </Sheet>
  );
}

/** Every other lift at this gym, grouped from most to least like the current one. */
export function SwapLiftSheet({ alternatives, onSwap, onClose }: { alternatives: SwapGroup<any>[]; onSwap: (lift: any) => void; onClose: () => void }) {
  return (
    <Sheet title="Swap exercise" subtitle="Closest matches first" onClose={onClose}>
      {alternatives.length === 0 && <p className="workout-hint">No other lifts are set up at this gym yet.</p>}
      {alternatives.map((group) => (
        <section key={group.label} style={{ marginBottom: '0.9rem' }}>
          <span className="workout-label" style={{ display: 'block', marginBottom: '0.35rem' }}>{group.label}</span>
          <div className="workout-stack">
            {group.lifts.map((lift) => (
              <button key={`${lift.gymId || ''}-${lift.id}`} type="button" className="workout-lift-row" onClick={() => onSwap(lift)}>
                <span className="workout-card-text">
                  <span className="workout-card-title">{lift.name}</span>
                  <span className="workout-card-meta">{lift.station?.name} · {lift.primaryMuscle}{lift.secondaryMuscle && lift.secondaryMuscle !== 'None' ? ` • ${lift.secondaryMuscle}` : ''}</span>
                </span>
                <span style={{ flexShrink: 0, fontSize: '0.85rem' }}>Swap 🔄</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  );
}

type SupersetProps = {
  lift: any;
  partner: any;
  logged: (lift: any) => number;
  targetSets: (lift: any) => number;
  eligible: any[];
  canUnpair: boolean;
  onPair: (lift: any) => void;
  onUnpair: () => void;
  onClose: () => void;
};

/** Pair the current lift with another (alternate sets) or undo a pair. */
export function SupersetSheet({ lift, partner, logged, targetSets, eligible, canUnpair, onPair, onUnpair, onClose }: SupersetProps) {
  return (
    <Sheet title="Superset" subtitle={lift.name} onClose={onClose}>
      {partner ? (<>
        <div className="workout-tile">
          <span className="workout-label">Paired with</span>
          <strong style={{ display: 'block' }}>{partner.name}</strong>
          <span className="workout-hint">{logged(partner)}/{targetSets(partner)} sets logged</span>
          <p className="workout-hint" style={{ margin: '0.6rem 0 0' }}>After each set the tracker switches to the other lift, until one side is finished.</p>
        </div>
        <button className="workout-button is-danger is-block" disabled={!canUnpair} onClick={onUnpair}>Remove pair</button>
      </>) : (<>
        <p className="workout-hint" style={{ marginTop: 0 }}>Pick a lift to alternate with this one, set by set.</p>
        <div className="workout-stack">
          {eligible.map((other) => (
            <button key={uidOf(other)} type="button" className="workout-lift-row" onClick={() => onPair(other)}>
              <span className="workout-card-text">
                <span className="workout-card-title">{other.name}</span>
                <span className="workout-card-meta">{other.station?.name} · {logged(other)}/{targetSets(other)} sets logged</span>
              </span>
              <span style={{ flexShrink: 0, fontSize: '0.85rem' }}>Pair</span>
            </button>
          ))}
          {eligible.length === 0 && <p className="workout-hint">No lifts left to pair: only unfinished, unpaired lifts can be added to a superset.</p>}
        </div>
      </>)}
    </Sheet>
  );
}
