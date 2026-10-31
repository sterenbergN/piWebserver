'use client';

import { useState } from 'react';
import HouseholdPanel from '@/components/chores/HouseholdPanel';
import type { useSitePopup } from '@/components/SitePopup';
import type { Kitchen } from './useKitchen';

const names = (list: string[]) => new Intl.ListFormat('en').format(list);

/** The pill above the plan and the list: who it's shared with, and the way to change that. */
export function HouseholdBar({ kitchen, canEdit, onOpen }: { kitchen: Kitchen; canEdit: boolean; onOpen: () => void }) {
  const { household } = kitchen;
  if (!canEdit) {
    return (
      <button type="button" className="rc-household" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>
        <span aria-hidden>👥</span> Sign in to share this with your household
      </button>
    );
  }
  if (!household) return null; // the admin login isn't an account, so it has no household
  const others = household.members.filter((m) => m.id !== household.me);
  return (
    <button type="button" className={`rc-household${others.length ? ' is-shared' : ''}`} onClick={onOpen}>
      {others.length ? (
        <>
          <span className="rc-household-faces" aria-hidden>
            {others.slice(0, 3).map((m) => <span key={m.id} className="nav-avatar">{m.name.slice(0, 1).toUpperCase()}</span>)}
          </span>
          Shared with {names(others.map((m) => m.name))}
        </>
      ) : (
        <><span aria-hidden>👥</span> Share with your household</>
      )}
    </button>
  );
}

export default function HouseholdSheet({
  kitchen,
  confirm,
  onClose,
}: {
  kitchen: Kitchen;
  confirm: ReturnType<typeof useSitePopup>['confirm'];
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const { household, householdOp } = kitchen;
  if (!household) return null;

  return (
    <div className="rc-sheet-backdrop" onClick={onClose}>
      <div className="rc-sheet rc-household-sheet" role="dialog" aria-modal="true" aria-label="Your household" onClick={(e) => e.stopPropagation()}>
        <div className="rc-sheet-head">
          <h2>Your household</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="rc-meta">Everyone in it sees the same meal plan, grocery list and chores, and can change them from their own phone.</p>
        {error && <p className="rc-sheet-error" role="alert">{error}</p>}
        <HouseholdPanel
          members={household.members}
          me={household.me}
          invite={household.invite}
          confirm={confirm}
          op={async (op, code) => {
            const problem = await householdOp(op, code);
            setError(problem ?? '');
            return !problem;
          }}
        />
      </div>
    </div>
  );
}
