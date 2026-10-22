import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Leaderboard', description: 'Who is ahead on daily questions, habits, chores and overall level.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
