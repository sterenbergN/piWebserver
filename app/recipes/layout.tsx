import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recipes',
  description:
    'Engineering-style recipe spec sheets with single-source-of-truth inline ingredients, auto-extracted Bill of Materials, parallel Gantt timelines, live scaling, and inline kitchen timers.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
