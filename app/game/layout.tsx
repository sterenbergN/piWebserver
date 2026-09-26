import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Arcade', description: 'Play Snake and 2048 and climb the leaderboards.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
