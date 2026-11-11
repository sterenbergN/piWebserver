import { type Film, TOP_FILMS } from '@/lib/movies-data';

export type MovieReview = {
  rating: number; // 0-10 or 1-10
  review?: string;
  watchedDate: string; // YYYY-MM-DD
  favorite?: boolean;
  tags?: string[];
  updatedAt: string;
};

export type UserMovieState = {
  userId: string;
  username?: string;
  watched: string[];
  reviews: Record<string, MovieReview>;
  rankings: string[];
  watchlist: string[];
  customFilms?: Film[];
  updatedAt: string;
};

export type FilterEra =
  | string // e.g. 'classic', '70s', '1980s', '90s', '2000s', 'modern', '1980-1999'
  | [number, number]
  | { start?: number; end?: number; min?: number; max?: number };

export type FilterPool =
  | 'all'
  | 'top250'
  | 'custom'
  | 'watched'
  | 'unwatched'
  | 'watchlist'
  | string[]
  | Film[];

export type FilterOptions = {
  genre?: string | string[];
  genres?: string[];
  era?: FilterEra;
  minYear?: number;
  maxYear?: number;
  runtime?: number | [number, number] | { min?: number; max?: number } | string;
  minRuntime?: number;
  maxRuntime?: number;
  rating?: number | [number, number] | { min?: number; max?: number };
  minRating?: number;
  pool?: FilterPool;
  userState?: UserMovieState;
  watchedIds?: string[] | Set<string>;
  search?: string;
};

export function emptyUserMovieState(userId: string, username?: string): UserMovieState {
  return {
    userId,
    username: username || undefined,
    watched: [],
    reviews: {},
    rankings: [],
    watchlist: [],
    customFilms: [],
    updatedAt: new Date().toISOString(),
  };
}

export function isValidFilm(f: unknown): f is Film {
  if (!f || typeof f !== 'object') return false;
  const item = f as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    item.id.trim().length > 0 &&
    typeof item.title === 'string' &&
    item.title.trim().length > 0 &&
    (item.year === null || (typeof item.year === 'number' && Number.isFinite(item.year))) &&
    typeof item.rating === 'number' &&
    Number.isFinite(item.rating) &&
    Array.isArray(item.genres) &&
    typeof item.runtime === 'number' &&
    Number.isFinite(item.runtime)
  );
}

export function normalizeUserMovieState(raw: unknown, userId: string, username?: string): UserMovieState {
  if (!raw) {
    return emptyUserMovieState(userId, username);
  }

  // Handle legacy array of watched IDs
  if (Array.isArray(raw)) {
    const watched = Array.from(new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
    return {
      userId,
      username: username || undefined,
      watched,
      reviews: {},
      rankings: [],
      watchlist: [],
      customFilms: [],
      updatedAt: new Date().toISOString(),
    };
  }

  if (typeof raw !== 'object') {
    return emptyUserMovieState(userId, username);
  }

  const obj = raw as Record<string, unknown>;

  const stateUserId = typeof obj.userId === 'string' && obj.userId.trim() ? obj.userId.trim() : userId;
  const stateUsername = typeof obj.username === 'string' && obj.username.trim() ? obj.username.trim() : (username || undefined);

  // Watched array
  let watched: string[] = [];
  if (Array.isArray(obj.watched)) {
    watched = Array.from(new Set(obj.watched.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  }

  // Reviews record
  const reviews: Record<string, MovieReview> = {};
  if (obj.reviews && typeof obj.reviews === 'object' && !Array.isArray(obj.reviews)) {
    for (const [filmId, r] of Object.entries(obj.reviews as Record<string, unknown>)) {
      if (!filmId || typeof filmId !== 'string') continue;
      if (!r || typeof r !== 'object') continue;
      const reviewObj = r as Record<string, unknown>;

      const ratingVal = typeof reviewObj.rating === 'number' && Number.isFinite(reviewObj.rating)
        ? Math.max(0, Math.min(10, reviewObj.rating))
        : 0;

      const reviewText = typeof reviewObj.review === 'string' ? reviewObj.review : undefined;
      const watchedDate = typeof reviewObj.watchedDate === 'string' && reviewObj.watchedDate.trim()
        ? reviewObj.watchedDate.trim()
        : new Date().toISOString().slice(0, 10);

      const favorite = typeof reviewObj.favorite === 'boolean' ? reviewObj.favorite : undefined;
      const tags = Array.isArray(reviewObj.tags)
        ? Array.from(new Set(reviewObj.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)))
        : undefined;

      const updatedAt = typeof reviewObj.updatedAt === 'string' && reviewObj.updatedAt.trim()
        ? reviewObj.updatedAt.trim()
        : new Date().toISOString();

      reviews[filmId] = {
        rating: ratingVal,
        ...(reviewText !== undefined ? { review: reviewText } : {}),
        watchedDate,
        ...(favorite !== undefined ? { favorite } : {}),
        ...(tags !== undefined ? { tags } : {}),
        updatedAt,
      };

      // If film has a review, ensure it's in watched list
      if (!watched.includes(filmId)) {
        watched.push(filmId);
      }
    }
  }

  // Rankings
  let rankings: string[] = [];
  if (Array.isArray(obj.rankings)) {
    rankings = Array.from(new Set(obj.rankings.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  }

  // Watchlist
  let watchlist: string[] = [];
  if (Array.isArray(obj.watchlist)) {
    watchlist = Array.from(new Set(obj.watchlist.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  }

  // Custom films
  let customFilms: Film[] = [];
  if (Array.isArray(obj.customFilms)) {
    customFilms = obj.customFilms.filter(isValidFilm);
  }

  const updatedAt = typeof obj.updatedAt === 'string' && obj.updatedAt.trim()
    ? obj.updatedAt.trim()
    : new Date().toISOString();

  return {
    userId: stateUserId,
    username: stateUsername,
    watched,
    reviews,
    rankings,
    watchlist,
    customFilms,
    updatedAt,
  };
}

function parseEraBounds(era: FilterEra): { minYear: number; maxYear: number } {
  if (Array.isArray(era)) {
    return { minYear: era[0] ?? -Infinity, maxYear: era[1] ?? Infinity };
  }
  if (typeof era === 'object' && era !== null) {
    const minYear = era.min ?? era.start ?? -Infinity;
    const maxYear = era.max ?? era.end ?? Infinity;
    return { minYear, maxYear };
  }
  if (typeof era === 'string') {
    const s = era.trim().toLowerCase();
    if (s === 'classic' || s === 'pre-70s' || s === 'pre-1970') {
      return { minYear: -Infinity, maxYear: 1969 };
    }
    if (s === '70s' || s === '1970s') {
      return { minYear: 1970, maxYear: 1979 };
    }
    if (s === '80s' || s === '1980s') {
      return { minYear: 1980, maxYear: 1989 };
    }
    if (s === '90s' || s === '1990s') {
      return { minYear: 1990, maxYear: 1999 };
    }
    if (s === '2000s' || s === '00s') {
      return { minYear: 2000, maxYear: 2009 };
    }
    if (s === '2010s' || s === '10s') {
      return { minYear: 2010, maxYear: 2019 };
    }
    if (s === '2020s' || s === '20s' || s === 'modern') {
      return { minYear: 2020, maxYear: Infinity };
    }
    const rangeMatch = s.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
    if (rangeMatch) {
      return { minYear: parseInt(rangeMatch[1], 10), maxYear: parseInt(rangeMatch[2], 10) };
    }
    const decadeMatch = s.match(/^(\d{4})s?$/);
    if (decadeMatch) {
      const start = parseInt(decadeMatch[1], 10);
      return { minYear: start, maxYear: start + 9 };
    }
  }
  return { minYear: -Infinity, maxYear: Infinity };
}

function parseRuntimeBounds(runtime: NonNullable<FilterOptions['runtime']>): { minRuntime: number; maxRuntime: number } {
  if (typeof runtime === 'number') {
    return { minRuntime: 0, maxRuntime: runtime };
  }
  if (Array.isArray(runtime)) {
    return { minRuntime: runtime[0] ?? 0, maxRuntime: runtime[1] ?? Infinity };
  }
  if (typeof runtime === 'object' && runtime !== null) {
    return { minRuntime: runtime.min ?? 0, maxRuntime: runtime.max ?? Infinity };
  }
  if (typeof runtime === 'string') {
    const s = runtime.trim();
    if (s.startsWith('<') || s.startsWith('under ')) {
      const val = parseInt(s.replace(/[^0-9]/g, ''), 10);
      return { minRuntime: 0, maxRuntime: Number.isFinite(val) ? val : Infinity };
    }
    if (s.startsWith('>') || s.startsWith('over ')) {
      const val = parseInt(s.replace(/[^0-9]/g, ''), 10);
      return { minRuntime: Number.isFinite(val) ? val : 0, maxRuntime: Infinity };
    }
    const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      return { minRuntime: parseInt(rangeMatch[1], 10), maxRuntime: parseInt(rangeMatch[2], 10) };
    }
    if (s.toLowerCase() === 'short') return { minRuntime: 0, maxRuntime: 90 };
    if (s.toLowerCase() === 'medium') return { minRuntime: 91, maxRuntime: 130 };
    if (s.toLowerCase() === 'long') return { minRuntime: 131, maxRuntime: Infinity };
  }
  return { minRuntime: 0, maxRuntime: Infinity };
}

export function filterFilms(films: Film[], options: FilterOptions = {}): Film[] {
  let result = [...films];

  // Genre filter
  const genresToMatch = options.genre
    ? (Array.isArray(options.genre) ? options.genre : [options.genre])
    : (options.genres || []);
  if (genresToMatch.length > 0) {
    const lowerGenres = genresToMatch.map((g) => g.trim().toLowerCase());
    result = result.filter((film) =>
      film.genres && film.genres.some((fg) => lowerGenres.includes(fg.toLowerCase()))
    );
  }

  // Era / Year bounds
  let minYear = options.minYear ?? -Infinity;
  let maxYear = options.maxYear ?? Infinity;
  if (options.era) {
    const bounds = parseEraBounds(options.era);
    minYear = Math.max(minYear, bounds.minYear);
    maxYear = Math.min(maxYear, bounds.maxYear);
  }
  if (minYear !== -Infinity || maxYear !== Infinity) {
    result = result.filter((film) => {
      if (film.year === null) return false;
      return film.year >= minYear && film.year <= maxYear;
    });
  }

  // Runtime filter
  let minRuntime = options.minRuntime ?? 0;
  let maxRuntime = options.maxRuntime ?? Infinity;
  if (options.runtime !== undefined) {
    const bounds = parseRuntimeBounds(options.runtime);
    minRuntime = Math.max(minRuntime, bounds.minRuntime);
    maxRuntime = Math.min(maxRuntime, bounds.maxRuntime);
  }
  if (minRuntime > 0 || maxRuntime !== Infinity) {
    result = result.filter((film) => film.runtime >= minRuntime && film.runtime <= maxRuntime);
  }

  // Rating filter
  let minRating = options.minRating ?? -Infinity;
  let maxRating = Infinity;
  if (typeof options.rating === 'number') {
    minRating = Math.max(minRating, options.rating);
  } else if (Array.isArray(options.rating)) {
    minRating = Math.max(minRating, options.rating[0] ?? -Infinity);
    maxRating = Math.min(maxRating, options.rating[1] ?? Infinity);
  } else if (typeof options.rating === 'object' && options.rating !== null) {
    minRating = Math.max(minRating, options.rating.min ?? -Infinity);
    maxRating = Math.min(maxRating, options.rating.max ?? Infinity);
  }
  if (minRating !== -Infinity || maxRating !== Infinity) {
    result = result.filter((film) => film.rating >= minRating && film.rating <= maxRating);
  }

  // Pool filter
  if (options.pool) {
    const pool = options.pool;
    if (Array.isArray(pool)) {
      if (typeof pool[0] === 'string') {
        const poolSet = new Set(pool as string[]);
        result = result.filter((f) => poolSet.has(f.id));
      } else {
        const poolSet = new Set((pool as Film[]).map((f) => f.id));
        result = result.filter((f) => poolSet.has(f.id));
      }
    } else if (typeof pool === 'string') {
      const watchedSet = new Set<string>(
        options.watchedIds instanceof Set
          ? options.watchedIds
          : options.watchedIds || options.userState?.watched || []
      );
      const watchlistSet = new Set<string>(options.userState?.watchlist || []);
      const customSet = new Set<string>((options.userState?.customFilms || []).map((f) => f.id));
      const topFilmsSet = new Set<string>(TOP_FILMS.map((f) => f.id));

      if (pool === 'watched') {
        result = result.filter((f) => watchedSet.has(f.id));
      } else if (pool === 'unwatched') {
        result = result.filter((f) => !watchedSet.has(f.id));
      } else if (pool === 'watchlist') {
        result = result.filter((f) => watchlistSet.has(f.id));
      } else if (pool === 'custom') {
        result = result.filter((f) => customSet.has(f.id));
      } else if (pool === 'top250') {
        result = result.filter((f) => topFilmsSet.has(f.id));
      }
    }
  }

  // Search filter (title)
  if (options.search && options.search.trim()) {
    const term = options.search.trim().toLowerCase();
    result = result.filter((film) => film.title.toLowerCase().includes(term));
  }

  return result;
}

export function multiUserUnwatched(films: Film[], userStates: UserMovieState[]): Film[] {
  const watchedSet = new Set<string>();
  for (const state of userStates) {
    if (Array.isArray(state?.watched)) {
      for (const id of state.watched) {
        watchedSet.add(id);
      }
    }
  }
  return films.filter((film) => !watchedSet.has(film.id));
}

export function rankFilm(state: UserMovieState, filmId: string, targetRank: number): UserMovieState {
  const current = (state.rankings || []).filter((id) => id !== filmId);
  // targetRank is 1-based: rank 1 means index 0. Values <= 1 go to start.
  const index = Math.max(0, Math.min(current.length, targetRank - 1));
  current.splice(index, 0, filmId);
  return {
    ...state,
    rankings: current,
    updatedAt: new Date().toISOString(),
  };
}

export function mergeUserMovieStates(base: UserMovieState, incoming: Partial<UserMovieState>): UserMovieState {
  const watchedSet = new Set([...(base.watched || []), ...(incoming.watched || [])]);

  const mergedReviews: Record<string, MovieReview> = { ...(base.reviews || {}) };
  if (incoming.reviews) {
    for (const [id, review] of Object.entries(incoming.reviews)) {
      if (!mergedReviews[id]) {
        mergedReviews[id] = review;
      } else {
        const baseTime = Date.parse(mergedReviews[id].updatedAt || '0');
        const incomingTime = Date.parse(review.updatedAt || '0');
        if (Number.isNaN(baseTime) || incomingTime >= baseTime) {
          mergedReviews[id] = review;
        }
      }
      watchedSet.add(id);
    }
  }

  const rankingSet = new Set(base.rankings || []);
  const mergedRankings = [...(base.rankings || [])];
  for (const id of incoming.rankings || []) {
    if (!rankingSet.has(id)) {
      mergedRankings.push(id);
      rankingSet.add(id);
    }
  }

  const mergedWatchlist = Array.from(new Set([...(base.watchlist || []), ...(incoming.watchlist || [])]));

  const customMap = new Map<string, Film>();
  for (const f of base.customFilms || []) customMap.set(f.id, f);
  for (const f of incoming.customFilms || []) customMap.set(f.id, f);

  return {
    ...base,
    watched: Array.from(watchedSet),
    reviews: mergedReviews,
    rankings: mergedRankings,
    watchlist: mergedWatchlist,
    customFilms: Array.from(customMap.values()),
    updatedAt: new Date().toISOString(),
  };
}
