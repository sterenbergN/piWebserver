import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('journal'), title: 'Journal', description: 'A private daily journal, only readable by your account.', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
