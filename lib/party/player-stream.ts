import { computeAwards } from './awards';
import { isVipPlayer } from './engine';
import { waitingFor } from './presence';
import { GameState } from './types';

export function computeWaitingOnNames(state: GameState): string[] {
  const ids = waitingFor(state, state.playerOrder);

  const isDone = (pid: string): boolean => {
    const pd = state.playerData?.[pid];
    switch (state.gameType) {
      case 'quip-clash': {
        if (state.phase === 'PROMPTING') return Boolean(pd?.answers?.[0] && pd?.answers?.[1]);
        if (state.phase === 'VOTING') {
          const idx = state.gameData?.currentPromptIndex ?? 0;
          const owners: string[] = state.gameData?.promptOwners?.[idx] || [];
          return owners.includes(pid) || Boolean(state.gameData?.votes?.[idx]?.[pid]);
        }
        return true;
      }
      case 'the-faker':
        if (state.phase === 'VOTING') {
          return !(state.gameData?.activePlayers || []).includes(pid) || Boolean(state.gameData?.votes?.[pid]);
        }
        return true;
      case 'trivia-death':
        if (state.phase === 'QUESTION') return state.gameData?.currentAnswers?.[pid] !== undefined;
        if (state.phase === 'KILLING_FLOOR') {
          return !(state.gameData?.killingFloorPlayers || []).includes(pid)
            || state.gameData?.killingFloorAnswers?.[pid] !== undefined;
        }
        if (state.phase === 'FINAL_ESCAPE') {
          return state.gameData?.playerStatuses?.[pid] === 'escaped' || Boolean(state.gameData?.escapeAnswers?.[pid]);
        }
        return true;
      case 'bracket-battles':
        if (state.phase === 'PROMPTING') return Boolean(state.gameData?.answers?.[pid] || pd?.phase === 'WAITING');
        if (state.phase === 'PREDICTION') return Boolean(state.gameData?.predictions?.[pid] || pd?.phase === 'WAITING');
        if (state.phase === 'MATCHUP') return !pd?.answers?.length || Boolean(state.gameData?.votes?.[pid] || pd?.phase === 'WAITING');
        return true;
      case 'spyfall':
        if (state.phase === 'VOTING') return Boolean(pd?.hasVoted || state.gameData?.votes?.[pid]);
        return true;
      case 'herd-mentality':
        if (state.phase === 'PROMPTING') return Boolean(pd?.submitted);
        return true;
      case 'wavelength':
        if (state.phase === 'CLUE_GIVING') return pid !== state.gameData?.psychicId;
        if (state.phase === 'DIALING') return pid === state.gameData?.psychicId || Boolean(pd?.submitted || pd?.lockedDial !== null);
        return true;
      case 'bluff-clash':
        if (state.phase === 'BLUFFING') return Boolean(pd?.submitted);
        if (state.phase === 'VOTING') return Boolean(pd?.voted || state.gameData?.votes?.[pid]);
        return true;
      case 'emoji-telephone':
        if (state.phase === 'TRANSLATE' || state.phase === 'GUESS') return Boolean(pd?.submitted);
        if (state.phase === 'VOTING') return Boolean(pd?.voted);
        return true;
      case 'debate-duel':
        if (state.phase === 'TOPIC') return Boolean(pd?.topic);
        if (state.phase === 'SWITCH') return Boolean(pd?.proposed);
        if (state.phase === 'VERDICT') return !(pd?.canVote || pd?.canRate) || (pd?.chosen !== null && pd?.chosen !== undefined);
        return true;
      case 'kart-clash':
        if (state.phase === 'TRACK_VOTE') return !pd?.isRacing || Boolean(pd?.votedTrackId);
        return true;
      default:
        return true;
    }
  };

  return ids
    .filter((pid) => !isDone(pid))
    .map((pid) => state.players[pid]?.name)
    .filter(Boolean);
}

/**
 * Extract only strictly non-secret / already-revealed UI fields for phone screens.
 * Raw `hostData` is never forwarded to players so secret answers, authors, roles,
 * death outcomes, or study decks cannot leak via the player SSE stream.
 */
export function sanitizePublicData(state: GameState, playerId: string): Record<string, any> {
  const hd = state.hostData || {};
  const phase = state.phase;
  const out: Record<string, any> = {};

  if (typeof hd.round === 'number') out.round = hd.round;
  if (typeof hd.totalRounds === 'number') out.totalRounds = hd.totalRounds;

  switch (state.gameType) {
    case 'quip-clash':
      if (phase === 'VOTING') {
        out.prompt = hd.prompt;
        out.promptNumber = hd.promptNumber;
        out.totalPrompts = hd.totalPrompts;
        out.answers = Array.isArray(hd.answers) ? hd.answers.map((a: any) => ({ answer: a.answer })) : undefined;
      } else if (phase === 'ROUND_RESULTS') {
        out.prompt = hd.prompt;
        out.promptNumber = hd.promptNumber;
        out.totalPrompts = hd.totalPrompts;
        out.tally = hd.tally;
        out.answers = hd.answers;
        out.quipLash = hd.quipLash;
      }
      break;
    case 'the-faker':
      if (phase === 'RESULTS') {
        out.fakerCaught = hd.fakerCaught;
        out.fakerEliminated = hd.fakerEliminated;
        out.eliminated = hd.eliminated;
        out.fakerId = hd.fakerId;
        out.task = hd.task;
      }
      break;
    case 'trivia-death':
      if (phase === 'QUESTION_RESULTS') {
        out.question = hd.question;
        out.choices = hd.choices;
        out.correctAnswer = hd.correctAnswer;
        out.killingFloorPlayers = hd.killingFloorPlayers;
      } else if (phase === 'KILLING_FLOOR') {
        out.miniGameName = hd.miniGameName;
        out.killingFloorPlayers = hd.killingFloorPlayers;
        if (Array.isArray(hd.killingFloorPlayers) && hd.killingFloorPlayers.includes(playerId)) {
          out.grid = hd.grid;
        }
      } else if (phase === 'KILLING_FLOOR_RESULTS') {
        out.miniGameName = hd.miniGameName;
        out.killingFloorPlayers = hd.killingFloorPlayers;
        out.dead = hd.dead;
      }
      break;
    case 'bracket-battles':
      if (phase === 'MATCH_RESULT') {
        out.winner = hd.winner;
        out.votes = hd.votes;
      }
      break;
    case 'ready-set-bet':
      if (phase === 'RACING' || phase === 'RACE_RESULTS') {
        out.positions = hd.positions;
        out.trackLength = hd.trackLength;
        out.lastRoll = hd.lastRoll;
        out.commentary = hd.commentary;
        out.finishers = hd.finishers;
        out.bettingClosed = hd.bettingClosed;
      }
      break;
    case 'spyfall':
      if (hd.locations) out.locations = hd.locations;
      if (phase === 'VOTING') out.message = hd.message;
      if (phase === 'RESULTS') {
        out.headline = hd.headline;
        out.spyId = hd.spyId;
        out.location = hd.location;
        out.locationEmoji = hd.locationEmoji;
      }
      break;
    case 'herd-mentality':
      if (phase === 'ROUND_RESULTS') {
        out.prompt = hd.prompt;
        out.groups = hd.groups;
        out.pinkCowHolder = hd.pinkCowHolder;
      }
      break;
    case 'wavelength':
      if (hd.psychicId) out.psychicId = hd.psychicId;
      if (phase === 'ROUND_RESULTS') out.results = hd.results;
      break;
    case 'bluff-clash':
      if (phase === 'ROUND_RESULTS') {
        out.prompt = hd.prompt;
        out.revealed = hd.revealed;
      }
      break;
    case 'emoji-telephone':
      if (phase === 'SHOWCASE' || phase === 'VOTING' || phase === 'ROUND_RESULTS') {
        out.chain = hd.chain;
      }
      break;
    case 'debate-duel':
      for (const k of [
        'words', 'switch', 'matchNumber', 'totalMatches', 'debateRound',
        'speakerSide', 'speakerId', 'heckles', 'typed', 'winnerSide',
        'mode', 'tally', 'micDrop', 'points',
      ]) {
        if (hd[k] !== undefined) out[k] = hd[k];
      }
      break;
    case 'kart-clash':
      for (const k of [
        'raceId', 'trackId', 'heatName', 'format', 'speedClass', 'itemsMode',
        'heatSize', 'aiBots', 'laps', 'botLevel', 'tracks', 'nextHeatId',
        'isFinalHeat', 'heats', 'canBuildFinals', 'winnerName', 'winnerIsBot',
      ]) {
        if (hd[k] !== undefined) out[k] = hd[k];
      }
      break;
  }
  return out;
}

/** Build the sanitized player SSE payload (hostData is always omitted). */
export function buildPlayerPayload(state: GameState, playerId: string) {
  const isVip = isVipPlayer(state, playerId);
  return {
    roomCode: state.roomCode,
    gameType: state.gameType,
    phase: state.phase,
    players: state.players,
    playerOrder: state.playerOrder,
    settings: state.settings,
    vipId: state.vipId || null,
    audienceSize: Object.keys(state.audience || {}).length,
    paused: state.paused || null,
    baseScores: state.gameData?.baseScores || null,
    targetRounds: state.settings?.rounds ?? state.gameData?.targetRounds ?? null,
    timerStart: typeof state.hostData?.timerStart === 'number' ? state.hostData.timerStart : null,
    timerDuration: typeof state.hostData?.timerDuration === 'number' ? state.hostData.timerDuration : null,
    autoAdvanceAt: isVip ? (state.hostData?.autoAdvanceAt ?? null) : null,
    autoAdvanceAction: isVip ? (state.hostData?.autoAdvanceAction ?? null) : null,
    publicData: sanitizePublicData(state, playerId),
    kartConfig: state.gameType === 'kart-clash' ? {
      format: state.gameData?.format || (state.playerOrder.length > 8 ? 'tournament' : 'grand-prix'),
      totalRaces: state.gameData?.totalRaces || 3,
      heatSize: state.gameData?.heatSize || 4,
      aiBots: state.gameData?.aiBots !== false,
      speedClass: state.gameData?.speedClass || '150cc',
      itemsMode: state.gameData?.itemsMode || 'normal',
      myCustomization: state.gameData?.customizations?.[playerId] || null,
    } : null,
    waitingOn: computeWaitingOnNames(state),
    me: { ...state.players[playerId], isVip },
    data: state.playerData[playerId] || null,
    awards: state.phase === 'FINAL_RESULTS' ? computeAwards(state) : null,
    updatedAt: state.updatedAt,
  };
}
