import { GameState } from '../types';

const TOTAL_RACES = 4;
const TRACK_LENGTH = 15;
const HORSES = ['2/3', '4', '5', '6', '7', '8', '9', '10', '11/12'];

const MULTIPLIERS: Record<string, { win: number, place: number, show: number }> = {
  '2/3': { win: 10, place: 6, show: 4 },
  '4': { win: 8, place: 5, show: 3 },
  '5': { win: 6, place: 4, show: 2 },
  '6': { win: 4, place: 3, show: 2 },
  '7': { win: 3, place: 2, show: 1 }, // 7 moves the fastest
  '8': { win: 4, place: 3, show: 2 },
  '9': { win: 6, place: 4, show: 2 },
  '10': { win: 8, place: 5, show: 3 },
  '11/12': { win: 10, place: 6, show: 4 },
};

const PROP_BETS = [
  { id: 'odd_win', desc: 'Will the winner be an odd numbered horse?' },
  { id: 'even_win', desc: 'Will the winner be an even numbered horse?' },
  { id: 'seven_place', desc: 'Will horse 7 place (1st or 2nd)?' },
  { id: 'longshot_show', desc: 'Will 2/3 or 11/12 show (1st-3rd)?' },
  { id: 'no_seven_show', desc: 'Will horse 7 fail to show?' },
  { id: 'middle_win', desc: 'Will 6 or 8 win?' }
];

function rollDice() {
  return Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
}

export const readySetBetLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 1) return;

    state.gameData = {
      raceNumber: 0,
      totalRaces: TOTAL_RACES,
      money: {}, // playerId -> money
    };

    for (const pid of state.playerOrder) {
      state.gameData.money[pid] = 0;
      state.players[pid].score = 0;
    }

    startRace(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'PLACE_BET': {
        if (state.phase !== 'RACING') return;
        if (state.gameData.bettingClosed) return; // Cannot bet if closed
        
        // action.horse, action.betType (win|place|show)
        const bets = state.gameData.bets[playerId];
        if (bets.length >= 5) return; // Max 5 bets per race
        
        // Prevent duplicate bet types on same horse by same player
        if (bets.some((b: any) => b.horse === action.horse && b.type === action.betType)) return;

        bets.push({ horse: action.horse, type: action.betType });
        break;
      }

      case 'SUBMIT_PROP_BET': {
        if (state.phase !== 'RACING') return;
        if (state.gameData.propBetAnswers[playerId] !== undefined) return;
        
        state.gameData.propBetAnswers[playerId] = action.choice;
        state.playerData[playerId].propBetAnswered = true;
        state.playerData[playerId].propBetChoice = action.choice;
        break;
      }

      case 'RACE_TICK': {
        if (state.phase !== 'RACING' || playerId !== state.hostId) return;

        const roll = rollDice();
        let targetHorse = roll.toString();
        if (roll === 2 || roll === 3) targetHorse = '2/3';
        if (roll === 11 || roll === 12) targetHorse = '11/12';

        const prevRoll = state.gameData.lastRollHorse;
        state.gameData.lastRollHorse = targetHorse;

        // Move the horse
        state.gameData.positions[targetHorse]++;

        // Authentic Bonus Move if rolled back to back
        let bonusAmount = 0;
        if (targetHorse === prevRoll) {
          if (targetHorse === '6' || targetHorse === '8') bonusAmount = 1;
          else if (targetHorse === '5' || targetHorse === '9') bonusAmount = 2;
          else if (['2/3', '4', '10', '11/12'].includes(targetHorse)) bonusAmount = 3;
          
          state.gameData.positions[targetHorse] += bonusAmount;
        }

        let commentary = `The dice show ${roll}! #${targetHorse} moves forward.`;
        if (bonusAmount > 0) {
          commentary = `Double roll! #${targetHorse} sprints forward with a +${bonusAmount} bonus!`;
        }

        // Check for betting closure (if any horse reaches space 12)
        if (!state.gameData.bettingClosed) {
          if (Object.values(state.gameData.positions).some((p: any) => p >= TRACK_LENGTH - 3)) {
            state.gameData.bettingClosed = true;
            commentary = "The Red Line is crossed! ALL BETTING IS CLOSED!";
          }
        }

        // Check if race ends (a horse reaches TRACK_LENGTH)
        // If multiple reach at same time (due to bonus), the roll target is 1st.
        const finishedHorses = Object.keys(state.gameData.positions).filter(k => state.gameData.positions[k] >= TRACK_LENGTH);
        
        if (finishedHorses.length > 0) {
          // If we have winners, we need 3 finishers.
          // Wait, they can cross sequentially. Let's record finishers.
          if (!state.gameData.finishers.includes(targetHorse) && state.gameData.positions[targetHorse] >= TRACK_LENGTH) {
            state.gameData.finishers.push(targetHorse);
          }
          // We need to keep racing until we have 3 finishers
          if (state.gameData.finishers.length >= 3) {
            finishRace(state);
            return;
          }
        }

        state.hostData = {
          ...state.hostData,
          positions: state.gameData.positions,
          lastRoll: roll,
          commentary,
          finishers: state.gameData.finishers,
          bettingClosed: state.gameData.bettingClosed,
        };
        
        for (const pid of state.playerOrder) {
          state.playerData[pid] = {
            ...state.playerData[pid],
            bettingClosed: state.gameData.bettingClosed,
            bets: state.gameData.bets[pid]
          };
        }
        break;
      }

      case 'NEXT_RACE': {
        if (state.phase !== 'RACE_RESULTS') return;
        if (state.gameData.raceNumber >= TOTAL_RACES) {
          endBetGame(state);
        } else {
          startRace(state);
        }
        break;
      }

      case 'PLAY_AGAIN': {
        if (playerId !== state.hostId) return;
        state.phase = 'LOBBY';
        state.hostData = {};
        state.playerData = {};
        state.gameData = {};
        for (const pid of state.playerOrder) state.players[pid].score = 0;
        break;
      }
    }
  }
};

function startRace(state: GameState) {
  state.phase = 'RACING';
  state.gameData.raceNumber++;
  state.gameData.positions = {};
  for (const h of HORSES) state.gameData.positions[h] = 0;
  
  state.gameData.bets = {};
  for (const pid of state.playerOrder) {
    state.gameData.bets[pid] = []; // Array of { horse, type: 'win'|'place'|'show' }
  }

  state.gameData.lastRollHorse = null;
  state.gameData.bettingClosed = false;
  state.gameData.finishers = [];

  const propBet = PROP_BETS[Math.floor(Math.random() * PROP_BETS.length)];
  state.gameData.propBet = propBet;
  state.gameData.propBetAnswers = {};

  state.hostData = {
    message: `Race ${state.gameData.raceNumber} of ${state.gameData.totalRaces}`,
    positions: state.gameData.positions,
    trackLength: TRACK_LENGTH,
    finishers: [],
    bettingClosed: false,
    lastRoll: null,
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'RACING',
      money: state.gameData.money[pid],
      bets: [],
      bettingClosed: false,
      propBet: { desc: propBet.desc },
      propBetAnswered: false,
      propBetChoice: null,
    };
  }
}

function finishRace(state: GameState) {
  state.phase = 'RACE_RESULTS';
  const finishers = state.gameData.finishers; // [1st, 2nd, 3rd]

  const first = finishers[0];
  const second = finishers[1];
  const third = finishers[2];

  const propBet = state.gameData.propBet;
  let propResult = false;
  
  if (propBet) {
    if (propBet.id === 'odd_win') propResult = ['5','7','9'].includes(first);
    else if (propBet.id === 'even_win') propResult = ['4','6','8','10'].includes(first);
    else if (propBet.id === 'seven_place') propResult = (first === '7' || second === '7');
    else if (propBet.id === 'longshot_show') propResult = ['2/3','11/12'].some(h => [first,second,third].includes(h));
    else if (propBet.id === 'no_seven_show') propResult = !([first,second,third].includes('7'));
    else if (propBet.id === 'middle_win') propResult = (first === '6' || first === '8');
  }

  const results: Record<string, { won: number, lost: number, net: number }> = {};

  for (const pid of state.playerOrder) {
    results[pid] = { won: 0, lost: 0, net: 0 };
    const bets = state.gameData.bets[pid] || [];
    
    for (const bet of bets) {
      const { horse, type } = bet;
      let won = 0;
      const mults = MULTIPLIERS[horse];
      
      if (type === 'win' && horse === first) {
        won = mults.win * 100; 
      } else if (type === 'place' && (horse === first || horse === second)) {
        won = mults.place * 100;
      } else if (type === 'show' && (horse === first || horse === second || horse === third)) {
        won = mults.show * 100;
      }

      if (won > 0) {
        results[pid].won += won;
        results[pid].net += won;
      } else {
        // Punish losing bets on slow horses to balance odds? Let's just deduct a fixed 100 fee per losing bet for simplicity
        results[pid].lost -= 100;
        results[pid].net -= 100;
      }
    }

    const pAnswer = state.gameData.propBetAnswers?.[pid];
    if (pAnswer !== undefined) {
      if (pAnswer === propResult) {
        results[pid].won += 150;
        results[pid].net += 150;
      } else {
        results[pid].lost -= 50;
        results[pid].net -= 50;
      }
    }

    state.gameData.money[pid] += results[pid].net;
    // Don't let money go below 0
    if (state.gameData.money[pid] < 0) state.gameData.money[pid] = 0;
    
    state.players[pid].score = state.gameData.money[pid];
  }

  state.hostData = {
    message: 'Race Finished!',
    finishers,
    results,
    timerStart: Date.now(),
    timerDuration: 12,
    autoAdvanceAt: Date.now() + 12_000,
    autoAdvanceAction: 'NEXT_RACE',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'RACE_RESULTS',
      money: state.gameData.money[pid],
      net: results[pid].net,
      finishers,
    };
  }
}

function endBetGame(state: GameState) {
  state.phase = 'FINAL_RESULTS';
  state.hostData = {
    message: 'Betting Concluded!'
  };
  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'FINAL_RESULTS'
    };
  }
}
