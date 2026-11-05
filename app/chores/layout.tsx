import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('chores'), title: 'Chores', description: 'A shared chore list with due dates and repeats: tick things off together, earn XP and grow a garden.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
