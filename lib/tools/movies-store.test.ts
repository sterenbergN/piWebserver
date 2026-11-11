import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import {
  emptyUserMovieState,
  normalizeUserMovieState,
  userMovieFile,
  loadUserMovieData,
  saveUserMovieData,
  filterFilms,
  multiUserUnwatched,
  rankFilm,
  mergeUserMovieStates,
  type UserMovieState,
} from './movies-store';
import { TOP_FILMS, type Film } from '@/lib/movies-data';

test('emptyUserMovieState returns default structure', () => {
  const state = emptyUserMovieState('user123', 'Alice');
  assert.equal(state.userId, 'user123');
  assert.equal(state.username, 'Alice');
  assert.deepEqual(state.watched, []);
  assert.deepEqual(state.reviews, {});
  assert.deepEqual(state.rankings, []);
  assert.deepEqual(state.watchlist, []);
  assert.deepEqual(state.customFilms, []);
  assert.ok(typeof state.updatedAt === 'string');
});

test('normalizeUserMovieState handles null, undefined and invalid payloads', () => {
  const fromNull = normalizeUserMovieState(null, 'u1');
  assert.equal(fromNull.userId, 'u1');
  assert.deepEqual(fromNull.watched, []);

  const fromUndefined = normalizeUserMovieState(undefined, 'u1');
  assert.equal(fromUndefined.userId, 'u1');

  const fromNumber = normalizeUserMovieState(12345, 'u1');
  assert.equal(fromNumber.userId, 'u1');
  assert.deepEqual(fromNumber.watched, []);

  const fromString = normalizeUserMovieState('invalid-json', 'u1');
  assert.equal(fromString.userId, 'u1');
  assert.deepEqual(fromString.watched, []);
});

test('normalizeUserMovieState handles legacy array of watched titles', () => {
  const legacy = ['tt0111161', 'tt0068646', 'tt0111161']; // with duplicate
  const normalized = normalizeUserMovieState(legacy, 'u2', 'Bob');

  assert.equal(normalized.userId, 'u2');
  assert.equal(normalized.username, 'Bob');
  assert.deepEqual(normalized.watched, ['tt0111161', 'tt0068646']);
  assert.deepEqual(normalized.reviews, {});
  assert.deepEqual(normalized.rankings, []);
  assert.deepEqual(normalized.watchlist, []);
});

test('normalizeUserMovieState sanitizes reviews and ensures reviewed films are marked watched', () => {
  const raw = {
    userId: 'u3',
    username: 'Charlie',
    watched: ['tt0111161'],
    reviews: {
      tt0068646: {
        rating: 9.5,
        review: 'Masterpiece',
        watchedDate: '2026-05-01',
        favorite: true,
        tags: ['classic', 'mafia'],
      },
      tt0468569: {
        rating: 15, // Out of bounds, should clamp to 10
        review: 'Best superhero film',
      },
      invalid: null,
    },
    rankings: ['tt0111161', 'tt0068646'],
    watchlist: ['tt0167260'],
  };

  const state = normalizeUserMovieState(raw, 'u3');
  assert.equal(state.userId, 'u3');
  assert.equal(state.username, 'Charlie');
  // tt0068646 and tt0468569 must be included in watched since they have reviews
  assert.ok(state.watched.includes('tt0111161'));
  assert.ok(state.watched.includes('tt0068646'));
  assert.ok(state.watched.includes('tt0468569'));

  assert.equal(state.reviews['tt0068646'].rating, 9.5);
  assert.equal(state.reviews['tt0068646'].favorite, true);
  assert.deepEqual(state.reviews['tt0068646'].tags, ['classic', 'mafia']);
  assert.equal(state.reviews['tt0468569'].rating, 10);
});

test('Adding and updating reviews, updating rankings array', () => {
  let state = emptyUserMovieState('u4');

  // Add review
  state = normalizeUserMovieState({
    ...state,
    reviews: {
      tt0111161: {
        rating: 9.0,
        review: 'Great',
        watchedDate: '2026-01-01',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    },
  }, 'u4');
  assert.equal(state.reviews['tt0111161'].rating, 9.0);
  assert.ok(state.watched.includes('tt0111161'));

  // Update review
  state = normalizeUserMovieState({
    ...state,
    reviews: {
      ...state.reviews,
      tt0111161: {
        rating: 9.8,
        review: 'All-time best',
        watchedDate: '2026-01-02',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    },
  }, 'u4');
  assert.equal(state.reviews['tt0111161'].rating, 9.8);
  assert.equal(state.reviews['tt0111161'].review, 'All-time best');

  // Update rankings
  state = rankFilm(state, 'tt0111161', 1);
  assert.deepEqual(state.rankings, ['tt0111161']);

  state = rankFilm(state, 'tt0068646', 1); // Insert at 1st place
  assert.deepEqual(state.rankings, ['tt0068646', 'tt0111161']);

  state = rankFilm(state, 'tt0468569', 2); // Insert at 2nd place
  assert.deepEqual(state.rankings, ['tt0068646', 'tt0468569', 'tt0111161']);

  // Move 3rd place film to 1st place
  state = rankFilm(state, 'tt0111161', 1);
  assert.deepEqual(state.rankings, ['tt0111161', 'tt0068646', 'tt0468569']);
});

test('filterFilms by genre', () => {
  const sampleFilms: Film[] = [
    { id: '1', title: 'Action Film', year: 2020, rating: 8.0, genres: ['Action', 'Thriller'], runtime: 120 },
    { id: '2', title: 'Pure Drama', year: 2018, rating: 8.5, genres: ['Drama'], runtime: 110 },
    { id: '3', title: 'Comedy Drama', year: 1995, rating: 7.9, genres: ['Comedy', 'Drama'], runtime: 95 },
  ];

  const action = filterFilms(sampleFilms, { genre: 'Action' });
  assert.equal(action.length, 1);
  assert.equal(action[0].id, '1');

  const drama = filterFilms(sampleFilms, { genre: 'Drama' });
  assert.equal(drama.length, 2);

  // Case insensitive
  const dramaLower = filterFilms(sampleFilms, { genre: 'drama' });
  assert.equal(dramaLower.length, 2);

  // Array of genres
  const multi = filterFilms(sampleFilms, { genres: ['Comedy', 'Action'] });
  assert.equal(multi.length, 2);
});

test('filterFilms by era', () => {
  const sampleFilms: Film[] = [
    { id: '1', title: 'Classic Film', year: 1954, rating: 8.6, genres: ['Drama'], runtime: 100 },
    { id: '2', title: 'Seventies', year: 1974, rating: 9.0, genres: ['Crime'], runtime: 175 },
    { id: '3', title: 'Eighties', year: 1985, rating: 8.5, genres: ['Sci-Fi'], runtime: 116 },
    { id: '4', title: 'Nineties', year: 1994, rating: 9.3, genres: ['Drama'], runtime: 142 },
    { id: '5', title: 'Modern', year: 2023, rating: 8.4, genres: ['Action'], runtime: 150 },
  ];

  const classic = filterFilms(sampleFilms, { era: 'classic' });
  assert.deepEqual(classic.map((f) => f.id), ['1']);

  const seventies = filterFilms(sampleFilms, { era: '70s' });
  assert.deepEqual(seventies.map((f) => f.id), ['2']);

  const eighties = filterFilms(sampleFilms, { era: '1980s' });
  assert.deepEqual(eighties.map((f) => f.id), ['3']);

  const nineties = filterFilms(sampleFilms, { era: '90s' });
  assert.deepEqual(nineties.map((f) => f.id), ['4']);

  const modern = filterFilms(sampleFilms, { era: 'modern' });
  assert.deepEqual(modern.map((f) => f.id), ['5']);

  const customRange = filterFilms(sampleFilms, { era: [1970, 1989] });
  assert.deepEqual(customRange.map((f) => f.id), ['2', '3']);
});

test('filterFilms by runtime', () => {
  const sampleFilms: Film[] = [
    { id: '1', title: 'Short Film', year: 2020, rating: 8.0, genres: ['Animation'], runtime: 85 },
    { id: '2', title: 'Medium Film', year: 2020, rating: 8.0, genres: ['Drama'], runtime: 115 },
    { id: '3', title: 'Long Film', year: 2020, rating: 8.0, genres: ['Adventure'], runtime: 180 },
  ];

  const max90 = filterFilms(sampleFilms, { runtime: 90 });
  assert.deepEqual(max90.map((f) => f.id), ['1']);

  const under90Str = filterFilms(sampleFilms, { runtime: '<90' });
  assert.deepEqual(under90Str.map((f) => f.id), ['1']);

  const midRange = filterFilms(sampleFilms, { runtime: [90, 150] });
  assert.deepEqual(midRange.map((f) => f.id), ['2']);

  const over150 = filterFilms(sampleFilms, { runtime: '>150' });
  assert.deepEqual(over150.map((f) => f.id), ['3']);
});

test('filterFilms by rating', () => {
  const sampleFilms: Film[] = [
    { id: '1', title: 'Good', year: 2020, rating: 8.0, genres: ['Drama'], runtime: 100 },
    { id: '2', title: 'Great', year: 2020, rating: 8.5, genres: ['Drama'], runtime: 100 },
    { id: '3', title: 'Masterpiece', year: 2020, rating: 9.2, genres: ['Drama'], runtime: 100 },
  ];

  const min85 = filterFilms(sampleFilms, { rating: 8.5 });
  assert.deepEqual(min85.map((f) => f.id), ['2', '3']);

  const min90 = filterFilms(sampleFilms, { minRating: 9.0 });
  assert.deepEqual(min90.map((f) => f.id), ['3']);
});

test('filterFilms by pool', () => {
  const userState: UserMovieState = {
    userId: 'u1',
    watched: ['1', '2'],
    reviews: {},
    rankings: [],
    watchlist: ['3'],
    customFilms: [
      { id: 'c1', title: 'Custom Indy', year: 2024, rating: 8.1, genres: ['Indie'], runtime: 90 },
    ],
    updatedAt: new Date().toISOString(),
  };

  const poolFilms: Film[] = [
    { id: '1', title: 'Film 1', year: 2020, rating: 8.0, genres: ['Drama'], runtime: 100 },
    { id: '2', title: 'Film 2', year: 2020, rating: 8.2, genres: ['Drama'], runtime: 100 },
    { id: '3', title: 'Film 3', year: 2020, rating: 8.4, genres: ['Drama'], runtime: 100 },
    { id: '4', title: 'Film 4', year: 2020, rating: 8.6, genres: ['Drama'], runtime: 100 },
    { id: 'c1', title: 'Custom Indy', year: 2024, rating: 8.1, genres: ['Indie'], runtime: 90 },
  ];

  const watched = filterFilms(poolFilms, { pool: 'watched', userState });
  assert.deepEqual(watched.map((f) => f.id), ['1', '2']);

  const unwatched = filterFilms(poolFilms, { pool: 'unwatched', userState });
  assert.deepEqual(unwatched.map((f) => f.id), ['3', '4', 'c1']);

  const watchlist = filterFilms(poolFilms, { pool: 'watchlist', userState });
  assert.deepEqual(watchlist.map((f) => f.id), ['3']);

  const custom = filterFilms(poolFilms, { pool: 'custom', userState });
  assert.deepEqual(custom.map((f) => f.id), ['c1']);
});

test('multiUserUnwatched returns intersection of unwatched films across all users', () => {
  const allFilms: Film[] = [
    { id: 'tt1', title: 'Film 1', year: 2020, rating: 8.0, genres: ['Drama'], runtime: 100 },
    { id: 'tt2', title: 'Film 2', year: 2020, rating: 8.0, genres: ['Drama'], runtime: 100 },
    { id: 'tt3', title: 'Film 3', year: 2020, rating: 8.0, genres: ['Drama'], runtime: 100 },
    { id: 'tt4', title: 'Film 4', year: 2020, rating: 8.0, genres: ['Drama'], runtime: 100 },
  ];

  const userA: UserMovieState = {
    ...emptyUserMovieState('userA'),
    watched: ['tt1', 'tt2'],
  };

  const userB: UserMovieState = {
    ...emptyUserMovieState('userB'),
    watched: ['tt2', 'tt3'],
  };

  // Film tt1 is watched by A.
  // Film tt2 is watched by both.
  // Film tt3 is watched by B.
  // Film tt4 is watched by NEITHER -> this is in multiUserUnwatched!
  const unwatchedBoth = multiUserUnwatched(allFilms, [userA, userB]);
  assert.deepEqual(unwatchedBoth.map((f) => f.id), ['tt4']);

  // If only userA is in the group, unwatched is tt3 and tt4
  const unwatchedA = multiUserUnwatched(allFilms, [userA]);
  assert.deepEqual(unwatchedA.map((f) => f.id), ['tt3', 'tt4']);

  // If user list is empty, all films are unwatched
  const unwatchedEmpty = multiUserUnwatched(allFilms, []);
  assert.equal(unwatchedEmpty.length, 4);
});

test('mergeUserMovieStates cleanly merges guest and base states', () => {
  const base: UserMovieState = {
    userId: 'uBase',
    username: 'BaseUser',
    watched: ['1', '2'],
    reviews: {
      '1': { rating: 8, watchedDate: '2026-01-01', updatedAt: '2026-01-01T00:00:00Z' },
    },
    rankings: ['1', '2'],
    watchlist: ['3'],
    customFilms: [],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const guest: Partial<UserMovieState> = {
    watched: ['2', '3'],
    reviews: {
      '1': { rating: 9, review: 'Updated by guest', watchedDate: '2026-02-01', updatedAt: '2026-02-01T00:00:00Z' },
      '3': { rating: 7, watchedDate: '2026-02-01', updatedAt: '2026-02-01T00:00:00Z' },
    },
    rankings: ['3', '1'],
    watchlist: ['4'],
  };

  const merged = mergeUserMovieStates(base, guest);
  // Watched union
  assert.ok(merged.watched.includes('1'));
  assert.ok(merged.watched.includes('2'));
  assert.ok(merged.watched.includes('3'));

  // Review for 1 updated because guest's updatedAt is newer
  assert.equal(merged.reviews['1'].rating, 9);
  assert.equal(merged.reviews['1'].review, 'Updated by guest');
  assert.equal(merged.reviews['3'].rating, 7);

  // Rankings: base '1', '2' preserved, '3' appended
  assert.deepEqual(merged.rankings, ['1', '2', '3']);

  // Watchlist: '3', '4'
  assert.ok(merged.watchlist.includes('3'));
  assert.ok(merged.watchlist.includes('4'));
});

test('loadUserMovieData and saveUserMovieData persist and reload correctly', async () => {
  const testUserId = 'test-unit-user-movies';
  const file = userMovieFile(testUserId);
  try {
    const initialState = emptyUserMovieState(testUserId, 'Tester');
    initialState.watched = ['tt0111161'];
    initialState.reviews['tt0111161'] = {
      rating: 9.3,
      review: 'Classic prison drama',
      watchedDate: '2026-03-01',
      updatedAt: new Date().toISOString(),
    };
    initialState.rankings = ['tt0111161'];

    await saveUserMovieData(testUserId, initialState);

    const loaded = await loadUserMovieData(testUserId);
    assert.equal(loaded.userId, testUserId);
    assert.equal(loaded.username, 'Tester');
    assert.deepEqual(loaded.watched, ['tt0111161']);
    assert.equal(loaded.reviews['tt0111161'].rating, 9.3);
    assert.deepEqual(loaded.rankings, ['tt0111161']);
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
});

test('API route GET and POST functionality', async () => {
  const { GET: moviesGET, POST: moviesPOST } = await import('@/app/api/tools/movies/user/route');
  const { createWorkoutAuthToken } = await import('@/lib/security/auth');
  const { NextRequest } = await import('next/server');

  // 1. Signed out GET returns authenticated: false
  const signedOutReq = new NextRequest('http://localhost/api/tools/movies/user');
  const resSignedOut = await moviesGET(signedOutReq);
  const dataSignedOut = await resSignedOut.json();
  assert.equal(dataSignedOut.success, true);
  assert.equal(dataSignedOut.authenticated, false);

  // 2. Signed out POST returns 401
  const signedOutPostReq = new NextRequest('http://localhost/api/tools/movies/user', {
    method: 'POST',
    body: JSON.stringify({ watched: ['tt0111161'] }),
    headers: { 'content-type': 'application/json' },
  });
  const resPost401 = await moviesPOST(signedOutPostReq);
  assert.equal(resPost401.status, 401);

  // 3. Signed in GET returns user's state and users list
  const testUserId = 'test-api-movie-user';
  const token = createWorkoutAuthToken(testUserId);
  const userFile = userMovieFile(testUserId);

  try {
    const signedInReq = new NextRequest('http://localhost/api/tools/movies/user', {
      headers: { cookie: `workout_auth=${token}` },
    });
    const resSignedIn = await moviesGET(signedInReq);
    const dataSignedIn = await resSignedIn.json();
    assert.equal(dataSignedIn.success, true);
    assert.equal(dataSignedIn.authenticated, true);
    assert.ok(Array.isArray(dataSignedIn.users));
    assert.equal(dataSignedIn.state.userId, testUserId);

    // 4. Signed in POST updates state
    const signedInPostReq = new NextRequest('http://localhost/api/tools/movies/user', {
      method: 'POST',
      body: JSON.stringify({
        watched: ['tt0111161', 'tt0068646'],
        rankings: ['tt0111161'],
      }),
      headers: {
        'content-type': 'application/json',
        cookie: `workout_auth=${token}`,
      },
    });
    const resPost = await moviesPOST(signedInPostReq);
    const dataPost = await resPost.json();
    assert.equal(dataPost.success, true);
    assert.deepEqual(dataPost.state.watched, ['tt0111161', 'tt0068646']);
    assert.deepEqual(dataPost.state.rankings, ['tt0111161']);

    // 5. Signed in POST with guestState merges state
    const mergeReq = new NextRequest('http://localhost/api/tools/movies/user', {
      method: 'POST',
      body: JSON.stringify({
        guestState: {
          watched: ['tt0468569'],
          reviews: {
            tt0468569: { rating: 9, watchedDate: '2026-06-01' },
          },
        },
      }),
      headers: {
        'content-type': 'application/json',
        cookie: `workout_auth=${token}`,
      },
    });
    const resMerge = await moviesPOST(mergeReq);
    const dataMerge = await resMerge.json();
    assert.equal(dataMerge.success, true);
    assert.ok(dataMerge.state.watched.includes('tt0111161'));
    assert.ok(dataMerge.state.watched.includes('tt0468569'));
    assert.equal(dataMerge.state.reviews['tt0468569'].rating, 9);

    // 6. Signed in GET with ?userId=<targetId> returns target user's public state
    const targetUserId = 'target-user-test';
    const targetFile = userMovieFile(targetUserId);
    try {
      await saveUserMovieData(targetUserId, {
        ...emptyUserMovieState(targetUserId, 'TargetUser'),
        watched: ['tt0167260'],
      });

      const queryReq = new NextRequest(`http://localhost/api/tools/movies/user?userId=${targetUserId}`, {
        headers: { cookie: `workout_auth=${token}` },
      });
      const resQuery = await moviesGET(queryReq);
      const dataQuery = await resQuery.json();
      assert.equal(dataQuery.success, true);
      assert.equal(dataQuery.authenticated, true);
      assert.equal(dataQuery.state.userId, targetUserId);
      assert.deepEqual(dataQuery.state.watched, ['tt0167260']);
    } finally {
      await fs.rm(targetFile, { force: true }).catch(() => {});
    }
  } finally {
    await fs.rm(userFile, { force: true }).catch(() => {});
  }
});
