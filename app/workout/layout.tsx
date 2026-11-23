import './workout.css';
import OverflowGuard from '@/components/workout/OverflowGuard';
import NoZoom from '@/components/workout/NoZoom';
import WorkoutTabBar from '@/components/workout/WorkoutTabBar';
import { Metadata, Viewport } from 'next';
import { homeScreenMetadata } from '@/lib/home-apps';

// Its own app on a home screen, opening on /workout (the site's main app opens on the home page).
export const metadata: Metadata = {
  ...homeScreenMetadata('workout'),
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
