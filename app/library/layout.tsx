import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('library'), title: 'Library', description: 'Documents and PDFs.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
