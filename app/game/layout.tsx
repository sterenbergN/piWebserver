import type { Metadata } from 'next';
import './arcade.css';
import { homeScreenMetadata } from '@/lib/home-apps';

export const metadata: Metadata = { ...homeScreenMetadata('game'), title: 'Arcade', description: 'Arcade games, classic and original: Snake, 2048, Breakout, Blocks, Flap, Setpoint, Chain Reaction and Merge Snake, each with a leaderboard.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
