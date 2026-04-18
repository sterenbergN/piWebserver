import { GameState } from '../types';
import { getRandomTriviaQuestions, TriviaQuestion } from '../prompts';

const TOTAL_ROUNDS = 7;
const QUESTION_TIME = 15;
const KILLING_FLOOR_TIME = 10;
const ESCAPE_QUESTIONS = 4;

type PlayerStatus = 'alive' | 'ghost' | 'escaped';
type MiniGame = 'spin' | 'math' | 'password' | 'memory' | 'hotpotato' | 'scramble' | 'reaction' | 'auction';

const MINI_GAME_NAMES: Record<MiniGame, string> = {
  spin:      'Wheel of Misfortune',
  math:      'Death Math',
  password:  'Russian Roulette',
  memory:    'The Séance',
  hotpotato: 'Hot Coffin',
  scramble:  'Coffin Scramble',
  reaction:  'Chainsaw Dodge',
  auction:   'Grim Auction',
};

const MINI_GAME_SUBTITLES: Record<MiniGame, string> = {
  spin:      'Fate decides who dies. The killer spins the wheel...',
  math:      'Solve the equation or meet your maker.',
  password:  'One door leads to safety. The others... do not.',
  memory:    'The spirits revealed symbols. Did you pay attention?',
  hotpotato: 'Your phone is a ticking coffin. Tap to pass the doom!',
  scramble:  'Unscramble the word before the killer unscrambles YOU.',
  reaction:  'Dodge the chainsaw. First to tap survives.',
  auction:   'Bid your hard-earned cash to escape the floor.',
};

const HOST_FLAVOR: Record<string, string[]> = {
  QUESTION: [
    'Answer correctly, or I\'ll be seeing you shortly...',
    'Take your time. The Killing Floor isn\'t going anywhere.',
    'Such confident faces. We\'ll see how long that lasts.',
    'Every correct answer buys you one more minute of life.',
    'I\'ve redecorated the Killing Floor. You\'re going to hate it.',
  ],
  KILLING_FLOOR: [
    'Welcome to my favorite part of the evening.',
    'Don\'t worry. This will only hurt... a lot.',
    'The screaming always starts here.',
    'I\'ve been looking forward to this.',
  ],
  SURVIVE: [
    'You got lucky. This time.',
    'How... disappointing.',
    'Enjoy your borrowed time.',
  ],
  DEATH: [
    'Excellent. As I expected.',
    'Another one joins the collection.',
    'Sleep well. Forever.',
  ],
};

function randomFlavor(key: string): string {
  const arr = HOST_FLAVOR[key] || ['...'];
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickMiniGame(): MiniGame {
  const games: MiniGame[] = ['spin', 'math', 'password', 'memory', 'hotpotato', 'scramble', 'reaction', 'auction'];
  return games[Math.floor(Math.random() * games.length)];
}

function generateMathQuestion(): { question: string; answer: number } {
  const ops = ['+', '-', '*'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a: number, b: number, answer: number;
  if (op === '+') { a = Math.floor(Math.random() * 50) + 10; b = Math.floor(Math.random() * 50) + 10; answer = a + b; }
  else if (op === '-') { a = Math.floor(Math.random() * 50) + 30; b = Math.floor(Math.random() * 30) + 1; answer = a - b; }
  else { a = Math.floor(Math.random() * 9) + 2; b = Math.floor(Math.random() * 9) + 2; answer = a * b; }
  return { question: `${a} ${op === '*' ? '×' : op} ${b}`, answer };
}

const MEMORY_SYMBOLS = ['🦇', '🕷️', '💀', '🕯️', '🌙', '⚰️', '🔮', '🩸', '🗡️', '🦴'];
function generateMemoryGrid(size: number): string[] {
  const symbols = MEMORY_SYMBOLS.slice(0, size);
  return [...symbols, ...symbols].sort(() => Math.random() - 0.5);
}

const SCRAMBLE_WORDS = [
  'GHOST', 'COFFIN', 'MURDER', 'KILLER', 'ESCAPE', 'HAUNT', 'CORPSE', 'VICTIM',
  'DAGGER', 'VENOM', 'TERROR', 'SCREAM', 'CURSED', 'WICKED', 'GRIEVE', 'MORTAL',
];
function pickScrambleWord(): { word: string; scrambled: string } {
  const word = SCRAMBLE_WORDS[Math.floor(Math.random() * SCRAMBLE_WORDS.length)];
  const scrambled = word.split('').sort(() => Math.random() - 0.5).join('');
  return { word, scrambled };
}

function getSafeChoice(arr: any[]) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export const triviaDeathLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;

    const questions = await getRandomTriviaQuestions(TOTAL_ROUNDS + ESCAPE_QUESTIONS + 20);

    state.gameData = {
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      questions,
      roundHistory: [] as { round: number; killingFloor: boolean }[],
      playerStatuses: {} as Record<string, PlayerStatus>,
      ghostStreaks: {} as Record<string, number>,
      killingFloorPlayers: [] as string[],
      killingFloorMiniGame: null as MiniGame | null,
      killingFloorData: null as any,
      killingFloorAnswers: {} as Record<string, any>,
      money: {} as Record<string, number>,
      currentAnswers: {} as Record<string, number | null>,
      escapeProgress: {} as Record<string, number>,
      escapeAnswers: {} as Record<string, any>,
      escapedPlayers: [] as string[],
      reactionTaps: {} as Record<string, number>,
      hotPotatoHolder: null as string | null,
      hotPotatoPasses: 0,
      auctionBids: {} as Record<string, number>,
    };

    for (const pid of state.playerOrder) {
      state.gameData.playerStatuses[pid] = 'alive';
      state.gameData.ghostStreaks[pid] = 0;
      state.gameData.money[pid] = 500; // Starting cash
      state.gameData.escapeProgress[pid] = 0;
      state.players[pid].score = 500;
    }

    await startTriviaRound(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {

      case 'SUBMIT_TRIVIA_ANSWER': {
        if (state.phase !== 'QUESTION') return;
        if (state.gameData.currentAnswers[playerId] !== undefined) return;
        state.gameData.currentAnswers[playerId] = action.answer;
        const eligible = state.playerOrder.filter(
          (pid: string) => state.gameData.playerStatuses[pid] !== 'escaped'
        );
        const answered = eligible.filter(
          (pid: string) => state.gameData.currentAnswers[pid] !== null && state.gameData.currentAnswers[pid] !== undefined
        );
        if (answered.length >= eligible.length) revealTriviaAnswers(state);
        break;
      }

      case 'FORCE_TRIVIA_REVEAL':
        if (state.phase !== 'QUESTION') return;
        revealTriviaAnswers(state);
        break;

      case 'PROCEED_TO_KILLING_FLOOR':
        if (state.phase !== 'QUESTION_RESULTS') return;
        if (state.gameData.killingFloorPlayers.length === 0) {
          await nextRoundOrEscape(state);
        } else {
          await startKillingFloor(state);
        }
        break;

      case 'SUBMIT_KILLING_FLOOR_ANSWER': {
        if (state.phase !== 'KILLING_FLOOR') return;
        const mg = state.gameData.killingFloorMiniGame as MiniGame;

        if (mg === 'hotpotato') {
          // Pass the hot potato to a random alive player
          if (playerId !== state.gameData.hotPotatoHolder) return;
          const candidates = state.gameData.killingFloorPlayers.filter((p: string) => p !== playerId);
          if (candidates.length === 0) return;
          const next = candidates[Math.floor(Math.random() * candidates.length)];
          state.gameData.hotPotatoHolder = next;
          state.gameData.hotPotatoPasses++;
          for (const pid of state.playerOrder) {
            state.playerData[pid] = {
              ...state.playerData[pid],
              hotPotatoHolder: next,
              isHolder: pid === next,
            };
          }
          state.hostData = { ...state.hostData, hotPotatoHolder: next, passes: state.gameData.hotPotatoPasses };
          return;
        }

        if (mg === 'reaction') {
          // First tap survives — record tap time
          if (state.gameData.killingFloorAnswers[playerId] !== undefined) return;
          state.gameData.killingFloorAnswers[playerId] = Date.now();
          // If all have tapped, resolve immediately
          const allTapped = state.gameData.killingFloorPlayers.every(
            (pid: string) => state.gameData.killingFloorAnswers[pid] !== undefined
          );
          if (allTapped) { resolveKillingFloor(state); return; }
          return;
        }

        if (mg === 'auction') {
          // Store bid amount
          if (state.gameData.auctionBids[playerId] !== undefined) return;
          const bid = Math.min(action.answer ?? 0, state.gameData.money[playerId]);
          state.gameData.auctionBids[playerId] = bid;
          const allBid = state.gameData.killingFloorPlayers.every(
            (pid: string) => state.gameData.auctionBids[pid] !== undefined
          );
          if (allBid) { resolveKillingFloor(state); return; }
          return;
        }

        if (!state.gameData.killingFloorPlayers.includes(playerId)) return;
        if (state.gameData.killingFloorAnswers[playerId] !== undefined) return;
        state.gameData.killingFloorAnswers[playerId] = action.answer;
        const allAnswered = state.gameData.killingFloorPlayers.every(
          (pid: string) => state.gameData.killingFloorAnswers[pid] !== undefined
        );
        if (allAnswered) resolveKillingFloor(state);
        break;
      }

      case 'FORCE_KILLING_FLOOR_RESOLVE':
        if (state.phase !== 'KILLING_FLOOR') return;
        resolveKillingFloor(state);
        break;

      case 'NEXT_TRIVIA_ROUND':
        if (state.phase !== 'KILLING_FLOOR_RESULTS') return;
        await nextRoundOrEscape(state);
        break;

      case 'SUBMIT_ESCAPE_ANSWER': {
        if (state.phase !== 'FINAL_ESCAPE') return;
        const pid = playerId;
        if (state.gameData.playerStatuses[pid] === 'escaped') return;
        if (state.gameData.escapeAnswers[pid]) return;
        state.gameData.escapeAnswers[pid] = { answer: action.answer, doubleDown: action.doubleDown || false };
        state.playerData[pid].voted = true;
        break;
      }

      case 'FORCE_ESCAPE_ADVANCE': {
        if (state.phase !== 'FINAL_ESCAPE') return;
        const escQ = state.gameData.currentEscapeQuestion as TriviaQuestion;
        
        let anyoneEscaped = false;
        
        for (const pid of state.playerOrder) {
          if (state.gameData.playerStatuses[pid] === 'escaped') continue;
          const ans = state.gameData.escapeAnswers[pid];
          if (!ans) continue;
          
          if (ans.answer === escQ.answer) {
            state.gameData.money[pid] += 300;
            if (ans.doubleDown) {
              state.gameData.escapeProgress[pid] += 2;
            } else {
              state.gameData.escapeProgress[pid] += 1;
            }
          } else {
            if (ans.doubleDown) {
              state.gameData.escapeProgress[pid] = Math.max(0, state.gameData.escapeProgress[pid] - 2);
            }
          }
          
          if (state.gameData.escapeProgress[pid] >= ESCAPE_QUESTIONS) {
            state.gameData.playerStatuses[pid] = 'escaped';
            state.gameData.escapedPlayers.push(pid);
            anyoneEscaped = true;
          }
        }
        
        if (anyoneEscaped) {
           // We have a winner!
           endTriviaGame(state);
        } else {
           advanceEscapeQuestion(state);
        }
        break;
      }

      case 'PLAY_AGAIN':
        if (playerId !== state.hostId) return;
        state.phase = 'LOBBY';
        state.hostData = {};
        state.playerData = {};
        state.gameData = {};
        for (const pid of state.playerOrder) state.players[pid].score = 0;
        break;
    }
  },
};

async function startTriviaRound(state: GameState) {
  state.gameData.round++;
  state.gameData.currentAnswers = {};
  state.gameData.killingFloorPlayers = [];

  const q = state.gameData.questions[state.gameData.round - 1] as TriviaQuestion;
  state.phase = 'QUESTION';

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    question: q.question,
    choices: q.choices,
    category: q.category,
    playerStatuses: state.gameData.playerStatuses,
    playerMoney: state.gameData.money,
    ghostStreaks: state.gameData.ghostStreaks,
    flavor: randomFlavor('QUESTION'),
    timerStart: Date.now(),
    timerDuration: QUESTION_TIME,
    autoAdvanceAt: Date.now() + QUESTION_TIME * 1000,
    autoAdvanceAction: 'FORCE_TRIVIA_REVEAL',
  };

  for (const pid of state.playerOrder) {
    const status = state.gameData.playerStatuses[pid];
    if (status === 'escaped') {
      state.playerData[pid] = { phase: 'ESCAPED', money: state.gameData.money[pid] };
    } else {
      state.playerData[pid] = {
        phase: 'QUESTION',
        question: q.question,
        choices: q.choices,
        category: q.category,
        status,
        ghostStreak: state.gameData.ghostStreaks[pid] || 0,
        round: state.gameData.round,
        totalRounds: state.gameData.totalRounds,
        money: state.gameData.money[pid],
        timerStart: Date.now(),
        timerDuration: QUESTION_TIME,
        flavor: status === 'ghost'
          ? '👻 Answer correctly 3 times in a row to resurrect!'
          : '💀 Answer wrong and you go to the Killing Floor...',
      };
    }
  }
}

function revealTriviaAnswers(state: GameState) {
  state.phase = 'QUESTION_RESULTS';
  const q = state.gameData.questions[state.gameData.round - 1] as TriviaQuestion;
  const correctIdx = q.answer;

  const roundRecord = { round: state.gameData.round, killingFloor: false };

  for (const pid of state.playerOrder) {
    const status = state.gameData.playerStatuses[pid];
    if (status === 'escaped') continue;

    const answered = state.gameData.currentAnswers[pid];
    const correct = answered === correctIdx;

    if (status === 'alive') {
      if (correct) {
        state.gameData.money[pid] += 500;
        state.players[pid].score = state.gameData.money[pid];
      } else {
        state.gameData.killingFloorPlayers.push(pid);
        roundRecord.killingFloor = true;
      }
    } else if (status === 'ghost') {
      if (correct) {
        state.gameData.ghostStreaks[pid]++;
        state.gameData.money[pid] += 200;
        if (state.gameData.ghostStreaks[pid] >= 3) {
          state.gameData.playerStatuses[pid] = 'alive';
          state.gameData.ghostStreaks[pid] = 0;
          state.gameData.money[pid] += 500; // resurrection bonus
          state.players[pid].score = state.gameData.money[pid];
        }
      } else {
        state.gameData.ghostStreaks[pid] = 0;
      }
    }
  }

  state.gameData.roundHistory.push(roundRecord);

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    question: q.question,
    choices: q.choices,
    correctAnswer: correctIdx,
    playerAnswers: state.gameData.currentAnswers,
    killingFloorPlayers: state.gameData.killingFloorPlayers,
    playerStatuses: state.gameData.playerStatuses,
    playerMoney: state.gameData.money,
    ghostStreaks: state.gameData.ghostStreaks,
    timerStart: Date.now(),
    timerDuration: 6,
    autoAdvanceAt: Date.now() + 6_000,
    autoAdvanceAction: 'PROCEED_TO_KILLING_FLOOR',
  };

  for (const pid of state.playerOrder) {
    const status = state.gameData.playerStatuses[pid];
    const answered = state.gameData.currentAnswers[pid];
    const correct = answered === correctIdx;
    state.playerData[pid] = {
      phase: 'QUESTION_RESULTS',
      correct,
      correctAnswer: correctIdx,
      yourAnswer: answered,
      going_to_killing_floor: state.gameData.killingFloorPlayers.includes(pid),
      status,
      ghostStreak: state.gameData.ghostStreaks[pid] || 0,
      money: state.gameData.money[pid],
      message: correct
        ? (status === 'ghost' ? `👻 Streak: ${state.gameData.ghostStreaks[pid]}/3 to resurrect` : '✅ Correct! +$500')
        : (state.gameData.killingFloorPlayers.includes(pid) ? '💀 To the Killing Floor!' : '❌ Wrong'),
    };
  }
}

async function startKillingFloor(state: GameState) {
  const miniGame = pickMiniGame();
  state.gameData.killingFloorMiniGame = miniGame;
  state.gameData.killingFloorAnswers = {};
  state.gameData.reactionTaps = {};
  state.gameData.hotPotatoPasses = 0;
  state.gameData.auctionBids = {};
  let miniGameData: any = {};

  const baseHostData = {
    phase: 'KILLING_FLOOR',
    miniGame,
    miniGameName: MINI_GAME_NAMES[miniGame],
    miniGameSubtitle: MINI_GAME_SUBTITLES[miniGame],
    killingFloorPlayers: state.gameData.killingFloorPlayers,
    playerStatuses: state.gameData.playerStatuses,
    playerMoney: state.gameData.money,
    flavor: randomFlavor('KILLING_FLOOR'),
  };

  const basePlayerData = (pid: string) => ({
    phase: 'KILLING_FLOOR',
    miniGame,
    miniGameName: MINI_GAME_NAMES[miniGame],
    isOnFloor: state.gameData.killingFloorPlayers.includes(pid),
    status: state.gameData.playerStatuses[pid],
    money: state.gameData.money[pid],
  });

  if (miniGame === 'spin') {
    const DEATH_CHANCE = 0.4;
    const outcomes: Record<string, boolean> = {};
    for (const pid of state.gameData.killingFloorPlayers) {
      outcomes[pid] = state.gameData.killingFloorPlayers.length === 1
        ? false
        : Math.random() > DEATH_CHANCE;
    }
    miniGameData = { type: 'spin', outcomes };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      timerStart: Date.now(),
      timerDuration: 6,
      autoAdvanceAt: Date.now() + 6_000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      state.playerData[pid] = { ...basePlayerData(pid) };
    }
    return;
  }

  if (miniGame === 'math') {
    const mathQ = generateMathQuestion();
    miniGameData = { type: 'math', question: mathQ.question, answer: mathQ.answer };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      question: mathQ.question,
      timerStart: Date.now(),
      timerDuration: KILLING_FLOOR_TIME,
      autoAdvanceAt: Date.now() + KILLING_FLOOR_TIME * 1000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      const isOnFloor = state.gameData.killingFloorPlayers.includes(pid);
      state.playerData[pid] = {
        ...basePlayerData(pid),
        mathQuestion: isOnFloor ? mathQ.question : null,
        timerStart: Date.now(),
        timerDuration: KILLING_FLOOR_TIME,
      };
    }
    return;
  }

  if (miniGame === 'password') {
    const deathNumber = Math.floor(Math.random() * 5) + 1;
    miniGameData = { type: 'password', deathNumber };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      timerStart: Date.now(),
      timerDuration: KILLING_FLOOR_TIME,
      autoAdvanceAt: Date.now() + KILLING_FLOOR_TIME * 1000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      state.playerData[pid] = {
        ...basePlayerData(pid),
        timerStart: Date.now(),
        timerDuration: KILLING_FLOOR_TIME,
      };
    }
    return;
  }

  if (miniGame === 'memory') {
    // Show a grid of symbols for 4 seconds, then hide them. Player picks the sequence.
    const gridSize = 3; // 3 pairs = 6 tiles
    const grid = generateMemoryGrid(gridSize);
    const solution = grid; // The correct grid
    miniGameData = { type: 'memory', grid, solution };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      grid,
      revealPhase: true, // show symbols
      timerStart: Date.now(),
      timerDuration: KILLING_FLOOR_TIME,
      autoAdvanceAt: Date.now() + KILLING_FLOOR_TIME * 1000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      const isOnFloor = state.gameData.killingFloorPlayers.includes(pid);
      state.playerData[pid] = {
        ...basePlayerData(pid),
        grid: isOnFloor ? grid : null,
        timerStart: Date.now(),
        timerDuration: KILLING_FLOOR_TIME,
      };
    }
    return;
  }

  if (miniGame === 'hotpotato') {
    // Pick a random starting holder from killing floor players
    const holder = state.gameData.killingFloorPlayers[
      Math.floor(Math.random() * state.gameData.killingFloorPlayers.length)
    ];
    state.gameData.hotPotatoHolder = holder;
    miniGameData = { type: 'hotpotato', startHolder: holder };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      hotPotatoHolder: holder,
      passes: 0,
      timerStart: Date.now(),
      timerDuration: KILLING_FLOOR_TIME,
      autoAdvanceAt: Date.now() + KILLING_FLOOR_TIME * 1000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      state.playerData[pid] = {
        ...basePlayerData(pid),
        hotPotatoHolder: holder,
        isHolder: pid === holder,
        timerStart: Date.now(),
        timerDuration: KILLING_FLOOR_TIME,
      };
    }
    return;
  }

  if (miniGame === 'scramble') {
    const { word, scrambled } = pickScrambleWord();
    miniGameData = { type: 'scramble', word, scrambled };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      scrambled,
      timerStart: Date.now(),
      timerDuration: KILLING_FLOOR_TIME,
      autoAdvanceAt: Date.now() + KILLING_FLOOR_TIME * 1000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      const isOnFloor = state.gameData.killingFloorPlayers.includes(pid);
      state.playerData[pid] = {
        ...basePlayerData(pid),
        scrambled: isOnFloor ? scrambled : null,
        timerStart: Date.now(),
        timerDuration: KILLING_FLOOR_TIME,
      };
    }
    return;
  }

  if (miniGame === 'reaction') {
    // First player to tap after a hidden countdown survives
    miniGameData = { type: 'reaction', revealAt: Date.now() + 3000 + Math.random() * 4000 };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      revealAt: miniGameData.revealAt,
      timerStart: Date.now(),
      timerDuration: KILLING_FLOOR_TIME,
      autoAdvanceAt: Date.now() + KILLING_FLOOR_TIME * 1000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      const isOnFloor = state.gameData.killingFloorPlayers.includes(pid);
      state.playerData[pid] = {
        ...basePlayerData(pid),
        revealAt: isOnFloor ? miniGameData.revealAt : null,
        timerStart: Date.now(),
        timerDuration: KILLING_FLOOR_TIME,
      };
    }
    return;
  }

  if (miniGame === 'auction') {
    // Players bid money; highest bidder (or bidders above threshold) survive
    // Everyone on floor must bid. Lowest bidder dies. All bids are spent.
    miniGameData = { type: 'auction' };
    state.gameData.killingFloorData = miniGameData;
    state.phase = 'KILLING_FLOOR';
    state.hostData = {
      ...baseHostData,
      timerStart: Date.now(),
      timerDuration: KILLING_FLOOR_TIME,
      autoAdvanceAt: Date.now() + KILLING_FLOOR_TIME * 1000,
      autoAdvanceAction: 'FORCE_KILLING_FLOOR_RESOLVE',
    };
    for (const pid of state.playerOrder) {
      const isOnFloor = state.gameData.killingFloorPlayers.includes(pid);
      state.playerData[pid] = {
        ...basePlayerData(pid),
        maxBid: isOnFloor ? state.gameData.money[pid] : 0,
        timerStart: Date.now(),
        timerDuration: KILLING_FLOOR_TIME,
      };
    }
    return;
  }
}

function resolveKillingFloor(state: GameState) {
  state.phase = 'KILLING_FLOOR_RESULTS';
  const miniGame = state.gameData.killingFloorMiniGame as MiniGame;
  const data = state.gameData.killingFloorData;
  const dead: string[] = [];
  const survived: string[] = [];

  for (const pid of state.gameData.killingFloorPlayers) {
    let survives = false;

    if (miniGame === 'spin') {
      survives = data.outcomes[pid];
    } else if (miniGame === 'math') {
      const theirAnswer = parseInt(state.gameData.killingFloorAnswers[pid] ?? '-999', 10);
      survives = theirAnswer === data.answer;
    } else if (miniGame === 'password') {
      const theirPick = state.gameData.killingFloorAnswers[pid];
      survives = theirPick !== data.deathNumber;
    } else if (miniGame === 'memory') {
      // Player must have typed the first symbol of the grid sequence
      const theirAnswer = (state.gameData.killingFloorAnswers[pid] || '').toString().trim().toUpperCase();
      const correct = data.word || data.grid?.[0] || '';
      survives = theirAnswer.includes(correct.toString().toUpperCase());
    } else if (miniGame === 'hotpotato') {
      // Whoever is holding when time runs out dies
      survives = pid !== state.gameData.hotPotatoHolder;
    } else if (miniGame === 'scramble') {
      const theirAnswer = (state.gameData.killingFloorAnswers[pid] || '').toString().trim().toUpperCase();
      survives = theirAnswer === data.word;
    } else if (miniGame === 'reaction') {
      // First to tap survives, rest die (or: all but last to tap survive if multiple on floor)
      const taps = state.gameData.killingFloorAnswers;
      const tapTimes = state.gameData.killingFloorPlayers
        .filter((p: string) => taps[p] !== undefined)
        .sort((a: string, b: string) => taps[a] - taps[b]);
      // Only the last person (or no-tappers) dies
      const lastOrNonTapper = tapTimes.length > 0 ? tapTimes[tapTimes.length - 1] : pid;
      survives = taps[pid] !== undefined && pid !== lastOrNonTapper;
    } else if (miniGame === 'auction') {
      const bids = state.gameData.auctionBids;
      // Deduct bid from money
      const bid = bids[pid] ?? 0;
      state.gameData.money[pid] = Math.max(0, state.gameData.money[pid] - bid);
      // Lowest bidder(s) die; if tie at bottom, all tied die
      const sortedBids = state.gameData.killingFloorPlayers
        .map((p: string) => ({ pid: p, bid: bids[p] ?? 0 }))
        .sort((a: any, b: any) => a.bid - b.bid);
      const lowestBid = sortedBids[0].bid;
      survives = (bids[pid] ?? 0) > lowestBid;
    }

    if (survives) survived.push(pid);
    else {
      dead.push(pid);
      state.gameData.playerStatuses[pid] = 'ghost';
      state.gameData.ghostStreaks[pid] = 0;
    }
  }

  // Sync scores
  for (const pid of state.playerOrder) {
    state.players[pid].score = state.gameData.money[pid];
  }

  let revealAnswer: any = null;
  if (miniGame === 'math') revealAnswer = data.answer;
  if (miniGame === 'password') revealAnswer = data.deathNumber;
  if (miniGame === 'scramble') revealAnswer = data.word;
  if (miniGame === 'hotpotato') revealAnswer = state.gameData.hotPotatoHolder;
  if (miniGame === 'auction') revealAnswer = state.gameData.auctionBids;

  state.hostData = {
    phase: 'KILLING_FLOOR_RESULTS',
    miniGame,
    miniGameName: MINI_GAME_NAMES[miniGame],
    dead,
    survived,
    answer: revealAnswer,
    killingFloorPlayers: state.gameData.killingFloorPlayers,
    playerStatuses: state.gameData.playerStatuses,
    playerMoney: state.gameData.money,
    flavor: dead.length > 0 ? randomFlavor('DEATH') : randomFlavor('SURVIVE'),
    timerStart: Date.now(),
    timerDuration: 7,
    autoAdvanceAt: Date.now() + 7_000,
    autoAdvanceAction: 'NEXT_TRIVIA_ROUND',
  };

  for (const pid of state.playerOrder) {
    const isDead = dead.includes(pid);
    const isOnFloor = state.gameData.killingFloorPlayers.includes(pid);
    state.playerData[pid] = {
      phase: 'KILLING_FLOOR_RESULTS',
      isDead,
      isOnFloor,
      status: state.gameData.playerStatuses[pid],
      yourAnswer: state.gameData.killingFloorAnswers[pid],
      money: state.gameData.money[pid],
      message: !isOnFloor ? 'Look at the TV!' : isDead ? '💀 You\'ve been slain...' : '🎉 You survived!',
    };
  }
}

async function nextRoundOrEscape(state: GameState) {
  if (state.gameData.round >= state.gameData.totalRounds) {
    await startFinalEscape(state);
  } else {
    await startTriviaRound(state);
  }
}

async function startFinalEscape(state: GameState) {
  state.phase = 'FINAL_ESCAPE';
  
  const sortedPids = [...state.playerOrder].sort((a, b) => (state.gameData.money[a] || 0) - (state.gameData.money[b] || 0));
  const N = sortedPids.length;
  for (let i = 0; i < N; i++) {
    // 1st place gets N spaces, last gets 1 space.
    state.gameData.escapeProgress[sortedPids[i]] = i + 1;
  }
  
  state.gameData.escapeQuestionIndex = TOTAL_ROUNDS;
  state.gameData.escapedPlayers = [];

  const q = state.gameData.questions[state.gameData.escapeQuestionIndex] as TriviaQuestion;
  state.gameData.currentEscapeQuestion = q;
  state.gameData.escapeAnswers = {};

  const maxProg = Math.max(...Object.values(state.gameData.escapeProgress) as number[]);

  state.hostData = {
    phase: 'FINAL_ESCAPE',
    question: q.question,
    choices: q.choices,
    category: q.category,
    escapeProgress: state.gameData.escapeProgress,
    escapedPlayers: state.gameData.escapedPlayers,
    playerStatuses: state.gameData.playerStatuses,
    playerMoney: state.gameData.money,
    escapeStepsNeeded: ESCAPE_QUESTIONS,
    timerStart: Date.now(),
    timerDuration: 12,
    autoAdvanceAt: Date.now() + 12_000,
    autoAdvanceAction: 'FORCE_ESCAPE_ADVANCE',
  };

  for (const pid of state.playerOrder) {
    const isLeader = state.gameData.escapeProgress[pid] === maxProg;
    state.playerData[pid] = {
      phase: 'FINAL_ESCAPE',
      question: q.question,
      choices: q.choices,
      category: q.category,
      status: state.gameData.playerStatuses[pid],
      escapeProgress: state.gameData.escapeProgress[pid],
      escapeStepsNeeded: ESCAPE_QUESTIONS,
      money: state.gameData.money[pid],
      timerStart: Date.now(),
      timerDuration: 12,
      flavor: '🚪 Answer correctly to escape the Murder Hotel!',
      allowDoubleDown: !isLeader
    };
  }
}

function advanceEscapeQuestion(state: GameState) {
  state.gameData.escapeQuestionIndex++;
  const q = state.gameData.questions[state.gameData.escapeQuestionIndex] as TriviaQuestion;

  if (!q) {
    endTriviaGame(state);
    return;
  }

  state.gameData.currentEscapeQuestion = q;
  state.gameData.escapeAnswers = {};
  
  const maxProg = Math.max(...Object.values(state.gameData.escapeProgress) as number[]);

  state.hostData = {
    phase: 'FINAL_ESCAPE',
    question: q.question,
    choices: q.choices,
    category: q.category,
    escapeProgress: state.gameData.escapeProgress,
    escapedPlayers: state.gameData.escapedPlayers,
    playerStatuses: state.gameData.playerStatuses,
    playerMoney: state.gameData.money,
    escapeStepsNeeded: ESCAPE_QUESTIONS,
    timerStart: Date.now(),
    timerDuration: 12,
    autoAdvanceAt: Date.now() + 12_000,
    autoAdvanceAction: 'FORCE_ESCAPE_ADVANCE',
  };

  for (const pid of state.playerOrder) {
    if (state.gameData.playerStatuses[pid] === 'escaped') {
      state.playerData[pid] = { phase: 'ESCAPED', money: state.gameData.money[pid] };
      continue;
    }
    const isLeader = state.gameData.escapeProgress[pid] === maxProg;
    state.playerData[pid] = {
      phase: 'FINAL_ESCAPE',
      question: q.question,
      choices: q.choices,
      status: state.gameData.playerStatuses[pid],
      escapeProgress: state.gameData.escapeProgress[pid],
      escapeStepsNeeded: ESCAPE_QUESTIONS,
      money: state.gameData.money[pid],
      timerStart: Date.now(),
      timerDuration: 12,
      allowDoubleDown: !isLeader
    };
  }
}

function endTriviaGame(state: GameState) {
  state.phase = 'FINAL_RESULTS';
  for (const pid of state.playerOrder) {
    state.players[pid].score = state.gameData.money[pid];
  }
  state.hostData = {
    phase: 'FINAL_RESULTS',
    escapedPlayers: state.gameData.escapedPlayers,
    playerStatuses: state.gameData.playerStatuses,
    playerMoney: state.gameData.money,
    flavor: 'The Murder Hotel thanks you for your... patronage.',
  };
  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'FINAL_RESULTS',
      status: state.gameData.playerStatuses[pid],
      money: state.gameData.money[pid],
      escaped: state.gameData.playerStatuses[pid] === 'escaped',
    };
  }
}
