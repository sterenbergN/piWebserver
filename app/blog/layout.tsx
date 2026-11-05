import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('blog'), title: 'Posts', description: 'Build logs, write-ups and notes.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
