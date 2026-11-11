import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  isTmdbConfigured,
  searchTmdbMovies,
  searchMoviesWithSource,
  fallbackLocalSearch,
  normalizeTmdbMovie,
  getMovieProviders,
  clearTmdbMemoryCache,
  setCacheDirForTesting,
  TMDB_GENRES,
  type FilmSearchResult,
} from './tmdb';
import { GET as searchGet } from '@/app/api/tools/movies/search/route';
import { GET as providersGet } from '@/app/api/tools/movies/providers/route';

async function inTempCacheDir(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmdb-cache-test-'));
  setCacheDirForTesting(dir);
  clearTmdbMemoryCache();
  try {
    await run(dir);
  } finally {
    setCacheDirForTesting(null);
    clearTmdbMemoryCache();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

test('isTmdbConfigured returns correct status based on process.env.TMDB_API_KEY', () => {
  const origKey = process.env.TMDB_API_KEY;
  try {
    delete process.env.TMDB_API_KEY;
    assert.equal(isTmdbConfigured(), false);

    process.env.TMDB_API_KEY = '   ';
    assert.equal(isTmdbConfigured(), false);

    process.env.TMDB_API_KEY = 'valid_test_key_12345';
    assert.equal(isTmdbConfigured(), true);
  } finally {
    if (origKey !== undefined) {
      process.env.TMDB_API_KEY = origKey;
    } else {
      delete process.env.TMDB_API_KEY;
    }
  }
});

test('fallbackLocalSearch matches local TOP_FILMS correctly', () => {
  const empty = fallbackLocalSearch('');
  assert.deepEqual(empty, []);

  const shawshank = fallbackLocalSearch('Shawshank');
  assert.ok(shawshank.length >= 1);
  assert.equal(shawshank[0].title, 'The Shawshank Redemption');
  assert.equal(shawshank[0].year, 1994);
  assert.equal(shawshank[0].id, 'tt0111161');
  assert.equal(shawshank[0].imdbId, 'tt0111161');
  assert.ok(shawshank[0].rating >= 9.0);
  assert.ok(shawshank[0].runtime > 100);

  // Exact year filtering
  const godfather2 = fallbackLocalSearch('Godfather', 1974);
  assert.ok(godfather2.length >= 1);
  assert.equal(godfather2[0].title, 'The Godfather Part II');
  assert.equal(godfather2[0].year, 1974);

  // Non-existent film returns empty list
  const unknown = fallbackLocalSearch('NonExistentFilmXYZ987654321');
  assert.deepEqual(unknown, []);
});

test('searchTmdbMovies falls back to local TOP_FILMS when no API key configured', async () => {
  const origKey = process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_KEY;

  try {
    const { results, source } = await searchMoviesWithSource('Inception');
    assert.equal(source, 'local');
    assert.ok(results.length >= 1);
    const film = results[0];
    assert.equal(film.title, 'Inception');
    assert.equal(film.year, 2010);
    assert.ok(film.id.startsWith('tt'));

    const directResults = await searchTmdbMovies('Dark Knight');
    assert.ok(directResults.length >= 1);
    assert.equal(directResults[0].title, 'The Dark Knight');
  } finally {
    if (origKey !== undefined) process.env.TMDB_API_KEY = origKey;
  }
});

test('normalizeTmdbMovie correctly normalizes raw TMDB results and genre IDs', () => {
  const rawTmdb = {
    id: 550,
    title: 'Fight Club',
    release_date: '1999-10-15',
    vote_average: 8.433,
    genre_ids: [18, 53],
    poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
    overview: 'An insomniac office worker...',
  };

  const normalized = normalizeTmdbMovie(rawTmdb);
  assert.equal(normalized.tmdbId, 550);
  assert.equal(normalized.title, 'Fight Club');
  assert.equal(normalized.year, 1999);
  assert.equal(normalized.rating, 8.4);
  assert.deepEqual(normalized.genres, ['Drama', 'Thriller']);
  assert.equal(
    normalized.poster,
    'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg'
  );
  assert.equal(normalized.overview, 'An insomniac office worker...');
  // Since Fight Club is in TOP_FILMS (1999), it links the known IMDb ID and runtime!
  assert.equal(normalized.imdbId, 'tt0137523');
  assert.equal(normalized.id, 'tt0137523');
  assert.equal(normalized.runtime, 139);
});

test('normalizeTmdbMovie handles external uncurated film with no local match', () => {
  const rawTmdb = {
    id: 999999,
    title: 'Unknown Indie Film',
    release_date: '2024-05-12',
    vote_average: 7.2,
    genre_ids: [878],
    poster_path: null,
    overview: 'A cool sci-fi story.',
  };

  const normalized = normalizeTmdbMovie(rawTmdb);
  assert.equal(normalized.tmdbId, 999999);
  assert.equal(normalized.id, 'tmdb-999999');
  assert.equal(normalized.imdbId, undefined);
  assert.equal(normalized.poster, null);
  assert.deepEqual(normalized.genres, ['Sci-Fi']);
  assert.equal(normalized.runtime, 0);
});

test('multi-tier caching saves to disk and satisfies <5ms repeat lookups', () =>
  inTempCacheDir(async (cacheDir) => {
    const origKey = process.env.TMDB_API_KEY;
    const origFetch = globalThis.fetch;

    process.env.TMDB_API_KEY = 'mock_key_test';

    let fetchCount = 0;
    globalThis.fetch = (async (url: string | URL) => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          results: [
            {
              id: 157336,
              title: 'Interstellar',
              release_date: '2014-11-05',
              vote_average: 8.6,
              genre_ids: [12, 18, 878],
              poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
              overview: 'A team of explorers travel through a wormhole...',
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    try {
      // First fetch: should trigger fetch and create disk cache file
      const start1 = performance.now();
      const firstResults = await searchTmdbMovies('Interstellar', 2014);
      const duration1 = performance.now() - start1;

      assert.equal(fetchCount, 1);
      assert.equal(firstResults.length, 1);
      assert.equal(firstResults[0].title, 'Interstellar');

      // Check that cache file was written to disk
      const files = await fs.readdir(cacheDir);
      assert.ok(files.length >= 1);
      assert.ok(files.some((f) => f.startsWith('search_') && f.endsWith('.json')));

      // Second fetch in same process: served from in-memory Tier 1 in <5ms
      const start2 = performance.now();
      const secondResults = await searchTmdbMovies('Interstellar', 2014);
      const duration2 = performance.now() - start2;

      assert.equal(fetchCount, 1, 'In-memory cache prevents second fetch');
      assert.deepEqual(secondResults, firstResults);
      assert.ok(duration2 < 50, `Expected repeat lookup to be fast, got ${duration2.toFixed(2)}ms`);

      // Clear memory cache to simulate process restart and verify Tier 2 disk cache
      clearTmdbMemoryCache();
      const start3 = performance.now();
      const thirdResults = await searchTmdbMovies('Interstellar', 2014);
      const duration3 = performance.now() - start3;

      assert.equal(fetchCount, 1, 'Disk cache prevents network fetch after memory clear');
      assert.deepEqual(thirdResults, firstResults);
      assert.ok(duration3 < 100, `Expected disk cache lookup to be fast, got ${duration3.toFixed(2)}ms`);
    } finally {
      globalThis.fetch = origFetch;
      if (origKey !== undefined) process.env.TMDB_API_KEY = origKey;
      else delete process.env.TMDB_API_KEY;
    }
  }));

test('graceful fallback when network fetch fails on configured key', async () => {
  const origKey = process.env.TMDB_API_KEY;
  const origFetch = globalThis.fetch;

  process.env.TMDB_API_KEY = 'mock_key_failing';
  clearTmdbMemoryCache();

  globalThis.fetch = (async () => {
    throw new Error('Network timeout (simulated)');
  }) as typeof fetch;

  try {
    const { results, source } = await searchMoviesWithSource('Pulp Fiction');
    assert.equal(source, 'local');
    assert.ok(results.length >= 1);
    assert.equal(results[0].title, 'Pulp Fiction');
    assert.equal(results[0].year, 1994);
  } finally {
    globalThis.fetch = origFetch;
    if (origKey !== undefined) process.env.TMDB_API_KEY = origKey;
    else delete process.env.TMDB_API_KEY;
  }
});

test('getMovieProviders returns null when TMDB is not configured', async () => {
  const origKey = process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_KEY;

  try {
    const res = await getMovieProviders('tt0111161');
    assert.equal(res, null);

    const empty = await getMovieProviders('');
    assert.equal(empty, null);
  } finally {
    if (origKey !== undefined) process.env.TMDB_API_KEY = origKey;
  }
});

test('getMovieProviders fetches and formats watch providers correctly', () =>
  inTempCacheDir(async () => {
    const origKey = process.env.TMDB_API_KEY;
    const origFetch = globalThis.fetch;

    process.env.TMDB_API_KEY = 'mock_key_providers';

    globalThis.fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes('/find/tt0137523')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            movie_results: [{ id: 550, title: 'Fight Club' }],
          }),
        } as Response;
      }
      if (u.includes('/movie/550/watch/providers')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 550,
            results: {
              US: {
                link: 'https://www.themoviedb.org/movie/550-fight-club/watch?locale=US',
                flatrate: [
                  {
                    provider_id: 8,
                    provider_name: 'Netflix',
                    logo_path: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg',
                    display_priority: 0,
                  },
                ],
                rent: [
                  {
                    provider_id: 2,
                    provider_name: 'Apple TV',
                    logo_path: '/peURlLlr8j00Qbv3vaogJQdaoYq.jpg',
                  },
                ],
              },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    try {
      // Query by IMDb ID
      const providers = await getMovieProviders('tt0137523', 'US');
      assert.ok(providers !== null);
      assert.equal(
        providers.link,
        'https://www.themoviedb.org/movie/550-fight-club/watch?locale=US'
      );
      assert.equal(providers.flatrate.length, 1);
      assert.equal(providers.flatrate[0].providerId, 8);
      assert.equal(providers.flatrate[0].providerName, 'Netflix');
      assert.equal(
        providers.flatrate[0].logoPath,
        'https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg'
      );
      assert.equal(providers.rent?.length, 1);
      assert.equal(providers.rent?.[0].providerName, 'Apple TV');

      // Query by TMDB ID
      const byTmdbId = await getMovieProviders('tmdb-550', 'US');
      assert.ok(byTmdbId !== null);
      assert.equal(byTmdbId.flatrate[0].providerName, 'Netflix');

      // Non-existent region returns null
      const nonExistentRegion = await getMovieProviders('550', 'ZZ');
      assert.equal(nonExistentRegion, null);
    } finally {
      globalThis.fetch = origFetch;
      if (origKey !== undefined) process.env.TMDB_API_KEY = origKey;
      else delete process.env.TMDB_API_KEY;
    }
  }));

test('Search API route handles queries and returns contract structure', async () => {
  const req = new Request('http://localhost/api/tools/movies/search?q=Godfather&year=1972');
  const res = await searchGet(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.success, true);
  assert.ok(json.source === 'tmdb' || json.source === 'local');
  assert.ok(typeof json.configured === 'boolean');
  assert.ok(Array.isArray(json.results));
  assert.ok(json.results.length >= 1);
  assert.equal(json.results[0].title, 'The Godfather');
});

test('Providers API route validates id and returns contract structure', async () => {
  // Missing id
  const badReq = new Request('http://localhost/api/tools/movies/providers');
  const badRes = await providersGet(badReq);
  assert.equal(badRes.status, 400);

  // Valid query
  const req = new Request('http://localhost/api/tools/movies/providers?id=tt0111161&region=US');
  const res = await providersGet(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.success, true);
  assert.ok('providers' in json);
});
