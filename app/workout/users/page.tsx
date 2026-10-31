import { redirect } from 'next/navigation';

/** Accounts moved to the admin page; this keeps old links working. */
export default function WorkoutUsersPage() {
  redirect('/admin#accounts');
}
