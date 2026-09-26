import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tools', description: 'Unit converter, movie picker, restaurant finder and golf scorecard.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
