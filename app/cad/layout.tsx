import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = {
  ...homeScreenMetadata('cad'),
  title: '3D Models & CAD',
  description: 'Interactive 3D parts, assemblies, and CAD designs.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
