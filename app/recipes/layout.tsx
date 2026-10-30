import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recipes',
  description: 'Recipes with a step-by-step cook mode, scaling, kitchen timers and grocery lists.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
