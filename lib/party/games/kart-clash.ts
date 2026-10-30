import { GameState } from '../types';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';
import { emitStateUpdate } from '../emitter';
import { waitingFor } from '../presence';
import { KART_TRACKS, TRACK_LIST, TrackId } from '../kart-tracks';
import {
  KartRaceSim,
  KartSpeedClass,
  KartItemsMode,
  buildKartRacers,
  createKartSimulation,
  forceStartCountdown,
  getKartSimulation,
   getKartSnapshot,
  startKartSimulationLoop,
  stopKartSimulation,
  triggerChaosDrop,
  updateKartInput,
} from '../kart-physics';

export type KartFormat = 'grand-prix' | 'tournament';
export type ChaosChoice = 'bananas' | 'item-boxes' | 'boost-pack';

export interface KartHeatStandingsRow {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  rank: number;
  points: number;
  timeMs: number | null;
}

export interface KartHeat {
  id: string;
  name: string;
  stage: 'qualifying' | 'semifinal' | 'consolation' | 'final' | 'custom';
  playerIds: string[];
  status: 'pending' | 'completed';
  trackId?: TrackId;
  winnerId?: string | null;
  standings?: KartHeatStandingsRow[];
  qualifiers?: string[];
}

const RANK_POINTS = [1500, 1200, 1000, 800, 600, 400, 200, 100];
const CHAMPIONSHIP_FINAL_BONUS = 500;
const PIT_CREW_PREDICT_BONUS = 300;
const TRACK_VOTE_SECONDS = 14;
const RESULTS_SECONDS = 12;

function activeRoomPlayers(state: GameState): string[] {
  return state.playerOrder.filter((pid) => state.players[pid] && !state.players[pid].left);
}

function getKartConfig(state: GameState) {
  const gd = (state.gameData ||= {});
  const players = activeRoomPlayers(state);
  const format: KartFormat = players.length > 8
    ? 'tournament'
    : gd.format === 'tournament'
    ? 'tournament'
    : 'grand-prix';
  const totalRaces = typeof gd.totalRaces === 'number' ? Math.max(1, Math.min(6, gd.totalRaces)) : 3;
  const heatSize: 2 | 4 | 8 = gd.heatSize === 2 || gd.heatSize === 8 ? gd.heatSize : 4;
  const aiBots = typeof gd.aiBots === 'boolean' ? gd.aiBots : true;
  const speedClass: KartSpeedClass = gd.speedClass === '50cc' || gd.speedClass === '100cc' || gd.speedClass === '200cc'
    ? gd.speedClass
    : '150cc';
  const itemsMode: KartItemsMode = gd.itemsMode === 'frantic' || gd.itemsMode === 'shells-only' || gd.itemsMode === 'pure'
    ? gd.itemsMode
    : 'normal';
  return { format, totalRaces, heatSize, aiBots, speedClass, itemsMode };
}

function createBalancedHeats(playerIds: string[], heatSize: 2 | 4 | 8, shuffle = false): KartHeat[] {
  const list = [...playerIds];
  if (shuffle) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  if (list.length === 0) return [];
  const numHeats = Math.max(1, Math.ceil(list.length / heatSize));
  const heats: KartHeat[] = Array.from({ length: numHeats }, (_, i) => ({
    id: `heat_${i + 1}`,
    name: numHeats === 1 ? 'Championship Heat' : `Qualifying Heat ${i + 1}`,
    stage: numHeats === 1 ? 'final' : 'qualifying',
    playerIds: [],
    status: 'pending',
  }));
  // Deal players across heats so heat sizes are balanced (e.g. 6 players with heatSize 4 -> 3 & 3)
  list.forEach((pid, idx) => {
    const heatIdx = Math.floor((idx * numHeats) / list.length);
    heats[Math.min(numHeats - 1, heatIdx)].playerIds.push(pid);
  });
  return heats;
}

function syncHeatSetupViews(state: GameState) {
  const cfg = getKartConfig(state);
  const heats: KartHeat[] = state.gameData.heats || [];
  const nextPending = heats.find((h) => h.status === 'pending') || null;
  const allQualifyingDone =
    heats.length > 0 &&
    heats.filter((h) => h.stage === 'qualifying').every((h) => h.status === 'completed');
  const hasFinalHeat = heats.some((h) => h.stage === 'final');

  state.hostData = {
    phase: 'HEAT_SETUP',
    format: cfg.format,
    speedClass: cfg.speedClass,
    itemsMode: cfg.itemsMode,
    heatSize: cfg.heatSize,
    aiBots: cfg.aiBots,
    totalRaces: cfg.totalRaces,
    heats,
    nextHeatId: nextPending?.id || null,
    canBuildFinals: allQualifyingDone && !hasFinalHeat && heats.length > 1,
    allHeatsCompleted: heats.length > 0 && heats.every((h) => h.status === 'completed'),
  };

  for (const pid of activeRoomPlayers(state)) {
    const myNextHeat = heats.find((h) => h.status === 'pending' && h.playerIds.includes(pid))
      || heats.find((h) => h.playerIds.includes(pid))
      || null;
    const custom = state.gameData?.customizations?.[pid] || {};
    state.playerData[pid] = {
      phase: 'HEAT_SETUP',
      format: cfg.format,
      speedClass: cfg.speedClass,
      itemsMode: cfg.itemsMode,
      heatSize: cfg.heatSize,
      aiBots: cfg.aiBots,
      myHeatId: myNextHeat?.id || null,
      myHeatName: myNextHeat?.name || null,
      nextHeatId: nextPending?.id || null,
      nextHeatName: nextPending?.name || null,
      kartStyle: custom.kartStyle || 'classic',
      sparksColor: custom.sparksColor || state.players[pid]?.avatarColor || '#38bdf8',
    };
  }
}

function startTrackVote(state: GameState, activeHeat?: KartHeat) {
  const cfg = getKartConfig(state);
  state.phase = 'TRACK_VOTE';
  state.gameData.raceNumber = (state.gameData.raceNumber || 0) + 1;
  state.gameData.trackVotes = {};
  state.gameData.heatPredictions = {};
  state.gameData.chaosVotes = {};
  state.gameData.chaosTriggered = false;

  const activeRacers = activeHeat
    ? activeHeat.playerIds.filter((pid) => state.players[pid] && !state.players[pid].left)
    : activeRoomPlayers(state).slice(0, 8);

  state.gameData.activeRacers = activeRacers;
  state.gameData.activeHeatId = activeHeat?.id || null;
  state.gameData.activeHeatName = activeHeat
    ? activeHeat.name
    : `Grand Prix — Race ${state.gameData.raceNumber} of ${cfg.totalRaces}`;

  const deadline = Date.now() + TRACK_VOTE_SECONDS * 1000;

  state.hostData = {
    phase: 'TRACK_VOTE',
    format: cfg.format,
    speedClass: cfg.speedClass,
    itemsMode: cfg.itemsMode,
    raceNumber: state.gameData.raceNumber,
    totalRaces: cfg.format === 'grand-prix' ? cfg.totalRaces : (state.gameData.heats?.length || 1),
    heatId: activeHeat?.id || null,
    heatName: state.gameData.activeHeatName,
    activeRacers,
    aiBots: cfg.aiBots,
    tracks: TRACK_LIST.map((t) => ({
      id: t.id,
      name: t.name,
      emoji: t.emoji,
      tagline: t.tagline,
      difficulty: t.difficulty,
    })),
    trackVotes: {},
    heats: state.gameData.heats || [],
    timerStart: Date.now(),
    timerDuration: TRACK_VOTE_SECONDS,
    autoAdvanceAt: deadline,
    autoAdvanceAction: 'LOCK_TRACK_VOTE',
  };

  for (const pid of activeRoomPlayers(state)) {
    const isRacing = activeRacers.includes(pid);
    const myUpcomingHeat = (state.gameData.heats || []).find(
      (h: KartHeat) => h.status === 'pending' && h.playerIds.includes(pid),
    );
    const custom = state.gameData?.customizations?.[pid] || {};
    state.playerData[pid] = {
      phase: 'TRACK_VOTE',
      isRacing,
      speedClass: cfg.speedClass,
      itemsMode: cfg.itemsMode,
      kartStyle: custom.kartStyle || 'classic',
      sparksColor: custom.sparksColor || state.players[pid]?.avatarColor || '#38bdf8',
      heatName: state.gameData.activeHeatName,
      myUpcomingHeatName: myUpcomingHeat?.name || null,
      activeRacers: activeRacers.map((rid) => ({
        id: rid,
        name: state.players[rid]?.name || 'Racer',
        avatar: state.players[rid]?.avatar || '🏎️',
        color: state.players[rid]?.avatarColor || '#38bdf8',
      })),
      tracks: state.hostData.tracks,
      votedTrackId: null,
      predictedWinnerId: null,
    };
  }
}

function chooseWinningTrack(state: GameState): TrackId {
  const votes: Record<string, TrackId> = state.gameData.trackVotes || {};
  const counts: Record<string, number> = {};
  for (const tid of Object.values(votes)) {
    if (KART_TRACKS[tid]) counts[tid] = (counts[tid] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length > 0) {
    const maxVotes = Math.max(...entries.map(([, c]) => c));
    const tied = entries.filter(([, c]) => c === maxVotes).map(([tid]) => tid as TrackId);
    return tied[Math.floor(Math.random() * tied.length)];
  }
  // Default rotation through tracks so a Grand Prix plays varied courses
  const played: TrackId[] = state.gameData.playedTracks || [];
  const unplayed = TRACK_LIST.map((t) => t.id).filter((id) => !played.includes(id));
  const pool = unplayed.length > 0 ? unplayed : TRACK_LIST.map((t) => t.id);
  return pool[(state.gameData.raceNumber - 1) % pool.length];
}

function launchRace(state: GameState, trackId: TrackId) {
  const cfg = getKartConfig(state);
  state.phase = 'RACING';
  state.gameData.currentTrackId = trackId;
  state.gameData.playedTracks = [...(state.gameData.playedTracks || []), trackId];

  const activeRacerIds: string[] = state.gameData.activeRacers || activeRoomPlayers(state).slice(0, 8);
  const humanPlayers = activeRacerIds
    .map((pid) => {
      const p = state.players[pid];
      if (!p) return null;
      const custom = state.gameData?.customizations?.[pid] || {};
      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        avatarColor: p.avatarColor,
        kartStyle: custom.kartStyle || 'classic',
        sparksColor: custom.sparksColor || p.avatarColor || '#38bdf8',
      };
    })
    .filter(Boolean) as any[];

  const targetGridSize = cfg.format === 'tournament' ? Math.max(cfg.heatSize, humanPlayers.length, cfg.aiBots ? 6 : humanPlayers.length) : 8;
  const racers = buildKartRacers(humanPlayers, cfg.aiBots, targetGridSize);
  const track = KART_TRACKS[trackId] || KART_TRACKS['sunny-circuit'];
  const raceId = `${state.roomCode}_R${state.gameData.raceNumber}_${Date.now()}`;

  const sim = createKartSimulation({
    roomCode: state.roomCode,
    raceId,
    trackId: track.id,
    racers,
    totalLaps: 3,
    speedClass: cfg.speedClass,
    itemsMode: cfg.itemsMode,
    requireOrientation: humanPlayers.length > 0,
    onFinish: () => {
      // Automatically transition room state to RACE_RESULTS when physics loop completes
      import('../engine')
        .then(({ processAction }) => processAction(state.roomCode, state.hostId, { type: 'FINISH_KART_RACE' }))
        .catch((err) => console.error('Kart Clash finish error:', err));
    },
  });

  startKartSimulationLoop(sim);
  const initialSnapshot = getKartSnapshot(sim);

  openAudienceVote(state, {
    key: `kart-race-${state.gameData.raceNumber}`,
    prompt: `Who wins ${state.gameData.activeHeatName}?`,
    choices: humanPlayers.map((p) => ({ id: p.id, label: `${p.avatar || '🏎️'} ${p.name}` })),
  });

  state.hostData = {
    phase: 'RACING',
    format: cfg.format,
    speedClass: cfg.speedClass,
    itemsMode: cfg.itemsMode,
    raceId,
    raceNumber: state.gameData.raceNumber,
    totalRaces: cfg.format === 'grand-prix' ? cfg.totalRaces : (state.gameData.heats?.length || 1),
    heatId: state.gameData.activeHeatId,
    heatName: state.gameData.activeHeatName,
    trackId: track.id,
    trackName: track.name,
    trackEmoji: track.emoji,
    activeRacers: activeRacerIds,
    initialSnapshot,
    chaosTriggered: false,
    chaosChoice: null,
  };

  for (const pid of activeRoomPlayers(state)) {
    const isRacing = activeRacerIds.includes(pid);
    const myUpcomingHeat = (state.gameData.heats || []).find(
      (h: KartHeat) => h.status === 'pending' && h.id !== state.gameData.activeHeatId && h.playerIds.includes(pid),
    );
    const custom = state.gameData?.customizations?.[pid] || {};
    state.playerData[pid] = {
      phase: 'RACING',
      isRacing,
      raceId,
      trackId: track.id,
      trackName: `${track.emoji} ${track.name}`,
      speedClass: cfg.speedClass,
      itemsMode: cfg.itemsMode,
      kartStyle: custom.kartStyle || 'classic',
      sparksColor: custom.sparksColor || state.players[pid]?.avatarColor || '#38bdf8',
      heatName: state.gameData.activeHeatName,
      myUpcomingHeatName: myUpcomingHeat?.name || null,
      activeRacers: humanPlayers.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar || '🏎️',
        color: p.avatarColor,
      })),
      predictedWinnerId: state.gameData.heatPredictions?.[pid] || null,
      chaosVote: state.gameData.chaosVotes?.[pid] || null,
      chaosTriggered: false,
    };
  }
}

function finalizeRaceResults(state: GameState, sim?: KartRaceSim) {
  if (state.phase === 'RACE_RESULTS') return;
  const cfg = getKartConfig(state);
  const activeSim = sim || getKartSimulation(state.roomCode);
  const activeRacerIds: string[] = state.gameData.activeRacers || [];

  // Build final standings from simulation (or fallback to activeRacers if forced without sim)
  let standings: KartHeatStandingsRow[] = [];
  if (activeSim) {
    const sorted = Object.values(activeSim.karts).sort((a, b) => a.rank - b.rank);
    standings = sorted.map((k, idx) => ({
      id: k.id,
      name: k.name,
      avatar: k.avatar,
      color: k.color,
      isBot: k.isBot,
      rank: idx + 1,
      points: !k.isBot ? (RANK_POINTS[idx] || 100) : 0,
      timeMs: k.finishTimeMs,
    }));

    // Merge simulation stats into game award counters
    for (const [pid, count] of Object.entries(activeSim.stats.drifts)) {
      bumpStat(state, 'drifts', pid, count);
    }
    for (const [pid, count] of Object.entries(activeSim.stats.hits)) {
      bumpStat(state, 'hits', pid, count);
    }
    for (const [pid, count] of Object.entries(activeSim.stats.spunOut)) {
      bumpStat(state, 'spunOut', pid, count);
    }
    if (activeSim.stats.fastestLap?.racerId) {
      bumpStat(state, 'fastestLap', activeSim.stats.fastestLap.racerId, 1);
    }
  } else {
    standings = activeRacerIds.map((pid, idx) => ({
      id: pid,
      name: state.players[pid]?.name || 'Racer',
      avatar: state.players[pid]?.avatar || '🏎️',
      color: state.players[pid]?.avatarColor || '#38bdf8',
      isBot: false,
      rank: idx + 1,
      points: RANK_POINTS[idx] || 100,
      timeMs: null,
    }));
  }

  stopKartSimulation(state.roomCode);
  state.phase = 'RACE_RESULTS';

  // Identify top human finisher
  const humanRows = standings.filter((r) => !r.isBot && state.players[r.id]);
  const topHuman = humanRows[0] || null;
  if (topHuman) {
    bumpStat(state, 'raceWins', topHuman.id, 1);
  }

  // Check if this is a Tournament Championship Final heat
  const heats: KartHeat[] = state.gameData.heats || [];
  const currentHeat = heats.find((h) => h.id === state.gameData.activeHeatId) || null;
  const isFinalHeat = currentHeat?.stage === 'final' && heats.length > 1;
  if (isFinalHeat && topHuman) {
    topHuman.points += CHAMPIONSHIP_FINAL_BONUS;
  }

  // Award race points to human racers
  for (const row of humanRows) {
    if (state.players[row.id]) {
      state.players[row.id].score += row.points;
    }
  }

  // Score Pit Crew predictions (+300 pts for calling the 1st-place human finisher)
  const predictions: Record<string, string> = state.gameData.heatPredictions || {};
  const correctPredictors: string[] = [];
  if (topHuman) {
    for (const [watcherId, pickedId] of Object.entries(predictions)) {
      if (pickedId === topHuman.id && state.players[watcherId] && !activeRacerIds.includes(watcherId)) {
        state.players[watcherId].score += PIT_CREW_PREDICT_BONUS;
        correctPredictors.push(watcherId);
        bumpStat(state, 'pitCrewOracle', watcherId, 1);
      }
    }
  }

  // Score Audience vote
  const audiencePoll = closeAudienceVote(state, `kart-race-${state.gameData.raceNumber}`);
  if (topHuman) {
    for (const [audId, choice] of Object.entries(audiencePoll.votes)) {
      if (choice === topHuman.id && state.audience?.[audId]) {
        state.audience[audId].score += 1;
      }
    }
  }

  // Update Tournament Heat state & qualifiers
  if (currentHeat) {
    currentHeat.status = 'completed';
    currentHeat.trackId = state.gameData.currentTrackId;
    currentHeat.winnerId = topHuman?.id || standings[0]?.id || null;
    currentHeat.standings = standings;
    const advanceCount = Math.max(1, Math.ceil(humanRows.length / 2));
    currentHeat.qualifiers = humanRows.slice(0, advanceCount).map((r) => r.id);

    // If all qualifying heats are finished and no Championship Final heat exists yet, auto-seed one!
    const qualifyingHeats = heats.filter((h) => h.stage === 'qualifying');
    const allQualDone = qualifyingHeats.length > 1 && qualifyingHeats.every((h) => h.status === 'completed');
    const hasFinal = heats.some((h) => h.stage === 'final');
    if (allQualDone && !hasFinal) {
      const finalists = [...new Set(qualifyingHeats.flatMap((h) => h.qualifiers || []))].slice(0, 8);
      if (finalists.length >= 2) {
        heats.push({
          id: `heat_final_${Date.now()}`,
          name: '🏆 Championship Final',
          stage: 'final',
          playerIds: finalists,
          status: 'pending',
        });
      }
    }
  }

  const deadline = Date.now() + RESULTS_SECONDS * 1000;
  state.hostData = {
    phase: 'RACE_RESULTS',
    format: cfg.format,
    speedClass: cfg.speedClass,
    itemsMode: cfg.itemsMode,
    raceNumber: state.gameData.raceNumber,
    totalRaces: cfg.format === 'grand-prix' ? cfg.totalRaces : heats.length,
    heatId: currentHeat?.id || null,
    heatName: state.gameData.activeHeatName,
    isFinalHeat,
    trackId: state.gameData.currentTrackId,
    standings,
    fastestLap: activeSim?.stats?.fastestLap || null,
    topHumanId: topHuman?.id || null,
    correctPredictors,
    qualifiers: currentHeat?.qualifiers || [],
    heats,
    timerStart: Date.now(),
    timerDuration: RESULTS_SECONDS,
    autoAdvanceAt: deadline,
    autoAdvanceAction: 'NEXT_KART_STEP',
  };

  for (const pid of activeRoomPlayers(state)) {
    const myRow = standings.find((r) => r.id === pid) || null;
    const wonPrediction = correctPredictors.includes(pid);
    const qualified = Boolean(currentHeat?.qualifiers?.includes(pid));
    state.playerData[pid] = {
      phase: 'RACE_RESULTS',
      heatName: state.gameData.activeHeatName,
      myRank: myRow?.rank || null,
      myPoints: myRow?.points || 0,
      qualified,
      wonPrediction,
      predictionBonus: wonPrediction ? PIT_CREW_PREDICT_BONUS : 0,
      topHumanName: topHuman?.name || standings[0]?.name || 'Winner',
      fastestLap: activeSim?.stats?.fastestLap || null,
      standings: standings.slice(0, 8),
    };
  }
}

export const kartClashLogic = {
  onStart: async (state: GameState) => {
    const players = activeRoomPlayers(state);
    if (players.length < 1) return;

    const cfg = getKartConfig(state);
    state.gameData = {
      ...state.gameData,
      format: cfg.format,
      totalRaces: cfg.totalRaces,
      heatSize: cfg.heatSize,
      aiBots: cfg.aiBots,
      raceNumber: 0,
      playedTracks: [],
      stats: state.gameData?.stats || {},
    };

    if (cfg.format === 'tournament') {
      state.phase = 'HEAT_SETUP';
      state.gameData.heats = createBalancedHeats(players, cfg.heatSize, false);
      syncHeatSetupViews(state);
    } else {
      state.gameData.heats = [];
      startTrackVote(state);
    }
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    const isHost = playerId === state.hostId;

    switch (action.type) {
      case 'SET_KART_CONFIG': {
        if (!isHost) return;
        if (state.phase !== 'LOBBY' && state.phase !== 'HEAT_SETUP') return;
        const gd = (state.gameData ||= {});
        if (action.format === 'grand-prix' || action.format === 'tournament') {
          gd.format = action.format;
        }
        if (typeof action.totalRaces === 'number' && action.totalRaces >= 1 && action.totalRaces <= 6) {
          gd.totalRaces = Math.round(action.totalRaces);
        }
        if (action.heatSize === 2 || action.heatSize === 4 || action.heatSize === 8) {
          gd.heatSize = action.heatSize;
        }
        if (typeof action.aiBots === 'boolean') {
          gd.aiBots = action.aiBots;
        }
        if (action.speedClass === '50cc' || action.speedClass === '100cc' || action.speedClass === '150cc' || action.speedClass === '200cc') {
          gd.speedClass = action.speedClass;
        }
        if (action.itemsMode === 'normal' || action.itemsMode === 'frantic' || action.itemsMode === 'shells-only' || action.itemsMode === 'pure') {
          gd.itemsMode = action.itemsMode;
        }

        if (state.phase === 'HEAT_SETUP') {
          const heats: KartHeat[] = gd.heats || [];
          const anyCompleted = heats.some((h) => h.status === 'completed');
          if (!anyCompleted && action.heatSize) {
            gd.heats = createBalancedHeats(activeRoomPlayers(state), gd.heatSize, false);
          }
          syncHeatSetupViews(state);
        }
        break;
      }

      case 'SET_KART_CUSTOMIZATION': {
        const gd = (state.gameData ||= {});
        const custom = (gd.customizations ||= {});
        const kartStyle = ['classic', 'rocket', 'cyber', 'bruiser'].includes(action.kartStyle)
          ? action.kartStyle
          : 'classic';
        const sparksColor = typeof action.sparksColor === 'string' && action.sparksColor.startsWith('#')
          ? action.sparksColor
          : (state.players[playerId]?.avatarColor || '#38bdf8');
        custom[playerId] = { kartStyle, sparksColor };
        if (state.playerData[playerId]) {
          state.playerData[playerId].kartStyle = kartStyle;
          state.playerData[playerId].sparksColor = sparksColor;
        }
        break;
      }

      case 'RANDOMIZE_HEATS': {
        if (!isHost || state.phase !== 'HEAT_SETUP') return;
        const cfg = getKartConfig(state);
        const heats: KartHeat[] = state.gameData.heats || [];
        const completed = heats.filter((h) => h.status === 'completed');
        const randomized = createBalancedHeats(activeRoomPlayers(state), cfg.heatSize, true).map((h, idx) => ({
          ...h,
          id: `heat_${completed.length + idx + 1}_${Date.now().toString(36)}`,
          name: completed.length > 0 ? `Round Heat ${completed.length + idx + 1}` : h.name,
        }));
        state.gameData.heats = [...completed, ...randomized];
        syncHeatSetupViews(state);
        break;
      }

      case 'ASSIGN_HEAT_PLAYER': {
        if (!isHost || state.phase !== 'HEAT_SETUP') return;
        const cfg = getKartConfig(state);
        const targetPlayerId = String(action.playerId || action.targetPlayerId || '');
        const targetHeatId = String(action.targetHeatId || '');
        const swapWithPlayerId = action.swapWithPlayerId ? String(action.swapWithPlayerId) : null;
        if (!state.players[targetPlayerId]) return;

        const heats: KartHeat[] = state.gameData.heats || [];
        const targetHeat = heats.find((h) => h.id === targetHeatId && h.status === 'pending');
        if (!targetHeat) return;

        const sourceHeat = heats.find(
          (h) => h.status === 'pending' && h.id !== targetHeatId && h.playerIds.includes(targetPlayerId),
        );

        if (swapWithPlayerId && targetHeat.playerIds.includes(swapWithPlayerId) && sourceHeat) {
          // Swap two players between pending heats
          sourceHeat.playerIds = sourceHeat.playerIds.map((id) => (id === targetPlayerId ? swapWithPlayerId : id));
          targetHeat.playerIds = targetHeat.playerIds.map((id) => (id === swapWithPlayerId ? targetPlayerId : id));
        } else if (targetHeat.playerIds.includes(targetPlayerId)) {
          // Toggle out if heat has >1 player
          if (targetHeat.playerIds.length > 1) {
            targetHeat.playerIds = targetHeat.playerIds.filter((id) => id !== targetPlayerId);
          }
        } else if (sourceHeat && targetHeat.playerIds.length >= cfg.heatSize) {
          // Target heat is already at heatSize capacity -> swap with last player in targetHeat so sizes stay balanced
          const displacedId = targetHeat.playerIds[targetHeat.playerIds.length - 1];
          sourceHeat.playerIds = sourceHeat.playerIds.map((id) => (id === targetPlayerId ? displacedId : id));
          targetHeat.playerIds = targetHeat.playerIds.map((id) => (id === displacedId ? targetPlayerId : id));
        } else if (targetHeat.playerIds.length < 8) {
          if (sourceHeat) {
            sourceHeat.playerIds = sourceHeat.playerIds.filter((id) => id !== targetPlayerId);
          }
          targetHeat.playerIds.push(targetPlayerId);
        }

        // Remove any empty pending heats if more than 1 pending heat remains
        const pendingCount = heats.filter((h) => h.status === 'pending').length;
        if (pendingCount > 1) {
          state.gameData.heats = heats.filter((h) => h.status === 'completed' || h.playerIds.length > 0);
        }
        syncHeatSetupViews(state);
        break;
      }

      case 'ADD_CUSTOM_HEAT': {
        if (!isHost || state.phase !== 'HEAT_SETUP') return;
        const heats: KartHeat[] = (state.gameData.heats ||= []);
        const cfg = getKartConfig(state);
        const allPlayers = activeRoomPlayers(state);
        const requestedIds = Array.isArray(action.playerIds)
          ? action.playerIds.filter((id: string) => state.players[id] && !state.players[id].left).slice(0, 8)
          : allPlayers.slice(0, cfg.heatSize);
        const stage: KartHeat['stage'] = action.stage === 'final' || action.stage === 'consolation' ? action.stage : 'custom';
        const defaultName = stage === 'final'
          ? '🏆 Championship Final'
          : stage === 'consolation'
          ? '💥 Consolation Heat'
          : `Heat ${heats.length + 1}`;
        heats.push({
          id: `heat_custom_${Date.now().toString(36)}`,
          name: typeof action.name === 'string' && action.name.trim() ? action.name.trim() : defaultName,
          stage,
          playerIds: requestedIds,
          status: 'pending',
        });
        syncHeatSetupViews(state);
        break;
      }

      case 'REMOVE_HEAT': {
        if (!isHost || state.phase !== 'HEAT_SETUP') return;
        const heatId = String(action.heatId || '');
        const heats: KartHeat[] = state.gameData.heats || [];
        if (heats.length <= 1) return;
        state.gameData.heats = heats.filter((h) => !(h.id === heatId && h.status === 'pending'));
        syncHeatSetupViews(state);
        break;
      }

      case 'BUILD_FINALS_HEAT': {
        if (!isHost || state.phase !== 'HEAT_SETUP') return;
        const heats: KartHeat[] = (state.gameData.heats ||= []);
        const completed = heats.filter((h) => h.status === 'completed');
        if (completed.length === 0) return;

        const qualifiers = [...new Set(completed.flatMap((h) => h.qualifiers || []))].slice(0, 8);
        const nonQualifiers = activeRoomPlayers(state)
          .filter((pid) => !qualifiers.includes(pid))
          .slice(0, 8);

        // Remove existing pending heats and seed Consolation (optional) + Championship Final
        const nextHeats = [...completed];
        if (action.includeConsolation && nonQualifiers.length >= 2) {
          nextHeats.push({
            id: `heat_consolation_${Date.now().toString(36)}`,
            name: '💥 Consolation Chaos Heat',
            stage: 'consolation',
            playerIds: nonQualifiers,
            status: 'pending',
          });
        }
        if (qualifiers.length >= 1) {
          nextHeats.push({
            id: `heat_final_${Date.now().toString(36)}`,
            name: '🏆 Championship Final',
            stage: 'final',
            playerIds: qualifiers,
            status: 'pending',
          });
        }
        state.gameData.heats = nextHeats;
        syncHeatSetupViews(state);
        break;
      }

      case 'START_HEAT':
      case 'START_NEXT_HEAT': {
        if (!isHost || state.phase !== 'HEAT_SETUP') return;
        const heats: KartHeat[] = state.gameData.heats || [];
        const target = (action.heatId && heats.find((h) => h.id === action.heatId && h.status === 'pending'))
          || heats.find((h) => h.status === 'pending');
        if (!target || target.playerIds.length === 0) return;
        startTrackVote(state, target);
        break;
      }

      case 'END_TOURNAMENT': {
        if (!isHost) return;
        stopKartSimulation(state.roomCode);
        state.phase = 'FINAL_RESULTS';
        state.hostData = { message: 'Tournament Complete!' };
        for (const pid of activeRoomPlayers(state)) {
          state.playerData[pid] = { phase: 'FINAL_RESULTS' };
        }
        break;
      }

      case 'VOTE_TRACK':
      case 'SUBMIT_TRACK_VOTE': {
        if (state.phase !== 'TRACK_VOTE') return;
        const trackId = String(action.trackId || '') as TrackId;
        if (!KART_TRACKS[trackId]) return;
        const activeRacers: string[] = state.gameData.activeRacers || [];
        if (!activeRacers.includes(playerId)) return;

        state.gameData.trackVotes[playerId] = trackId;
        if (state.playerData[playerId]) {
          state.playerData[playerId].votedTrackId = trackId;
        }
        state.hostData.trackVotes = { ...state.gameData.trackVotes };

        const needed = waitingFor(state, activeRacers);
        if (needed.length > 0 && needed.every((pid) => Boolean(state.gameData.trackVotes[pid]))) {
          launchRace(state, chooseWinningTrack(state));
        }
        break;
      }

      case 'LOCK_TRACK_VOTE': {
        if (!isHost || state.phase !== 'TRACK_VOTE') return;
        launchRace(state, chooseWinningTrack(state));
        break;
      }

      case 'SUBMIT_HEAT_PREDICTION': {
        if (state.phase !== 'TRACK_VOTE' && state.phase !== 'RACING') return;
        const activeRacers: string[] = state.gameData.activeRacers || [];
        if (activeRacers.includes(playerId)) return; // Racers cannot bet against themselves
        const predictedId = String(action.predictedPlayerId || action.racerId || '');
        if (!activeRacers.includes(predictedId)) return;

        // Lock in prediction during TRACK_VOTE or early RACING
        const sim = getKartSimulation(state.roomCode);
        if (state.phase === 'RACING' && sim && sim.elapsedMs > 30_000) return;

        state.gameData.heatPredictions = { ...(state.gameData.heatPredictions || {}), [playerId]: predictedId };
        if (state.playerData[playerId]) {
          state.playerData[playerId].predictedWinnerId = predictedId;
        }
        break;
      }

      case 'SUBMIT_CHAOS_VOTE': {
        if (state.phase !== 'RACING') return;
        const activeRacers: string[] = state.gameData.activeRacers || [];
        if (activeRacers.includes(playerId)) return; // Only Pit Crew / waiting players vote on Chaos Drop
        const choice = String(action.choice || '') as ChaosChoice;
        if (!['bananas', 'item-boxes', 'boost-pack'].includes(choice)) return;
        if (state.gameData.chaosTriggered) return;

        state.gameData.chaosVotes = { ...(state.gameData.chaosVotes || {}), [playerId]: choice };
        if (state.playerData[playerId]) {
          state.playerData[playerId].chaosVote = choice;
        }

        // Check if all waiting players have voted or if race is past 15s to trigger immediately
        const waitingIds = activeRoomPlayers(state).filter((pid) => !activeRacers.includes(pid));
        const voteValues = Object.values(state.gameData.chaosVotes) as ChaosChoice[];
        const sim = getKartSimulation(state.roomCode);
        const pastOpening = !sim || sim.elapsedMs >= 10_000 || voteValues.length >= Math.max(1, waitingIds.length);
        if (pastOpening && voteValues.length > 0) {
          const tally: Record<ChaosChoice, number> = { bananas: 0, 'item-boxes': 0, 'boost-pack': 0 };
          for (const c of voteValues) tally[c] = (tally[c] || 0) + 1;
          const winner = (Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0]) as ChaosChoice;
          state.gameData.chaosTriggered = true;
          state.hostData.chaosTriggered = true;
          state.hostData.chaosChoice = winner;
          for (const pid of waitingIds) {
            if (state.playerData[pid]) state.playerData[pid].chaosTriggered = true;
          }
          triggerChaosDrop(state.roomCode, winner);
          emitStateUpdate(state.roomCode);
        }
        break;
      }

      case 'KART_INPUT': {
        if (state.phase !== 'RACING') return;
        updateKartInput(state.roomCode, playerId, action.input || action);
        break;
      }

      case 'HONK_HORN': {
        if (state.phase !== 'RACING') return;
        updateKartInput(state.roomCode, playerId, { honk: true });
        break;
      }

      case 'PIT_CREW_EMOJI':
      case 'SEND_EMOJI': {
        if (state.phase !== 'RACING') return;
        const emoji = typeof action.emoji === 'string' ? action.emoji.slice(0, 4) : '🏎️';
        state.hostData = {
          ...state.hostData,
          latestEmoji: {
            id: `${playerId}_${Date.now()}`,
            playerId,
            playerName: state.players[playerId]?.name || 'Pit Crew',
            emoji,
            timestamp: Date.now(),
          },
        };
        break;
      }

      case 'FORCE_START_COUNTDOWN':
      case 'START_COUNTDOWN_NOW': {
        if (!isHost || state.phase !== 'RACING') return;
        forceStartCountdown(state.roomCode);
        break;
      }

      case 'FINISH_KART_RACE': {
        if (!isHost || state.phase !== 'RACING') return;
        finalizeRaceResults(state);
        break;
      }

      case 'NEXT_KART_STEP': {
        if (!isHost || state.phase !== 'RACE_RESULTS') return;
        const cfg = getKartConfig(state);
        if (cfg.format === 'tournament') {
          const heats: KartHeat[] = state.gameData.heats || [];
          const currentHeat = heats.find((h) => h.id === state.gameData.activeHeatId);
          const hasPending = heats.some((h) => h.status === 'pending');
          if (currentHeat?.stage === 'final' && !hasPending) {
            state.phase = 'FINAL_RESULTS';
            state.hostData = { message: 'Tournament Concluded!' };
            for (const pid of activeRoomPlayers(state)) {
              state.playerData[pid] = { phase: 'FINAL_RESULTS' };
            }
          } else {
            state.phase = 'HEAT_SETUP';
            syncHeatSetupViews(state);
          }
        } else {
          if (state.gameData.raceNumber >= cfg.totalRaces) {
            state.phase = 'FINAL_RESULTS';
            state.hostData = { message: 'Grand Prix Concluded!' };
            for (const pid of activeRoomPlayers(state)) {
              state.playerData[pid] = { phase: 'FINAL_RESULTS' };
            }
          } else {
            startTrackVote(state);
          }
        }
        break;
      }
    }
  },
};
