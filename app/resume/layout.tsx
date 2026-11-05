import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('resume') };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
