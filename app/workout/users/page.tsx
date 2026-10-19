import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import PageHeader from '@/components/workout/PageHeader';
import WorkoutUsersPanel from '@/components/workout/WorkoutUsersPanel';

export const metadata: Metadata = { title: 'Workout users', robots: { index: false, follow: false } };

/** Site admin only: who can sign in to the workout tracker. */
export default async function WorkoutUsersPage() {
  if (!(await isAdminAuthenticated())) redirect('/login');
  return (
    <div className="animate-fade-in" style={{ paddingBottom: '3rem' }}>
      <PageHeader title="Workout users" subtitle="People who can sign in to the workout tracker. Only you (the site admin) can see this page." />
      <WorkoutUsersPanel />
    </div>
  );
}
