import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Library', description: 'Documents and PDFs.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
