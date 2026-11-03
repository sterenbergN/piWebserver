'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { DEVICE_PLAYER } from '@/lib/golf/round';
import Hub from './Hub';
import NewRound from './NewRound';
import RoundScreen from './RoundScreen';
import JoinRound from './JoinRound';
import StatsView from './StatsView';
import CourseView from './CourseView';
import BagView from './BagView';
import FindDisc from './FindDisc';
import { prepareOffline } from './offline';
import { useGolf } from './useGolf';
import { useHashRoute } from './ui';

export default function GolfApp() {
  const golf = useGolf();
  const [route, go] = useHashRoute();
  const popup = useSitePopup();
  // Per phone, not per account: it's about this screen in this light.
  const [sunlight, setSunlightState] = useState(false);
  useEffect(() => { try { setSunlightState(localStorage.getItem(SUNLIGHT_KEY) === '1'); } catch { /* blocked */ } }, []);
  const setSunlight = (on: boolean) => {
    setSunlightState(on);
    try { localStorage.setItem(SUNLIGHT_KEY, on ? '1' : '0'); } catch { /* blocked */ }
  };

  useEffect(() => {
    if (golf.mode !== 'loading') void prepareOffline().catch(() => {});
  }, [golf.mode]);

  if (golf.mode === 'loading') return <main className={`golf${sunlight ? ' is-sunlight' : ''}`}><p className="golf-muted">Loading…</p></main>;

  // Signed out, "you" in a round is the player marked as this device.
  const me = golf.mode === 'account' ? golf.userId! : DEVICE_PLAYER;
  const [view, a, b] = route;
  const props = { golf, me, go, popup, sunlight, setSunlight };
  let screen;
  if (view === 'new') screen = <NewRound {...props} sport={a === 'disc' ? 'disc' : 'golf'} />;
  else if (view === 'round' && a) screen = <RoundScreen {...props} roundId={a} />;
  else if (view === 'join' && a && b) screen = <JoinRound {...props} roundId={a} code={b} />;
  else if (view === 'stats') screen = <StatsView {...props} />;
  else if (view === 'course' && a) screen = <CourseView {...props} courseId={a} />;
  else if (view === 'bag') screen = <BagView {...props} />;
  else if (view === 'find') screen = <FindDisc {...props} roundId={a} shotId={b} />;
  else screen = <Hub {...props} />;

  return (
    <main className={`golf${sunlight ? ' is-sunlight' : ''}`}>
      {screen}
      {golf.notice && (
        <div className="golf-toast" role="status">
          <span>{golf.notice}</span>
          <button type="button" className="golf-icon-btn" aria-label="Dismiss" onClick={golf.clearNotice}>✕</button>
        </div>
      )}
      {popup.popup}
    </main>
  );
}

export type ScreenProps = {
  golf: ReturnType<typeof useGolf>;
  /** The account id, or the device stand-in when signed out. */
  me: string;
  go: (path: string, replace?: boolean) => void;
  popup: ReturnType<typeof useSitePopup>;
  /** Black on white for reading in direct sun. */
  sunlight: boolean;
  setSunlight: (on: boolean) => void;
};

const SUNLIGHT_KEY = 'golf:sunlight';
