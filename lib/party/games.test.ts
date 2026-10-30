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

  // Step through "3... 2..." of countdown, then hold drift on "1" for a Rocket Start boost!
  for (let i = 0; i < 65; i++) {
    stepKartSimulation(sim!, 1 / 30);
  }
  const { POST: postKartInput } = await import('../../app/api/party/kart-input/route');
  const startAngle = sim!.karts[id1].angle;
  const res = await postKartInput(
    new Request('http://localhost/api/party/kart-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerKey: p1.playerId, steer: 0.75, drift: true, useItem: false, brake: false }),
    }),
  );
  assert.equal(res.status, 200);
  const resJson = await res.json();
  assert.equal(resJson.ok, true, '/api/party/kart-input accepts phone gyro payload');
  assert.equal(sim!.inputs[id1].steer, 0.75, 'phone gyro steer value stored on active simulation');

  for (let i = 0; i < 65; i++) {
    stepKartSimulation(sim!, 1 / 30);
  }
  assert.equal(sim!.countdownMs, 0, 'countdown finishes after 3.4s');
  assert.ok(sim!.karts[id1].boostTimer > 0, 'Rocket Start turbo boost activated');
  assert.ok(sim!.karts[id1].totalProgress > 0, 'kart advances past start line along 3D spline');
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

