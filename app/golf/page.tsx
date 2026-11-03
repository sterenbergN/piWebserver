import GolfApp from '@/components/golf/GolfApp';

// One page for the whole tracker, so the service worker can keep it for the course.
export default function GolfPage() {
  return <GolfApp />;
}
