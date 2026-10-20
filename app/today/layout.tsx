import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Today', description: 'Today’s engineering question, habits and workout in one place.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
