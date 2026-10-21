import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Chores', description: 'A shared chore list with due dates and repeats: tick things off together, earn XP and grow a garden.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
