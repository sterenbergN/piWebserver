import type { Metadata } from 'next';
import './party.css';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = {
  ...homeScreenMetadata('party'),
  title: 'Party Games',
  description: 'Play Jackbox-style games with your friends.',
};

export default function PartyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="party-root">
      {children}
    </div>
  );
}
