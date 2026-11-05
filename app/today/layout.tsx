import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('today'), title: 'Today', description: 'Today’s engineering question, habits and workout in one place.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
