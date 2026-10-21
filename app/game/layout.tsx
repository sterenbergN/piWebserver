import type { Metadata } from 'next';
import './arcade.css';

export const metadata: Metadata = { title: 'Arcade', description: 'Arcade games, classic and original: Snake, 2048, Breakout, Blocks, Flap, Setpoint and Chain Reaction, each with a leaderboard.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
