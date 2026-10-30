import { GameType } from './types';

export interface GameGuide {
  id: GameType;
  name: string;
  emoji: string;
  tagline: string;
  players: string;
  rounds: string;
  goal: string;
  steps: [string, string, string];
  scoring: string[];
  tip: string;
}

export const GAME_GUIDES: Record<GameType, GameGuide> = {
  'quip-clash': {
    id: 'quip-clash',
    name: 'Quip Clash',
    emoji: '⚡',
    tagline: 'Head-to-head comedy prompts',
    players: '3–8 Players',
    rounds: '1–3 Rounds',
    goal: 'Write funnier answers than your rival to win the room’s votes.',
    steps: [
      'Type short, funny answers to 2 prompts on your phone.',
      'Your answer goes head-to-head against another player’s.',
      'Everyone votes for their favorite (you can’t vote on your own).',
    ],
    scoring: [
      '+500 pts for every vote your answer wins',
      '+1,000 pts QuipLash bonus for a clean sweep of 3+ votes',
      '+250 pts Audience Favorite bonus',
    ],
    tip: 'Stuck? Tap "🎲 Safety Quip" to auto-fill a joke before time runs out.',
  },
  'the-faker': {
    id: 'the-faker',
    name: 'The Faker',
    emoji: '🕵️',
    tagline: 'Spot the physical impostor',
    players: '3–8 Players',
    rounds: '3 Rounds',
    goal: 'Catch the one player who didn’t get the secret prompt.',
    steps: [
      'Read your phone’s task (point, hold up fingers, make a face).',
      'On "3-2-1 GO!", everyone performs the action out loud together.',
      'Discuss who looked suspicious and vote for The Faker!',
    ],
    scoring: [
      '+1,000 pts to each player who votes for The Faker',
      '+1,500 pts to The Faker if they escape the majority vote',
    ],
    tip: 'As The Faker, react half a second late and blend in with the crowd!',
  },
  'trivia-death': {
    id: 'trivia-death',
    name: 'Trivia Death',
    emoji: '💀',
    tagline: 'Survive trivia & the Killing Floor',
    players: '3–8 Players',
    rounds: '5 Questions + Finale',
    goal: 'Answer trivia correctly or survive deadly mini-games to escape.',
    steps: [
      'Pick the right multiple-choice trivia answer on your phone.',
      'Wrong answers send you to The Killing Floor (math, doors, memory, etc.).',
      'Die and become a Ghost — Ghosts can still catch up in the Final Escape!',
    ],
    scoring: [
      '+500 pts per correct trivia answer',
      '+1,000 pts bonus for winning the Final Escape',
      'All cash earned above your starting $500 adds to your Session Score',
    ],
    tip: 'Even as a Ghost, correct trivia answers give you a head start in the Finale.',
  },
  'bracket-battles': {
    id: 'bracket-battles',
    name: 'Bracket Battles',
    emoji: '🏆',
    tagline: 'Tournament of ridiculous answers',
    players: '3–16 Players',
    rounds: 'Knockout Bracket',
    goal: 'Submit a crowd-pleasing answer and survive every tournament round.',
    steps: [
      'Submit an answer to the tournament prompt on your phone.',
      'Before the bracket starts, predict which entry will win it all.',
      'Vote in each head-to-head matchup until one Champion remains!',
    ],
    scoring: [
      '+500 / +750 / +1,250 pts for winning Quarter / Semi / Final matches',
      '+100 pts per vote your answer receives',
      '+750 pts Oracle bonus if your pre-show prediction wins',
    ],
    tip: 'Callback jokes to people in the room almost always make the Finals!',
  },
  'ready-set-bet': {
    id: 'ready-set-bet',
    name: 'Ready Set Bet',
    emoji: '🐎',
    tagline: 'Real-time dice horse racing',
    players: '1–16 Players',
    rounds: '4 Races',
    goal: 'Place live bets while horses race down the track before betting closes.',
    steps: [
      'While the race runs, tap a horse’s WIN, PLACE, or SHOW slot (up to 5 bets).',
      'Get your bets in before the leader hits the red line and betting closes.',
      'Horses move whenever 2d6 rolls their number — roll twice in a row for a 🔥 Bonus!',
    ],
    scoring: [
      'A winning bet pays its multiplier × $100 · a losing bet costs $100',
      'Prop bet: +$150 if you call it, −$50 if you don’t',
      'Your bankroll (never below $0) is added to the Session Leaderboard',
    ],
    tip: 'Horses 6, 7 & 8 roll most often, while 2/3 & 11/12 have huge payout odds!',
  },
  'spyfall': {
    id: 'spyfall',
    name: 'Spyfall',
    emoji: '🕵️‍♀️',
    tagline: 'Ask questions to unmask the Spy',
    players: '3–12 Players',
    rounds: '3 Rounds',
    goal: 'Detectives unmask The Spy; The Spy figures out the secret location.',
    steps: [
      'Check your secret card: Detectives see the Location & Role; The Spy sees nothing.',
      'Take turns asking each other questions out loud ("Is it loud here?").',
      'Call a vote anytime — or if you’re The Spy, guess the location to steal the win!',
    ],
    scoring: [
      '+800 pts for voting out The Spy (+250 bonus to whoever called the vote)',
      '+1,200 pts to The Spy for escaping the vote OR guessing the right location',
      '+800 pts to all Detectives if The Spy guesses the wrong location',
    ],
    tip: 'Ask questions specific enough to prove you know the place without giving it away!',
  },
  'herd-mentality': {
    id: 'herd-mentality',
    name: 'Herd Mentality',
    emoji: '🐄',
    tagline: 'Think like the crowd, avoid the Pink Cow',
    players: '3–16 Players',
    rounds: '5 Rounds',
    goal: 'Write the exact same answer as the majority of the room.',
    steps: [
      'Read the open-ended question (e.g. "Best pizza topping?").',
      'Type what you think MOST players in the room will write—not your personal favorite!',
      'Match the biggest group to score; be the only oddball and get the Pink Cow 🐄🍓.',
    ],
    scoring: [
      '+600 pts each round your answer is in the majority herd',
      '0 pts if you miss the majority',
      '🐄🍓 Pink Cow passes to a lone oddball when everyone else matched!',
    ],
    tip: 'Keep answers short and obvious (e.g. "Pepperoni" instead of "Thin crust pepperoni").',
  },
  'wavelength': {
    id: 'wavelength',
    name: 'Wavelength',
    emoji: '📡',
    tagline: 'Read your friends’ minds on a spectrum',
    players: '2–16 Players',
    rounds: '3–5 Rounds',
    goal: 'Turn your dial as close as possible to the Psychic’s hidden target.',
    steps: [
      'One player is the Psychic and sees a hidden target (0–100%) on a spectrum.',
      'The Psychic gives a 1-phrase clue (e.g. on Cold ↔ Hot, 80% = "Hot coffee").',
      'Everyone else slides their dial (0–100%) and locks in where they think the target is!',
    ],
    scoring: [
      '🎯 Bullseye (±4%): +800 pts to guesser · +400 pts to Psychic',
      '🔥 Close (±10%): +550 pts to guesser · +250 pts to Psychic',
      '👍 Warm (±18%): +300 pts to guesser · +125 pts to Psychic',
    ],
    tip: 'Psychics: don’t use numbers or percentages in your clue!',
  },
  'bluff-clash': {
    id: 'bluff-clash',
    name: 'Bluff Clash',
    emoji: '🤥',
    tagline: 'Write fake answers to bizarre real facts',
    players: '3–16 Players',
    rounds: '4 Rounds',
    goal: 'Fool your friends with believable lies while spotting the real truth.',
    steps: [
      'Read a weird-but-true fact with a blank (e.g. "Ancient Romans used ___ as mouthwash").',
      'Type a convincing fake answer that sounds like it could be the real truth.',
      'All lies + the real truth appear on screen — vote for the REAL truth!',
    ],
    scoring: [
      '+750 pts for voting for the real truth',
      '+400 pts for EVERY player who falls for your lie',
    ],
    tip: 'Match the style of the fact (short, lowercase, matter-of-fact) to fool more players.',
  },
  'emoji-telephone': {
    id: 'emoji-telephone',
    name: 'Emoji Telephone',
    emoji: '🔗',
    tagline: 'Pass the phrase using ONLY emojis',
    players: '3–12 Players',
    rounds: 'Translate → Decode → Vote',
    goal: 'Translate a wild prompt into emojis, decode someone else’s, and vote on the funniest chain.',
    steps: [
      'Step 1: Translate your secret phrase using ONLY emojis (no letters/numbers!).',
      'Step 2: Receive another player’s emojis and type what you think the phrase was.',
      'Step 3: Watch every chain unfold and vote for the funniest transformation!',
    ],
    scoring: [
      '+400 pts for completing your emoji translation + 400 pts for decoding',
      '+800 pts to the Translator & +600 pts to the Guesser per favorite vote won',
    ],
    tip: 'Use the quick-pick emoji palette or your phone’s emoji keyboard to build visual stories.',
  },
  'kart-clash': {
    id: 'kart-clash',
    name: 'Kart Clash',
    emoji: '🏎️',
    tagline: '3D split-screen kart racing with phone gyro steering',
    players: '1–16 Players · TV required',
    rounds: 'Grand Prix or Tournament Heats',
    goal: 'Tilt your phone like a steering wheel, drift around corners, and fire power-ups to win the Cup or Tournament!',
    steps: [
      'Pick a kart in the lobby, vote for a track, then turn your phone sideways. Tilt it like a steering wheel, or drag the touch pad if you prefer.',
      'Watch your viewport on the TV: steer into corners, hold DRIFT while turning to charge blue, orange and purple sparks, then let go for a Mini-Turbo. Press DRIFT in mid-air off a jump for a trick boost.',
      'Drive through rainbow boxes and tap ITEM to fire shells and boosts. In Tournament Heats, race to qualify for the Championship Final while waiting players bet and drop Chaos as the Pit Crew!',
    ],
    scoring: [
      '+1,500 / +1,200 / +1,000 / +800 / +600 / +400 / +200 / +100 pts for 1st–8th place finishes',
      '+300 pts Pit Crew bonus for predicting the winner of a heat you are spectating',
      '+500 pts Championship Final winner bonus in Tournament Heats mode',
    ],
    tip: 'Hold DRIFT when the countdown shows "1" for a Rocket Start. Press too early and you flood the engine!',
  },
};

/** Games drawn on one shared screen, so a room with only phones can't play them. */
export const TV_ONLY_GAMES: readonly string[] = ['kart-clash'];

export const GUIDE_ORDER: GameType[] = [
  'kart-clash',
  'quip-clash',
  'the-faker',
  'trivia-death',
  'bracket-battles',
  'ready-set-bet',
  'spyfall',
  'herd-mentality',
  'wavelength',
  'bluff-clash',
  'emoji-telephone',
];
