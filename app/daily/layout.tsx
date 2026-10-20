import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Daily questions', description: 'A daily engineering question (mechanical, controls and automation) with worked solutions, sources and a formula sheet.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
