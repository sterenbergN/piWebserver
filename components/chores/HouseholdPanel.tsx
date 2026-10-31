'use client';

import { useState } from 'react';
import type { useSitePopup } from '@/components/SitePopup';
import type { Member } from './useChores';
import './household.css';

type Props = {
  members: Member[];
  me: string | null;
  invite: string | null;
  op: (op: 'invite' | 'invite-off' | 'join' | 'leave', code?: string) => Promise<boolean>;
  confirm: ReturnType<typeof useSitePopup>['confirm'];
};

/** Who's in, an invite code and joining with one: the same household for chores, the meal plan and the grocery list. */
export default function HouseholdPanel({ members, me, invite, op, confirm }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const join = () => run(async () => {
    const ok = await confirm({
      title: 'Join this household?',
      message: members.length > 1
        ? 'You’ll leave your current household; its chores, meal plan and grocery list stay with the others in it.'
        : 'Your chores, meal plan and grocery list move into the household you join, and everyone in it shares them.',
      confirmLabel: 'Join',
    });
    if (ok && await op('join', code)) setCode('');
  });
  const leave = () => run(async () => {
    const ok = await confirm({ title: 'Leave the household?', message: 'The chores, meal plan and grocery list stay with everyone else. You start again with empty ones of your own.', confirmLabel: 'Leave', danger: true });
    if (ok) await op('leave');
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select it by hand */ }
  };

  return (
    <>
      <section className="hh-section">
        <h3>Who’s in</h3>
        <ul className="hh-members">
          {members.map((m) => (
            <li key={m.id}><span className="nav-avatar" aria-hidden>{m.name.slice(0, 1).toUpperCase()}</span>{m.name}{m.id === me ? ' (you)' : ''}</li>
          ))}
        </ul>
        {members.length > 1 && <button type="button" className="hh-leave" disabled={busy} onClick={leave}>Leave this household</button>}
      </section>

      <section className="hh-section">
        <h3>Invite someone</h3>
        {invite ? (
          <>
            <div className="hh-code" aria-label={`Invite code ${invite.split('').join(' ')}`}>{invite}</div>
            <p className="hh-hint">They sign in with their own account, open <strong>Chores → Household</strong> or the <strong>Grocery list</strong>, and enter this code. It keeps working until you turn it off.</p>
            <div className="hh-code-actions">
              <button type="button" className="hh-btn is-primary" onClick={copy}>{copied ? '✓ Copied' : 'Copy code'}</button>
              <button type="button" className="hh-btn" disabled={busy} onClick={() => run(() => op('invite'))}>New code</button>
              <button type="button" className="hh-btn" disabled={busy} onClick={() => run(() => op('invite-off'))}>Turn off</button>
            </div>
          </>
        ) : (
          <>
            <p className="hh-hint">Make a code for someone with an account on this site (accounts are made by Noah).</p>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(() => op('invite'))}>Make an invite code</button>
          </>
        )}
      </section>

      <section className="hh-section">
        <h3>Join a household</h3>
        <form className="hh-join" onSubmit={(e) => { e.preventDefault(); if (code.trim()) join(); }}>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="Code" aria-label="Invite code"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          <button type="submit" className="btn btn-secondary" disabled={busy || code.replace(/\W/g, '').length < 6}>Join</button>
        </form>
      </section>
    </>
  );
}
