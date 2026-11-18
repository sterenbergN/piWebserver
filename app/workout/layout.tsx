import './workout.css';
import OverflowGuard from '@/components/workout/OverflowGuard';
import NoZoom from '@/components/workout/NoZoom';
import WorkoutTabBar from '@/components/workout/WorkoutTabBar';
import { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Workout Tracker',
  description: 'Mobile-first workout tracker',
};

// Fit mobile viewports cleanly without blocking user pinch-to-zoom.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function WorkoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="workout-mobile-container animate-fade-in">
      {children}
      <WorkoutTabBar />
      <NoZoom />
      <OverflowGuard />
    </div>
  );
}
