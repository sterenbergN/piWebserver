# Golf and disc golf — plan

One tracker for both sports, tied to site accounts, that keeps long-term stats and
shows real distances on a satellite map. It replaces the scorecard in Tools
(`components/tools/GolfTrackerTool.tsx`).

Status (2026-11-03): phases 1–5 built, replacing an earlier build that didn't follow
this plan. Not used on a real course yet (see the last section). Not built yet: the
whole-round map and comparing two rounds on one map. This covers ideas 2 and 3 from
the ideas list. Practice drills (14) and tournaments (8) build on it later and get
their own plans.

## Ground rules

- **Phone first, one hand, outdoors.** One hole per screen, big steppers, nothing
  that needs typing mid-round. A high-contrast option for sunlight.
- **A round never waits on the network.** Courses lose signal. Everything saves on
  the phone first and syncs when it can.
- **Few taps.** GPS is for drives and any shot you choose to mark, never required.
  A round with no GPS at all is still a complete round.
- **Honest numbers.** Phone GPS is good to about 3–10 m, so distances show their
  accuracy, putts never come from GPS, and the lost-disc area is a probability
  region from your own throws, not a physics simulation.
- **No TV mode.** Everything is for phones.
- **No new levels.** XP (when practice comes) feeds the one site level in
  `lib/progress/levels.ts`.

## Decisions

| Question | Answer |
|---|---|
| Accounts | Site accounts (`workout_auth`, `getAuthenticatedWorkoutUserId`). Signed out, rounds live on the device and move into the account on sign-in, like the rest of the site. |
| Players in a round | Each is an account or a guest name. A round is stored once; it counts in the stats of every account in it. Anyone in a round can take themselves out of it. |
| GPS shots | Drives plus any shot you pick. |
| Map imagery | Satellite tiles with a free developer key (below). Street map if the key is missing. |
| Map library | Leaflet, plain and imperative in one client component, loaded only on map views. It does raster tiles, lines and circles, which is all this needs. MapLibre is ten times the size for vector maps we don't use. |
| Distance math | Haversine. Its error at 300 m is centimetres; GPS error is metres. |
| Golf handicap | A WHS estimate, only for tees with a course rating and slope entered: best 8 of the last 20 differentials, net double bogey per hole. Labelled an estimate. |
| Disc golf rating | No PDGA rating. It needs the scores of everyone who played the course that day. Instead: against your own average on that course and layout, and personal bests. |
| Old rounds | Imported: `.data/golf-saved-games.json` (you pick which account) and the `golfGames` rounds in a phone's storage. |

## Map key

Esri Location Platform's free tier has the best US imagery. MapTiler's free tier is
the fallback; the tile URL is one setting, so either works.

- The key goes in the Pi's `shared/env` as `GOLF_MAP_KEY` (and `GOLF_MAP_PROVIDER`).
  Builds run on GitHub Actions, so a `NEXT_PUBLIC_` variable would be baked in at
  build time. Instead a server component reads it at request time and hands it to
  the map.
- Restrict the key to the site's domains (`noahstuf.com`, `localhost`) in the
  provider's dashboard. A browser has to see a tile key; the restriction is what
  protects it.
- No bulk downloading of tiles for offline use (both providers forbid it). Tiles
  you've already looked at stay in the browser's normal cache, so a course you
  opened at home will mostly be there.
- Check the free tier's current limits at sign-up. One person's rounds are far
  below any of them.

## Data

All under `.data/golf/` (backups already take everything in `.data`; add a
"Golf" label in `lib/backup.ts`):

- `rounds/<roundId>.json` — one file per round, so saving a hole never rewrites
  every round. `rounds/index.json` lists id, date, sport, course and player
  account ids for fast history.
- `courses/<courseId>.json` — shared by everyone.
- `users/<userId>.json` — bag and settings.

```ts
type Sport = 'golf' | 'disc';
type Fix = { lat: number; lon: number; acc: number; at: string }; // acc = metres

type Course = {
  id: string; sport: Sport; name: string; center: { lat: number; lon: number };
  osm?: string; // where the layout came from, if OpenStreetMap
  layouts: {    // golf: tees (Blue, White…); disc: layouts (Long, Short, A pins…)
    id: string; name: string; rating?: number; slope?: number; // golf only
    holes: { n: number; par: number; length?: number; tee?: Fix; target?: Fix }[];
  }[];
};

type Round = {
  id: string; sport: Sport; courseId: string; layoutId: string;
  date: string; scorerId: string;
  players: { id: string; userId?: string; name: string }[];
  holes: {
    n: number; par: number;
    scores: Record<string, {           // keyed by player id
      strokes: number; putts?: number; penalties?: number;
      fairway?: 'hit' | 'left' | 'right' | 'short'; // golf, par 4/5
      c1?: [made: number, tries: number];           // disc golf putting
      c2?: [made: number, tries: number];
      at: string;                                   // for merging offline edits
    }>;
  }[];
  shots: {
    id: string; playerId: string; hole: number;
    kind: 'drive' | 'approach' | 'other';
    clubId?: string; discId?: string;
    from: Fix; to?: Fix; lost?: boolean;
  }[];
};

type Bag = {
  clubs: { id: string; name: string }[];
  discs: {
    id: string; name: string; brand?: string; plastic?: string; weight?: number; color?: string;
    speed: number; glide: number; turn: number; fade: number;
    inBag: boolean; lost?: { at: string; where: Fix };
  }[];
  throwHand: 'RHBH' | 'RHFH' | 'LHBH' | 'LHFH';
};
```

GIR is worked out, not entered: strokes − putts ≤ par − 2.

## Offline and sync

- The round being played lives in the phone's storage. Each change goes into a
  send queue, the same way `lib/workout/offline-queue.ts` works, and is sent
  per hole, not as the whole round.
- The server merges per player and hole by the `at` time, so two phones scoring
  the same round can't wipe each other out.
- The service worker keeps the `/golf` pages and their code, like the Reader and
  Notes do, so the app opens with no signal.
- Saved, waiting and offline states always show on the hole screen.

## GPS on the course

- **Rangefinder.** When the hole has a pin or basket, the hole screen shows the
  distance to it from where you're standing. For golf this is the feature you'll
  use most.
- **Mark drive.** The start is the hole's tee if it's known, otherwise where you
  stand now. Walk to the ball or disc, tap **Here**. The distance and how far it
  finished off the tee-to-target line are worked out from that.
- **Mark shot.** Anywhere: start where you stand, finish with the next tap.
- **Good fixes.** Each mark watches GPS for a few seconds and keeps the best
  reading. Above 15 m accuracy it says so and lets you wait or use it anyway.
- **Courses learn themselves.** The first time you play a course, the start of
  your first drive becomes the hole's tee, and an optional **Holed** tap becomes
  the pin or basket. Every hole can be fixed by dragging it on the map.
- **OpenStreetMap import.** When you make a course, the Pi asks Overpass once for
  golf (`golf=tee`, `golf=pin`, `golf=hole`) or disc golf (`disc_golf=tee`,
  `basket`, `hole`) features nearby and fills in what it finds. Disc golf
  coverage is thin, so most disc courses will learn themselves.
- GPS only runs while the hole screen is open. Keeping the screen on uses
  `components/useWakeLock.ts`, and it's a setting.

## Maps

- **Hole:** tee, target and the line between, your shots, distance rings.
- **Round:** every marked shot, coloured by hole.
- **Compare:** two rounds on the same course over each other.
- **Dispersion:** every drive you've marked on a hole, with your average distance
  and miss to each side. This is where the map earns its place.

## Stats

Both sports: scoring average (9-hole rounds kept apart from 18), score against
par by hole par, birdie/par/bogey spread, penalties, each course's hole averages,
best rounds, a trend over time, and drive distance and spread from GPS.

Golf adds fairways (hit, left, right), GIR, putts per round and per GIR,
scrambling, average distance per club, and the handicap estimate.

Disc golf adds C1 and C2 putting (inside 10 m, 10–20 m), distance per disc, and
results against your own course average.

Charts use Recharts, which the site already has.

## Bag and lost discs

- **Bag.** Clubs are just names; their distances come from marked shots. Discs
  have the four flight numbers plus brand, plastic, weight, colour and in-bag.
- **Disc catalogue.** Searching by name fills in flight numbers from a JSON file
  shipped with the site. A script (like `scripts/update-movie-list.mjs`) rebuilds
  it from the open-source discit-api data (Marshall Street's flight guide).
  Typing them in always works too.
- **Flight preview.** A simple curve from turn and fade for your throwing hand,
  labelled as an illustration.
- **Find a lost disc.**
  - **Inputs:** where it was thrown from (the tee or last mark), which disc, and
    which way it went. You set the direction by pointing the phone down the line
    (the compass, about ±15°) or by dragging the line on the map. Optionally say
    whether it felt normal, big or short.
  - **Distance:** from your own marked throws with that disc. With too few, it
    uses throws with discs of similar speed, then a default for the speed.
  - **Left or right:** from how far your marked drives finish off the line,
    measured against each hole's tee-to-target line, so no extra taps are needed.
    Until there's data, it leans toward the disc's fade for your throwing hand.
  - **Result:** the area where the disc probably is (about 70% and 90% likely),
    with GPS error added. It's drawn on the satellite map with your live position
    and the distance and direction to walk.
  - **Afterwards:** **Found** records a real landing, which sharpens the next
    estimate. **Not found** marks the disc lost in the bag, with where.
  - **iPhone compass:** Safari only gives the compass after a tap asks
    permission (`DeviceOrientationEvent.requestPermission`, then
    `webkitCompassHeading`). Android uses `deviceorientationabsolute`.

## Pages

All of it is one page, `/golf` (`components/golf/GolfApp.tsx`), with the part
showing after the `#`. One page is what lets the service worker keep the whole
app on the phone, the way it keeps Notes and the Reader.

| Address | What |
|---|---|
| `/golf` | Resume or start a round, rounds, courses, importing old rounds |
| `#new/golf`, `#new/disc` | Sport, course (search, nearest first, new, or from OpenStreetMap), layout, players |
| `#round/<id>` | Hole screen, scorecard and map tabs; share, finish, players |
| `#join/<id>/<code>` | A friend's join link: pick which name is you |
| `#course/<id>` | Every hole on the map, the card (pars, lengths, stroke index, rating, slope), your hole averages |
| `#stats` | Everything above, by sport and course |
| `#bag` | Settings, discs and clubs |
| `#find`, `#find/<round>/<shot>` | Lost disc |

APIs under `/api/golf/`: `rounds` (+ `[id]` for changes, `[id]/join`), `courses`
(+ `[id]`, `osm`), `me` (bag and settings), `import` (old and signed-out rounds)
and `map` (tile settings). The phone's side of syncing is `lib/golf/sync.ts`.

Nav: **Golf & disc golf** in the Free time group, with the movie picker and where to eat; old `/tools#golf`
links and the search entry go to `/golf`. Golf goes into "Download my data"
(`lib/account-export.ts`): rounds the account is in, and its bag.

## Build order

Each phase ends in commits on master with `npm test` and `npm run build` passing.

| Phase | What |
|---|---|
| 1 | Types, store, the pure parts (scoring, stats, geo, handicap) with tests, APIs, old-round import, backup and export |
| 2 | `/golf`, new round, hole screen, scorecard, offline queue, history. The Tools scorecard goes. |
| 3 | Stats for both sports |
| 4 | Map key, Leaflet, rangefinder, mark drive and shot, courses that learn, OSM import, round, compare and dispersion maps |
| 5 | Bag, disc catalogue, flight preview, find a lost disc |

Phases 1–3 are useful on their own, with no map key needed. Phase 4 needs the
key in the Pi's env first.

## Later

- **Practice (idea 14).** Drills logged on the phone (for example 10 putts at
  6 m), skill numbers for putting and driving from recent results, real rounds
  feeding the same numbers, and XP into the site level.
- **Tournaments (idea 8).** Stroke play, skins and match-play brackets with a
  live leaderboard on everyone's phone. No TV mode.

## Can't be checked at a desk

- GPS fixes and compass direction on a real course, on your phone.
- iPhone motion permission and the screen-on setting in Safari and as a home
  screen app.
- How the lost-disc area does against discs you actually find.
