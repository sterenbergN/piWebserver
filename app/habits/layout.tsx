import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('habits'), title: 'Habits', description: 'Track daily habits, keep streaks, grow a garden and see how consistent you are.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
