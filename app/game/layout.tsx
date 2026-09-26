import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Snake', description: 'Play Snake and climb the leaderboard.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
