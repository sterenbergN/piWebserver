import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('gallery'), title: 'Gallery', description: 'Photo albums.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
