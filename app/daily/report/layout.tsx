import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Strengths & weaknesses', description: 'Your engineering question strengths and weaknesses by track and topic, with what to practise next.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
