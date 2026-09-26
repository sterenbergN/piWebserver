import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Gallery', description: 'Photo albums.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
