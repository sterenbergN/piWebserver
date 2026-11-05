import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './golf.css';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = {
  ...homeScreenMetadata('golf'),
  title: 'Golf & disc golf',
  description: 'Score golf and disc golf rounds with friends, measure shots with GPS on a satellite map, and see your numbers over time.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
