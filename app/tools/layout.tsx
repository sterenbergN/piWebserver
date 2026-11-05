import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('tools'), title: 'Tools', description: 'Unit converter, movie picker and restaurant finder.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
