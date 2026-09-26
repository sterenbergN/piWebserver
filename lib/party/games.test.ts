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
let engine: typeof import('./engine');

test.before(async () => {
  process.chdir(await fs.mkdtemp(path.join(os.tmpdir(), 'party-')));
  ({ quipClashLogic } = await import('./games/quip-clash'));
  ({ bracketBattlesLogic } = await import('./games/bracket-battles'));
  ({ fakerLogic } = await import('./games/the-faker'));
  ({ normalizePrompts, savePrompts } = await import('./prompts'));
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
  await savePrompts({ quipClash: ['Only prompt'], theFaker: ['x'], bracketBattles: ['y'], triviaQuestions: [] });
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
