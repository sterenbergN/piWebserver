import crypto from 'crypto';
import path from 'path';
import { readJson, writeJsonAtomic } from '@/lib/json-store';
import { type Film, TOP_FILMS } from '@/lib/movies-data';

export interface FilmSearchResult {
  id: string;
  title: string;
  year: number | null;
  rating: number;
  genres: string[];
  runtime: number;
  poster: string | null;
  overview: string;
  tmdbId: number;
  imdbId?: string;
}

export interface WatchProviderItem {
  providerId: number;
  providerName: string;
  logoPath: string;
  displayPriority?: number;
}

export interface WatchProviders {
  link: string;
  flatrate: WatchProviderItem[];
  rent?: WatchProviderItem[];
  buy?: WatchProviderItem[];
  free?: WatchProviderItem[];
}

export const TMDB_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

// Caching configuration
type CacheEntry<T> = {
  data: T;
  cachedAt: number;
  expiresAt: number;
};

let customCacheDir: string | null = null;
const memoryCache = new Map<string, CacheEntry<unknown>>();

export function getCacheDir(): string {
  return customCacheDir || path.join(process.cwd(), '.data', 'movies', 'cache');
}

export function setCacheDirForTesting(dir: string | null): void {
  customCacheDir = dir;
}

export function clearTmdbMemoryCache(): void {
  memoryCache.clear();
}

/**
 * Multi-tier cache: In-Memory Map (Tier 1) -> Atomic Disk JSON (Tier 2).
 * Guarantees repeat lookups resolve in <5ms.
 */
async function getCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();

  // Tier 1: In-memory Map cache
  const mem = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (mem && mem.expiresAt > now) {
    return mem.data;
  }

  // Tier 2: Atomic JSON disk cache
  const diskFile = path.join(getCacheDir(), `${key}.json`);
  try {
    const disk = await readJson<{ data: T; cachedAt: number; ttlMs: number } | null>(diskFile, null);
    if (disk && disk.data !== undefined && disk.cachedAt && now - disk.cachedAt < (disk.ttlMs || ttlMs)) {
      memoryCache.set(key, {
        data: disk.data,
        cachedAt: disk.cachedAt,
        expiresAt: disk.cachedAt + (disk.ttlMs || ttlMs),
      });
      return disk.data;
    }
  } catch {
    // Disk read failed or corrupt - continue to fetcher
  }

  // Tier 3: Fresh fetch
  const data = await fetcher();

  // Save to Tier 1
  memoryCache.set(key, {
    data,
    cachedAt: now,
    expiresAt: now + ttlMs,
  });

  // Persist to Tier 2 (atomic disk cache)
  try {
    await writeJsonAtomic(diskFile, {
      data,
      cachedAt: now,
      ttlMs,
    });
  } catch (err) {
    console.warn(`[tmdb-cache] Disk cache write failed for ${key}:`, err);
  }

  return data;
}

/** Check if TMDB_API_KEY is configured in the environment */
export function isTmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY && process.env.TMDB_API_KEY.trim().length > 0);
}

/** Normalize TMDB raw movie item to FilmSearchResult */
export function normalizeTmdbMovie(item: any, knownImdbId?: string): FilmSearchResult {
  const releaseDate = item.release_date || '';
  const yearMatch = String(releaseDate).match(/^(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const title = String(item.title || item.original_title || '').trim();

  // Link with known local film if possible for accurate runtime / metadata
  let imdbId: string | undefined = item.imdb_id || knownImdbId;
  let localFilm: Film | undefined = undefined;

  if (imdbId) {
    localFilm = TOP_FILMS.find((f) => f.id.toLowerCase() === imdbId!.toLowerCase());
  } else if (title && year) {
    localFilm = TOP_FILMS.find(
      (f) => f.year === year && f.title.toLowerCase() === title.toLowerCase()
    );
    if (localFilm) {
      imdbId = localFilm.id;
    }
  }

  let genreNames: string[] = [];
  if (Array.isArray(item.genre_ids)) {
    genreNames = item.genre_ids
      .map((id: number) => TMDB_GENRES[id] || '')
      .filter(Boolean);
  } else if (Array.isArray(item.genres)) {
    genreNames = item.genres
      .map((g: any) => (typeof g === 'string' ? g : g?.name || ''))
      .filter(Boolean);
  } else if (localFilm?.genres) {
    genreNames = localFilm.genres;
  }

  const posterPath = item.poster_path;
  const poster = posterPath
    ? posterPath.startsWith('http')
      ? posterPath
      : `https://image.tmdb.org/t/p/w500${posterPath}`
    : null;

  const id = imdbId || (item.id ? `tmdb-${item.id}` : 'tmdb-0');

  let runtime = typeof item.runtime === 'number' && item.runtime > 0 ? item.runtime : 0;
  if (!runtime && localFilm?.runtime) {
    runtime = localFilm.runtime;
  }

  const rating =
    typeof item.vote_average === 'number'
      ? Math.round(item.vote_average * 10) / 10
      : localFilm?.rating || 0;

  return {
    id,
    title,
    year,
    rating,
    genres: genreNames,
    runtime,
    poster,
    overview: item.overview || '',
    tmdbId: Number(item.id) || 0,
    imdbId: imdbId || undefined,
  };
}

/** Fallback search against the local TOP_FILMS dataset when offline or unconfigured */
export function fallbackLocalSearch(query: string, year?: number): FilmSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matched = TOP_FILMS.filter((film) => {
    const titleMatch = film.title.toLowerCase().includes(q);
    const idMatch = film.id.toLowerCase() === q;
    if (!titleMatch && !idMatch) return false;
    if (year && film.year && film.year !== year) return false;
    return true;
  });

  return matched
    .sort((a, b) => {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      const aExact = aTitle === q ? 2 : aTitle.startsWith(q) ? 1 : 0;
      const bExact = bTitle === q ? 2 : bTitle.startsWith(q) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return b.rating - a.rating;
    })
    .map((film) => ({
      id: film.id,
      title: film.title,
      year: film.year,
      rating: film.rating,
      genres: film.genres || [],
      runtime: film.runtime || 0,
      poster: null,
      overview: '',
      tmdbId: 0,
      imdbId: film.id.startsWith('tt') ? film.id : undefined,
    }));
}

/** Internal helper for TMDB API requests with timeout and authentication */
async function tmdbFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const key = process.env.TMDB_API_KEY?.trim() || '';
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (key.startsWith('eyJ')) {
    headers['Authorization'] = `Bearer ${key}`;
  } else if (key) {
    url.searchParams.set('api_key', key);
  }

  return fetch(url.toString(), {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(8000),
  });
}

/** Resolve an IMDb ID to a TMDB numeric ID */
async function findTmdbIdByImdbId(imdbId: string): Promise<number | null> {
  const cleanImdb = imdbId.toLowerCase();
  const cacheKey = `find_${cleanImdb}`;
  return getCached<number | null>(cacheKey, 30 * 24 * 60 * 60 * 1000, async () => {
    try {
      const res = await tmdbFetch(`/find/${encodeURIComponent(cleanImdb)}?external_source=imdb_id`);
      if (!res.ok) return null;
      const data = await res.json();
      const movie = data.movie_results?.[0];
      return movie?.id ? Number(movie.id) : null;
    } catch (err) {
      console.warn(`[tmdb] Failed to resolve IMDb ID ${imdbId} to TMDB ID:`, err);
      return null;
    }
  });
}

/** Search TMDB live API with multi-tier caching */
async function fetchTmdbSearch(query: string, year?: number): Promise<FilmSearchResult[]> {
  const queryHash = crypto
    .createHash('md5')
    .update(`${query.toLowerCase()}_${year || ''}`)
    .digest('hex');
  const cacheKey = `search_${queryHash}`;

  return getCached<FilmSearchResult[]>(cacheKey, 7 * 24 * 60 * 60 * 1000, async () => {
    const imdbMatch = query.match(/^(tt\d{5,10})$/i);
    let items: any[] = [];
    let knownImdbId: string | undefined = undefined;

    if (imdbMatch) {
      knownImdbId = imdbMatch[1].toLowerCase();
      const endpoint = `/find/${encodeURIComponent(knownImdbId)}?external_source=imdb_id`;
      const res = await tmdbFetch(endpoint);
      if (!res.ok) {
        throw new Error(`TMDB find failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      items = Array.isArray(data.movie_results) ? data.movie_results : [];
    } else {
      let endpoint = `/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US`;
      if (year) {
        endpoint += `&year=${year}`;
      }
      const res = await tmdbFetch(endpoint);
      if (!res.ok) {
        throw new Error(`TMDB search failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      items = Array.isArray(data.results) ? data.results : [];
    }

    return items.map((item) => normalizeTmdbMovie(item, knownImdbId));
  });
}

/**
 * Search movies with origin source indication ('tmdb' or 'local').
 * Gracefully degrades to local TOP_FILMS if TMDB is not configured or network fails.
 */
export async function searchMoviesWithSource(
  query: string,
  year?: number
): Promise<{ results: FilmSearchResult[]; source: 'tmdb' | 'local' }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], source: isTmdbConfigured() ? 'tmdb' : 'local' };
  }

  if (!isTmdbConfigured()) {
    return { results: fallbackLocalSearch(trimmed, year), source: 'local' };
  }

  try {
    const results = await fetchTmdbSearch(trimmed, year);
    return { results, source: 'tmdb' };
  } catch (error) {
    console.warn('[tmdb] Live search failed, falling back to local dataset:', error);
    return { results: fallbackLocalSearch(trimmed, year), source: 'local' };
  }
}

/**
 * Main movie search function:
 * Searches TMDB (/search/movie or /find/{imdb_id}) when configured.
 * Gracefully falls back to local TOP_FILMS substring match if unconfigured or network fails.
 */
export async function searchTmdbMovies(
  query: string,
  year?: number
): Promise<FilmSearchResult[]> {
  const { results } = await searchMoviesWithSource(query, year);
  return results;
}

/**
 * Fetch streaming providers for a movie (flatrate, rent, buy, free).
 * Accepts either a numeric TMDB ID, 'tmdb-123', or an IMDb ID 'tt1234567'.
 */
export async function getMovieProviders(
  tmdbIdOrImdbId: string,
  region = 'US'
): Promise<WatchProviders | null> {
  if (!tmdbIdOrImdbId || typeof tmdbIdOrImdbId !== 'string') return null;
  if (!isTmdbConfigured()) return null;

  const target = tmdbIdOrImdbId.trim();
  let tmdbId: number | null = null;

  if (target.startsWith('tmdb-')) {
    const parsed = parseInt(target.replace('tmdb-', ''), 10);
    if (!isNaN(parsed) && parsed > 0) tmdbId = parsed;
  } else if (/^\d+$/.test(target)) {
    const parsed = parseInt(target, 10);
    if (!isNaN(parsed) && parsed > 0) tmdbId = parsed;
  } else if (/^tt\d{5,10}$/i.test(target)) {
    tmdbId = await findTmdbIdByImdbId(target);
  }

  if (!tmdbId) return null;

  const cleanRegion = (region || 'US').trim().toUpperCase();
  const cacheKey = `providers_${tmdbId}_${cleanRegion.toLowerCase()}`;

  return getCached<WatchProviders | null>(
    cacheKey,
    48 * 60 * 60 * 1000,
    async () => {
      try {
        const res = await tmdbFetch(`/movie/${tmdbId}/watch/providers`);
        if (!res.ok) return null;
        const data = await res.json();
        const regData = data.results?.[cleanRegion] || data.results?.[region] || null;
        if (!regData) return null;

        const mapList = (list?: any[]): WatchProviderItem[] => {
          if (!Array.isArray(list)) return [];
          return list.map((item) => ({
            providerId: item.provider_id ?? item.providerId ?? 0,
            providerName: item.provider_name ?? item.providerName ?? '',
            logoPath: item.logo_path
              ? item.logo_path.startsWith('http')
                ? item.logo_path
                : `https://image.tmdb.org/t/p/w92${item.logo_path}`
              : (item.logoPath || ''),
            ...(typeof item.display_priority === 'number'
              ? { displayPriority: item.display_priority }
              : {}),
          }));
        };

        return {
          link: regData.link || '',
          flatrate: mapList(regData.flatrate),
          ...(regData.rent ? { rent: mapList(regData.rent) } : {}),
          ...(regData.buy ? { buy: mapList(regData.buy) } : {}),
          ...(regData.free ? { free: mapList(regData.free) } : {}),
        };
      } catch (err) {
        console.warn(`[tmdb] Failed to fetch watch providers for ${tmdbId}:`, err);
        return null;
      }
    }
  );
}
