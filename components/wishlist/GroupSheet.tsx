'use client';

import { useState } from 'react';
import { formatPrice, MAX_RULES, pickOfGroup, type OwnerList, type PriceRule, type WishGroup } from '@/lib/wishlist/model';
import { Sheet } from './Sheets';
import './wishlist.css';

export type GroupDraft = { name: string; itemIds: string[]; rules: PriceRule[]; fallback: string };

const OPS: { value: PriceRule['op']; label: string }[] = [
  { value: 'atMost', label: 'costs at most' },
  { value: 'over', label: 'costs more than' },
  { value: 'withinOf', label: 'costs at most…' },
];

/**
 * Alternatives for one want: tick the items that could stand in for each other,
 * then say which to show on top depending on price ("the newer one if it's no more
 * than $100 more than the old one; the cheap one if the newer is over $600").
 */
export default function GroupSheet({ list, group, onSave, onDelete, onClose }: {
  list: OwnerList;
  group: WishGroup | null;
  onSave: (draft: GroupDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [ids, setIds] = useState<string[]>(() => (group ? list.items.filter((i) => i.group === group.id).map((i) => i.id) : []));
  const [rules, setRules] = useState<PriceRule[]>(group?.rules ?? []);
  const [fallback, setFallback] = useState(group?.fallback ?? '');

  const candidates = list.items.filter((i) => !i.gotIt || ids.includes(i.id));
  const members = list.items.filter((i) => ids.includes(i.id));
  const title = (id: string | undefined) => list.items.find((i) => i.id === id)?.title ?? '';
  const otherGroup = (groupId: string) => list.groups.find((g) => g.id === groupId)?.name ?? 'another group';

  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setIds(next);
    // A rule about an item that's no longer in the group can't hold.
    setRules((old) => old.filter((r) => [r.pick, r.subject, r.other].every((x) => !x || next.includes(x))));
    if (fallback && !next.includes(fallback)) setFallback('');
  };
  const setRule = (index: number, patch: Partial<PriceRule>) => setRules((old) => old.map((r, i) => {
    if (i !== index) return r;
    const next = { ...r, ...patch };
    if (next.op === 'withinOf' && (!next.other || next.other === next.subject)) next.other = members.find((m) => m.id !== next.subject)?.id;
    if (next.op !== 'withinOf') delete next.other;
    return next;
  }));
  const move = (index: number, dir: -1 | 1) => setRules((old) => {
    const to = index + dir;
    if (to < 0 || to >= old.length) return old;
    const copy = [...old];
    [copy[index], copy[to]] = [copy[to], copy[index]];
    return copy;
  });
  const addRule = () => {
    const subject = members[1] ?? members[0];
    setRules((old) => [...old, { pick: subject.id, subject: subject.id, op: 'atMost', amount: subject.price ?? 0 }]);
  };

  // What givers would see on top with these choices and today's prices.
  const preview = members.length < 2 ? null
    : pickOfGroup({ id: '__draft', rules, fallback }, list.items.map((i) => ({ ...i, group: ids.includes(i.id) ? '__draft' : '' })));

  const itemSelect = (value: string | undefined, onChange: (id: string) => void, label: string) => (
    <select value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {members.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
    </select>
  );

  return (
    <Sheet title={group ? 'Group of alternatives' : 'Group alternatives'} onClose={onClose}>
      <form className="wl-form" onSubmit={(e) => { e.preventDefault(); onSave({ name, itemIds: ids, rules, fallback }); }}>
        <label>What it’s for<input value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. A vacuum" /></label>

        <fieldset className="wl-group-pick">
          <legend>Any one of these would do</legend>
          {candidates.map((item) => (
            <label key={item.id} className="wl-check">
              <input type="checkbox" checked={ids.includes(item.id)} onChange={() => toggle(item.id)} />
              <span>
                {item.title}
                {item.price !== null && <em> · {formatPrice(item.price, item.currency)}</em>}
                {item.group && item.group !== group?.id && <em> · moves out of “{otherGroup(item.group)}”</em>}
              </span>
            </label>
          ))}
        </fieldset>

        {members.length >= 2 && (
          <div className="wl-rules">
            <span className="wl-rules-title">Which to show on top</span>
            {rules.map((rule, i) => (
              <div key={i} className="wl-rule">
                <span>{i === 0 ? 'Show' : 'Else show'}</span>
                {itemSelect(rule.pick, (pick) => setRule(i, { pick }), `Rule ${i + 1}: item to show`)}
                <span>if</span>
                {itemSelect(rule.subject, (subject) => setRule(i, { subject }), `Rule ${i + 1}: item whose price is checked`)}
                <select value={rule.op} aria-label={`Rule ${i + 1}: comparison`} onChange={(e) => setRule(i, { op: e.target.value as PriceRule['op'] })}>
                  {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span>$</span>
                <input type="number" inputMode="decimal" min={0} step="any" value={Number.isFinite(rule.amount) ? rule.amount : ''} aria-label={`Rule ${i + 1}: amount`}
                  onChange={(e) => setRule(i, { amount: Math.max(0, Number(e.target.value) || 0) })} />
                {rule.op === 'withinOf' && (
                  <>
                    <span>more than</span>
                    {itemSelect(rule.other, (other) => setRule(i, { other }), `Rule ${i + 1}: compared with`)}
                  </>
                )}
                <span className="wl-rule-tools">
                  <button type="button" className="wl-icon" aria-label={`Move rule ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="wl-icon" aria-label={`Move rule ${i + 1} down`} disabled={i === rules.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button type="button" className="wl-icon" aria-label={`Remove rule ${i + 1}`} onClick={() => setRules((old) => old.filter((_, j) => j !== i))}>✕</button>
                </span>
              </div>
            ))}
            {rules.length < MAX_RULES && <button type="button" className="wl-link" onClick={addRule}>+ Add a price rule</button>}
            <label className="wl-rule">
              <span>{rules.length ? 'If none of those hold, show' : 'Show'}</span>
              <select value={fallback} onChange={(e) => setFallback(e.target.value)}>
                <option value="">the first one ({members[0]?.title})</option>
                {members.slice(1).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </label>
            {preview && (
              <p className="wl-notice" role="status">
                Right now: <strong>{title(preview.itemId)}</strong>{preview.reason ? `, because ${preview.reason}.` : rules.length ? ' (no rule holds at today’s prices).' : '.'}
              </p>
            )}
          </div>
        )}

        <p className="wl-hint">People see the one on top first, with the others below. When someone gets any of them, the rest are covered too. Prices with a link are checked every day.</p>
        <div className="wl-row">
          <button type="submit" className="btn btn-primary" disabled={members.length < 2}>Save group</button>
          {onDelete && <button type="button" className="btn btn-secondary wl-danger" onClick={onDelete}>Ungroup</button>}
        </div>
      </form>
    </Sheet>
  );
}
