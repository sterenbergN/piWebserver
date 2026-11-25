import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { GameState } from './types';

import type * as Prompts from './prompts';

// Prompt storage is fixed to process.cwd()/.data when the module loads, so
// move to a temp dir first and only then load the game modules.
let quipClashLogic: typeof import('./games/quip-clash').quipClashLogic;
let bracketBattlesLogic: typeof import('./games/bracket-battles').bracketBattlesLogic;
let fakerLogic: typeof import('./games/the-faker').fakerLogic;
let normalizePrompts: typeof Prompts.normalizePrompts;
let savePrompts: typeof Prompts.savePrompts;
let sanitizeEmojiClue: typeof import('./games/emoji-telephone').sanitizeEmojiClue;
let engine: typeof import('./engine');

test.before(async () => {
  process.chdir(await fs.mkdtemp(path.join(os.tmpdir(), 'party-')));
  ({ quipClashLogic } = await import('./games/quip-clash'));
  ({ bracketBattlesLogic } = await import('./games/bracket-battles'));
  ({ fakerLogic } = await import('./games/the-faker'));
  ({ normalizePrompts, savePrompts } = await import('./prompts'));
  ({ sanitizeEmojiClue } = await import('./games/emoji-telephone'));
  engine = await import('./engine');
});

function makeState(gameType: GameState['gameType'], count: number): GameState {
  const players: GameState['players'] = {};
  const playerOrder: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `p${i}`;
    players[id] = { id, name: `Player ${i}`, score: 0, connected: true, avatarColor: '#fff' };
    playerOrder.push(id);
  }
  return { roomCode: 'ABCD', gameType, phase: 'LOBBY', players, playerOrder, hostId: 'host', hostData: {}, playerData: {}, gameData: {}, updatedAt: 0 };
}

test('quip clash keeps matchups separate even when the prompt pool repeats', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['Only prompt'], theFaker: ['x'], bracketBattles: ['y'] }));
  const state = makeState('quip-clash', 4);
  await quipClashLogic.onStart(state);

  assert.equal(state.gameData.promptOwners.length, 4);
  for (const owners of state.gameData.promptOwners) assert.equal(owners.length, 2);

  for (const pid of state.playerOrder) {
    for (const i of [0, 1]) await quipClashLogic.processAction(state, pid, { type: 'SUBMIT_ANSWER', promptIndex: i, answer: `${pid}-${i}` });
  }
  assert.equal(state.phase, 'VOTING');
  const answers = state.hostData.answers.map((a: { answer: string }) => a.answer).sort();
  assert.equal(answers.length, 2);
  assert.notEqual(answers[0], answers[1]);
});

test('quip clash rejects blank answers and votes for non-authors', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['a', 'b', 'c', 'd'], theFaker: ['x'], bracketBattles: ['y'] }));
  const state = makeState('quip-clash', 3);
  await quipClashLogic.onStart(state);
  await quipClashLogic.processAction(state, 'p0', { type: 'SUBMIT_ANSWER', promptIndex: 0, answer: '   ' });
  assert.equal(state.playerData.p0.answers[0], '');

  await quipClashLogic.processAction(state, 'host', { type: 'FORCE_VOTING' });
  const owners: string[] = state.gameData.promptOwners[0];
  const voter = state.playerOrder.find((pid) => !owners.includes(pid))!;
  await quipClashLogic.processAction(state, voter, { type: 'SUBMIT_VOTE', votedForId: voter });
  assert.equal(state.phase, 'VOTING', 'a vote for a non-author is ignored');
  await quipClashLogic.processAction(state, voter, { type: 'SUBMIT_VOTE', votedForId: owners[0] });
  assert.equal(state.phase, 'ROUND_RESULTS');
  assert.equal(state.players[owners[0]].score, 500);
});

test('bracket battles pairs prompt partners and bars them from voting on their own match', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['a'], theFaker: ['x'], bracketBattles: Array.from({ length: 20 }, (_, i) => `prompt ${i}`) }));
  const state = makeState('bracket-battles', 4);
  await bracketBattlesLogic.onStart(state);
  for (const pid of state.playerOrder) await bracketBattlesLogic.processAction(state, pid, { type: 'SUBMIT_ANSWER', answer: `answer ${pid}` });
  assert.equal(state.phase, 'PREDICTION');

  // Two players who shared a prompt meet in round one under that prompt.
  const humanMatches = state.gameData.bracket.filter((m: any) => m.answer1 && !m.answer1.isBot && !m.answer2.isBot);
  assert.equal(humanMatches.length, 2);
  for (const m of humanMatches) {
    assert.equal(state.gameData.playerPrompts[m.answer1.id], m.prompt);
    assert.equal(state.gameData.playerPrompts[m.answer2.id], m.prompt);
  }

  await bracketBattlesLogic.processAction(state, 'host', { type: 'FORCE_MATCHUP' });
  const match = state.gameData.bracket[state.gameData.currentMatchId];
  const contestant = [match.answer1, match.answer2].find((a: any) => !a.isBot)?.id;
  if (contestant) {
    await bracketBattlesLogic.processAction(state, contestant, { type: 'SUBMIT_VOTE', voteId: contestant });
    assert.equal(state.gameData.votes[contestant], undefined);
  }
  const voter = state.playerOrder.find((pid) => pid !== match.answer1.id && pid !== match.answer2.id)!;
  await bracketBattlesLogic.processAction(state, voter, { type: 'SUBMIT_VOTE', voteId: 'not-in-match' });
  assert.equal(state.gameData.votes[voter], undefined);
});

test('the faker ignores self-votes and votes for players not in the round', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['a'], theFaker: ['Touch your nose'], bracketBattles: ['y'] }));
  const state = makeState('the-faker', 4);
  await fakerLogic.onStart(state);
  await fakerLogic.processAction(state, 'host', { type: 'PROCEED_TO_ACTION' });
  await fakerLogic.processAction(state, 'host', { type: 'PROCEED_TO_VOTING' });
  assert.equal(state.playerData.p0.showAction, false);

  await fakerLogic.processAction(state, 'p0', { type: 'SUBMIT_VOTE', votedFor: 'p0' });
  await fakerLogic.processAction(state, 'p0', { type: 'SUBMIT_VOTE', votedFor: 'ghost' });
  assert.deepEqual(state.gameData.votes, {});
  await fakerLogic.processAction(state, 'p0', { type: 'SUBMIT_VOTE', votedFor: 'p1' });
  assert.equal(state.gameData.votes.p0, 'p1');
});

test('normalizePrompts trims, de-duplicates and drops incomplete trivia', () => {
  const result = normalizePrompts({
    quipClash: ['  Hello ', 'hello', '', 42],
    triviaQuestions: [
      { question: 'Q1', choices: ['a', 'b', 'c', 'd'], answer: 2, category: ' Sci ' },
      { question: 'Q2', choices: ['a', '', 'c', 'd'], answer: 0 },
      { question: 'Q3', choices: ['a', 'b', 'c', 'd'], answer: 7 },
    ],
  });
  assert.deepEqual(result.quipClash, ['Hello']);
  assert.deepEqual(result.theFaker, []);
  assert.deepEqual(result.triviaQuestions, [{ question: 'Q1', choices: ['a', 'b', 'c', 'd'], answer: 2, category: 'Sci' }]);
});

test('audience: full rooms offer the audience, and audience votes only count in open polls', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['a', 'b', 'c'], theFaker: ['x'], bracketBattles: ['y'] }));
  const { roomCode, hostId } = await engine.createRoom('quip-clash');
  for (let i = 0; i < engine.MAX_PLAYERS; i++) {
    const r = await engine.joinRoom(roomCode, `P${i}`);
    assert.ok('playerId' in r);
  }
  const full = await engine.joinRoom(roomCode, 'Late');
  assert.ok('error' in full && full.audienceAvailable);

  const seat = await engine.joinRoom(roomCode, 'Late', { asAudience: true });
  assert.ok('playerId' in seat && seat.audience);
  const key = (seat as { playerId: string }).playerId;

  // The audience can't act as a player, and can't vote with no poll open.
  assert.equal((await engine.processAction(roomCode, key, { type: 'SUBMIT_ANSWER', promptIndex: 0, answer: 'hi' })).success, false);
  assert.equal((await engine.processAction(roomCode, key, { type: 'AUDIENCE_VOTE', choice: 'x' })).success, false);

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  await engine.processAction(roomCode, hostId, { type: 'FORCE_VOTING' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'VOTING');
  const owner = state.gameData.promptOwners[0][0];
  assert.equal((await engine.processAction(roomCode, key, { type: 'AUDIENCE_VOTE', choice: 'nobody' })).success, false);
  assert.equal((await engine.processAction(roomCode, key, { type: 'AUDIENCE_VOTE', choice: owner })).success, true);

  const before = state.players[owner].score;
  await engine.processAction(roomCode, hostId, { type: 'FORCE_NEXT_VOTE' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.hostData.audienceFavorite, owner);
  assert.equal(state.players[owner].score, before + 250);
  assert.equal(state.audienceVote, null);
  // The host view never exposes keys or who voted for what.
  const host = engine.hostView(state) as Record<string, unknown>;
  assert.equal(host.audienceKeys, undefined);
  assert.equal(host.playerKeys, undefined);
  assert.equal(host.audienceSize, 1);
});

test('awards pick the leaders and skip ties that say nothing', async () => {
  const { computeAwards, bumpStat } = await import('./awards');
  const state = makeState('quip-clash', 3);
  state.gameData = {};
  bumpStat(state, 'votes', 'p0', 5);
  bumpStat(state, 'votes', 'p1', 2);
  bumpStat(state, 'quiplash', 'p0');
  bumpStat(state, 'votes', 'ghost', 99); // not a player: ignored
  const awards = computeAwards(state);
  const byTitle = Object.fromEntries(awards.map((a) => [a.title, a.playerIds]));
  assert.deepEqual(byTitle['Crowd Pleaser'], ['p0']);
  assert.deepEqual(byTitle['Clean Sweep'], ['p0']);
  assert.deepEqual(byTitle['Tough Crowd'], ['p2']);
  assert.equal(byTitle['Audience Darling'], undefined);
});

test('prompt packs: chosen packs supply the prompts, unknown packs fall back to Classic', async () => {
  const { getRandomPrompts } = await import('./prompts');
  await savePrompts(normalizePrompts({
    quipClash: ['classic prompt'],
    packs: [{ id: 'fam', name: 'Fam', quipClash: ['family prompt'] }, { name: 'Fam' /* duplicate name → new id */ }],
  }));
  const saved = normalizePrompts({ packs: [{ id: 'classic', name: 'Sneaky' }, { name: '' }] });
  assert.notEqual(saved.packs![0].id, 'classic');
  assert.equal(saved.packs!.length, 1);

  assert.deepEqual(await getRandomPrompts('quip-clash', 2, ['fam']), ['family prompt', 'family prompt']);
  assert.deepEqual(await getRandomPrompts('quip-clash', 1), ['classic prompt']);
  assert.deepEqual(await getRandomPrompts('quip-clash', 1, ['nope']), ['classic prompt']);
  const both = await getRandomPrompts('quip-clash', 2, ['classic', 'fam']);
  assert.deepEqual([...both].sort(), ['classic prompt', 'family prompt']);
});

test('avatars are unique per room and reactions are validated and rate-limited', async () => {
  const { roomCode } = await engine.createRoom('quip-clash');
  const a = await engine.joinRoom(roomCode, 'Ann', { avatar: '🦊' });
  const b = await engine.joinRoom(roomCode, 'Bob', { avatar: '🦊' });
  await engine.joinRoom(roomCode, 'Cy', { avatar: 'not-an-avatar' });
  let state = (await engine.getGameState(roomCode))!;
  const avatars = Object.values(state.players).map((p) => p.avatar);
  assert.equal(avatars[0], '🦊');
  assert.equal(new Set(avatars).size, 3);

  const keyA = (a as { playerId: string }).playerId;
  await engine.processAction(roomCode, keyA, { type: 'SUBMIT_REACTION', emoji: '😂' });
  await engine.processAction(roomCode, keyA, { type: 'SUBMIT_REACTION', emoji: '🔥' }); // too soon: dropped
  await engine.processAction(roomCode, (b as { playerId: string }).playerId, { type: 'SUBMIT_REACTION', emoji: '<script>' }); // not allowed
  state = (await engine.getGameState(roomCode))!;
  assert.deepEqual(state.reactions?.map((r) => r.emoji), ['😂']);
});

test('in-session profile updates, leaving rooms, closing rooms, and disconnected player advance', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['p1', 'p2', 'p3', 'p4'], theFaker: ['x'], bracketBattles: ['y'] }));
  const { roomCode, hostId } = await engine.createRoom('quip-clash');
  const p1 = (await engine.joinRoom(roomCode, 'Alice', { avatar: '🦊' })) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Bob', { avatar: '🐸' })) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Cara', { avatar: '🐼' })) as { playerId: string };
  const aud = (await engine.joinRoom(roomCode, 'Spec', { asAudience: true })) as { playerId: string };

  // Seat validation works for player, audience, and host
  assert.equal((await engine.checkRoomSeat(roomCode, { playerKey: p1.playerId })).valid, true);
  assert.equal((await engine.checkRoomSeat(roomCode, { playerKey: aud.playerId, audience: true })).valid, true);
  assert.equal((await engine.checkRoomSeat(roomCode, { hostId })).valid, true);
  assert.equal((await engine.checkRoomSeat(roomCode, { hostId: 'wrong' })).valid, false);

  // Profile update: rename and swap avatar
  assert.equal((await engine.processAction(roomCode, p1.playerId, { type: 'UPDATE_PROFILE', name: 'Bob' })).success, false, 'duplicate player name rejected');
  assert.equal((await engine.processAction(roomCode, p1.playerId, { type: 'UPDATE_PROFILE', name: 'Spec' })).success, false, 'duplicate audience name rejected');
  assert.equal((await engine.processAction(roomCode, p1.playerId, { type: 'UPDATE_PROFILE', avatar: '🐸' })).success, false, 'taken avatar rejected');
  assert.equal((await engine.processAction(roomCode, p1.playerId, { type: 'UPDATE_PROFILE', name: 'Alicia', avatar: '🐙' })).success, true);
  assert.equal((await engine.processAction(roomCode, aud.playerId, { type: 'UPDATE_PROFILE', name: 'Watcher' })).success, true);

  let state = (await engine.getGameState(roomCode))!;
  const p1Id = engine.resolvePlayerKey(state, p1.playerId)!;
  const p3Id = engine.resolvePlayerKey(state, p3.playerId)!;
  assert.equal(state.players[p1Id].name, 'Alicia');
  assert.equal(state.players[p1Id].avatar, '🐙');

  // Set rounds and start game
  await engine.processAction(roomCode, hostId, { type: 'SET_QUIP_ROUNDS', rounds: 2 });
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });

  // p3 leaves mid-game: their key is revoked and p1 + p2 submitting advances without waiting on p3
  assert.equal((await engine.processAction(roomCode, p3.playerId, { type: 'LEAVE_ROOM' })).success, true);
  assert.equal((await engine.checkRoomSeat(roomCode, { playerKey: p3.playerId })).valid, false);

  for (const key of [p1.playerId, p2.playerId]) {
    await engine.processAction(roomCode, key, { type: 'SUBMIT_ANSWER', promptIndex: 0, answer: 'a0' });
    await engine.processAction(roomCode, key, { type: 'SUBMIT_ANSWER', promptIndex: 1, answer: 'a1' });
  }
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'VOTING', 'advances without waiting for disconnected/left player');

  // PLAY_AGAIN resets to lobby, purges left player p3, and preserves targetRounds
  await engine.processAction(roomCode, hostId, { type: 'PLAY_AGAIN' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'LOBBY');
  assert.equal(state.players[p3Id], undefined);
  assert.equal(state.gameData.targetRounds, 2);

  // Audience leaves
  assert.equal((await engine.processAction(roomCode, aud.playerId, { type: 'LEAVE_ROOM' })).success, true);
  assert.equal((await engine.checkRoomSeat(roomCode, { playerKey: aud.playerId, audience: true })).valid, false);

  // Host closes room
  assert.equal((await engine.processAction(roomCode, hostId, { type: 'CLOSE_ROOM' })).success, true);
  assert.equal(await engine.getGameState(roomCode), null);
  assert.equal((await engine.checkRoomSeat(roomCode, { hostId })).valid, false);
});

test('Trivia Death: while paused only the host can restart it, and nothing else moves', async () => {
  const { roomCode, hostId } = await engine.createRoom('trivia-death');
  const keys: string[] = [];
  for (const name of ['Ann', 'Bo', 'Cy']) {
    const joined = await engine.joinRoom(roomCode, name);
    assert.ok('playerId' in joined);
    keys.push(joined.playerId);
  }
  const audience = await engine.joinRoom(roomCode, 'Viewer', { asAudience: true });
  assert.ok('playerId' in audience);
  assert.deepEqual(await engine.processAction(roomCode, hostId, { type: 'PAUSE_GAME' }), { success: false, error: 'This can’t be paused right now' }, 'not from the lobby');
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });

  assert.equal((await engine.processAction(roomCode, keys[0], { type: 'PAUSE_GAME' })).success, false, 'players can’t');
  assert.deepEqual(await engine.processAction(roomCode, hostId, { type: 'PAUSE_GAME' }), { success: true });
  assert.deepEqual(await engine.processAction(roomCode, hostId, { type: 'PAUSE_GAME' }), { success: true }, 'a double tap is harmless');

  const held = (await engine.getGameState(roomCode))!;
  assert.equal(held.phase, 'QUESTION');
  const before = held.paused!.autoAdvanceAt;
  const paused = { success: false, error: 'The game is paused' };
  assert.deepEqual(await engine.processAction(roomCode, keys[0], { type: 'SUBMIT_TRIVIA_ANSWER', answer: 0 }), paused);
  assert.deepEqual(await engine.processAction(roomCode, hostId, { type: 'FORCE_TRIVIA_REVEAL' }), paused, 'no skipping past a pause');
  assert.deepEqual(await engine.processAction(roomCode, audience.playerId, { type: 'AUDIENCE_VOTE', choice: '0' }), paused);
  assert.deepEqual(await engine.processAction(roomCode, hostId, { type: 'FORCE_TRIVIA_REVEAL', deadline: before }), { success: true }, 'a timer already on its way is ignored');
  const still = (await engine.getGameState(roomCode))!;
  assert.equal(still.phase, 'QUESTION');
  assert.deepEqual(still.gameData.currentAnswers, {});
  assert.equal(engine.audienceView(still, Object.keys(still.audience!)[0]).paused, true);

  assert.equal((await engine.processAction(roomCode, keys[0], { type: 'RESUME_GAME' })).success, false, 'players can’t resume either');
  assert.deepEqual(await engine.processAction(roomCode, hostId, { type: 'RESUME_GAME' }), { success: true });
  const back = (await engine.getGameState(roomCode))!;
  assert.equal(back.paused, undefined);
  assert.ok(back.hostData.autoAdvanceAt >= before);
  assert.deepEqual(await engine.processAction(roomCode, keys[0], { type: 'SUBMIT_TRIVIA_ANSWER', answer: 0 }), { success: true });
  assert.equal((await engine.getGameState(roomCode))!.gameData.currentAnswers[Object.keys(back.players)[0]], 0);

  await engine.processAction(roomCode, hostId, { type: 'PAUSE_GAME' });
  await engine.processAction(roomCode, hostId, { type: 'QUIT_GAME' });
  assert.equal((await engine.getGameState(roomCode))!.paused, undefined, 'ending the game ends the pause');
  await engine.processAction(roomCode, hostId, { type: 'CLOSE_ROOM' });
});

test('Spyfall: discussion, spy location guess, and voting flow', async () => {
  const { roomCode, hostId } = await engine.createRoom('spyfall');
  const p1 = (await engine.joinRoom(roomCode, 'Alice')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Bob')) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Cara')) as { playerId: string };

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'DISCUSSION');

  const keys = [p1.playerId, p2.playerId, p3.playerId];
  const spyId = state.gameData.spyId as string;
  const spyKey = keys.find((k) => engine.resolvePlayerKey(state, k) === spyId)!;
  const nonSpyKey = keys.find((k) => engine.resolvePlayerKey(state, k) !== spyId)!;

  // Non-spy cannot guess location
  await engine.processAction(roomCode, nonSpyKey, { type: 'SPY_GUESS_LOCATION', location: state.gameData.location });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'DISCUSSION');

  // Anyone can call a vote
  await engine.processAction(roomCode, nonSpyKey, { type: 'CALL_VOTE' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'VOTING');

  // Everyone votes for the Spy
  for (const k of keys) {
    const myId = engine.resolvePlayerKey(state, k)!;
    const target = myId === spyId ? engine.resolvePlayerKey(state, nonSpyKey)! : spyId;
    await engine.processAction(roomCode, k, { type: 'SUBMIT_VOTE', votedFor: target });
  }
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RESULTS');
  assert.equal(state.hostData.spyCaught, true);

  // Advance to round 2 and test Spy guessing correct location
  await engine.processAction(roomCode, hostId, { type: 'NEXT_SPYFALL_ROUND' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'DISCUSSION');
  const spyKeyR2 = keys.find((k) => engine.resolvePlayerKey(state, k) === state.gameData.spyId)!;
  await engine.processAction(roomCode, spyKeyR2, { type: 'SPY_GUESS_LOCATION', location: state.gameData.location });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RESULTS');
  assert.equal(state.hostData.spyCaught, false);
});

test('Herd Mentality: majority scoring and Pink Cow penalty', async () => {
  const { roomCode, hostId } = await engine.createRoom('herd-mentality');
  const p1 = (await engine.joinRoom(roomCode, 'Alice')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Bob')) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Cara')) as { playerId: string };

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'PROMPTING');

  const id1 = engine.resolvePlayerKey(state, p1.playerId)!;
  const id2 = engine.resolvePlayerKey(state, p2.playerId)!;
  const id3 = engine.resolvePlayerKey(state, p3.playerId)!;

  await engine.processAction(roomCode, p1.playerId, { type: 'SUBMIT_ANSWER', answer: 'Pizza' });
  await engine.processAction(roomCode, p2.playerId, { type: 'SUBMIT_ANSWER', answer: 'the pizza!' });
  await engine.processAction(roomCode, p3.playerId, { type: 'SUBMIT_ANSWER', answer: 'Broccoli' });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'ROUND_RESULTS');
  assert.equal(state.players[id1].score, 600);
  assert.equal(state.players[id2].score, 600);
  assert.equal(state.players[id3].score, 0);
  assert.equal(state.hostData.pinkCowHolder, id3, 'lone outlier gets the Pink Cow');
});

test('Wavelength: psychic clue and dial proximity scoring', async () => {
  const { roomCode, hostId } = await engine.createRoom('wavelength');
  const p1 = (await engine.joinRoom(roomCode, 'Alice')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Bob')) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Cara')) as { playerId: string };

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'CLUE_GIVING');

  const keys = [p1.playerId, p2.playerId, p3.playerId];
  const psychicId = state.gameData.psychicId as string;
  const target = state.gameData.target as number;
  const psychicKey = keys.find((k) => engine.resolvePlayerKey(state, k) === psychicId)!;
  const guesserKeys = keys.filter((k) => k !== psychicKey);

  await engine.processAction(roomCode, psychicKey, { type: 'SUBMIT_CLUE', clue: 'Warm coffee' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'DIALING');

  // Guesser 1 hits bullseye, Guesser 2 misses by 40
  await engine.processAction(roomCode, guesserKeys[0], { type: 'SUBMIT_DIAL', value: target });
  await engine.processAction(roomCode, guesserKeys[1], { type: 'SUBMIT_DIAL', value: (target + 40) % 100 });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'ROUND_RESULTS');
  const g1Id = engine.resolvePlayerKey(state, guesserKeys[0])!;
  assert.equal(state.players[g1Id].score, 800);
  assert.ok(state.players[psychicId].score > 0);
});

test('Bluff Clash: blocks real truth, scores bluffs and truth votes', async () => {
  const { roomCode, hostId } = await engine.createRoom('bluff-clash');
  const p1 = (await engine.joinRoom(roomCode, 'Alice')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Bob')) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Cara')) as { playerId: string };

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'BLUFFING');

  const realTruth = state.gameData.facts[0].truth as string;
  // Typing the real truth warns the player instead of accepting it
  await engine.processAction(roomCode, p1.playerId, { type: 'SUBMIT_BLUFF', bluff: realTruth });
  state = (await engine.getGameState(roomCode))!;
  const id1 = engine.resolvePlayerKey(state, p1.playerId)!;
  assert.ok(state.playerData[id1].truthWarning);
  assert.equal(state.playerData[id1].submitted, null);

  await engine.processAction(roomCode, p1.playerId, { type: 'SUBMIT_BLUFF', bluff: 'Fake answer A' });
  await engine.processAction(roomCode, p2.playerId, { type: 'SUBMIT_BLUFF', bluff: 'Fake answer B' });
  await engine.processAction(roomCode, p3.playerId, { type: 'SUBMIT_BLUFF', bluff: 'Fake answer C' });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'VOTING');

  const choices = state.gameData.choices as { id: string; text: string; isTruth: boolean; authorIds: string[] }[];
  const truthChoice = choices.find((c) => c.isTruth)!;
  const p1Bluff = choices.find((c) => c.authorIds.includes(id1))!;

  // p1 votes for truth (+750), p2 & p3 fall for p1's bluff (+400 each to p1)
  await engine.processAction(roomCode, p1.playerId, { type: 'SUBMIT_VOTE', choiceId: truthChoice.id });
  await engine.processAction(roomCode, p2.playerId, { type: 'SUBMIT_VOTE', choiceId: p1Bluff.id });
  await engine.processAction(roomCode, p3.playerId, { type: 'SUBMIT_VOTE', choiceId: p1Bluff.id });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'ROUND_RESULTS');
  assert.equal(state.players[id1].score, 1550);
});

test('Emoji Telephone: translate, decode, showcase, and vote', async () => {
  const { roomCode, hostId } = await engine.createRoom('emoji-telephone');
  const p1 = (await engine.joinRoom(roomCode, 'Alice')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Bob')) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Cara')) as { playerId: string };

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'TRANSLATE');

  // ASCII letters get stripped from emoji submissions
  await engine.processAction(roomCode, p1.playerId, { type: 'SUBMIT_EMOJIS', emojis: '🐍✈️abc' });
  await engine.processAction(roomCode, p2.playerId, { type: 'SUBMIT_EMOJIS', emojis: '🦖🏞️' });
  await engine.processAction(roomCode, p3.playerId, { type: 'SUBMIT_EMOJIS', emojis: '👻🔫' });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'GUESS');

  await engine.processAction(roomCode, p1.playerId, { type: 'SUBMIT_GUESS', guess: 'Ghostbusters' });
  await engine.processAction(roomCode, p2.playerId, { type: 'SUBMIT_GUESS', guess: 'Snakes on a plane' });
  await engine.processAction(roomCode, p3.playerId, { type: 'SUBMIT_GUESS', guess: 'Jurassic Park' });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'SHOWCASE');

  // Advance through chains to VOTING
  await engine.processAction(roomCode, hostId, { type: 'NEXT_CHAIN' });
  await engine.processAction(roomCode, hostId, { type: 'NEXT_CHAIN' });
  await engine.processAction(roomCode, hostId, { type: 'NEXT_CHAIN' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'VOTING');

  // With 3 players each phone may only vote for the one chain it had no hand in.
  const keys = [p1.playerId, p2.playerId, p3.playerId];
  for (const key of keys) {
    const pid = engine.resolvePlayerKey(state, key)!;
    const own = state.gameData.chains.find((c: any) => c.translatorId === pid);
    assert.ok(state.playerData[pid].chains.every((c: any) => c.id !== own.id), 'own chain hidden from the ballot');
    await engine.processAction(roomCode, key, { type: 'SUBMIT_VOTE', chainId: own.id });
  }
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'VOTING', 'self-votes are ignored');
  assert.deepEqual(state.gameData.favoriteVotes, {});

  for (const key of keys) {
    const pid = engine.resolvePlayerKey(state, key)!;
    const [allowed] = state.playerData[pid].chains;
    await engine.processAction(roomCode, key, { type: 'SUBMIT_VOTE', chainId: allowed.id });
  }
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'FINAL_RESULTS');
  // Each player: 400 + 400 for submitting, 800 for the chain they translated and 600 for the one they decoded.
  assert.ok(Object.values(state.players).every((p) => p.score === 2200));
});

test('Emoji Telephone: clues keep only emoji and never split one in half', () => {
  assert.equal(sanitizeEmojiClue('🐍 snake ✈️ 42'), '🐍 ✈️');
  const family = '👨‍👩‍👧‍👦';
  const capped = sanitizeEmojiClue(family.repeat(20));
  assert.equal(capped, family.repeat(16));
});

test('Bluff Clash: near-copies of the truth are rejected and merged with it', async () => {
  const { roomCode, hostId } = await engine.createRoom('bluff-clash');
  const keys = [];
  for (const name of ['Alice', 'Bob', 'Cara']) keys.push(((await engine.joinRoom(roomCode, name)) as { playerId: string }).playerId);
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  const truth: string = state.gameData.facts[0].truth;
  const id0 = engine.resolvePlayerKey(state, keys[0])!;

  await engine.processAction(roomCode, keys[0], { type: 'SUBMIT_BLUFF', bluff: `The ${truth.toUpperCase()}!` });
  state = (await engine.getGameState(roomCode))!;
  assert.ok(state.playerData[id0].truthWarning, 'a reworded truth is caught');
  assert.equal(state.gameData.bluffs[id0], undefined);

  await engine.processAction(roomCode, keys[0], { type: 'SUBMIT_BLUFF', bluff: 'a sentient toaster' });
  await engine.processAction(roomCode, keys[1], { type: 'SUBMIT_BLUFF', bluff: 'A sentient toaster.' });
  await engine.processAction(roomCode, keys[2], { type: 'SUBMIT_BLUFF', bluff: 'moon dust' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'VOTING');
  const toaster = state.gameData.choices.find((c: any) => c.text.includes('toaster'));
  assert.equal(toaster.authorIds.length, 2, 'identical lies are merged');
  assert.ok(state.gameData.choices.length >= 4, 'house decoys top up the ballot');
  assert.ok(!JSON.stringify(state.hostData).includes('authorIds'), 'TV and phones never see who wrote which lie');
  const shownIds = state.playerData[id0].choices.map((c: any) => c.id).join(',');
  assert.ok(!/TRUTH|BLUFF|DECOY/.test(shownIds), `choice ids don't give the answer away (${shownIds})`);
});

test('Spyfall: only the spy is kept in the dark and public data never names the location', async () => {
  const { roomCode, hostId } = await engine.createRoom('spyfall');
  for (const name of ['Alice', 'Bob', 'Cara', 'Dev']) await engine.joinRoom(roomCode, name);
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  const state = (await engine.getGameState(roomCode))!;
  const { spyId, location } = state.gameData;
  assert.equal(state.playerData[spyId].location, null);
  assert.equal(state.playerData[spyId].isSpy, true);
  for (const pid of state.playerOrder.filter((id) => id !== spyId)) {
    assert.equal(state.playerData[pid].location, location);
    assert.equal(state.playerData[pid].isSpy, false);
  }
  // hostData goes to every phone, so it must not reveal the spy or the answer before the vote.
  const pub = JSON.stringify(state.hostData);
  assert.ok(!pub.includes(spyId), 'spy id not public');
  assert.ok(!pub.includes(`"location":`), 'location not public');
});

test('Session Leaderboard: scores persist across games and only host can RESET_SCORES', async () => {
  const { roomCode, hostId } = await engine.createRoom('herd-mentality');
  const p1 = (await engine.joinRoom(roomCode, 'Alice')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Bob')) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Cara')) as { playerId: string };

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  const id1 = engine.resolvePlayerKey(state, p1.playerId)!;

  await engine.processAction(roomCode, p1.playerId, { type: 'SUBMIT_ANSWER', answer: 'Tacos' });
  await engine.processAction(roomCode, p2.playerId, { type: 'SUBMIT_ANSWER', answer: 'Tacos' });
  await engine.processAction(roomCode, p3.playerId, { type: 'SUBMIT_ANSWER', answer: 'Salad' });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.players[id1].score, 600);

  // Switch to another game and start it — scores should persist!
  await engine.processAction(roomCode, hostId, { type: 'SWITCH_GAME', gameType: 'bluff-clash' });
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.players[id1].score, 600, 'score persists across games');
  assert.equal(state.gameData.baseScores[id1], 600, 'baseScores snapshots session score at start of match');

  // Non-host player cannot reset scores
  const badReset = await engine.processAction(roomCode, p1.playerId, { type: 'RESET_SCORES' });
  assert.ok('error' in badReset);
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.players[id1].score, 600);

  // Host can reset scores
  const goodReset = await engine.processAction(roomCode, hostId, { type: 'RESET_SCORES' });
  assert.ok('success' in goodReset);
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.players[id1].score, 0);
});


test('presence: a phone that drops briefly is still waited on, one gone past the grace period is not', async () => {
  const { DISCONNECT_GRACE_MS, isPresent } = await import('./presence');
  const now = Date.now();
  const base = { id: 'p', name: 'P', score: 0, avatarColor: '#fff' };
  assert.equal(isPresent({ ...base, connected: true }, now), true);
  assert.equal(isPresent({ ...base, connected: false, disconnectedAt: now - 5_000 }, now), true, 'locked screen for 5s');
  assert.equal(isPresent({ ...base, connected: false, disconnectedAt: now - DISCONNECT_GRACE_MS - 1 }, now), false);
  assert.equal(isPresent({ ...base, connected: false }, now), false, 'rooms saved before the grace period existed');
  assert.equal(isPresent({ ...base, connected: true, left: true }, now), false, 'players who left never hold up a round');

  const { roomCode, hostId } = await engine.createRoom('herd-mentality');
  const keys: string[] = [];
  for (const name of ['Alice', 'Bob', 'Cara']) keys.push(((await engine.joinRoom(roomCode, name)) as { playerId: string }).playerId);
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  const caraId = engine.resolvePlayerKey(state, keys[2])!;

  // Cara's screen locks: her stream closes, but the round still waits for her.
  await engine.setPlayerConnected(roomCode, caraId, false);
  state = (await engine.getGameState(roomCode))!;
  assert.equal(typeof state.players[caraId].disconnectedAt, 'number');
  await engine.processAction(roomCode, keys[0], { type: 'SUBMIT_ANSWER', answer: 'Ranch' });
  await engine.processAction(roomCode, keys[1], { type: 'SUBMIT_ANSWER', answer: 'Ranch' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'PROMPTING', 'no early advance while Cara is inside the grace period');

  // She comes back and answers; the round ends normally.
  await engine.setPlayerConnected(roomCode, caraId, true);
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.players[caraId].disconnectedAt, undefined, 'reconnecting clears the timestamp');
  await engine.processAction(roomCode, keys[2], { type: 'SUBMIT_ANSWER', answer: 'Ketchup' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'ROUND_RESULTS');

  // Next round: Cara has been gone longer than the grace period, so she no longer blocks it.
  await engine.processAction(roomCode, hostId, { type: 'NEXT_HERD_ROUND' });
  await engine.setPlayerConnected(roomCode, caraId, false);
  state = (await engine.getGameState(roomCode))!;
  state.players[caraId].disconnectedAt = Date.now() - DISCONNECT_GRACE_MS - 1_000;
  await engine.saveGameState(state);
  await engine.processAction(roomCode, keys[0], { type: 'SUBMIT_ANSWER', answer: 'Ranch' });
  await engine.processAction(roomCode, keys[1], { type: 'SUBMIT_ANSWER', answer: 'Ranch' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'ROUND_RESULTS', 'a long-gone phone stops holding up the round');
});

test('prompt store: new games\' content is validated, back-filled into older files and used by the games', async () => {
  const { getPrompts, getGameContent } = await import('./prompts');
  const cleaned = normalizePrompts({
    spyfallLocations: [
      { emoji: '🚒', name: ' Fire Station ', roles: ['Chief', ' chief', '', 'Rookie'] },
      { name: 'No Roles', roles: [] },
      { name: 'fire station', roles: ['Dup'] },
    ],
    wavelengthSpectrums: [{ left: 'Cold', right: 'Hot' }, { left: 'Half', right: '' }],
    bluffFacts: [
      { prompt: 'A group of crows is a _____.', truth: 'murder', decoys: ['party', 'Murder', 'flock', '', 'a', 'b', 'c', 'd'] },
      { prompt: 'No truth _____.', truth: '' },
    ],
    herdMentality: [' Best pizza? ', 'best pizza?'],
  } as never);
  assert.deepEqual(cleaned.spyfallLocations, [{ emoji: '🚒', name: 'Fire Station', roles: ['Chief', 'Rookie'] }]);
  assert.deepEqual(cleaned.wavelengthSpectrums, [{ left: 'Cold', right: 'Hot' }]);
  assert.deepEqual(cleaned.bluffFacts, [{ prompt: 'A group of crows is a _____.', truth: 'murder', decoys: ['party', 'flock', 'a', 'b', 'c'] }]);
  assert.deepEqual(cleaned.herdMentality, ['Best pizza?']);

  // A prompt file from before these games existed: lists come back from the
  // defaults and old packs gain empty lists instead of crashing the pool.
  await fs.writeFile(path.join('.data', 'party-prompts.json'), JSON.stringify({
    quipClash: ['q'], theFaker: ['f'], bracketBattles: ['b'], triviaQuestions: [],
    packs: [{ id: 'old', name: 'Old', emoji: '📦', quipClash: ['x'], theFaker: [], bracketBattles: [], triviaQuestions: [] }],
  }));
  const data = await getPrompts();
  assert.ok(data.spyfallLocations.length >= 16 && data.bluffFacts.length > 0 && data.emojiTelephone.length > 0);
  assert.deepEqual(data.packs![0].spyfallLocations, []);
  assert.ok((await getGameContent('spyfallLocations', 3, ['old'])).length === 3, 'an empty pack falls back to Classic');

  // Edited content is what the games play with.
  await savePrompts(normalizePrompts({
    spyfallLocations: [{ emoji: '🚒', name: 'Fire Station', roles: ['Chief', 'Rookie'] }],
    bluffFacts: [{ prompt: 'A group of crows is a _____.', truth: 'murder', decoys: ['party'] }],
    herdMentality: ['Only herd prompt'],
    wavelengthSpectrums: [{ left: 'Cold', right: 'Hot' }],
    emojiTelephone: ['Only phrase'],
  }));
  for (const [game, check] of [
    ['spyfall', (s: GameState) => assert.equal(s.gameData.location, 'Fire Station')],
    ['bluff-clash', (s: GameState) => assert.equal(s.hostData.prompt, 'A group of crows is a _____.')],
    ['herd-mentality', (s: GameState) => assert.equal(s.hostData.prompt, 'Only herd prompt')],
    ['wavelength', (s: GameState) => assert.deepEqual(s.hostData.spectrum, ['Cold', 'Hot'])],
    ['emoji-telephone', (s: GameState) => assert.ok(s.gameData.chains.every((c: any) => c.originPrompt === 'Only phrase'))],
  ] as const) {
    const { roomCode, hostId } = await engine.createRoom(game);
    for (const name of ['Alice', 'Bob', 'Cara']) await engine.joinRoom(roomCode, name);
    assert.equal((await engine.processAction(roomCode, hostId, { type: 'START_GAME' })).success, true, game);
    check((await engine.getGameState(roomCode))!);
  }
});

test('Debate Duel: topics come from the room, never debated by the person who wrote them if avoidable', async () => {
  const { assignTopics, cleanTopic, pairPlayers, isSwitchable, switchWord, toWords, cleanSwitchWord } = await import('./games/debate-duel');
  assert.equal(cleanTopic('  all   menus need photos  '), 'All menus need photos');
  assert.equal(cleanTopic(42), '');

  const topics = [{ author: 'a', text: 'A wrote this' }, { author: 'b', text: 'B wrote this' }, { author: 'c', text: 'C wrote this' }];
  const [only] = assignTopics([['a', 'b']], topics);
  assert.equal(only.author, 'c', 'the debaters argue someone else’s take');
  const reused = assignTopics([['a', 'b'], ['c', 'd'], ['e', 'f']], [{ author: 'a', text: 'Only one' }]);
  assert.deepEqual(reused.map((t) => t.text), ['Only one', 'Only one', 'Only one'], 'one topic is shared when that’s all there is');

  for (const n of [2, 3, 5, 8]) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const pairs = pairPlayers(ids);
    assert.equal(pairs.length, Math.ceil(n / 2));
    assert.ok(ids.every((id) => pairs.some((p) => p.includes(id))), `everyone debates (${n})`);
  }

  const words = toWords('We need more spiders!');
  assert.deepEqual(words.map(isSwitchable), [false, true, true, true], 'meaningful little words like “more” can be switched');
  assert.equal(isSwitchable('the'), false);
  assert.deepEqual(switchWord(words, 2, 'hotter'), ['We', 'need', 'hotter', 'spiders!']);
  assert.deepEqual(switchWord(words, 3, 'pancakes'), ['We', 'need', 'more', 'pancakes!'], 'punctuation stays put');
  assert.equal(cleanSwitchWord('  <b>gravy</b>!! '), 'bgravyb');
});

test('Debate Duel: hot takes, two rounds of speeches around a switch, sides as the verdict', async () => {
  const { debateDuelLogic, VOTE_POINTS, SWITCH_POINTS, MIC_DROP_BONUS } = await import('./games/debate-duel');
  const state = makeState('debate-duel', 4);
  await debateDuelLogic.onStart(state);
  assert.equal(state.phase, 'TOPIC');

  // The timer running out with no topics gives everyone more time instead of using anything premade.
  await debateDuelLogic.processAction(state, 'host', { type: 'FORCE_MATCHUPS' });
  assert.equal(state.phase, 'TOPIC');
  assert.equal(state.hostData.again, true);

  await debateDuelLogic.processAction(state, 'p0', { type: 'SUBMIT_TOPIC', text: '   ' });
  assert.equal(state.gameData.topics.p0, undefined);
  for (const pid of state.playerOrder) await debateDuelLogic.processAction(state, pid, { type: 'SUBMIT_TOPIC', text: `${pid} thinks we need more spiders` });
  assert.equal(state.phase, 'UP_NEXT', 'everyone wrote one, so the debates start');
  assert.equal(state.gameData.matchups.length, 2);
  for (const m of state.gameData.matchups) assert.ok(!m.debaters.includes(m.author), 'nobody argues their own take');

  const [pro, con] = state.hostData.debaters;
  const fans = state.playerOrder.filter((pid) => pid !== pro && pid !== con);
  assert.equal(state.hostData.speakerId, pro, 'Pro opens');

  // Speech 1 (Pro): fans pick sides and heckle; debaters can't do either.
  await debateDuelLogic.processAction(state, 'host', { type: 'START_PITCH' });
  await debateDuelLogic.processAction(state, fans[0], { type: 'SUBMIT_SIDE', side: 1 });
  await debateDuelLogic.processAction(state, fans[1], { type: 'SUBMIT_SIDE', side: 1 });
  await debateDuelLogic.processAction(state, con, { type: 'SUBMIT_SIDE', side: 1 });
  assert.deepEqual(state.hostData.crowd, { [fans[0]]: 1, [fans[1]]: 1 });
  await debateDuelLogic.processAction(state, fans[0], { type: 'SUBMIT_HECKLE', text: 'Spiders are scary!' });
  await debateDuelLogic.processAction(state, fans[0], { type: 'SUBMIT_HECKLE', text: 'Too soon' });
  await debateDuelLogic.processAction(state, con, { type: 'SUBMIT_HECKLE', text: 'Boo' });
  assert.deepEqual(state.hostData.heckles.map((h: any) => h.text), ['Spiders are scary!'], 'rate limited, and debaters can’t heckle');
  await debateDuelLogic.processAction(state, pro, { type: 'SUBMIT_PITCH_LINE', text: 'Spiders eat mosquitoes' });
  assert.deepEqual(state.hostData.typed, ['Spiders eat mosquitoes']);
  await debateDuelLogic.processAction(state, pro, { type: 'SUBMIT_PITCH_DONE' });
  assert.equal(state.hostData.speakerId, con);

  // Speech 2 (Con), then the switch.
  await debateDuelLogic.processAction(state, 'host', { type: 'START_PITCH' });
  await debateDuelLogic.processAction(state, fans[1], { type: 'SUBMIT_SIDE', side: 0 });
  await debateDuelLogic.processAction(state, 'host', { type: 'END_PITCH' });
  assert.equal(state.phase, 'SWITCH');

  const words: string[] = state.hostData.words;
  const spiders = words.findIndex((w) => w.startsWith('spiders'));
  await debateDuelLogic.processAction(state, fans[0], { type: 'SUBMIT_SWITCH', index: 0, word: 'nope' });
  assert.equal(state.gameData.proposals[fans[0]], undefined, 'only real words can be switched');
  await debateDuelLogic.processAction(state, fans[0], { type: 'SUBMIT_SWITCH', index: spiders, word: 'pancakes' });
  for (const pid of [fans[1], pro, con]) await debateDuelLogic.processAction(state, pid, { type: 'SUBMIT_SWITCH', pass: true });
  assert.equal(state.phase, 'SWITCH_REVEAL', 'everyone answered, so the reveal comes early');
  assert.equal(state.hostData.switch.to, 'pancakes');
  assert.equal(state.hostData.switch.byName, state.players[fans[0]].name);
  assert.ok(state.hostData.words.join(' ').endsWith('more pancakes'));
  assert.equal(state.players[fans[0]].score, SWITCH_POINTS);

  // Speeches 3 and 4 are on the switched topic.
  await debateDuelLogic.processAction(state, 'host', { type: 'NEXT_SPEECH' });
  assert.equal(state.hostData.speakerId, pro);
  assert.equal(state.hostData.debateRound, 2);
  for (const t of ['START_PITCH', 'END_PITCH', 'START_PITCH', 'END_PITCH']) await debateDuelLogic.processAction(state, 'host', { type: t });
  assert.equal(state.phase, 'VERDICT');
  assert.equal(state.hostData.mode, 'vote');

  // Final call: fans[1] stays put without locking in, fans[0] crosses the floor and locks in.
  await debateDuelLogic.processAction(state, fans[0], { type: 'SUBMIT_VOTE', side: 0 });
  await debateDuelLogic.processAction(state, fans[0], { type: 'SUBMIT_SIDE', side: 1 });
  assert.equal(state.hostData.crowd[fans[0]], 0, 'a locked-in side can’t change');
  await debateDuelLogic.processAction(state, 'host', { type: 'FORCE_TALLY' });
  assert.equal(state.phase, 'VERDICT_RESULTS');
  assert.deepEqual(state.hostData.tally, [2, 0]);
  assert.equal(state.hostData.micDrop, 0);
  assert.equal(state.players[pro].score, 2 * VOTE_POINTS + MIC_DROP_BONUS);

  // The second debate starts with an empty floor; skipping through it ends the game.
  await debateDuelLogic.processAction(state, 'host', { type: 'NEXT_MATCHUP' });
  assert.deepEqual(state.hostData.crowd, {});
  for (const t of ['START_PITCH', 'END_PITCH', 'START_PITCH', 'END_PITCH', 'FORCE_SWITCH', 'NEXT_SPEECH', 'START_PITCH', 'END_PITCH', 'START_PITCH', 'END_PITCH', 'FORCE_TALLY', 'NEXT_MATCHUP']) {
    await debateDuelLogic.processAction(state, 'host', { type: t });
  }
  assert.equal(state.phase, 'FINAL_RESULTS');
});

test('Debate Duel: two players rate each other, and nobody switching keeps the topic', async () => {
  const { debateDuelLogic, STAR_POINTS } = await import('./games/debate-duel');
  const state = makeState('debate-duel', 2);
  state.gameData = { targetRounds: 2 };
  await debateDuelLogic.onStart(state);
  await debateDuelLogic.processAction(state, 'p0', { type: 'SUBMIT_TOPIC', text: 'Naps should be mandatory' });
  await debateDuelLogic.processAction(state, 'host', { type: 'FORCE_MATCHUPS' });
  assert.equal(state.hostData.words.join(' '), 'Naps should be mandatory', 'one take is enough to start');

  for (const t of ['START_PITCH', 'END_PITCH', 'START_PITCH', 'END_PITCH', 'FORCE_SWITCH']) await debateDuelLogic.processAction(state, 'host', { type: t });
  assert.equal(state.phase, 'SWITCH_REVEAL');
  assert.equal(state.hostData.switch, null);
  assert.equal(state.hostData.words.join(' '), 'Naps should be mandatory');

  for (const t of ['NEXT_SPEECH', 'START_PITCH', 'END_PITCH', 'START_PITCH', 'END_PITCH']) await debateDuelLogic.processAction(state, 'host', { type: t });
  assert.equal(state.phase, 'VERDICT');
  assert.equal(state.hostData.mode, 'rate');
  const [pro, con] = state.hostData.debaters;
  await debateDuelLogic.processAction(state, pro, { type: 'SUBMIT_SIDE', side: 0 });
  assert.deepEqual(state.hostData.crowd, {}, 'debaters don’t stand on the floor');
  await debateDuelLogic.processAction(state, pro, { type: 'SUBMIT_RATING', stars: 2 });
  await debateDuelLogic.processAction(state, con, { type: 'SUBMIT_RATING', stars: 9 });
  assert.equal(state.phase, 'VERDICT', 'out-of-range ratings are ignored');
  await debateDuelLogic.processAction(state, con, { type: 'SUBMIT_RATING', stars: 5 });
  assert.deepEqual(state.hostData.tally, [5, 2], 'each rating scores the other debater');
  assert.equal(state.players[pro].score, 5 * STAR_POINTS);

  await debateDuelLogic.processAction(state, 'host', { type: 'NEXT_MATCHUP' });
  assert.equal(state.phase, 'TOPIC', 'round two starts with fresh hot takes');
  assert.equal(state.hostData.round, 2);
});

test('Debate Duel: the audience can heckle a speech through the engine', async () => {
  const { roomCode, hostId } = await engine.createRoom('debate-duel');
  const keys: string[] = [];
  for (const name of ['Alice', 'Bob']) keys.push(((await engine.joinRoom(roomCode, name)) as { playerId: string }).playerId);
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  const fan = (await engine.joinRoom(roomCode, 'Fan', { asAudience: true })) as { playerId: string };

  await engine.processAction(roomCode, fan.playerId, { type: 'SUBMIT_HECKLE', text: 'Too early' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.hostData.heckles, undefined, 'nothing to heckle before a speech');
  assert.equal(engine.audienceView(state, state.audienceKeys![fan.playerId]).heckle, null);

  await engine.processAction(roomCode, keys[0], { type: 'SUBMIT_TOPIC', text: 'Naps should be mandatory' });
  await engine.processAction(roomCode, hostId, { type: 'FORCE_MATCHUPS' });
  await engine.processAction(roomCode, hostId, { type: 'START_PITCH' });
  await engine.processAction(roomCode, fan.playerId, { type: 'SUBMIT_HECKLE', text: 'Boo!' });
  state = (await engine.getGameState(roomCode))!;
  assert.deepEqual(state.hostData.heckles.map((h: any) => [h.name, h.text]), [['Fan', 'Boo!']]);
  assert.ok(engine.audienceView(state, state.audienceKeys![fan.playerId]).heckle);
});

test('Kart Clash: Grand Prix Cup track voting, gyro physics simulation, and multi-race scoring', async () => {
  const { getKartSimulation, updateKartInput, stepKartSimulation, stopKartSimulation } = await import('./kart-physics');
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  const p1 = (await engine.joinRoom(roomCode, 'Mario')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Luigi')) as { playerId: string };

  // Configure 2-race Grand Prix
  await engine.processAction(roomCode, hostId, {
    type: 'SET_KART_CONFIG',
    format: 'grand-prix',
    totalRaces: 2,
    aiBots: true,
  });

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'TRACK_VOTE');

  const id1 = engine.resolvePlayerKey(state, p1.playerId)!;
  const id2 = engine.resolvePlayerKey(state, p2.playerId)!;

  // Both players vote for neon-starway; once all active racers vote, race launches immediately
  await engine.processAction(roomCode, p1.playerId, { type: 'VOTE_TRACK', trackId: 'neon-starway' });
  await engine.processAction(roomCode, p2.playerId, { type: 'VOTE_TRACK', trackId: 'neon-starway' });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RACING');
  assert.equal(state.hostData.trackId, 'neon-starway');

  const sim = getKartSimulation(roomCode);
  assert.ok(sim, 'in-memory 30Hz physics simulation is active');
  assert.equal(Object.keys(sim!.karts).length, 8, '2 humans + 6 AI bots fill the 8-kart grid');
  assert.equal(sim!.waitingForOrientation, true, 'race holds on grid waiting for all racers to rotate to landscape');

  // Both players rotate their phones horizontally to unlock countdown
  const { POST: postKartInput } = await import('../../app/api/party/kart-input/route');
  await postKartInput(
    new Request('http://localhost/api/party/kart-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerKey: p1.playerId, isHorizontal: true }),
    }),
  );
  await postKartInput(
    new Request('http://localhost/api/party/kart-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerKey: p2.playerId, isHorizontal: true }),
    }),
  );

  // Step through "3... 2..." of countdown now that both racers are horizontal
  for (let i = 0; i < 65; i++) {
    stepKartSimulation(sim!, 1 / 30);
  }
  assert.equal(sim!.waitingForOrientation, false, 'countdown unlocked once all human racers are horizontal');

  // On "1" of countdown, hold drift for Rocket Start!
  const startAngle = sim!.karts[id1].angle;
  const startProgress = sim!.karts[id1].totalProgress;
  const res = await postKartInput(
    new Request('http://localhost/api/party/kart-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerKey: p1.playerId, steer: 0.75, drift: true, useItem: false, brake: false, isHorizontal: true }),
    }),
  );
  assert.equal(res.status, 200);
  const resJson = await res.json();
  assert.equal(resJson.ok, true, '/api/party/kart-input accepts phone gyro payload');
  assert.equal(sim!.inputs[id1].steer, 0.75, 'phone gyro steer value stored on active simulation');

  // Step through remaining countdown to GO!
  for (let i = 0; i < 65; i++) {
    stepKartSimulation(sim!, 1 / 30);
  }
  assert.equal(sim!.countdownMs, 0, 'countdown finishes after 3.4s');
  assert.ok(sim!.karts[id1].boostTimer > 0, 'Rocket Start turbo boost activated');
  assert.ok(sim!.karts[id1].speed > 20, 'rocket start launches the kart off the line');
  assert.ok(sim!.karts[id1].totalProgress > startProgress, 'kart advances along the spline');
  assert.notEqual(sim!.karts[id1].angle, startAngle, 'steering input turns the kart heading angle');

  // Finish Race 1
  await engine.processAction(roomCode, hostId, { type: 'FINISH_KART_RACE' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RACE_RESULTS');
  assert.ok(state.players[id1].score > 0 && state.players[id2].score > 0, 'cup points awarded');

  // Advance to Race 2
  await engine.processAction(roomCode, hostId, { type: 'NEXT_KART_STEP' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'TRACK_VOTE');

  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RACING');

  await engine.processAction(roomCode, hostId, { type: 'FINISH_KART_RACE' });
  await engine.processAction(roomCode, hostId, { type: 'NEXT_KART_STEP' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'FINAL_RESULTS');
  stopKartSimulation(roomCode);
});

test('Kart Clash: Tournament Heats mode with 8 players, 2 heats of 4, manual heat swap, Pit Crew bonus, and Championship Final seeding', async () => {
  const { stopKartSimulation } = await import('./kart-physics');
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  const keys: string[] = [];
  for (const name of ['Racer1', 'Racer2', 'Racer3', 'Racer4', 'Racer5', 'Racer6', 'Racer7', 'Racer8']) {
    const joined = (await engine.joinRoom(roomCode, name)) as { playerId: string };
    keys.push(joined.playerId);
  }

  // Host configures Tournament Heats with 4 racers per heat
  await engine.processAction(roomCode, hostId, {
    type: 'SET_KART_CONFIG',
    format: 'tournament',
    heatSize: 4,
    aiBots: false,
  });

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'HEAT_SETUP');
  assert.equal(state.hostData.heats.length, 2, '8 players with heatSize 4 creates 2 Qualifying Heats');
  assert.equal(state.hostData.heats[0].playerIds.length, 4);
  assert.equal(state.hostData.heats[1].playerIds.length, 4);

  // Test RANDOMIZE_HEATS and manual ASSIGN_HEAT_PLAYER swap
  await engine.processAction(roomCode, hostId, { type: 'RANDOMIZE_HEATS' });
  state = (await engine.getGameState(roomCode))!;
  const h1Player = state.hostData.heats[0].playerIds[0];
  await engine.processAction(roomCode, hostId, {
    type: 'ASSIGN_HEAT_PLAYER',
    targetPlayerId: h1Player,
    targetHeatId: state.hostData.heats[1].id,
  });
  state = (await engine.getGameState(roomCode))!;
  assert.ok(state.hostData.heats[1].playerIds.includes(h1Player), 'manual heat swap moves player to Heat 2 while keeping Heat 2 capped at heatSize');
  assert.equal(state.hostData.heats[0].playerIds.length, 4);
  assert.equal(state.hostData.heats[1].playerIds.length, 4);

  // Launch Qualifying Heat 1
  const heat1Id = state.hostData.heats[0].id;
  const heat1Players: string[] = state.hostData.heats[0].playerIds;
  const heat2Players: string[] = state.hostData.heats[1].playerIds;
  await engine.processAction(roomCode, hostId, { type: 'START_NEXT_HEAT', heatId: heat1Id });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'TRACK_VOTE');
  assert.deepEqual(state.hostData.activeRacers, heat1Players);

  // A Pit Crew player (from Heat 2) predicts who wins Heat 1
  const pitCrewId = heat2Players[0];
  const pitCrewKey = keys.find((k) => engine.resolvePlayerKey(state, k) === pitCrewId)!;
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RACING');

  const { getKartSimulation } = await import('./kart-physics');
  const sim1 = getKartSimulation(roomCode)!;
  const rank1RacerId = Object.values(sim1.karts).sort((a, b) => a.rank - b.rank)[0].id;

  await engine.processAction(roomCode, pitCrewKey, { type: 'SUBMIT_HEAT_PREDICTION', racerId: rank1RacerId });
  await engine.processAction(roomCode, pitCrewKey, { type: 'SUBMIT_CHAOS_VOTE', choice: 'boost-pack' });

  await engine.processAction(roomCode, hostId, { type: 'FINISH_KART_RACE' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RACE_RESULTS');
  assert.equal(state.players[pitCrewId].score, 300, 'Pit Crew player earns +300 bonus points for predicting Heat 1 winner');

  // Return to HEAT_SETUP and run Qualifying Heat 2
  await engine.processAction(roomCode, hostId, { type: 'NEXT_KART_STEP' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'HEAT_SETUP');

  const heat2Id = state.hostData.heats[1].id;
  await engine.processAction(roomCode, hostId, { type: 'START_NEXT_HEAT', heatId: heat2Id });
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });
  await engine.processAction(roomCode, hostId, { type: 'FINISH_KART_RACE' });

  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RACE_RESULTS');
  const finalHeat = state.hostData.heats.find((h: any) => h.stage === 'final');
  assert.ok(finalHeat, 'Championship Final heat is automatically seeded once all Qualifying Heats complete');
  assert.equal(finalHeat.playerIds.length, 4, 'top 2 finishers from each 4-player heat advance to the 4-player Championship Final');
  stopKartSimulation(roomCode);
});

test('Kart Clash: AI bots hold the road, and a hands-off human is kept going by the road assist', async () => {
  const { buildKartRacers, createKartSimulation, stepKartSimulation, stopKartSimulation } = await import('./kart-physics');
  const racers = buildKartRacers([{ id: 'p1', name: 'Driver', avatar: '🏎️', avatarColor: '#ef4444' }], true, 4);
  const sim = createKartSimulation({
    roomCode: 'TEST_AI',
    raceId: 'race-1',
    trackId: 'canyon-driftway',
    racers,
  });
  // Skip countdown and step 360 ticks (12 seconds of racing around curves)
  sim.countdownMs = 0;
  let offRoadBotFrames = 0;
  let totalBotFrames = 0;
  for (let i = 0; i < 360; i++) {
    stepKartSimulation(sim, 1 / 30);
    for (const k of Object.values(sim.karts)) {
      if (k.isBot) {
        totalBotFrames++;
        if (k.offRoad) offRoadBotFrames++;
      }
      assert.ok(Math.abs(k.lateralOffset) <= sim.track.wallWidth, 'no kart ever escapes the barriers');
    }
  }
  const human = sim.karts['p1'];
  const bots = Object.values(sim.karts).filter((k) => k.isBot);
  assert.ok(offRoadBotFrames / totalBotFrames < 0.05, 'AI bots stay on the road through curves');
  assert.ok(human.totalProgress > 0.15, 'A hands-off human keeps moving along the spline');
  assert.ok(bots.every((b) => b.totalProgress > 0.15), 'All AI bots advance along the spline');

  // Verify holding DRIFT immediately initiates drifting, charges Level 1 & Level 2 sparks, and triggers Super Mini-Turbo on release
  const { updateKartInput } = await import('./kart-physics');
  sim.hazards = [];
  for (const k of Object.values(sim.karts)) {
    if (k.isBot) {
      k.heldItem = null;
      k.pendingItem = null;
    }
  }
  human.spinOutTimer = 0;
  human.speed = Math.max(30, human.speed);
  updateKartInput('TEST_AI', 'p1', { drift: true, steer: 0 });
  stepKartSimulation(sim, 1 / 30);
  assert.equal(human.drifting, true, 'Holding drift starts drifting immediately even before tilting the wheel');
  for (let i = 0; i < 16; i++) {
    updateKartInput('TEST_AI', 'p1', { drift: true, steer: 0.5 });
    stepKartSimulation(sim, 1 / 30);
  }
  assert.equal(human.driftLevel, 1, 'Holding drift into a turn for ~0.5s charges Level 1 Blue Mini-Turbo sparks');
  for (let i = 0; i < 18; i++) {
    updateKartInput('TEST_AI', 'p1', { drift: true, steer: 0.5 });
    stepKartSimulation(sim, 1 / 30);
  }
  assert.equal(human.driftLevel, 2, 'Holding drift into a turn for ~1.1s charges Level 2 Orange Super Mini-Turbo sparks');
  updateKartInput('TEST_AI', 'p1', { drift: false, steer: 0 });
  stepKartSimulation(sim, 1 / 30);
  assert.equal(human.drifting, false, 'Releasing drift exits drift state');
  assert.ok(human.boostTimer >= 1.4, 'Releasing Level 2 drift grants a Super Mini-Turbo boost');
  stopKartSimulation('TEST_AI');
});

test('Kart Clash: Speed classes, Item modes, Tier 3 Ultra Mini-Turbo, and Slipstream Drafting', async () => {
  const {
    createKartSimulation,
    stepKartSimulation,
    stopKartSimulation,
    buildKartRacers,
    updateKartInput,
    SPEED_CLASSES,
  } = await import('./kart-physics');

  // 1. Verify speed class configurations
  assert.ok(SPEED_CLASSES['50cc'].maxSpeed < SPEED_CLASSES['100cc'].maxSpeed);
  assert.ok(SPEED_CLASSES['100cc'].maxSpeed < SPEED_CLASSES['150cc'].maxSpeed);
  assert.ok(SPEED_CLASSES['150cc'].maxSpeed < SPEED_CLASSES['200cc'].maxSpeed);

  const racers = buildKartRacers(
    [
      { id: 'p1', name: 'Racer1', avatar: '🏎️', avatarColor: '#ef4444' },
      { id: 'p2', name: 'Racer2', avatar: '🚀', avatarColor: '#38bdf8' },
    ],
    false,
    2,
  );

  const sim = createKartSimulation({
    roomCode: 'TEST_ADVANCED_KART',
    raceId: 'race-tier3',
    trackId: 'cyber-metro',
    racers,
    speedClass: '200cc',
    itemsMode: 'frantic',
  });

  sim.countdownMs = 0;
  assert.equal(sim.speedClass, '200cc');
  assert.equal(sim.itemsMode, 'frantic');

  const p1 = sim.karts['p1'];
  const p2 = sim.karts['p2'];

  // Test Tier 3 Ultra Mini-Turbo: drift for ~2.3 seconds
  updateKartInput('TEST_ADVANCED_KART', 'p1', { drift: true, steer: 0.6 });
  for (let i = 0; i < 75; i++) {
    stepKartSimulation(sim, 1 / 30);
  }
  assert.equal(p1.driftLevel, 3, 'Holding drift for 2.2s charges Tier 3 Ultra Mini-Turbo (magenta sparks)');
  updateKartInput('TEST_ADVANCED_KART', 'p1', { drift: false, steer: 0 });
  stepKartSimulation(sim, 1 / 30);
  assert.ok(p1.boostTimer >= 2.1, 'Releasing Tier 3 Ultra Mini-Turbo grants the longest boost');

  // Test Slipstream Drafting: place p2 8 meters behind p1 along track
  p1.x = 0;
  p1.z = 20;
  p1.speed = 25;
  p2.x = 0;
  p2.z = 12;
  p1.angle = 0;
  p2.angle = 0;
  p2.speed = 25;

  for (let i = 0; i < 40; i++) {
    p1.x = 0;
    p1.z = 20;
    p2.x = 0;
    p2.z = 12;
    p1.angle = 0;
    p2.angle = 0;
    p2.speed = 25;
    stepKartSimulation(sim, 1 / 30);
  }
  assert.ok(p2.slipstreamTimer > 1.0, 'Drafting directly behind leader charges slipstream draft');

  stopKartSimulation('TEST_ADVANCED_KART');
});

test('Kart Clash: Expanded items (Blue Shell, Golden Shroom, Super Horn, Fake Box)', async () => {
  const {
    createKartSimulation,
    stepKartSimulation,
    stopKartSimulation,
    buildKartRacers,
    fireKartItem,
  } = await import('./kart-physics');

  const racers = buildKartRacers(
    [
      { id: 'leader', name: 'Leader', avatar: '👑', avatarColor: '#facc15' },
      { id: 'trailing', name: 'Chaser', avatar: '🏎️', avatarColor: '#38bdf8' },
    ],
    false,
    2,
  );

  const sim = createKartSimulation({
    roomCode: 'TEST_ITEMS',
    raceId: 'race-items',
    trackId: 'volcano-inferno',
    racers,
  });

  sim.countdownMs = 0;
  const leader = sim.karts['leader'];
  const chaser = sim.karts['trailing'];
  leader.rank = 1;
  chaser.rank = 2;

  // 1. Golden Mushroom test
  chaser.heldItem = 'golden_mushroom';
  fireKartItem(sim, 'trailing');
  assert.ok((chaser.goldenShroomTimer ?? 0) > 0, 'Golden mushroom activates multi-use timer');
  assert.equal(chaser.heldItem, 'golden_mushroom', 'Golden mushroom stays held while timer is active');

  // 2. Fake Item Box hazard test
  leader.heldItem = 'fake_box';
  fireKartItem(sim, 'leader');
  const fakeBox = sim.hazards.find((h) => h.kind === 'fake_box');
  assert.ok(fakeBox, 'Fake Item Box drops as a stationary hazard');

  // 3. Super Horn test (shatters nearby hazards)
  chaser.heldItem = 'super_horn';
  fakeBox.x = chaser.x + 1;
  fakeBox.z = chaser.z + 1;
  fireKartItem(sim, 'trailing');
  assert.ok(!sim.hazards.some((h) => h.id === fakeBox.id), 'Super Horn sonic blast shatters nearby hazards');

  // 4. Blue Spiny Shell test
  chaser.heldItem = 'spiny_shell';
  fireKartItem(sim, 'trailing');
  const blueShell = sim.hazards.find((h) => h.kind === 'spiny_shell');
  assert.ok(blueShell, 'Spiny Blue Shell is spawned');
  assert.equal(blueShell.targetId, 'leader', 'Spiny Blue Shell targets 1st place leader');

  stopKartSimulation('TEST_ITEMS');
});

test('Kart Clash: 6 Tracks registered with banking camber samples and theme scenery', async () => {
  const { KART_TRACKS, TRACK_LIST } = await import('./kart-tracks');
  assert.equal(TRACK_LIST.length, 6, 'Total of 6 playable courses available in Kart Clash');
  assert.ok(KART_TRACKS['volcano-inferno'], 'Volcano Inferno track exists');
  assert.ok(KART_TRACKS['cyber-metro'], 'Cyber Metropolis track exists');

  for (const track of TRACK_LIST) {
    assert.ok(track.samples.length >= 200, `${track.id} has high-resolution spline samples`);
    assert.ok(track.samples.some((s) => s.bank !== undefined && s.bank !== 0), `${track.id} has 3D road camber banking`);
    assert.ok(track.itemBoxes.length >= 4, `${track.id} has item box locations`);
    assert.ok(track.boostPads.length >= 2, `${track.id} has boost pads`);
  }
});

test('Kart Clash: 6-race Grand Prix cup, shockwave hazards, fake box grace period, and telemetry snapshot', async () => {
  const {
    createKartSimulation,
    stepKartSimulation,
    stopKartSimulation,
    buildKartRacers,
    fireKartItem,
    getKartSnapshot,
  } = await import('./kart-physics');

  // 1. Verify 6-race Grand Prix configuration
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  await engine.joinRoom(roomCode, 'Speedy');
  await engine.processAction(roomCode, hostId, {
    type: 'SET_KART_CONFIG',
    format: 'grand-prix',
    totalRaces: 6,
    speedClass: '200cc',
    itemsMode: 'frantic',
  });
  const state = (await engine.getGameState(roomCode))!;
  assert.equal(state.gameData.totalRaces, 6, 'Grand Prix allows configuring all 6 tracks');
  assert.equal(state.gameData.speedClass, '200cc', 'Speed class configured to 200cc');
  assert.equal(state.gameData.itemsMode, 'frantic', 'Items mode configured to frantic');

  // 2. Test Super Horn spawns a shockwave hazard
  const racers = buildKartRacers([
    { id: 'p1', name: 'Racer 1', avatar: '🏎️', avatarColor: '#38bdf8' },
    { id: 'p2', name: 'Racer 2', avatar: '🚗', avatarColor: '#f43f5e' },
  ]);
  const sim = createKartSimulation({
    roomCode: 'TEST_EXTRA_VERIF',
    raceId: 'race_test_extra',
    trackId: 'neon-starway',
    speedClass: '150cc',
    itemsMode: 'normal',
    racers,
  });
  sim.countdownMs = 0;
  sim.karts['p1'].heldItem = 'super_horn';
  fireKartItem(sim, 'p1');

  const shockwave = sim.hazards.find((h) => h.kind === 'shockwave');
  assert.ok(shockwave, 'Super Horn creates a shockwave hazard');
  assert.equal(shockwave.ownerId, 'p1', 'Shockwave hazard is attributed to firing racer');

  // 3. Test Fake Box grace period (immune for first 0.8s, vulnerable afterwards)
  const p1 = sim.karts['p1'];
  p1.heldItem = 'fake_box';
  fireKartItem(sim, 'p1');
  const fakeBox = sim.hazards.find((h) => h.kind === 'fake_box');
  assert.ok(fakeBox, 'Fake Box hazard dropped');

  // Place p1 directly on top of fakeBox
  p1.x = fakeBox.x;
  p1.z = fakeBox.z;
  p1.spinOutTimer = 0;

  // Inside the grace period, stepping does not spin out the owner
  fakeBox.age = 0.2;
  stepKartSimulation(sim, 0.05);
  assert.equal(p1.spinOutTimer, 0, 'Owner is immune to own Fake Box during 0.8s grace period');

  // Once the grace period has passed, the owner's own box gets them too
  fakeBox.age = 1;
  p1.x = fakeBox.x;
  p1.z = fakeBox.z;
  stepKartSimulation(sim, 0.05);
  assert.ok(p1.spinOutTimer > 0, 'Owner triggers Fake Box after grace period expires');

  // 4. Test Spiny Shell explosion spawns shockwave hazard on impact
  const leaderKart = sim.karts['p2'];
  leaderKart.totalProgress = 5000;
  leaderKart.rank = 1;
  sim.karts['p1'].totalProgress = 100;
  sim.karts['p1'].rank = 2;
  leaderKart.spinOutTimer = 0;

  sim.hazards.push({
    id: 'test_blue_shell',
    kind: 'spiny_shell',
    ownerId: 'p1',
    targetId: 'p2',
    x: leaderKart.x,
    z: leaderKart.z,
    vx: 0,
    vz: 0,
    angle: 0,
    progress: leaderKart.progress,
    bouncesLeft: 0,
    ttl: 10,
    age: 0,
  });
  stepKartSimulation(sim, 0.05);
  const spinyShockwave = sim.hazards.find((h) => h.kind === 'shockwave' && Math.hypot(h.x - leaderKart.x, h.z - leaderKart.z) < 2);
  assert.ok(spinyShockwave, 'Spiny Blue Shell impact spawns a shockwave hazard');

  // 5. Test getKartSnapshot exposes fastestLap, lateralOffset, and sampleIdx
  sim.stats.fastestLap = { racerId: 'p1', racerName: 'Racer 1', timeMs: 24500 };
  p1.lateralOffset = 3.5;
  p1.sampleIdx = 42;
  const snapshot = getKartSnapshot(sim);
  assert.deepEqual(snapshot.fastestLap, { racerId: 'p1', racerName: 'Racer 1', timeMs: 24500 });
  const snapKart = snapshot.karts.find((k) => k.id === 'p1');
  assert.ok(snapKart, 'Kart found in snapshot');
  assert.equal(snapKart.lateralOffset, 3.5, 'lateralOffset exposed in snapshot');
  assert.equal(snapKart.sampleIdx, 42, 'sampleIdx exposed in snapshot');

  stopKartSimulation('TEST_EXTRA_VERIF');
});

test('Kart Clash: every track is laid out so barriers never overlap and start on a straight', async () => {
  const { TRACK_LIST, getTrackBoundsAt } = await import('./kart-tracks');
  for (const t of TRACK_LIST) {
    const m = t.samples.length;
    const ds = t.totalLength / m;
    for (let i = 0; i < m; i += 2) {
      const wA = getTrackBoundsAt(t, t.samples[i].progress).wallWidth;
      for (let j = i + 2; j < m; j += 2) {
        const wB = getTrackBoundsAt(t, t.samples[j].progress).wallWidth;
        const along = Math.min(j - i, m - (j - i)) * ds;
        if (along < Math.max(wA, wB) * 4) continue;
        const gap = Math.hypot(t.samples[i].x - t.samples[j].x, t.samples[i].z - t.samples[j].z);
        assert.ok(gap > wA + wB + 2, `${t.id}: sections at ${i} and ${j} overlap (gap ${gap.toFixed(1)}, need > ${(wA + wB + 2).toFixed(1)})`);
      }
    }
    for (let i = -6; i <= 6; i++) {
      assert.ok(Math.abs(t.samples[(i + m) % m].curvature) < 0.006, `${t.id}: start grid should be on a straight`);
    }
    for (const r of t.ramps) {
      const idx = Math.round(r.progress * m) % m;
      assert.ok(Math.abs(t.samples[idx].curvature) < 0.012, `${t.id}: ramp ${r.id} should not sit on a tight bend`);
    }
  }
});

test('Kart Clash: a full race runs to the end on every track with bots and a hands-off human', async () => {
  const { TRACK_LIST } = await import('./kart-tracks');
  const { buildKartRacers, createKartSimulation, stepKartSimulation, stopKartSimulation, updateKartInput } = await import('./kart-physics');
  for (const t of TRACK_LIST) {
    const racers = buildKartRacers([{ id: 'p1', name: 'Hands Off', avatar: '🙌', avatarColor: '#fff000' }], true, 8);
    const sim = createKartSimulation({ roomCode: `FULL_${t.id}`, raceId: 'r', trackId: t.id, racers, itemsMode: 'frantic' });
    sim.countdownMs = 0;
    let ticks = 0;
    while (!sim.completed && ticks < 30 * 240) {
      updateKartInput(sim.roomCode, 'p1', { steer: 0 });
      stepKartSimulation(sim, 1 / 30);
      ticks++;
    }
    assert.ok(sim.completed, `${t.id}: race reaches a conclusion`);
    assert.equal(sim.karts['p1'].finished, true, `${t.id}: hands-off human still gets home`);
    assert.equal(sim.karts['p1'].dnf, false, `${t.id}: hands-off human finishes before the time limit`);
    assert.equal(Object.values(sim.karts).filter((k) => k.finished).length, 8, `${t.id}: every kart gets a finishing position`);
    const ranks = Object.values(sim.karts).map((k) => k.finishRank).sort((a, b) => a! - b!);
    assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8], `${t.id}: finishing ranks are unique`);
    stopKartSimulation(sim.roomCode);
  }
});

test('Kart Clash: green shells bounce once per wall contact and blue shells ignore everyone but the leader', async () => {
  const { buildKartRacers, createKartSimulation, fireKartItem, stepKartSimulation, stopKartSimulation } = await import('./kart-physics');
  const racers = buildKartRacers([
    { id: 'a', name: 'A', avatarColor: '#fff' },
    { id: 'b', name: 'B', avatarColor: '#fff' },
    { id: 'c', name: 'C', avatarColor: '#fff' },
  ]);
  const sim = createKartSimulation({ roomCode: 'TEST_SHELLS', raceId: 'r', trackId: 'sunny-circuit', racers });
  sim.countdownMs = 0;
  stepKartSimulation(sim, 1 / 30);

  // A shell fired straight at the wall loses one bounce, not all of them
  const a = sim.karts['a'];
  a.heldItem = 'green_shell';
  fireKartItem(sim, a);
  const shell = sim.hazards.find((h) => h.kind === 'green_shell')!;
  const s = sim.track.samples[a.sampleIdx];
  shell.x = s.x + s.nx * (sim.track.wallWidth - 2);
  shell.z = s.z + s.nz * (sim.track.wallWidth - 2);
  shell.vx = s.nx * 100;
  shell.vz = s.nz * 100;
  shell.age = 5;
  for (let i = 0; i < 4; i++) stepKartSimulation(sim, 1 / 30);
  assert.equal(shell.bouncesLeft, 3, 'one wall contact costs exactly one bounce');
  sim.hazards = [];

  // A blue shell passing straight through a non-leader leaves them alone
  const [leader, other] = [sim.karts['b'], sim.karts['c']];
  leader.rank = 1;
  other.rank = 2;
  a.rank = 3;
  leader.x = sim.track.samples[120].x;
  leader.z = sim.track.samples[120].z;
  leader.sampleIdx = 120;
  sim.hazards.push({ id: 'blue', kind: 'spiny_shell', ownerId: 'a', targetId: 'b', x: other.x, z: other.z, vx: 0, vz: 0, angle: 0, progress: other.progress, bouncesLeft: 0, ttl: 10, age: 1 });
  stepKartSimulation(sim, 1 / 30);
  assert.equal(other.spinOutTimer, 0, 'blue shell flies over karts that are not its target');
  stopKartSimulation('TEST_SHELLS');
});

test('Kart Clash: players can customise their kart, settings survive a return to the lobby, and a stale phone goes on autopilot', async () => {
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  const p1 = (await engine.joinRoom(roomCode, 'Garage')) as { playerId: string };
  const custom = await engine.processAction(roomCode, p1.playerId, { type: 'SET_KART_CUSTOMIZATION', kartStyle: 'rocket', sparksColor: '#d946ef' });
  assert.equal(custom.success, true, 'a regular player is allowed to change their own kart');
  await engine.processAction(roomCode, hostId, { type: 'SET_KART_CONFIG', speedClass: '200cc', itemsMode: 'pure' });
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });

  const { getKartSimulation, stepKartSimulation, stopKartSimulation } = await import('./kart-physics');
  let state = (await engine.getGameState(roomCode))!;
  const id = engine.resolvePlayerKey(state, p1.playerId)!;
  const sim = getKartSimulation(roomCode)!;
  assert.equal(sim.karts[id].kartStyle, 'rocket', 'chosen chassis reaches the race');
  assert.equal(sim.karts[id].sparksColor, '#d946ef', 'chosen spark colour reaches the race');

  sim.waitingForOrientation = false;
  sim.countdownMs = 0;
  sim.inputs[id].steer = 1;
  sim.inputs[id].updatedAt = Date.now() - 10_000;
  stepKartSimulation(sim, 1 / 30);
  assert.equal(sim.karts[id].autopilot, true, 'a phone that stopped talking hands the kart to the autopilot');

  await engine.processAction(roomCode, hostId, { type: 'QUIT_GAME' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.gameData.speedClass, '200cc', 'speed class survives returning to the lobby');
  assert.equal(state.gameData.itemsMode, 'pure', 'items mode survives returning to the lobby');
  assert.equal(state.gameData.customizations[id].kartStyle, 'rocket', 'kart choice survives returning to the lobby');
  stopKartSimulation(roomCode);
});

test('Kart Clash: swapping two racers in the same heat never drops anyone from the tournament', async () => {
  const { stopKartSimulation } = await import('./kart-physics');
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  for (const name of ['A', 'B', 'C', 'D']) await engine.joinRoom(roomCode, name);
  await engine.processAction(roomCode, hostId, { type: 'SET_KART_CONFIG', format: 'tournament', heatSize: 4 });
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  const heat = state.hostData.heats[0];
  const [first, second] = heat.playerIds;
  await engine.processAction(roomCode, hostId, { type: 'ASSIGN_HEAT_PLAYER', playerId: first, targetHeatId: heat.id, swapWithPlayerId: second });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.hostData.heats[0].playerIds.length, 4, 'everyone is still in the heat');
  assert.equal(state.hostData.heats[0].playerIds[0], second, 'the two racers traded grid slots');
  stopKartSimulation(roomCode);
});

test('Kart Clash: pit crew chaos waits for the race to get going, then fires once', async () => {
  const { getKartSimulation, stepKartSimulation, stopKartSimulation } = await import('./kart-physics');
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  const keys: string[] = [];
  for (const name of ['A', 'B', 'C']) keys.push(((await engine.joinRoom(roomCode, name)) as { playerId: string }).playerId);
  await engine.processAction(roomCode, hostId, { type: 'SET_KART_CONFIG', format: 'tournament', heatSize: 2 });
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  let state = (await engine.getGameState(roomCode))!;
  await engine.processAction(roomCode, hostId, { type: 'START_HEAT', heatId: state.hostData.heats[0].id });
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });
  state = (await engine.getGameState(roomCode))!;
  const racing: string[] = state.gameData.activeRacers;
  const pitKey = keys.find((k) => !racing.includes(engine.resolvePlayerKey(state, k)!))!;

  const sim = getKartSimulation(roomCode)!;
  const res = await engine.processAction(roomCode, pitKey, { type: 'SUBMIT_CHAOS_VOTE', choice: 'bananas' });
  assert.equal(res.success, true);
  assert.equal(sim.chaosFired, false, 'a vote before the green light does not drop chaos on the grid');
  assert.equal(sim.queuedChaos, 'bananas', 'the vote is queued');

  sim.waitingForOrientation = false;
  sim.countdownMs = 0;
  sim.raceTimeMs = 12_000;
  stepKartSimulation(sim, 1 / 30);
  assert.equal(sim.chaosFired, true, 'chaos drops once the race is under way');
  assert.ok(sim.hazards.some((h) => h.kind === 'banana' && h.ownerId === 'AUDIENCE'), 'bananas land on the track');
  stopKartSimulation(roomCode);
});

test('Game catalog: covers every game, agrees with the guides, and filters sensibly', async () => {
  const { GAME_CATALOG, GAME_INFO, fitsBucket, gamesForRoom } = await import('./catalog');
  const { GAME_GUIDES } = await import('./guides');
  assert.deepEqual([...GAME_CATALOG.map((g) => g.id)].sort(), [...engine.GAME_TYPES].sort(), 'every game is in the catalog exactly once');
  for (const g of GAME_CATALOG) {
    assert.ok(GAME_GUIDES[g.id].players.startsWith(`${g.minPlayers}–${g.maxPlayers}`), `${g.id}: guide and catalog agree on player count`);
    assert.equal(GAME_GUIDES[g.id].name, g.name, `${g.id}: guide and catalog agree on the name`);
    assert.ok(fitsBucket(g, 'any'), `${g.id}: shows under Any`);
  }
  assert.ok(gamesForRoom(false).some((g) => g.id === 'kart-clash'), 'TV rooms offer Kart Clash');
  assert.ok(!gamesForRoom(true).some((g) => g.tvOnly), 'phones-only rooms never list a TV-only game');
  assert.equal(fitsBucket(GAME_INFO['quip-clash'], '1-2'), false, 'a 3+ game is hidden for 1-2 players');
  assert.equal(fitsBucket(GAME_INFO['the-faker'], '9+'), false, 'an 8-player game is hidden for 9+');
  assert.equal(fitsBucket(GAME_INFO['wavelength'], '1-2'), true, 'a 2-player game shows for 1-2 players');
});

test('Phones-only rooms: cannot create or switch to a TV-only game, but TV rooms can', async () => {
  await assert.rejects(() => engine.createRoom('kart-clash', { phonesOnly: true }), /needs a TV/);
  const { POST } = await import('../../app/api/party/create/route');
  const res = await POST(new Request('http://localhost/api/party/create', { method: 'POST', body: JSON.stringify({ gameType: 'kart-clash', mode: 'phones' }) }));
  assert.equal(res.status, 400, 'the API refuses it too');

  const phones = await engine.createRoom('quip-clash', { phonesOnly: true });
  const refused = await engine.processAction(phones.roomCode, phones.hostId, { type: 'SWITCH_GAME', gameType: 'kart-clash' });
  assert.equal(refused.success, false, 'switching a phones-only room to Kart Clash is refused');
  assert.equal((await engine.processAction(phones.roomCode, phones.hostId, { type: 'SWITCH_GAME', gameType: 'spyfall' })).success, true, 'other games still switch');
  assert.equal((await engine.getGameState(phones.roomCode))!.settings?.phonesOnly, true, 'the room stays phones-only after switching');

  const tv = await engine.createRoom('quip-clash');
  assert.equal((await engine.processAction(tv.roomCode, tv.hostId, { type: 'SWITCH_GAME', gameType: 'kart-clash' })).success, true, 'a TV room can switch to Kart Clash');
});

test('Kart Clash: laps and bot difficulty reach the race and survive a return to the lobby', async () => {
  const { getKartSimulation, stopKartSimulation, stepKartSimulation, createKartSimulation, buildKartRacers } = await import('./kart-physics');
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  await engine.joinRoom(roomCode, 'Racer');
  await engine.processAction(roomCode, hostId, { type: 'SET_KART_CONFIG', laps: 5, botLevel: 'mean' });
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });
  const sim = getKartSimulation(roomCode)!;
  assert.equal(sim.totalLaps, 5);
  assert.equal(sim.botLevel, 'mean');
  await engine.processAction(roomCode, hostId, { type: 'QUIT_GAME' });
  const state = (await engine.getGameState(roomCode))!;
  assert.equal(state.gameData.laps, 5);
  assert.equal(state.gameData.botLevel, 'mean');
  stopKartSimulation(roomCode);

  // Bots alone on a course: Mean should beat Chill round the same track by a clear margin
  const raceTime = (level: 'chill' | 'mean') => {
    const racers = buildKartRacers([], true, 6);
    const race = createKartSimulation({ roomCode: `LVL_${level}`, raceId: 'r', trackId: 'sunny-circuit', racers, botLevel: level, itemsMode: 'pure', totalLaps: 2 });
    race.countdownMs = 0;
    for (let i = 0; i < 30 * 200 && !race.completed; i++) stepKartSimulation(race, 1 / 30);
    const winner = Object.values(race.karts).find((k) => k.finishRank === 1)!;
    stopKartSimulation(`LVL_${level}`);
    return winner.finishTimeMs!;
  };
  assert.ok(raceTime('mean') < raceTime('chill'), 'Mean bots are faster than Chill bots');
});

test('Quip Clash settings.rounds and VIP gating reject non-VIP host actions', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['q1', 'q2', 'q3', 'q4'], theFaker: ['x'], bracketBattles: ['y'] }));
  // Default when settings.rounds is unset -> 3 rounds; explicit settings.rounds overrides cleanly
  const defaultState = makeState('quip-clash', 3);
  await quipClashLogic.onStart(defaultState);
  assert.equal(defaultState.gameData.targetRounds, 3, 'defaults safely to 3 rounds when unset');

  const customState = makeState('quip-clash', 3);
  customState.settings = { rounds: 2 };
  await quipClashLogic.onStart(customState);
  assert.equal(customState.gameData.targetRounds, 2, 'honors room.settings.rounds');

  // VIP joins with hostId; non-VIP joins without hostId
  const { roomCode, hostId } = await engine.createRoom('quip-clash', { phonesOnly: true, rounds: 2 });
  const vip = (await engine.joinRoom(roomCode, 'VipHost', { hostId })) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'Guest1')) as { playerId: string };
  const p3 = (await engine.joinRoom(roomCode, 'Guest2')) as { playerId: string };

  let state = (await engine.getGameState(roomCode))!;
  const vipPub = engine.resolvePlayerKey(state, vip.playerId)!;
  const p2Pub = engine.resolvePlayerKey(state, p2.playerId)!;
  assert.equal(state.vipId, vipPub);
  assert.equal(state.players[vipPub].isVip, true);
  assert.equal(state.players[p2Pub].isVip, undefined);

  // Non-VIP cannot start/skip/return to lobby via API or engine
  const { POST: postAction } = await import('../../app/api/party/action/route');
  const blockedRes = await postAction(new Request('http://localhost/api/party/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerId: p2.playerId, action: { type: 'START_GAME' } }),
  }));
  assert.equal(blockedRes.status, 403);

  // VIP can start, force-skip voting, and return to lobby using their key
  assert.equal((await engine.processAction(roomCode, vip.playerId, { type: 'START_GAME' })).success, true);
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'PROMPTING');
  assert.equal(state.gameData.targetRounds, 2);

  const p2Skip = await engine.processAction(roomCode, p2.playerId, { type: 'FORCE_VOTING' });
  assert.equal(p2Skip.success, false);
  assert.equal((await engine.processAction(roomCode, vip.playerId, { type: 'FORCE_VOTING' })).success, true);
  assert.equal((await engine.getGameState(roomCode))!.phase, 'VOTING');

  assert.equal((await engine.processAction(roomCode, p3.playerId, { type: 'QUIT_GAME' })).success, false);
  assert.equal((await engine.processAction(roomCode, vip.playerId, { type: 'QUIT_GAME' })).success, true);
  assert.equal((await engine.getGameState(roomCode))!.phase, 'LOBBY');
});

test('Kart Physics seq <= 5 reload reset and kart-input keyCache invalidation on kick', async () => {
  const { getKartSimulation, updateKartInput, stopKartSimulation } = await import('./kart-physics');
  const { POST: postKartInput } = await import('../../app/api/party/kart-input/route');

  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  const p1 = (await engine.joinRoom(roomCode, 'ReloadRacer')) as { playerId: string };
  const p2 = (await engine.joinRoom(roomCode, 'KickedRacer')) as { playerId: string };

  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });
  const state = (await engine.getGameState(roomCode))!;
  const id1 = engine.resolvePlayerKey(state, p1.playerId)!;
  const id2 = engine.resolvePlayerKey(state, p2.playerId)!;
  const sim = getKartSimulation(roomCode)!;

  // Normal high sequence number, then stale mid-race packet > 5 must NOT overwrite or refresh updatedAt
  assert.equal(updateKartInput(roomCode, id1, { seq: 40, steer: 0.5, isHorizontal: true }), true);
  sim.inputs[id1].updatedAt = 12345;
  assert.equal(updateKartInput(roomCode, id1, { seq: 20, steer: -0.9 }), true);
  assert.equal(sim.inputs[id1].steer, 0.5, 'mid-stream stale packet ignored');
  assert.equal(sim.inputs[id1].updatedAt, 12345, 'stale packet does not artificially refresh updatedAt');

  // Phone reload restarts seq at 1 (<= 5): must accept and reset seq tracking
  assert.equal(updateKartInput(roomCode, id1, { seq: 1, steer: -0.75, drift: true }), true);
  assert.equal(sim.inputs[id1].seq, 1, 'reconnect seq <= 5 resets seq tracking');
  assert.equal(sim.inputs[id1].steer, -0.75, 'reconnect packet steering accepted');
  assert.equal(sim.inputs[id1].drift, true);

  // Cache p2 in kart-input route, then kick p2 and verify cached key is rejected immediately
  const okRes = await postKartInput(new Request('http://localhost/api/party/kart-input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerKey: p2.playerId, steer: 0.4, seq: 1 }),
  }));
  assert.equal(okRes.status, 200);
  assert.equal((await okRes.json()).ok, true);

  await engine.processAction(roomCode, hostId, { type: 'KICK_PLAYER', targetId: id2 });
  const kickedRes = await postKartInput(new Request('http://localhost/api/party/kart-input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerKey: p2.playerId, steer: -0.8, seq: 2 }),
  }));
  assert.equal(kickedRes.status, 403, 'kicked player cannot continue driving via cached key');
  assert.equal(sim.karts[id2].autopilot, true);
  stopKartSimulation(roomCode);
});

test('Kart Clash ranks bots alongside humans so 6th DNF behind bots does not award 1st place or raceWins', async () => {
  const { getKartSimulation, stopKartSimulation } = await import('./kart-physics');
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  const p1 = (await engine.joinRoom(roomCode, 'SlowHuman')) as { playerId: string };
  await engine.processAction(roomCode, hostId, { type: 'SET_KART_CONFIG', format: 'grand-prix', totalRaces: 2, aiBots: true });
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });

  let state = (await engine.getGameState(roomCode))!;
  const humanId = engine.resolvePlayerKey(state, p1.playerId)!;
  const sim = getKartSimulation(roomCode)!;
  // Put 5 bots finished ahead of the single DNF human in 6th
  const bots = Object.values(sim.karts).filter((k) => k.isBot);
  bots.forEach((b, idx) => {
    b.finished = true;
    b.dnf = false;
    b.finishRank = idx + 1;
    b.rank = idx + 1;
    b.finishTimeMs = 40_000 + idx * 1000;
  });
  sim.karts[humanId].finished = false;
  sim.karts[humanId].dnf = true;
  sim.karts[humanId].rank = 6;
  bots[5].rank = 7;

  await engine.processAction(roomCode, hostId, { type: 'FINISH_KART_RACE' });
  state = (await engine.getGameState(roomCode))!;
  assert.equal(state.phase, 'RACE_RESULTS');
  assert.equal(state.playerData[humanId].myRank, 6);
  assert.equal(state.playerData[humanId].myCupRank, 6, 'cup rank places bots ahead of 6th-place human');
  assert.equal(state.hostData.winnerIsBot, true);
  assert.ok(state.hostData.cupStandings[0].isBot, '1st place in tournament totals belongs to top bot');
  assert.equal(state.gameData?.stats?.raceWins?.[humanId] || 0, 0, '6th DNF human is not credited with a race win');
  stopKartSimulation(roomCode);
});

test('Trivia Death fixes Final Escape auto-win, duplicate correct stat, and Seance emoji match', async () => {
  const { triviaDeathLogic } = await import('./games/trivia-death');
  const triviaQs = Array.from({ length: 15 }, (_, i) => ({
    question: `Q${i}?`,
    choices: ['A', 'B', 'C', 'D'] as [string, string, string, string],
    answer: 0,
  }));
  await savePrompts(normalizePrompts({ quipClash: ['a'], theFaker: ['x'], bracketBattles: ['y'], triviaQuestions: triviaQs }));

  const state = makeState('trivia-death', 5);
  await triviaDeathLogic.onStart(state);
  // 1st question: p0 answers right -> correct stat bumped once (not twice)
  await triviaDeathLogic.processAction(state, 'p0', { type: 'SUBMIT_TRIVIA_ANSWER', answer: 0 });
  await triviaDeathLogic.processAction(state, 'host', { type: 'FORCE_TRIVIA_REVEAL' });
  assert.equal(state.gameData.stats.correct.p0, 1, 'correct stat incremented once per right answer');

  // Séance ('memory'): emoji with VS-16 like 🕷️ matches both full emoji and stripped variant
  state.gameData.killingFloorPlayers = ['p1', 'p2'];
  state.gameData.killingFloorMiniGame = 'memory';
  state.gameData.killingFloorData = { type: 'memory', grid: ['🕷️', '💀', '🕯️', '🕷️', '💀', '🕯️'] };
  state.phase = 'KILLING_FLOOR';
  await triviaDeathLogic.processAction(state, 'p1', { type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: '🕷️' });
  await triviaDeathLogic.processAction(state, 'p2', { type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: '🦇' });
  await triviaDeathLogic.processAction(state, 'host', { type: 'FORCE_KILLING_FLOOR_RESOLVE' });
  assert.equal(state.playerData.p1.isDead, false, 'full multi-codepoint emoji survives Seance');
  assert.equal(state.playerData.p2.isDead, true, 'wrong symbol still dies in Seance');

  // Fast-forward into Final Escape with 5 players having distinct money totals
  state.gameData.round = state.gameData.totalRounds;
  state.gameData.money = { p0: 100, p1: 200, p2: 300, p3: 400, p4: 500 };
  state.phase = 'KILLING_FLOOR_RESULTS';
  await triviaDeathLogic.processAction(state, 'host', { type: 'NEXT_TRIVIA_ROUND' });
  assert.equal(state.phase, 'FINAL_ESCAPE');
  for (const pid of state.playerOrder) {
    assert.ok(state.gameData.escapeProgress[pid] < 4, `${pid} starts strictly below 4 steps in 5-player Final Escape`);
  }
  // 1st place (p4) answering WRONG on Q1 must NOT escape/win
  const escQ = state.gameData.currentEscapeQuestion;
  const wrongIdx = (escQ.answer + 1) % 4;
  await triviaDeathLogic.processAction(state, 'p4', { type: 'SUBMIT_ESCAPE_ANSWER', answer: wrongIdx });
  await triviaDeathLogic.processAction(state, 'host', { type: 'FORCE_ESCAPE_ADVANCE' });
  assert.equal(state.phase, 'FINAL_ESCAPE', '1st place wrong answer on Q1 does not auto-win');
  assert.equal(state.gameData.playerStatuses.p4, 'alive');
});

test('The Faker rotates fakerId each round across active players', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['a'], theFaker: ['Act 1', 'Act 2', 'Act 3'], bracketBattles: ['y'] }));
  const state = makeState('the-faker', 4);
  await fakerLogic.onStart(state);
  const f1 = state.gameData.fakerId;

  // Round 1 finishes in a tie (nobody eliminated) -> Round 2 must pick a DIFFERENT faker
  await fakerLogic.processAction(state, 'host', { type: 'PROCEED_TO_ACTION' });
  await fakerLogic.processAction(state, 'host', { type: 'PROCEED_TO_VOTING' });
  await fakerLogic.processAction(state, 'host', { type: 'FORCE_FAKER_RESULTS' });
  await fakerLogic.processAction(state, 'host', { type: 'NEXT_FAKER_ROUND' });
  const f2 = state.gameData.fakerId;
  assert.notEqual(f2, f1, 'Round 2 rotates away from Round 1 faker');

  await fakerLogic.processAction(state, 'host', { type: 'PROCEED_TO_ACTION' });
  await fakerLogic.processAction(state, 'host', { type: 'PROCEED_TO_VOTING' });
  await fakerLogic.processAction(state, 'host', { type: 'FORCE_FAKER_RESULTS' });
  await fakerLogic.processAction(state, 'host', { type: 'NEXT_FAKER_ROUND' });
  const f3 = state.gameData.fakerId;
  assert.notEqual(f3, f2, 'Round 3 rotates away from Round 2 faker');
  assert.notEqual(f3, f1, 'Round 3 picks an unused active player when available');
});

test('Ready Set Bet respects bettingClosed on prop bets and counts 2/3 & 11/12 in odd/even props', async () => {
  const { readySetBetLogic } = await import('./games/ready-set-bet');
  const state = makeState('ready-set-bet', 2);
  await readySetBetLogic.onStart(state);

  // When bettingClosed is true, prop bets are rejected
  state.gameData.bettingClosed = true;
  await readySetBetLogic.processAction(state, 'p0', { type: 'SUBMIT_PROP_BET', choice: true });
  assert.equal(state.gameData.propBetAnswers.p0, undefined, 'prop bet ignored after bettingClosed');

  // When open, accept and pay out when 2/3 or 11/12 wins odd_win / even_win
  state.gameData.bettingClosed = false;
  await readySetBetLogic.processAction(state, 'p0', { type: 'SUBMIT_PROP_BET', choice: true });
  await readySetBetLogic.processAction(state, 'p1', { type: 'SUBMIT_PROP_BET', choice: true });
  state.gameData.propBet = { id: 'odd_win', desc: 'Will the winner be an odd numbered horse?' };
  state.gameData.positions['2/3'] = 16;
  state.gameData.positions['5'] = 15;
  state.gameData.positions['7'] = 15;
  state.gameData.finishers = ['2/3', '5', '7'];
  // Trigger race finish by advancing final finisher tick via internal helper path: simulate 3rd finisher crossing
  state.gameData.finishers = ['2/3', '5'];
  // Re-test via direct RACE_TICK would roll dice; test even_win / odd_win payout via a controlled 3rd finisher tick if needed,
  // or verify through full state transition: set all horses except '4' behind, wait — easier: roll until 3rd crosses?
  // Even cleaner: set two finishers and check finishRace through any 3rd finisher reaching finish on next RACE_TICK?
  // Wait: rollDice is random, so set EVERY horse >= 15 and finishers = ['2/3', '11/12']? Let's set all non-finishers >= 15!
  // Set all non-finisher horses to TRACK_LENGTH (15) so the next non-finisher roll finishes the race
  for (const h of ['4', '5', '6', '7', '8', '9', '10', '11/12']) state.gameData.positions[h] = 15;
  for (let t = 0; t < 60 && state.phase === 'RACING'; t++) {
    await readySetBetLogic.processAction(state, 'host', { type: 'RACE_TICK' });
  }
  assert.equal(state.phase, 'RACE_RESULTS');
  assert.equal(state.gameData.money.p0, 150, '2/3 winning satisfies odd_win and awards +$150');

  // Test 11/12 with even_win (plus confirm incorrect prop choice pays nothing)
  const state2 = makeState('ready-set-bet', 2);
  await readySetBetLogic.onStart(state2);
  await readySetBetLogic.processAction(state2, 'p0', { type: 'SUBMIT_PROP_BET', choice: true });
  await readySetBetLogic.processAction(state2, 'p1', { type: 'SUBMIT_PROP_BET', choice: false });
  state2.gameData.propBet = { id: 'even_win', desc: 'Will the winner be an even numbered horse?' };
  state2.gameData.positions['11/12'] = 16;
  state2.gameData.finishers = ['11/12', '5'];
  for (const h of ['2/3', '4', '6', '7', '8', '9', '10']) state2.gameData.positions[h] = 15;
  for (let t = 0; t < 60 && state2.phase === 'RACING'; t++) {
    await readySetBetLogic.processAction(state2, 'host', { type: 'RACE_TICK' });
  }
  assert.equal(state2.phase, 'RACE_RESULTS');
  assert.equal(state2.gameData.money.p0, 150, '11/12 winning satisfies even_win and awards +$150');
  assert.equal(state2.gameData.money.p1, 0, 'false choice loses prop bet (clamped to $0)');

  // Test 11/12 with odd_win and 2/3 with even_win (combined horses cover both parities)
  const state3 = makeState('ready-set-bet', 1);
  await readySetBetLogic.onStart(state3);
  await readySetBetLogic.processAction(state3, 'p0', { type: 'SUBMIT_PROP_BET', choice: true });
  state3.gameData.propBet = { id: 'odd_win', desc: 'Will the winner be an odd numbered horse?' };
  state3.gameData.positions['11/12'] = 16;
  state3.gameData.finishers = ['11/12', '4'];
  for (const h of ['2/3', '5', '6', '7', '8', '9', '10']) state3.gameData.positions[h] = 15;
  for (let t = 0; t < 60 && state3.phase === 'RACING'; t++) {
    await readySetBetLogic.processAction(state3, 'host', { type: 'RACE_TICK' });
  }
  assert.equal(state3.phase, 'RACE_RESULTS');
  assert.equal(state3.gameData.money.p0, 150, '11/12 winning satisfies odd_win');

  const state4 = makeState('ready-set-bet', 1);
  await readySetBetLogic.onStart(state4);
  await readySetBetLogic.processAction(state4, 'p0', { type: 'SUBMIT_PROP_BET', choice: true });
  state4.gameData.propBet = { id: 'even_win', desc: 'Will the winner be an even numbered horse?' };
  state4.gameData.positions['2/3'] = 16;
  state4.gameData.finishers = ['2/3', '7'];
  for (const h of ['4', '5', '6', '8', '9', '10', '11/12']) state4.gameData.positions[h] = 15;
  for (let t = 0; t < 60 && state4.phase === 'RACING'; t++) {
    await readySetBetLogic.processAction(state4, 'host', { type: 'RACE_TICK' });
  }
  assert.equal(state4.phase, 'RACE_RESULTS');
  assert.equal(state4.gameData.money.p0, 150, '2/3 winning satisfies even_win');
});

test('Herd Mentality clears Pink Cow when outlier joins majority or tie breaks', async () => {
  const { herdMentalityLogic } = await import('./games/herd-mentality');
  await savePrompts(normalizePrompts({ quipClash: ['a'], theFaker: ['x'], bracketBattles: ['y'], herdMentality: ['P1', 'P2', 'P3'] }));
  const state = makeState('herd-mentality', 3);
  await herdMentalityLogic.onStart(state);

  // Round 1: p2 is sole outlier -> gets Pink Cow
  await herdMentalityLogic.processAction(state, 'p0', { type: 'SUBMIT_ANSWER', answer: 'Cats' });
  await herdMentalityLogic.processAction(state, 'p1', { type: 'SUBMIT_ANSWER', answer: 'Cats' });
  await herdMentalityLogic.processAction(state, 'p2', { type: 'SUBMIT_ANSWER', answer: 'Dogs' });
  assert.equal(state.hostData.pinkCowHolder, 'p2');

  // Round 2: everyone agrees (p2 moves into majority) -> Pink Cow cleared
  await herdMentalityLogic.processAction(state, 'host', { type: 'NEXT_HERD_ROUND' });
  await herdMentalityLogic.processAction(state, 'p0', { type: 'SUBMIT_ANSWER', answer: 'Taco' });
  await herdMentalityLogic.processAction(state, 'p1', { type: 'SUBMIT_ANSWER', answer: 'Taco' });
  await herdMentalityLogic.processAction(state, 'p2', { type: 'SUBMIT_ANSWER', answer: 'Taco' });
  assert.equal(state.hostData.pinkCowHolder, null, 'Pink Cow clears when previous outlier matches the herd');
  assert.equal(state.playerData.p2.hasPinkCow, false);

  // Round 3: p0 gets Pink Cow; in a 3-way split, Pink Cow clears instead of sticking
  await herdMentalityLogic.processAction(state, 'host', { type: 'NEXT_HERD_ROUND' });
  await herdMentalityLogic.processAction(state, 'p0', { type: 'SUBMIT_ANSWER', answer: 'Sole' });
  await herdMentalityLogic.processAction(state, 'p1', { type: 'SUBMIT_ANSWER', answer: 'Herd' });
  await herdMentalityLogic.processAction(state, 'p2', { type: 'SUBMIT_ANSWER', answer: 'Herd' });
  assert.equal(state.hostData.pinkCowHolder, 'p0');
  state.gameData.totalRounds = 5;
  state.gameData.prompts.push('P4');
  await herdMentalityLogic.processAction(state, 'host', { type: 'NEXT_HERD_ROUND' });
  await herdMentalityLogic.processAction(state, 'p0', { type: 'SUBMIT_ANSWER', answer: 'Red' });
  await herdMentalityLogic.processAction(state, 'p1', { type: 'SUBMIT_ANSWER', answer: 'Blue' });
  await herdMentalityLogic.processAction(state, 'p2', { type: 'SUBMIT_ANSWER', answer: 'Green' });
  assert.equal(state.hostData.pinkCowHolder, null, 'Pink Cow clears when no sole outlier exists');
});

test('Player SSE buildPlayerPayload strips hostData and masks secret voting info', async () => {
  const { buildPlayerPayload } = await import('./player-stream');
  await savePrompts(normalizePrompts({ quipClash: ['q1', 'q2', 'q3'], theFaker: ['x'], bracketBattles: ['y'] }));

  const state = makeState('quip-clash', 3);
  state.vipId = 'p0';
  state.players.p0.isVip = true;
  await quipClashLogic.onStart(state);
  await quipClashLogic.processAction(state, 'p0', { type: 'SUBMIT_ANSWER', promptIndex: 0, answer: 'Joke A' });
  await quipClashLogic.processAction(state, 'host', { type: 'FORCE_VOTING' });

  const nonVipPayload = buildPlayerPayload(state, 'p1') as Record<string, any>;
  assert.equal('hostData' in nonVipPayload, false, 'raw hostData is stripped from player stream');
  assert.equal(nonVipPayload.me.isVip, false);
  assert.equal(nonVipPayload.autoAdvanceAction, null, 'non-VIP does not get autoAdvanceAction');
  assert.ok(Array.isArray(nonVipPayload.publicData.answers), 'author can still see prompt text safely');
  for (const a of nonVipPayload.publicData.answers) {
    assert.equal('id' in a, false, 'author IDs are masked in publicData during Quip Clash voting');
  }

  const vipPayload = buildPlayerPayload(state, 'p0') as Record<string, any>;
  assert.equal('hostData' in vipPayload, false);
  assert.equal(vipPayload.me.isVip, true);
  assert.equal(vipPayload.autoAdvanceAction, 'FORCE_NEXT_VOTE');
});

test('Quip Clash keeps hostData.round and hostData.totalRounds as actual rounds during voting and results', async () => {
  await savePrompts(normalizePrompts({ quipClash: ['q1', 'q2', 'q3', 'q4'], theFaker: ['x'], bracketBattles: ['y'] }));
  const state = makeState('quip-clash', 3);
  state.settings = { rounds: 1 };
  await quipClashLogic.onStart(state);
  assert.equal(state.hostData.round, 1);
  assert.equal(state.hostData.totalRounds, 1);

  await quipClashLogic.processAction(state, 'host', { type: 'FORCE_VOTING' });
  assert.equal(state.phase, 'VOTING');
  assert.equal(state.hostData.round, 1);
  assert.equal(state.hostData.totalRounds, 1);
  assert.equal(state.hostData.promptNumber, 1);
  assert.equal(state.hostData.totalPrompts, 3);

  await quipClashLogic.processAction(state, 'host', { type: 'FORCE_NEXT_VOTE' });
  assert.equal(state.phase, 'ROUND_RESULTS');
  assert.equal(state.hostData.round, 1);
  assert.equal(state.hostData.totalRounds, 1);
  assert.equal(state.hostData.promptNumber, 1);
  assert.equal(state.hostData.totalPrompts, 3);

  await quipClashLogic.processAction(state, 'host', { type: 'NEXT_PROMPT' });
  assert.equal(state.phase, 'VOTING');
  assert.equal(state.hostData.round, 1);
  assert.equal(state.hostData.totalRounds, 1);
  assert.equal(state.hostData.promptNumber, 2);
  assert.equal(state.hostData.totalPrompts, 3);
});

test('Kart Clash Stage 1: coin spawns across all 6 tracks, collection, top speed, and drop on spinout', async () => {
  const { TRACK_LIST } = await import('./kart-tracks');
  const { MAX_COINS } = await import('./kart-shared');
  const {
    buildKartRacers,
    createKartSimulation,
    fireKartItem,
    getKartSnapshot,
    stepKartSimulation,
    stopKartSimulation,
  } = await import('./kart-physics');

  const wrapDist = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, 1 - d);
  };

  for (const track of TRACK_LIST) {
    assert.ok(track.coins.length >= 36 && track.coins.length <= 45, `${track.id}: has 36-45 coins (got ${track.coins.length})`);
    for (const c of track.coins) {
      assert.ok(c.progress >= 0.04 && c.progress <= 0.96, `${track.id}: coin ${c.id} avoids start/finish (${c.progress})`);
    }
  }

  const racers = buildKartRacers([
    { id: 'p1', name: 'Coiner', avatar: '🪙', avatarColor: '#facc15' },
    { id: 'p2', name: 'Zapper', avatar: '⚡', avatarColor: '#38bdf8' },
  ], false, 2);
  const sim = createKartSimulation({
    roomCode: 'TEST_COINS',
    raceId: 'r-coins',
    trackId: 'sunny-circuit',
    racers,
    speedClass: '150cc',
  });
  sim.countdownMs = 0;

  // Measure top speed with 0 coins vs 10 coins from the exact same straight position
  const p1 = sim.karts['p1'];
  const p2 = sim.karts['p2'];
  p2.finished = true;
  for (const c of sim.coins) c.respawnTimer = 99;
  const resetToStraight = () => {
    const s0 = sim.track.samples[2];
    p1.x = s0.x;
    p1.z = s0.z;
    p1.angle = s0.angle;
    p1.velAngle = s0.angle;
    p1.sampleIdx = 2;
    p1.lateralOffset = 0;
    p1.offRoad = false;
    p1.boostTimer = 0;
    p1.starTimer = 0;
    p1.slipstreamTimer = 0;
    p1.slipstreamActive = false;
    p1.rank = 1;
    p1.speed = 60;
  };
  resetToStraight();
  p1.coins = 0;
  for (let i = 0; i < 60; i++) stepKartSimulation(sim, 1 / 30);
  const speed0 = p1.speed;

  // Collect coins via sim.coins
  p1.coins = 0;
  p1.boostTimer = 0;
  sim.stats.coinsCollected['p1'] = 0;
  for (let i = 0; i < 12; i++) {
    const coin = sim.coins[i];
    coin.respawnTimer = 0;
    p1.x = coin.x;
    p1.z = coin.z;
    p1.airTimer = 0;
    stepKartSimulation(sim, 1 / 30);
  }
  assert.equal(p1.coins, MAX_COINS, 'coins cap at MAX_COINS (10)');
  assert.equal(sim.stats.coinsCollected['p1'], 12, 'coinsCollected tracks total pickups');
  assert.ok(sim.events.some((e) => e.type === 'coin' && e.kartId === 'p1'), 'collecting a coin emits coin event');

  const snapWithCoins = getKartSnapshot(sim);
  assert.equal(snapWithCoins.coins.length, sim.coins.length, 'snapshot exposes coins');
  assert.equal(snapWithCoins.karts.find((k) => k.id === 'p1')?.coins, MAX_COINS);

  // Measure top speed with 10 coins from the same straight position
  resetToStraight();
  p1.coins = MAX_COINS;
  for (let i = 0; i < 60; i++) stepKartSimulation(sim, 1 / 30);
  assert.ok(p1.speed > speed0 * 1.05, `10 coins increase top speed (${p1.speed.toFixed(1)} vs ${speed0.toFixed(1)})`);

  // Banana / spinout drops up to 3 coins
  p1.coins = 5;
  p1.hitImmuneTimer = 0;
  p1.starTimer = 0;
  sim.hazards.push({
    id: 'haz_coin_drop',
    kind: 'banana',
    ownerId: 'p2',
    targetId: null,
    x: p1.x,
    z: p1.z,
    vx: 0,
    vz: 0,
    angle: 0,
    progress: p1.progress,
    bouncesLeft: 0,
    ttl: 10,
    age: 2,
  });
  stepKartSimulation(sim, 1 / 30);
  assert.equal(p1.coins, 2, 'spinning out drops 3 coins');

  // Lightning drops up to 3 coins too (clamped at 0)
  p2.heldItem = 'lightning';
  fireKartItem(sim, 'p2');
  assert.equal(p1.coins, 0, 'lightning drops up to 3 coins without going negative');

  stopKartSimulation('TEST_COINS');
});

test('Kart Clash Stage 1: drift hop, drift_tier events, countdown launchRev, slipstream event, and highlights', async () => {
  const { KART_STAT_BARS, DRIFT_TIER_LABELS } = await import('./kart-shared');
  assert.equal(DRIFT_TIER_LABELS[3], 'ULTRA TURBO');
  assert.equal(KART_STAT_BARS.rocket.speed, 5);
  assert.equal(KART_STAT_BARS.bruiser.weight, 5);

  const {
    buildKartRacers,
    createKartSimulation,
    getKartSnapshot,
    stepKartSimulation,
    stopKartSimulation,
    updateKartInput,
  } = await import('./kart-physics');

  const racers = buildKartRacers([
    { id: 'p1', name: 'Drifter', avatar: '🏎️', avatarColor: '#38bdf8' },
    { id: 'p2', name: 'Draftee', avatar: '🚀', avatarColor: '#f97316' },
  ], false, 2);

  const sim = createKartSimulation({
    roomCode: 'TEST_STAGE1_MECH',
    raceId: 'r-s1',
    trackId: 'sunny-circuit',
    racers,
  });

  // Countdown revving exposes launchRev
  sim.waitingForOrientation = false;
  updateKartInput('TEST_STAGE1_MECH', 'p1', { drift: true, isHorizontal: true });
  for (let i = 0; i < 15; i++) stepKartSimulation(sim, 1 / 30);
  const countdownSnap = getKartSnapshot(sim);
  const p1Countdown = countdownSnap.karts.find((k) => k.id === 'p1')!;
  assert.ok(p1Countdown.launchRev > 0.4, `countdown revving exposes launchRev (${p1Countdown.launchRev})`);

  // Finish countdown cleanly and test hop + drift_tier (1, 2, 3)
  updateKartInput('TEST_STAGE1_MECH', 'p1', { drift: false });
  sim.countdownMs = 0;
  const p1 = sim.karts['p1'];
  const p2 = sim.karts['p2'];
  p1.speed = 40;
  updateKartInput('TEST_STAGE1_MECH', 'p1', { drift: true, steer: 0.8 });
  stepKartSimulation(sim, 1 / 30);
  assert.ok(p1.hopTimer > 0, 'initiating drift sets hopTimer');
  assert.ok(sim.events.some((e) => e.type === 'hop' && e.kartId === 'p1'), 'initiating drift emits hop event');

  const seenTiers = new Set<number>();
  for (let i = 0; i < 80; i++) {
    p1.speed = 45;
    stepKartSimulation(sim, 1 / 30);
    for (const ev of sim.events) {
      if (ev.type === 'drift_tier' && ev.kartId === 'p1' && ev.value) seenTiers.add(ev.value);
    }
  }
  assert.deepEqual([...seenTiers].sort(), [1, 2, 3], 'charging drift emits drift_tier 1, 2, and 3');
  updateKartInput('TEST_STAGE1_MECH', 'p1', { drift: false, steer: 0 });
  stepKartSimulation(sim, 1 / 30);

  // Slipstream activates slipstreaming (>0.35s) and triggers burst + slipstream event (>=1.6s)
  p2.boostTimer = 0;
  p2.slipstreamTimer = 0;
  let sawSlipstreaming = false;
  let sawSlipstreamEvent = false;
  for (let i = 0; i < 55; i++) {
    p1.x = 0;
    p1.z = 20;
    p1.angle = 0;
    p1.speed = 30;
    p2.x = 0;
    p2.z = 12;
    p2.angle = 0;
    p2.speed = 30;
    stepKartSimulation(sim, 1 / 30);
    if (getKartSnapshot(sim).karts.find((k) => k.id === 'p2')?.slipstreaming) sawSlipstreaming = true;
    if (sim.events.some((e) => e.type === 'slipstream' && e.kartId === 'p2')) sawSlipstreamEvent = true;
  }
  assert.ok(sawSlipstreaming, 'snapshot exposes slipstreaming=true during sustained tow');
  assert.ok(sawSlipstreamEvent, 'slipstream burst emits slipstream event');
  assert.ok(p2.boostTimer > 0.7, 'slipstream burst awards boost');
  stopKartSimulation('TEST_STAGE1_MECH');

  // Verify RACE_RESULTS exposes highlights via kart-clash room lifecycle
  const { roomCode, hostId } = await engine.createRoom('kart-clash');
  const k1 = (await engine.joinRoom(roomCode, 'Ace')) as { playerId: string };
  await engine.processAction(roomCode, hostId, { type: 'START_GAME' });
  await engine.processAction(roomCode, hostId, { type: 'LOCK_TRACK_VOTE' });
  const rState = (await engine.getGameState(roomCode))!;
  const aceId = engine.resolvePlayerKey(rState, k1.playerId)!;
  const { getKartSimulation } = await import('./kart-physics');
  const rSim = getKartSimulation(roomCode)!;
  rSim.stats.drifts[aceId] = 4;
  rSim.stats.coinsCollected[aceId] = 7;
  rSim.stats.tricks[aceId] = 2;

  await engine.processAction(roomCode, hostId, { type: 'FINISH_KART_RACE' });
  const doneState = (await engine.getGameState(roomCode))!;
  assert.equal(doneState.phase, 'RACE_RESULTS');
  assert.equal(doneState.hostData.highlights.length, 3, 'hostData.highlights caps at 3 non-zero highlights');
  assert.equal(doneState.hostData.highlights[0].label, 'Drift King');
  assert.equal(doneState.hostData.highlights[0].racerName, 'Ace');
  assert.deepEqual(doneState.playerData[aceId].highlights, doneState.hostData.highlights, 'playerData exposes highlights too');
  stopKartSimulation(roomCode);
});

test('Kart Clash Stage B1: longer tracks, split paths, hidden shortcuts, boost rings, mega ramps, and moving hazards', async () => {
  const {
    TRACK_LIST,
    getMovingHazardPosition,
    getTrackBoundsAt,
    sampleTrackAtProgress,
  } = await import('./kart-tracks');
  const {
    buildKartRacers,
    createKartSimulation,
    getKartSnapshot,
    stepKartSimulation,
    stopKartSimulation,
    updateKartInput,
  } = await import('./kart-physics');

  for (const t of TRACK_LIST) {
    assert.ok(t.totalLength >= 3200 && t.totalLength <= 3950, `${t.id}: totalLength ${Math.round(t.totalLength)} in [3200, 3950]`);
    assert.ok(t.splitSections.length >= 1, `${t.id}: has splitSections`);
    assert.ok(t.shortcuts.length >= 1, `${t.id}: has shortcuts`);
    assert.ok(t.features.length >= 3, `${t.id}: has track features`);
    assert.ok(t.ramps.length >= 2, `${t.id}: has >= 2 ramps`);
    assert.ok(t.coins.length >= 30, `${t.id}: has >= 30 coins`);
    for (const sc of t.shortcuts) {
      assert.equal(sc.points.length, 20, `${t.id}: shortcut ${sc.id} has 20 Bezier points`);
    }
  }

  // 1. Split section widens bounds & central divider keeps karts on chosen branch
  const sunny = TRACK_LIST.find((t) => t.id === 'sunny-circuit')!;
  const split = sunny.splitSections[0];
  const splitMid = (split.startProgress + split.endProgress) * 0.5;
  const baseBounds = getTrackBoundsAt(sunny, 0.05);
  const peakBounds = getTrackBoundsAt(sunny, splitMid);
  assert.ok(peakBounds.halfRoad > baseBounds.halfRoad + 10, 'split section widens road');
  assert.ok(peakBounds.dividerHalf > 5, 'split section opens central divider');

  const racers = buildKartRacers([{ id: 'p1', name: 'Explorer', avatar: '🏎️', avatarColor: '#38bdf8' }], false, 1);
  const sim = createKartSimulation({ roomCode: 'TEST_STAGE_B1', raceId: 'r-b1', trackId: 'canyon-driftway', racers });
  sim.countdownMs = 0;
  const p1 = sim.karts['p1'];

  // Place p1 near center inside split section on the + side -> divider pushes outside dividerHalf + 1.1
  const canyon = sim.track;
  const cSplit = canyon.splitSections[0];
  const cMid = (cSplit.startProgress + cSplit.endProgress) * 0.5;
  const cSample = sampleTrackAtProgress(canyon, cMid);
  const cBounds = getTrackBoundsAt(canyon, cMid);
  p1.x = cSample.x + cSample.nx * 1.5;
  p1.z = cSample.z + cSample.nz * 1.5;
  p1.angle = cSample.angle;
  p1.velAngle = cSample.angle;
  p1.speed = 40;
  p1.sampleIdx = Math.floor(cMid * canyon.samples.length);
  stepKartSimulation(sim, 1 / 30);
  assert.ok(Math.abs(p1.lateralOffset) >= cBounds.dividerHalf + 1.0, `central divider keeps kart out of island (lat=${p1.lateralOffset.toFixed(2)}, div=${cBounds.dividerHalf.toFixed(2)})`);

  // 2. Hidden shortcut entry, traversal without wall clamping, progress advance, and 'shortcut' event
  const sc = canyon.shortcuts[0];
  const scStart = sc.points[1];
  p1.x = scStart.x;
  p1.z = scStart.z;
  p1.angle = Math.atan2(scStart.tx, scStart.tz);
  p1.velAngle = p1.angle;
  p1.speed = 55;
  p1.sampleIdx = Math.floor(sc.entryProgress * canyon.samples.length);
  p1.boostTimer = 0;
  updateKartInput('TEST_STAGE_B1', 'p1', { steer: 0, drift: false });
  stepKartSimulation(sim, 1 / 30);
  assert.equal(p1.activeShortcutId, sc.id, 'entering shortcut wall opening activates shortcut');
  assert.ok(sim.events.some((e) => e.type === 'shortcut' && e.kartId === 'p1'), 'emits shortcut event');
  assert.equal(getKartSnapshot(sim).karts.find((k) => k.id === 'p1')?.onShortcut, true, 'snapshot exposes onShortcut=true');
  const scProgressStart = p1.progress;
  for (let i = 0; i < 8; i++) stepKartSimulation(sim, 1 / 30);
  assert.ok(p1.progress > scProgressStart, 'shortcut traversal advances progress');
  p1.activeShortcutId = null;

  // 3. boost_ring grants boost, mega_ramp launches extended jump (airDuration >= 1.4), moving_hazard spins out
  const ring = canyon.features.find((f) => f.kind === 'boost_ring')!;
  p1.x = ring.x;
  p1.z = ring.z;
  p1.airTimer = 0;
  p1.boostTimer = 0;
  stepKartSimulation(sim, 1 / 30);
  assert.ok(p1.boostTimer >= 1.3, 'boost_ring grants turbo boost');

  const mega = canyon.features.find((f) => f.kind === 'mega_ramp')!;
  const megaS = sampleTrackAtProgress(canyon, mega.progress + 0.001);
  p1.x = megaS.x;
  p1.z = megaS.z;
  p1.angle = megaS.angle;
  p1.velAngle = megaS.angle;
  p1.sampleIdx = Math.floor((mega.progress + 0.001) * canyon.samples.length);
  p1.airTimer = 0;
  p1.speed = 55;
  stepKartSimulation(sim, 1 / 30);
  assert.ok(p1.airTimer > 0 && p1.airDuration >= 1.4, `mega_ramp launches extended jump (airDuration=${p1.airDuration})`);

  const hazard = canyon.features.find((f) => f.kind === 'moving_hazard')!;
  p1.airTimer = 0;
  p1.spinOutTimer = 0;
  p1.hitImmuneTimer = 0;
  p1.starTimer = 0;
  const hPos = getMovingHazardPosition(canyon, hazard, sim.raceTimeMs / 1000);
  p1.x = hPos.x;
  p1.z = hPos.z;
  p1.angle = hPos.angle;
  p1.velAngle = hPos.angle;
  p1.speed = 0;
  stepKartSimulation(sim, 1 / 30);
  assert.ok(p1.spinOutTimer > 0, 'moving_hazard collision spins kart out');

  stopKartSimulation('TEST_STAGE_B1');
});

test('Kart Clash: driving into a shortcut opening never teleports the kart onto the path', async () => {
  const { TRACK_LIST, getTrackBoundsAt, sampleTrackAtProgress } = await import('./kart-tracks');
  const { buildKartRacers, createKartSimulation, stepKartSimulation, stopKartSimulation, updateKartInput } = await import('./kart-physics');
  for (const t of TRACK_LIST) {
    for (const sc of t.shortcuts) {
      // Inside the wall opening, a little before the path starts and out past the barrier line
      for (const [dp, f] of [[-0.003, 1.2], [-0.003, 0.6], [-0.008, 0.6], [0.004, 1.2]]) {
        const room = `SC_TP_${t.id}`;
        const sim = createKartSimulation({ roomCode: room, raceId: 'r', trackId: t.id, racers: buildKartRacers([{ id: 'p1', name: 'H', avatar: '🙂', avatarColor: '#fff' }], false, 1) });
        sim.countdownMs = 0;
        const k = sim.karts['p1'];
        const p = sc.entryProgress + dp;
        const s = sampleTrackAtProgress(t, p);
        const lat = sc.side * getTrackBoundsAt(t, p).wallWidth * f;
        k.x = s.x + s.nx * lat;
        k.z = s.z + s.nz * lat;
        k.angle = s.angle;
        k.velAngle = s.angle;
        k.speed = 50;
        k.progress = p;
        k.sampleIdx = Math.round(p * t.samples.length) % t.samples.length;
        const x0 = k.x;
        const z0 = k.z;
        updateKartInput(room, 'p1', { steer: 0 });
        stepKartSimulation(sim, 1 / 30);
        const moved = Math.hypot(k.x - x0, k.z - z0);
        assert.ok(moved < 5, `${t.id} ${sc.id} dp=${dp} f=${f}: kart moved ${moved.toFixed(1)} in one tick`);
        stopKartSimulation(room);
      }
    }
  }
});

test('Kart Clash: a hidden ramp shortcut climbs and launches at its drawn top, not at the entrance', async () => {
  const { KART_TRACKS, HIDDEN_RAMP_LAUNCH_T, HIDDEN_RAMP_LIFT, HIDDEN_RAMP_START_INDEX, HIDDEN_RAMP_TOP_INDEX, projectOntoShortcut } = await import('./kart-tracks');
  const { buildKartRacers, createKartSimulation, stepKartSimulation, stopKartSimulation, updateKartInput } = await import('./kart-physics');
  const t = KART_TRACKS['neon-starway'];
  const sc = t.shortcuts.find((s) => s.kind === 'hidden-ramp')!;
  assert.ok(sc, 'neon starway has a hidden ramp shortcut');
  // The ramp's lift is part of the path heights, so the scene, karts and coins all sit on it
  // (the hills under the path slope too, so compare neighbouring points)
  const top = sc.points[HIDDEN_RAMP_TOP_INDEX];
  const after = sc.points[HIDDEN_RAMP_TOP_INDEX + 1];
  const beforeRamp = sc.points[HIDDEN_RAMP_START_INDEX - 1];
  const rampStart = sc.points[HIDDEN_RAMP_START_INDEX];
  assert.ok(top.y - after.y > HIDDEN_RAMP_LIFT * 0.8, `the path drops away after the lip (${(top.y - after.y).toFixed(2)})`);
  assert.ok(Math.abs(rampStart.y - beforeRamp.y) < HIDDEN_RAMP_LIFT * 0.6, 'the climb starts smoothly');
  const rampCoin = t.coins.find((c) => c.x === sc.points[8].x && c.z === sc.points[8].z);
  assert.ok(rampCoin && Math.abs(rampCoin.y - sc.points[8].y) < 1e-9, 'a coin on the ramp sits on the raised path');

  const room = 'SC_RAMP';
  const sim = createKartSimulation({ roomCode: room, raceId: 'r', trackId: t.id, racers: buildKartRacers([{ id: 'p1', name: 'H', avatar: '🙂', avatarColor: '#fff' }], false, 1) });
  sim.countdownMs = 0;
  const k = sim.karts['p1'];
  const p = sc.points[1];
  k.x = p.x;
  k.z = p.z;
  k.angle = Math.atan2(p.tx, p.tz);
  k.velAngle = k.angle;
  k.speed = 50;
  k.progress = p.progress;
  k.sampleIdx = Math.round(p.progress * t.samples.length);
  let launchT: number | null = null;
  let airborneAtEntry = false;
  for (let i = 0; i < 30 * 8 && launchT === null; i++) {
    const m = projectOntoShortcut(t, k.x, k.z, { only: sc.id, reach: Infinity })!;
    const aim = sc.points[Math.min(sc.points.length - 1, Math.round(m.t * (sc.points.length - 1)) + 3)];
    let err = Math.atan2(aim.x - k.x, aim.z - k.z) - k.angle;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    updateKartInput(room, 'p1', { steer: Math.max(-1, Math.min(1, -err * 2.6)), drift: false });
    stepKartSimulation(sim, 1 / 30);
    if (i === 0) airborneAtEntry = k.airTimer > 0;
    if (k.airTimer > 0 && launchT === null) launchT = m.t;
  }
  assert.equal(airborneAtEntry, false, 'no jump at the shortcut entrance');
  assert.ok(launchT !== null, 'the ramp launches the kart');
  assert.ok(launchT! >= HIDDEN_RAMP_LAUNCH_T - 0.06, `launch happens at the ramp top (t=${launchT!.toFixed(2)})`);
  stopKartSimulation(room);
});

test('Kart Clash: a mega ramp only launches karts that drive up the drawn ramp', async () => {
  const { KART_TRACKS, getTrackBoundsAt, megaRampHalfWidth, sampleTrackAtProgress } = await import('./kart-tracks');
  const { buildKartRacers, createKartSimulation, stepKartSimulation, stopKartSimulation } = await import('./kart-physics');
  const t = KART_TRACKS['sunny-circuit'];
  const mega = t.features.find((f) => f.kind === 'mega_ramp')!;
  const p = mega.progress + 0.001;
  const b = getTrackBoundsAt(t, p);
  const s = sampleTrackAtProgress(t, p);
  const half = megaRampHalfWidth(b.halfRoad);
  assert.ok(half + 2 < b.halfRoad, 'the ramp is narrower than the road');
  for (const [lat, shouldJump] of [[0, true], [half + 2, false]] as const) {
    const room = `MEGA_${lat}`;
    const sim = createKartSimulation({ roomCode: room, raceId: 'r', trackId: t.id, racers: buildKartRacers([{ id: 'p1', name: 'H', avatar: '🙂', avatarColor: '#fff' }], false, 1) });
    sim.countdownMs = 0;
    const k = sim.karts['p1'];
    k.x = s.x + s.nx * lat;
    k.z = s.z + s.nz * lat;
    k.angle = s.angle;
    k.velAngle = s.angle;
    k.speed = 55;
    k.progress = p;
    k.sampleIdx = Math.round(p * t.samples.length);
    stepKartSimulation(sim, 1 / 30);
    assert.equal(k.airTimer > 1, shouldJump, `kart at lateral ${lat.toFixed(1)} ${shouldJump ? 'launches' : 'stays on the road'}`);
    stopKartSimulation(room);
  }
});

test('Kart Clash: Mean bots line up and take boost-gate shortcuts without needing a boost', async () => {
  const { KART_TRACKS } = await import('./kart-tracks');
  const { buildKartRacers, createKartSimulation, stepKartSimulation, stopKartSimulation } = await import('./kart-physics');
  for (const id of ['canyon-driftway', 'frostbite-peak', 'volcano-inferno'] as const) {
    const t = KART_TRACKS[id];
    const room = `BOT_SC_${id}`;
    const sim = createKartSimulation({ roomCode: room, raceId: 'r', trackId: id, racers: buildKartRacers([], true, 1), itemsMode: 'pure', botLevel: 'mean' });
    sim.countdownMs = 0;
    const bot = Object.values(sim.karts)[0];
    bot.aiPhase = 0.5; // one of the bots that likes shortcuts
    let took = false;
    for (let i = 0; i < 30 * 120 && bot.lap < 2 && !took; i++) {
      stepKartSimulation(sim, 1 / 30);
      took = sim.events.some((e) => e.type === 'shortcut' && e.kartId === bot.id);
    }
    assert.ok(took, `${t.id}: a mean bot takes the ${t.shortcuts[0].kind} shortcut on its first lap`);
    stopKartSimulation(room);
  }
});

test('Kart Clash: boost pads lie on the road, following its camber, hills and raised decks', async () => {
  const { TRACK_LIST, boostPadSurface, projectOntoTrack, roadSurfaceY } = await import('./kart-tracks');
  for (const t of TRACK_LIST) {
    for (const pad of t.boostPads) {
      const { points } = boostPadSurface(t, pad, { lift: 0 });
      for (const pt of points) {
        // Where the road actually is under this corner of the pad
        const proj = projectOntoTrack(t, pt.x, pt.z);
        const roadY = roadSurfaceY(t, proj.progress, proj.lateralOffset);
        assert.ok(Math.abs(pt.y - roadY) < 0.06, `${t.id} ${pad.id}: pad point is ${(pt.y - roadY).toFixed(2)} off the road`);
      }
    }
  }
});
