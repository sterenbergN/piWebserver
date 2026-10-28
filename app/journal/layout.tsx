import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Journal', description: 'A private daily journal, only readable by your account.', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
