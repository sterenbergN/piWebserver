import './workout.css';
import OverflowGuard from '@/components/workout/OverflowGuard';
import NoZoom from '@/components/workout/NoZoom';
import { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Workout Tracker',
  description: 'Mobile-first workout tracker',
};

// Fit the phone screen with no zooming (NoZoom also blocks pinches).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function WorkoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="workout-mobile-container animate-fade-in">
      {children}
      <NoZoom />
      <OverflowGuard />
    </div>
  );
}
