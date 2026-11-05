import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('daily'), title: 'Daily questions', description: 'A daily engineering question (mechanical, controls and automation) with worked solutions, sources and a formula sheet.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
