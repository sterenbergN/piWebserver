import type { Metadata } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = {
  ...homeScreenMetadata('wishlist'),
  title: 'Wishlist',
  description: 'Lists of things I want, with links, pictures and prices, to share for birthdays and Christmas.',
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
