import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Posts', description: 'Build logs, write-ups and notes.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
