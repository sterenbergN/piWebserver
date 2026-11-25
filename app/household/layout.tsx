import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Household',
  description: 'Who you share chores, the meal plan, the grocery list and wishlists with.',
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
