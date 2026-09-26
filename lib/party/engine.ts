import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { GameState, GameType } from './types';
import { emitStateUpdate } from './emitter';
import { fakerLogic } from './games/the-faker';
import { quipClashLogic } from './games/quip-clash';
import { triviaDeathLogic } from './games/trivia-death';
import { bracketBattlesLogic } from './games/bracket-battles';
import { readySetBetLogic } from './games/ready-set-bet';
import { MAX_AUDIENCE, activeAudienceVote, recordAudienceVote } from './audience';
import { computeAwards } from './awards';
import { getPrompts, listPacks } from './prompts';

const DATA_DIR = path.join(process.cwd(), '.data', 'party');
const ROOM_CODE_RE = /^[A-Z]{4}$/;
/** Rooms untouched for this long are deleted when a new room is created. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_PLAYERS = 16;
const MAX_NAME_LENGTH = 16;
/** Free-text answers are capped so one player can't flood everyone's screen. */
const MAX_TEXT_LENGTH = 120;

export const GAME_TYPES: GameType[] = ['quip-clash', 'the-faker', 'trivia-death', 'bracket-battles', 'ready-set-bet'];

type GameLogic = {
  onStart: (state: GameState, ...args: any[]) => Promise<void> | void;
  processAction: (state: GameState, playerId: string, action: any) => Promise<void> | void;
};

const LOGIC: Record<GameType, GameLogic> = {
  'quip-clash': quipClashLogic,
  'the-faker': fakerLogic,
  'trivia-death': triviaDeathLogic,
  'bracket-battles': bracketBattlesLogic,
  'ready-set-bet': readySetBetLogic,
};

/** Minimum players needed to start each game. */
export const MIN_PLAYERS: Record<GameType, number> = {
  'quip-clash': 3,
  'the-faker': 3,
  'trivia-death': 3,
  'bracket-battles': 3,
  'ready-set-bet': 1,
};

export function normalizeRoomCode(roomCode: unknown): string | null {
  const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
  return ROOM_CODE_RE.test(code) ? code : null;
}

function roomPath(roomCode: string) {
  return path.join(DATA_DIR, `${roomCode}.json`);
}

// ─── Per-room lock ─────────────────────────────────────────────────────────────
// Every action is read → modify → write. Players tend to submit at the same
// moment (the timer runs out, everyone taps), and without serialization those
// concurrent writes silently drop each other's answers.

const roomLocks = new Map<string, Promise<unknown>>();

async function withRoomLock<R>(roomCode: string, fn: () => Promise<R>): Promise<R> {
  const previous = roomLocks.get(roomCode) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  roomLocks.set(roomCode, tail);
  try {
    return await run;
  } finally {
    if (roomLocks.get(roomCode) === tail) roomLocks.delete(roomCode);
  }
}

// ─── Storage ───────────────────────────────────────────────────────────────────

export async function getGameState(roomCode: string): Promise<GameState | null> {
  const code = normalizeRoomCode(roomCode);
  if (!code) return null;
  try {
    const data = await fs.readFile(roomPath(code), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function writeState(state: GameState) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = roomPath(state.roomCode);
  // Atomic write: live streams read this file constantly and must never see
  // a half-written JSON document.
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state));
  await fs.rename(tmp, file);
}

export async function saveGameState(state: GameState): Promise<void> {
  state.updatedAt = Date.now();
  await writeState(state);
  scheduleAutoAdvance(state);
  emitStateUpdate(state.roomCode);
}

async function pruneStaleRooms() {
  try {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const file of await fs.readdir(DATA_DIR)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(DATA_DIR, file);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.unlink(full).catch(() => {});
    }
  } catch {
    // Directory missing — nothing to prune.
  }
}

// ─── Server-side auto-advance ──────────────────────────────────────────────────
// Timed phases store `autoAdvanceAt` + `autoAdvanceAction`. The server fires
// them itself so a sleeping host tab can't stall the game; the host page's own
// timer is only a fallback. Either way the action carries the deadline it was
// scheduled for, and a stale one (from an earlier round) is ignored.

const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAutoAdvance(state: GameState) {
  const existing = autoTimers.get(state.roomCode);
  if (existing) clearTimeout(existing);
  autoTimers.delete(state.roomCode);

  const at = state.hostData?.autoAdvanceAt;
  const type = state.hostData?.autoAdvanceAction;
  if (typeof at !== 'number' || typeof type !== 'string') return;

  const timer = setTimeout(() => {
    autoTimers.delete(state.roomCode);
    processAction(state.roomCode, state.hostId, { type, deadline: at }).catch((error) =>
      console.error('Party auto-advance failed:', error)
    );
  }, Math.max(250, at - Date.now()));
  // Don't keep the process alive just for a party timer.
  (timer as { unref?: () => void }).unref?.();
  autoTimers.set(state.roomCode, timer);
}

// ─── Rooms & players ───────────────────────────────────────────────────────────

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easier to read on a TV
  return Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
}

export async function createRoom(gameType: GameType): Promise<{ roomCode: string; hostId: string }> {
  if (!GAME_TYPES.includes(gameType)) throw new Error('Unknown game type');
  await pruneStaleRooms();

  let roomCode = generateRoomCode();
  for (let i = 0; i < 20 && (await getGameState(roomCode)); i++) roomCode = generateRoomCode();

  const hostId = `HOST_${crypto.randomBytes(8).toString('hex')}`;
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

const COLORS = ['#FF5733', '#33FF57', '#3357FF', '#F033FF', '#33FFF0', '#FFB533', '#FF3380', '#9D4EDD', '#06D6A0', '#FFD60A', '#4CC9F0', '#F77F00'];

export function sanitizePlayerName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) : '';
}

export type JoinResult =
  | { playerId: string; rejoined?: boolean; audience?: boolean }
  | { error: string; audienceAvailable?: boolean };

export async function joinRoom(roomCode: string, playerName: string, options: { asAudience?: boolean } = {}): Promise<JoinResult> {
  const code = normalizeRoomCode(roomCode);
  const name = sanitizePlayerName(playerName);
  if (!code) return { error: 'Room codes are 4 letters' };
  if (!name) return { error: 'Enter a nickname' };

  return withRoomLock(code, async () => {
    const state = await getGameState(code);
    if (!state) return { error: 'Room not found' };

    const existing = Object.values(state.players).find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      // Let a player who lost their tab get back in (same name, not currently connected).
      if (!existing.connected) {
        existing.connected = true;
        const key = Object.keys(state.playerKeys || {}).find((k) => state.playerKeys![k] === existing.id) || newPlayerKey(state, existing.id);
        await saveGameState(state);
        return { playerId: key, rejoined: true };
      }
      return { error: 'Name already taken' };
    }

    if (options.asAudience) return joinAudience(state, name);
    if (state.phase !== 'LOBBY') return { error: 'This game has already started', audienceAvailable: true };
    if (state.playerOrder.length >= MAX_PLAYERS) return { error: `Room is full (${MAX_PLAYERS} players)`, audienceAvailable: true };
    if (Object.values(state.audience || {}).some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      return { error: 'Name already taken' };
    }

    const playerId = `P_${crypto.randomBytes(6).toString('hex')}`;
    const usedColors = new Set(Object.values(state.players).map((p) => p.avatarColor));
    const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[state.playerOrder.length % COLORS.length];

    state.players[playerId] = { id: playerId, name, score: 0, connected: true, avatarColor: color };
    state.playerOrder.push(playerId);
    const key = newPlayerKey(state, playerId);
    await saveGameState(state);
    return { playerId: key };
  });
}

async function joinAudience(state: GameState, name: string): Promise<JoinResult> {
  const audience = (state.audience ||= {});
  const existing = Object.values(audience).find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (existing.connected) return { error: 'Name already taken' };
    existing.connected = true;
    const key = Object.keys(state.audienceKeys || {}).find((k) => state.audienceKeys![k] === existing.id) || newAudienceKey(state, existing.id);
    await saveGameState(state);
    return { playerId: key, rejoined: true, audience: true };
  }
  if (Object.keys(audience).length >= MAX_AUDIENCE) return { error: 'The audience is full' };
  const id = `A_${crypto.randomBytes(6).toString('hex')}`;
  audience[id] = { id, name, connected: true, score: 0 };
  const key = newAudienceKey(state, id);
  await saveGameState(state);
  return { playerId: key, audience: true };
}

function newAudienceKey(state: GameState, audienceId: string) {
  const key = `AK_${crypto.randomBytes(12).toString('hex')}`;
  state.audienceKeys = { ...(state.audienceKeys || {}), [key]: audienceId };
  return key;
}

export function resolveAudienceKey(state: GameState, key: string | null | undefined): string | null {
  if (!key || !state.audienceKeys) return null;
  const id = state.audienceKeys[key];
  return id && state.audience?.[id] ? id : null;
}

/** What an audience member's phone shows: the open poll (if any) and their own vote. */
export function audienceView(state: GameState, audienceId: string) {
  const poll = activeAudienceVote(state);
  const me = state.audience![audienceId];
  const members = Object.values(state.audience || {});
  return {
    roomCode: state.roomCode,
    gameType: state.gameType,
    phase: state.phase,
    me,
    players: Object.values(state.players).map(({ id, name, score, avatarColor }) => ({ id, name, score, avatarColor })),
    audienceSize: members.length,
    audienceLeaders: members.filter((m) => m.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(({ name, score }) => ({ name, score })),
    poll: poll ? { key: poll.key, prompt: poll.prompt, choices: poll.choices, myChoice: poll.votes[audienceId] ?? null } : null,
    updatedAt: state.updatedAt,
  };
}

export async function setAudienceConnected(roomCode: string, audienceId: string, connected: boolean) {
  const code = normalizeRoomCode(roomCode);
  if (!code) return;
  await withRoomLock(code, async () => {
    const state = await getGameState(code);
    const member = state?.audience?.[audienceId];
    if (!state || !member || member.connected === connected) return;
    member.connected = connected;
    await saveGameState(state);
  });
}

function newPlayerKey(state: GameState, playerId: string) {
  const key = `K_${crypto.randomBytes(12).toString('hex')}`;
  state.playerKeys = { ...(state.playerKeys || {}), [key]: playerId };
  return key;
}

/** The player id a secret key belongs to (rooms from before keys existed used the id itself). */
export function resolvePlayerKey(state: GameState, key: string | null | undefined): string | null {
  if (!key) return null;
  if (state.playerKeys) return state.playerKeys[key] ?? null;
  return state.players[key] ? key : null;
}

/** State as sent to the host screen: everything except credentials and who voted for what. */
export function hostView(state: GameState) {
  const { playerKeys: _keys, audienceKeys: _audienceKeys, audienceVote: _poll, audience, ...rest } = state;
  const poll = activeAudienceVote(state);
  return {
    ...rest,
    audienceSize: Object.keys(audience || {}).length,
    audienceVote: poll ? { prompt: poll.prompt, voteCount: Object.keys(poll.votes).length } : null,
    audienceLeaders: Object.values(audience || {}).filter((m) => m.score > 0).sort((a, b) => b.score - a.score).slice(0, 3),
    awards: state.phase === 'FINAL_RESULTS' ? computeAwards(state) : null,
  };
}

/** Mark a player's live connection state (called by the player stream). */
export async function setPlayerConnected(roomCode: string, playerId: string, connected: boolean) {
  const code = normalizeRoomCode(roomCode);
  if (!code) return;
  await withRoomLock(code, async () => {
    const state = await getGameState(code);
    const player = state?.players[playerId];
    if (!state || !player || player.connected === connected) return;
    player.connected = connected;
    await saveGameState(state);
  });
}

// ─── Actions ───────────────────────────────────────────────────────────────────

/** Actions a player may send. Everything else (timers, next, force) is host-only. */
function isPlayerAction(type: string) {
  return type.startsWith('SUBMIT_') || type === 'PLACE_BET';
}

/** Trim free-text fields in an action so they stay within display limits. */
function sanitizeAction(action: Record<string, any>) {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(action)) {
    clean[key] = typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : value;
  }
  return clean;
}

function resetToLobby(state: GameState, resetScores: boolean) {
  state.phase = 'LOBBY';
  state.hostData = {};
  state.playerData = {};
  state.gameData = { targetRounds: state.gameData?.targetRounds };
  state.audienceVote = null;
  if (resetScores) for (const pid of state.playerOrder) state.players[pid].score = 0;
}

export async function processAction(roomCode: string, actorKey: string, rawAction: any): Promise<{ success: boolean; error?: string }> {
  const code = normalizeRoomCode(roomCode);
  if (!code) return { success: false, error: 'Invalid room code' };
  if (!rawAction || typeof rawAction !== 'object' || typeof rawAction.type !== 'string') {
    return { success: false, error: 'Invalid action' };
  }
  const action = sanitizeAction(rawAction);

  return withRoomLock(code, async () => {
    const state = await getGameState(code);
    if (!state) return { success: false, error: 'Room not found' };

    const isHost = actorKey === state.hostId;
    const playerId = isHost ? state.hostId : resolvePlayerKey(state, actorKey);
    if (!playerId) {
      const audienceId = resolveAudienceKey(state, actorKey);
      if (!audienceId) return { success: false, error: 'You are not in this room' };
      if (action.type !== 'AUDIENCE_VOTE') return { success: false, error: 'The audience can only vote' };
      if (!recordAudienceVote(state, audienceId, action.choice)) return { success: false, error: 'Voting is closed' };
      await saveGameState(state);
      return { success: true };
    }
    if (!isHost && !state.players[playerId]) return { success: false, error: 'Not in this room' };
    if (!isHost && !isPlayerAction(action.type)) return { success: false, error: 'Only the host can do that' };

    // Timer-driven actions carry the deadline they were scheduled for; ignore
    // them if the game has moved on since (e.g. everyone answered early).
    if (typeof action.deadline === 'number' && state.hostData?.autoAdvanceAt !== action.deadline) {
      return { success: true };
    }

    switch (action.type) {
      case 'START_GAME': {
        const min = MIN_PLAYERS[state.gameType];
        if (state.playerOrder.length < min) return { success: false, error: `Need at least ${min} players` };
        await LOGIC[state.gameType].onStart(state);
        break;
      }
      case 'QUIT_GAME':
        resetToLobby(state, false);
        break;
      case 'SWITCH_GAME': {
        if (!GAME_TYPES.includes(action.gameType)) return { success: false, error: 'Unknown game' };
        state.gameType = action.gameType;
        resetToLobby(state, true);
        break;
      }
      case 'SET_QUIP_ROUNDS': {
        const rounds = Math.round(Number(action.rounds));
        if (!Number.isFinite(rounds) || rounds < 1 || rounds > 5) return { success: false, error: 'Rounds must be 1–5' };
        state.gameData = { ...(state.gameData || {}), targetRounds: rounds };
        break;
      }
      case 'SET_PACKS': {
        const known = new Set(listPacks(await getPrompts()).map((p) => p.id));
        const packs = Array.isArray(action.packs) ? [...new Set(action.packs.filter((id: unknown) => typeof id === 'string' && known.has(id)))] as string[] : [];
        if (packs.length === 0) return { success: false, error: 'Pick at least one pack' };
        state.settings = { ...(state.settings || {}), packs };
        break;
      }
      case 'KICK_PLAYER': {
        if (state.phase !== 'LOBBY') return { success: false, error: 'Players can only be removed in the lobby' };
        const target = String(action.targetId || '');
        if (!state.players[target]) return { success: false, error: 'Player not found' };
        delete state.players[target];
        delete state.playerData[target];
        if (state.playerKeys) {
          for (const [k, pid] of Object.entries(state.playerKeys)) if (pid === target) delete state.playerKeys[k];
        }
        state.playerOrder = state.playerOrder.filter((pid) => pid !== target);
        break;
      }
      default:
        await LOGIC[state.gameType].processAction(state, playerId, action);
    }

    await saveGameState(state);
    return { success: true };
  });
}
