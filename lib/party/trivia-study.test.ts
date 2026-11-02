import test from 'node:test';
import { strict as assert } from 'node:assert';
import { triviaDeathLogic } from './games/trivia-death';
import { hostView } from './engine';
import { canPause, pauseGame, resumeGame } from './pause';
import type { GameState } from './types';

// Trivia Death with a host's own study questions.

const deck = Array.from({ length: 31 }, (_, i) => ({
  question: `Study question ${i}`,
  choices: ['Wrong', 'Right', 'Also wrong'],
  answer: 1,
  category: 'Cardio',
  explanation: `Because of ${i}`,
  studyId: `q${i}`,
  choiceMap: [2, 0, 1],
}));

function room(study = true): GameState {
  const players = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, { id, name: id, score: 0, connected: true, avatarColor: '#000' }]));
  return {
    roomCode: 'ABCD', gameType: 'trivia-death', phase: 'LOBBY', players, playerOrder: ['a', 'b', 'c'], hostId: 'h',
    hostData: {}, playerData: {}, gameData: {},
    ...(study ? { studyDeck: deck, settings: { study: { count: 31, seconds: 60 } } } : {}),
  } as unknown as GameState;
}

test('her deck and timer replace the usual questions', async () => {
  const state = room();
  await triviaDeathLogic.onStart(state);
  assert.equal(state.gameData.questions, deck);
  assert.equal(state.phase, 'QUESTION');
  assert.equal(state.hostData.question, 'Study question 0');
  assert.equal(state.hostData.timerDuration, 60);
  assert.equal(state.playerData.a.timerDuration, 60);
  assert.equal(state.hostData.explanation, undefined, 'no explanation before the answers are in');
  assert.equal(state.playerData.a.study, undefined);
});

test('the reveal explains itself, stays up longer, and tells each phone what to save', async () => {
  const state = room();
  await triviaDeathLogic.onStart(state);
  await triviaDeathLogic.processAction(state, 'a', { type: 'SUBMIT_TRIVIA_ANSWER', answer: 1 });
  await triviaDeathLogic.processAction(state, 'b', { type: 'SUBMIT_TRIVIA_ANSWER', answer: 0 });
  await triviaDeathLogic.processAction(state, 'h', { type: 'FORCE_TRIVIA_REVEAL' });
  assert.equal(state.phase, 'QUESTION_RESULTS');
  assert.equal(state.hostData.explanation, 'Because of 0');
  assert.equal(state.hostData.timerDuration, 15);
  assert.equal(state.playerData.a.explanation, 'Because of 0');
  // The choices were shuffled, so answers are sent back as the original choice.
  assert.deepEqual(state.playerData.a.study, { questionId: 'q0', answer: [0], round: 1 });
  assert.deepEqual(state.playerData.b.study, { questionId: 'q0', answer: [2], round: 1 });
  assert.deepEqual(state.playerData.c.study, { questionId: 'q0', answer: [], round: 1 }, 'no answer counts as missed');
});

test('a regular game is unchanged', async () => {
  const state = room(false);
  await triviaDeathLogic.onStart(state);
  assert.equal(state.hostData.timerDuration, 15);
  await triviaDeathLogic.processAction(state, 'h', { type: 'FORCE_TRIVIA_REVEAL' });
  assert.equal(state.hostData.timerDuration, 6);
  assert.equal(state.hostData.explanation, undefined);
  assert.equal(state.playerData.a.study, undefined);
});

test('a pause takes the deadline away, and resuming gives back the time that was left', async () => {
  const state = room();
  await triviaDeathLogic.onStart(state);
  const { timerStart, autoAdvanceAt, autoAdvanceAction } = state.hostData;
  assert.ok(canPause(state));

  pauseGame(state, timerStart + 10_000);
  assert.equal(state.hostData.autoAdvanceAt, undefined, 'nothing left for a timer to fire');
  assert.equal(state.hostData.autoAdvanceAction, undefined, 'and nothing for Skip to send');
  assert.equal(state.hostData.question, 'Study question 0', 'the question stays on screen');
  assert.ok(!canPause(state), 'already paused');

  resumeGame(state, timerStart + 70_000);
  assert.equal(state.paused, undefined);
  assert.equal(state.hostData.autoAdvanceAt, autoAdvanceAt + 60_000);
  assert.equal(state.hostData.autoAdvanceAction, autoAdvanceAction);
  assert.equal(state.hostData.timerStart, timerStart + 60_000);
  assert.equal(state.playerData.a.timerStart, state.hostData.timerStart);
});

test('only a timed moment in Trivia Death can pause', async () => {
  const lobby = room();
  assert.ok(!canPause(lobby), 'no clock in the lobby');
  const state = room();
  await triviaDeathLogic.onStart(state);
  assert.ok(!canPause({ ...state, gameType: 'quip-clash' }), 'other games keep running');
});

test('the TV never gets the deck itself', () => {
  const view = hostView(room()) as unknown as Record<string, unknown>;
  assert.equal(view.studyDeck, undefined);
  assert.deepEqual((view.settings as { study: unknown }).study, { count: 31, seconds: 60 });
});
