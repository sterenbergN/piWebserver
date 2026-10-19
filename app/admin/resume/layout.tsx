import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Edit home page', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
