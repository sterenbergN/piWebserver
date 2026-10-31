import test from 'node:test';
import { strict as assert } from 'node:assert';
import { triviaDeathLogic } from './games/trivia-death';
import { hostView } from './engine';
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

test('the TV never gets the deck itself', () => {
  const view = hostView(room()) as unknown as Record<string, unknown>;
  assert.equal(view.studyDeck, undefined);
  assert.deepEqual((view.settings as { study: unknown }).study, { count: 31, seconds: 60 });
});
