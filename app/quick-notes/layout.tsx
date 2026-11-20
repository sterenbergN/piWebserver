import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('quick-notes'), title: 'Quick notes', description: 'Things jotted down from anywhere on the site, to check off and clear later.', robots: { index: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
