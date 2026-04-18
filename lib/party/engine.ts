import fs from 'fs/promises';
import path from 'path';
import { GameState, GameType } from './types';
import { emitStateUpdate } from './emitter';
import { fakerLogic } from './games/the-faker';
import { quipClashLogic } from './games/quip-clash';
import { triviaDeathLogic } from './games/trivia-death';
import { bracketBattlesLogic } from './games/bracket-battles';
import { readySetBetLogic } from './games/ready-set-bet';

const DATA_DIR = path.join(process.cwd(), '.data', 'party');

// Ensure directory exists
async function ensureDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Error creating party data directory', err);
  }
}

// Generate a random 4-letter room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function getGameState(roomCode: string): Promise<GameState | null> {
  await ensureDir();
  const filePath = path.join(DATA_DIR, `${roomCode.toUpperCase()}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

export async function saveGameState(state: GameState): Promise<void> {
  await ensureDir();
  const filePath = path.join(DATA_DIR, `${state.roomCode.toUpperCase()}.json`);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
  // Emit event so SSE streams know to push state
  emitStateUpdate(state.roomCode);
}

export async function createRoom(gameType: GameType): Promise<{ roomCode: string; hostId: string }> {
  let roomCode = generateRoomCode();
  // Ensure uniqueness
  while (await getGameState(roomCode)) {
    roomCode = generateRoomCode();
  }

  const hostId = `HOST_${Math.random().toString(36).substring(2, 9)}`;

  const initialState: GameState = {
    roomCode,
    gameType,
    phase: 'LOBBY',
    players: {},
    playerOrder: [],
    hostId,
    hostData: {},
    playerData: {},
    updatedAt: Date.now(),
  };

  await saveGameState(initialState);
  return { roomCode, hostId };
}

const COLORS = ['#FF5733', '#33FF57', '#3357FF', '#F033FF', '#33FFF0', '#FFB533'];

export async function joinRoom(roomCode: string, playerName: string): Promise<{ playerId: string } | { error: string }> {
  const state = await getGameState(roomCode);
  if (!state) {
    return { error: 'Room not found' };
  }
  if (state.phase !== 'LOBBY') {
    return { error: 'Game has already started' };
  }

  // Check if player name already exists (case-insensitive)
  const nameExists = Object.values(state.players).some(p => p.name.toLowerCase() === playerName.toLowerCase());
  if (nameExists) {
    return { error: 'Name already taken' };
  }

  const playerId = `P_${Math.random().toString(36).substring(2, 9)}`;
  const color = COLORS[Object.keys(state.players).length % COLORS.length];

  state.players[playerId] = {
    id: playerId,
    name: playerName,
    score: 0,
    connected: true,
    avatarColor: color,
  };
  state.playerOrder.push(playerId);
  state.updatedAt = Date.now();

  await saveGameState(state);

  return { playerId };
}

export async function processAction(roomCode: string, playerId: string, action: any): Promise<{ success: boolean; error?: string }> {
  const state = await getGameState(roomCode);
  if (!state) return { success: false, error: 'Room not found' };

  if (action.type === 'START_GAME') {
    if (playerId !== state.hostId) return { success: false, error: 'Only host can start the game' };
    const minPlayers = state.gameType === 'ready-set-bet' ? 1 : 3;
    if (state.playerOrder.length < minPlayers) return { success: false, error: `Need at least ${minPlayers} players` };
    if (state.gameType === 'quip-clash') await quipClashLogic.onStart(state);
    else if (state.gameType === 'the-faker') await fakerLogic.onStart(state);
    else if (state.gameType === 'trivia-death') await triviaDeathLogic.onStart(state);
    else if (state.gameType === 'bracket-battles') await bracketBattlesLogic.onStart(state);
    else if (state.gameType === 'ready-set-bet') await readySetBetLogic.onStart(state);
    state.updatedAt = Date.now();
    await saveGameState(state);
    return { success: true };
  }

  // Global actions (work regardless of game type)
  if (action.type === 'QUIT_GAME') {
    if (playerId !== state.hostId) return { success: false, error: 'Only host can quit' };
    state.phase = 'LOBBY';
    state.hostData = {};
    state.playerData = {};
    state.gameData = {};
    state.updatedAt = Date.now();
    await saveGameState(state);
    return { success: true };
  }

  if (action.type === 'SWITCH_GAME') {
    if (playerId !== state.hostId) return { success: false, error: 'Only host can switch game' };
    const newGameType = action.gameType as GameType;
    state.gameType = newGameType;
    state.phase = 'LOBBY';
    state.hostData = {};
    state.playerData = {};
    state.gameData = {};
    // Reset all scores
    for (const pid of state.playerOrder) {
      state.players[pid].score = 0;
    }
    state.updatedAt = Date.now();
    await saveGameState(state);
    return { success: true };
  }

  if (action.type === 'SET_QUIP_ROUNDS') {
    if (playerId !== state.hostId) return { success: false, error: 'Only host can change rounds' };
    if (!state.gameData) state.gameData = {};
    state.gameData.targetRounds = action.rounds;
    state.updatedAt = Date.now();
    await saveGameState(state);
    return { success: true };
  }

  // Delegate other actions to respective engines
  if (state.gameType === 'quip-clash') await quipClashLogic.processAction(state, playerId, action);
  else if (state.gameType === 'the-faker') await fakerLogic.processAction(state, playerId, action);
  else if (state.gameType === 'trivia-death') await triviaDeathLogic.processAction(state, playerId, action);
  else if (state.gameType === 'bracket-battles') await bracketBattlesLogic.processAction(state, playerId, action);
  else if (state.gameType === 'ready-set-bet') await readySetBetLogic.processAction(state, playerId, action);

  state.updatedAt = Date.now();
  await saveGameState(state);
  return { success: true };
}
