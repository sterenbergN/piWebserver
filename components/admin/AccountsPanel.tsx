'use client';

import WorkoutUsersPanel from '@/components/workout/WorkoutUsersPanel';
import '@/app/workout/workout.css';

/** Who can sign in. One account covers the whole site, not only workouts. */
export default function AccountsPanel() {
  return (
    <section className="adm-card">
      <div className="adm-card-head">
        <div>
          <h2>Accounts</h2>
          <p>People who can sign in. An account keeps their workouts, habits, journal, chores and groceries, and they can share a household with each other.</p>
        </div>
      </div>
      <WorkoutUsersPanel />
    </section>
  );
}
