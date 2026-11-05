import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('stats'), title: 'System Stats', description: 'Live stats from the Raspberry Pi running this site.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
