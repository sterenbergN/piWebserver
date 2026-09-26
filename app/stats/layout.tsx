import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'System Stats', description: 'Live stats from the Raspberry Pi running this site.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
