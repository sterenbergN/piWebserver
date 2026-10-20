import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Habits', description: 'Track daily habits, keep streaks, grow a garden and see how consistent you are.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
