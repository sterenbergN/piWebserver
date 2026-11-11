'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Film } from '@/lib/movies-data';
import { TOP_FILMS } from '@/lib/movies-data';
import type { MovieReview, UserMovieState } from '@/lib/tools/movies-types';
import { rankFilm } from '@/lib/tools/movies-types';

interface Details {
  title: string;
  description: string;
  poster: string | null;
  year: string | null;
  url: string | null;
}

interface WatchProviderItem {
  providerId?: number;
  providerName: string;
  logoPath?: string;
}

interface WatchProviders {
  link?: string;
  flatrate?: WatchProviderItem[];
  rent?: WatchProviderItem[];
  buy?: WatchProviderItem[];
}

interface FilmSearchResult {
  id: string;
  title: string;
  year: number | null;
  rating: number;
  genres: string[];
  runtime: number;
  poster: string | null;
  overview: string;
  tmdbId?: number;
  imdbId?: string;
}

type PickedFilm = Film & { rank?: number };

const POOL_PRESETS = [25, 50, 100, 250, 1000] as const;
const STORAGE_STATE_KEY = 'moviePickerUserState_v2';
const LEGACY_STORAGE_KEY = 'moviePickerWatched';

const STREAMING_PROVIDERS = [
  { id: 'netflix', name: 'Netflix', query: 'netflix' },
  { id: 'max', name: 'Max', query: 'max' },
  { id: 'prime', name: 'Prime Video', query: 'prime' },
  { id: 'hulu', name: 'Hulu', query: 'hulu' },
  { id: 'disney', name: 'Disney+', query: 'disney' },
  { id: 'apple', name: 'Apple TV+', query: 'apple' },
];

const ALL_GENRES = [
  'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime',
  'Drama', 'Fantasy', 'Film-Noir', 'History', 'Horror', 'Mystery',
  'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'
];

const ERAS = [
  { id: 'all', label: 'All Eras' },
  { id: 'classic', label: 'Classic (<1970)' },
  { id: '70s', label: '70s' },
  { id: '80s', label: '80s' },
  { id: '90s', label: '90s' },
  { id: '2000s', label: '2000s' },
  { id: '2010s', label: '2010s' },
  { id: '2020s', label: '2020s' },
];

const RUNTIMES = [
  { id: 'all', label: 'Any Runtime' },
  { id: 'quick', label: 'Quick (<105m)' },
  { id: 'standard', label: 'Standard (105-140m)' },
  { id: 'epic', label: 'Epic (>140m)' },
];

const RATINGS = [
  { id: 0, label: 'Any IMDb (8.0+)' },
  { id: 8.3, label: '★ 8.3+' },
  { id: 8.5, label: '★ 8.5+' },
  { id: 8.8, label: '★ 8.8+' },
];

const QUICK_TAGS = [
  'Masterpiece', 'Great rewatch', 'Mind-blowing', 'Fun',
  'Emotional', 'Overrated', 'Visually stunning', 'Great soundtrack', 'Must-watch'
];

interface VibePreset {
  id: string;
  icon: string;
  title: string;
  desc: string;
  apply: () => {
    genres: string[];
    era: string;
    runtime: string;
    minRating: number;
    pool: '25' | '50' | '100' | '250' | '1000' | 'all' | 'watchlist';
  };
}

const VIBE_PRESETS: VibePreset[] = [
  {
    id: 'popcorn',
    icon: '🍿',
    title: 'Popcorn Night',
    desc: 'High-adrenaline action, sci-fi & adventure blockbusters',
    apply: () => ({ genres: ['Action', 'Adventure', 'Sci-Fi'], era: 'all', runtime: 'all', minRating: 8.0, pool: '100' }),
  },
  {
    id: 'mindbenders',
    icon: '🧠',
    title: 'Mind Benders',
    desc: 'Twisty psychological thrillers, mysteries & deep sci-fi',
    apply: () => ({ genres: ['Sci-Fi', 'Mystery', 'Thriller'], era: 'all', runtime: 'all', minRating: 8.3, pool: '100' }),
  },
  {
    id: 'heartfelt',
    icon: '☕',
    title: 'Cozy & Heartfelt',
    desc: 'Warm, uplifting, beautiful stories & animation',
    apply: () => ({ genres: ['Animation', 'Comedy', 'Drama', 'Romance'], era: 'all', runtime: 'all', minRating: 8.0, pool: '100' }),
  },
  {
    id: 'quick',
    icon: '⏱️',
    title: 'Under 2 Hours',
    desc: 'Tight runtime without sacrificing top-tier storytelling',
    apply: () => ({ genres: [], era: 'all', runtime: 'quick', minRating: 8.0, pool: '250' }),
  },
  {
    id: 'masterpieces',
    icon: '👑',
    title: 'Top Masterpieces',
    desc: 'The absolute greatest films of all time (IMDb 8.8+)',
    apply: () => ({ genres: [], era: 'all', runtime: 'all', minRating: 8.8, pool: '25' }),
  },
  {
    id: 'goldenage',
    icon: '🏛️',
    title: 'Golden Age Classics',
    desc: 'Timeless cinema defining vintage masterpieces (<1970)',
    apply: () => ({ genres: [], era: 'classic', runtime: 'all', minRating: 8.0, pool: '250' }),
  },
];

function formatRuntime(minutes?: number): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function isFilmWatched(film: Film, watched: string[]): boolean {
  const titleLower = film.title.toLowerCase();
  return watched.some(w => w === film.id || w.toLowerCase() === titleLower);
}

function getInitialLocalState(): UserMovieState {
  if (typeof window === 'undefined') {
    return {
      userId: 'guest',
      watched: [],
      reviews: {},
      rankings: [],
      watchlist: [],
      customFilms: [],
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const saved = localStorage.getItem(STORAGE_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        userId: parsed.userId || 'guest',
        username: parsed.username,
        watched: Array.isArray(parsed.watched) ? parsed.watched : [],
        reviews: parsed.reviews && typeof parsed.reviews === 'object' ? parsed.reviews : {},
        rankings: Array.isArray(parsed.rankings) ? parsed.rankings : [],
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        customFilms: Array.isArray(parsed.customFilms) ? parsed.customFilms : [],
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch {
    // fallback
  }

  let legacyWatched: string[] = [];
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) legacyWatched = parsed;
    }
  } catch {
    // ignore
  }

  return {
    userId: 'guest',
    watched: legacyWatched,
    reviews: {},
    rankings: [],
    watchlist: [],
    customFilms: [],
    updatedAt: new Date().toISOString(),
  };
}

export default function MoviePickerTool() {
  // Movie Hub Navigation
  const [activeTab, setActiveTab] = useState<'picker' | 'rankings' | 'watchlist'>('picker');
  const [pickerMode, setPickerMode] = useState<'wheel' | 'duel' | 'vibe' | 'group'>('wheel');

  // Server & User state
  const [movies, setMovies] = useState<Film[]>(TOP_FILMS);
  const [loadError, setLoadError] = useState(false);
  const [userState, setUserState] = useState<UserMovieState>(getInitialLocalState);
  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    userId?: string;
    username?: string;
    users?: { id: string; username: string }[];
  }>({ authenticated: false });
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Filter State
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedEra, setSelectedEra] = useState<string>('all');
  const [selectedRuntime, setSelectedRuntime] = useState<string>('all');
  const [minRating, setMinRating] = useState<number>(0);
  const [poolSource, setPoolSource] = useState<'25' | '50' | '100' | '250' | '1000' | 'all' | 'watchlist'>('100');
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [includeCustom, setIncludeCustom] = useState(true);
  const [watchedFilter, setWatchedFilter] = useState<'unwatched' | 'favorites' | 'all'>('unwatched');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Streaming Providers State & Cache
  const [pickProviders, setPickProviders] = useState<WatchProviders | null>(null);
  const [loadingPickProviders, setLoadingPickProviders] = useState(false);
  const [championProviders, setChampionProviders] = useState<WatchProviders | null>(null);
  const [loadingChampionProviders, setLoadingChampionProviders] = useState(false);
  const [providersCache, setProvidersCache] = useState<Record<string, WatchProviders | null>>({});

  // Wheel Mode State & Finalist Strip
  const [spinning, setSpinning] = useState(false);
  const [wheelDisplay, setWheelDisplay] = useState<number | null>(null);
  const [pick, setPick] = useState<PickedFilm | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [detailsState, setDetailsState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [finalists, setFinalists] = useState<Film[]>([]);
  const [activeFinalistIndex, setActiveFinalistIndex] = useState<number | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Showdown Duel Mode State
  const [duelRound, setDuelRound] = useState(1);
  const [duelContenderA, setDuelContenderA] = useState<Film | null>(null);
  const [duelContenderB, setDuelContenderB] = useState<Film | null>(null);
  const [duelDetailsA, setDuelDetailsA] = useState<Details | null>(null);
  const [duelDetailsB, setDuelDetailsB] = useState<Details | null>(null);
  const [duelChampion, setDuelChampion] = useState<Film | null>(null);
  const [duelHistory, setDuelHistory] = useState<string[]>([]);

  // Watch Together (Group Mode) State
  const [selectedGroupUserIds, setSelectedGroupUserIds] = useState<string[]>([]);
  const [groupPartyStates, setGroupPartyStates] = useState<Record<string, UserMovieState>>({});
  const [groupGuestNames, setGroupGuestNames] = useState<string[]>([]);
  const [newGuestInput, setNewGuestInput] = useState('');

  // Watchlist & Library State & Live TMDB Search
  const [librarySearch, setLibrarySearch] = useState('');
  const [librarySubfilter, setLibrarySubfilter] = useState<'all' | 'watchlist' | 'watched' | 'custom'>('all');
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [tmdbResults, setTmdbResults] = useState<FilmSearchResult[] | null>(null);
  const [tmdbConfigured, setTmdbConfigured] = useState<boolean | null>(null);
  const [tmdbNoticeDismissed, setTmdbNoticeDismissed] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customYear, setCustomYear] = useState('');
  const [customRating, setCustomRating] = useState('8.0');
  const [customRuntime, setCustomRuntime] = useState('110');
  const [customGenre, setCustomGenre] = useState('Drama');

  // Review & Rating Modal State
  const [reviewingFilm, setReviewingFilm] = useState<Film | null>(null);
  const [reviewScore, setReviewScore] = useState<number>(8.5);
  const [reviewFavorite, setReviewFavorite] = useState(false);
  const [reviewDate, setReviewDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewTags, setReviewTags] = useState<string[]>([]);

  // Rankings direct rank prompt modal
  const [rankingPromptFilm, setRankingPromptFilm] = useState<Film | null>(null);
  const [rankingPromptInput, setRankingPromptInput] = useState('1');

  // Persist local state
  const persistState = (newState: UserMovieState) => {
    try {
      localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(newState));
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(newState.watched));
    } catch {
      // ignore quota
    }
  };

  // Sync to server if authenticated
  const syncWithServer = async (stateToSync: UserMovieState, isMerge = false) => {
    if (!authStatus.authenticated) return;
    try {
      const res = await fetch('/api/tools/movies/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isMerge ? { guestState: stateToSync } : { state: stateToSync }),
      }).then(r => r.json());
      if (res.success && res.state) {
        setUserState(res.state);
        persistState(res.state);
      }
    } catch {
      // offline / network error
    }
  };

  // Update state helper
  const updateState = (updater: (prev: UserMovieState) => UserMovieState) => {
    setUserState(prev => {
      const next = updater(prev);
      persistState(next);
      if (authStatus.authenticated) {
        syncWithServer(next);
      }
      return next;
    });
  };

  // Initial load
  useEffect(() => {
    // 1. Fetch TOP_FILMS from API
    fetch('/api/tools/movies')
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.movies)) setMovies(d.movies);
      })
      .catch(() => setLoadError(true));

    // 2. Fetch authenticated user data & users list
    fetch('/api/tools/movies/user')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.authenticated) {
          setAuthStatus({
            authenticated: true,
            userId: d.callerUserId,
            username: d.state?.username || d.callerUserId,
            users: d.users || [],
          });

          // Check if guest had local changes before sign in to merge
          const local = getInitialLocalState();
          const hasLocalChanges = (local.watched.length > 0 && d.state?.watched?.length === 0) ||
            Object.keys(local.reviews).length > 0 ||
            (local.customFilms && local.customFilms.length > 0);

          if (hasLocalChanges) {
            syncWithServer(local, true);
            setSyncNotice('Merged your local movie history with your account.');
          } else if (d.state) {
            setUserState(d.state);
            persistState(d.state);
          }
        }
      })
      .catch(() => {
        // Guest mode fallback
      });

    return () => {
      if (spinTimer.current) clearTimeout(spinTimer.current);
    };
  }, []);

  // Fetch Wikipedia & details
  const loadFilmDetails = async (film: Film): Promise<Details | null> => {
    try {
      const q = new URLSearchParams({
        title: film.title,
        id: film.id,
        ...(film.year ? { year: String(film.year) } : {}),
      });
      const d = await fetch(`/api/tools/movies/details?${q}`).then(r => r.json());
      if (d.success) return d;
    } catch {
      // ignore
    }
    return null;
  };

  // Fetch streaming watch providers
  const loadFilmProviders = async (filmId: string): Promise<WatchProviders | null> => {
    if (providersCache[filmId] !== undefined) return providersCache[filmId];
    try {
      const res = await fetch(`/api/tools/movies/providers?id=${encodeURIComponent(filmId)}&region=US`).then(r => r.json());
      if (res.success && res.providers) {
        setProvidersCache(prev => ({ ...prev, [filmId]: res.providers }));
        return res.providers;
      }
    } catch {
      // ignore
    }
    setProvidersCache(prev => ({ ...prev, [filmId]: null }));
    return null;
  };

  // Combine top films with custom films
  const allFilms = useMemo(() => {
    const list = [...movies];
    if (includeCustom && userState.customFilms && userState.customFilms.length > 0) {
      list.push(...userState.customFilms);
    }
    return list;
  }, [movies, userState.customFilms, includeCustom]);

  // Combined watched set for Group Mode
  const groupWatchedIds = useMemo(() => {
    const set = new Set<string>();
    // Current user's watched
    for (const w of userState.watched) set.add(w.toLowerCase());

    // Selected other users' watched
    for (const uid of selectedGroupUserIds) {
      const otherState = groupPartyStates[uid];
      if (otherState?.watched) {
        for (const w of otherState.watched) set.add(w.toLowerCase());
      }
    }
    return set;
  }, [userState.watched, selectedGroupUserIds, groupPartyStates]);

  // Compute filtered films pool
  const filteredFilms = useMemo(() => {
    let pool: Film[] = [];

    // 1. Source Pool
    if (poolSource === 'watchlist') {
      const wlSet = new Set(userState.watchlist.map(w => w.toLowerCase()));
      pool = allFilms.filter(f => wlSet.has(f.id.toLowerCase()) || wlSet.has(f.title.toLowerCase()));
    } else if (poolSource === 'all') {
      pool = [...movies];
      if (includeCustom && userState.customFilms) {
        pool = [...pool, ...userState.customFilms];
      }
    } else {
      const limit = poolSource === '25' ? 25 : poolSource === '50' ? 50 : poolSource === '100' ? 100 : poolSource === '250' ? 250 : 1000;
      pool = movies.slice(0, limit);
      if (includeCustom && userState.customFilms) {
        pool = [...pool, ...userState.customFilms];
      }
    }

    // 2. Watched filter
    if (pickerMode === 'group') {
      pool = pool.filter(f => !groupWatchedIds.has(f.id.toLowerCase()) && !groupWatchedIds.has(f.title.toLowerCase()));
    } else if (watchedFilter === 'unwatched') {
      pool = pool.filter(f => !isFilmWatched(f, userState.watched));
    } else if (watchedFilter === 'favorites') {
      pool = pool.filter(f => {
        const rev = userState.reviews[f.id] || userState.reviews[f.title];
        return rev?.favorite === true;
      });
    }

    // 3. Genres filter (multi-select)
    if (selectedGenres.length > 0) {
      const targetGenres = selectedGenres.map(g => g.toLowerCase());
      pool = pool.filter(f => f.genres && f.genres.some(fg => targetGenres.includes(fg.toLowerCase())));
    }

    // 4. Era filter
    if (selectedEra !== 'all') {
      pool = pool.filter(f => {
        if (!f.year) return false;
        if (selectedEra === 'classic') return f.year < 1970;
        if (selectedEra === '70s') return f.year >= 1970 && f.year <= 1979;
        if (selectedEra === '80s') return f.year >= 1980 && f.year <= 1989;
        if (selectedEra === '90s') return f.year >= 1990 && f.year <= 1999;
        if (selectedEra === '2000s') return f.year >= 2000 && f.year <= 2009;
        if (selectedEra === '2010s') return f.year >= 2010 && f.year <= 2019;
        if (selectedEra === '2020s') return f.year >= 2020;
        return true;
      });
    }

    // 5. Runtime filter
    if (selectedRuntime !== 'all') {
      pool = pool.filter(f => {
        if (!f.runtime || f.runtime <= 0) return true;
        if (selectedRuntime === 'quick') return f.runtime < 105;
        if (selectedRuntime === 'standard') return f.runtime >= 105 && f.runtime <= 140;
        if (selectedRuntime === 'epic') return f.runtime > 140;
        return true;
      });
    }

    // 6. Minimum IMDb Rating threshold
    if (minRating > 0) {
      pool = pool.filter(f => f.rating >= minRating);
    }

    // 7. Streaming Providers filter (US)
    if (selectedProviders.length > 0) {
      pool = pool.filter(f => {
        const prov = providersCache[f.id];
        if (!prov || !prov.flatrate) return true; // keep candidate if providers not fetched yet
        const names = prov.flatrate.map(p => p.providerName.toLowerCase());
        return selectedProviders.some(sp => {
          const item = STREAMING_PROVIDERS.find(x => x.id === sp);
          const q = item ? item.query : sp.toLowerCase();
          return names.some(n => n.includes(q) || q.includes(n));
        });
      });
    }

    return pool;
  }, [
    movies, allFilms, poolSource, includeCustom, userState.customFilms,
    userState.watchlist, userState.watched, userState.reviews, watchedFilter,
    pickerMode, groupWatchedIds, selectedGenres, selectedEra, selectedRuntime, minRating,
    selectedProviders, providersCache
  ]);

  // Finalists sampler for large pools (>50 films)
  const drawFinalists = (pool: Film[]): Film[] => {
    if (pool.length === 0) return [];
    if (pool.length <= 16) return pool;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 14);
  };

  useEffect(() => {
    if (filteredFilms.length > 50) {
      setFinalists(prev => {
        if (prev.length >= 12 && prev.length <= 16 && prev.every(f => filteredFilms.some(x => x.id === f.id))) {
          return prev;
        }
        return drawFinalists(filteredFilms);
      });
    } else {
      setFinalists([]);
      setActiveFinalistIndex(null);
    }
  }, [filteredFilms]);

  // Mode 1: Spin Roulette / Finalist Reel
  const spin = () => {
    if (spinning || filteredFilms.length === 0) return;

    let candidates = filteredFilms;
    const useFinalists = filteredFilms.length > 50;
    let currentFinalists = finalists;
    if (useFinalists) {
      if (currentFinalists.length < 12) {
        currentFinalists = drawFinalists(filteredFilms);
        setFinalists(currentFinalists);
      }
      candidates = currentFinalists;
    }

    const winnerIdx = Math.floor(Math.random() * candidates.length);
    const finalFilm = candidates[winnerIdx];
    const filmRank = (movies.findIndex(m => m.id === finalFilm.id) + 1) || 1;

    setSpinning(true);
    setPick(null);
    setPickProviders(null);
    setDetails(null);
    setDetailsState('idle');

    let tick = 0;
    const run = () => {
      tick++;
      if (tick < 26) {
        if (useFinalists && currentFinalists.length > 0) {
          setActiveFinalistIndex(tick % currentFinalists.length);
        }
        setWheelDisplay(Math.floor(Math.random() * Math.min(movies.length, 1000)) + 1);
        spinTimer.current = setTimeout(run, tick < 12 ? 45 : tick < 20 ? 90 : 160);
        return;
      }
      if (useFinalists) {
        setActiveFinalistIndex(winnerIdx);
      }
      setWheelDisplay(filmRank);
      setPick({ ...finalFilm, rank: filmRank });
      setSpinning(false);

      // Load plot summary from Wikipedia/details
      setDetailsState('loading');
      loadFilmDetails(finalFilm).then(d => {
        if (d) {
          setDetails(d);
          setDetailsState('idle');
        } else {
          setDetailsState('missing');
        }
      });

      // Load streaming watch providers
      setLoadingPickProviders(true);
      loadFilmProviders(finalFilm.id).then(prov => {
        setPickProviders(prov);
        setLoadingPickProviders(false);
      });
    };

    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      tick = 99;
    }
    run();
  };

  // Mode 2: Showdown Duel Start / Step
  const startShowdown = () => {
    if (filteredFilms.length < 2) return;
    const shuffled = [...filteredFilms].sort(() => Math.random() - 0.5);
    const a = shuffled[0];
    const b = shuffled[1];

    setDuelRound(1);
    setDuelChampion(null);
    setChampionProviders(null);
    setDuelContenderA(a);
    setDuelContenderB(b);
    setDuelHistory([a.id, b.id]);

    // Load contender posters / details
    setDuelDetailsA(null);
    setDuelDetailsB(null);
    loadFilmDetails(a).then(d => setDuelDetailsA(d));
    loadFilmDetails(b).then(d => setDuelDetailsB(d));
  };

  const chooseContender = (winner: Film) => {
    if (duelRound >= 5) {
      setDuelChampion(winner);
      setDuelContenderA(null);
      setDuelContenderB(null);
      setLoadingChampionProviders(true);
      loadFilmProviders(winner.id).then(prov => {
        setChampionProviders(prov);
        setLoadingChampionProviders(false);
      });
      return;
    }

    // Pick next challenger not yet seen in duel history
    const nextCandidate = filteredFilms.find(f => !duelHistory.includes(f.id) && f.id !== winner.id);
    if (!nextCandidate) {
      // No more candidates left
      setDuelChampion(winner);
      setDuelContenderA(null);
      setDuelContenderB(null);
      setLoadingChampionProviders(true);
      loadFilmProviders(winner.id).then(prov => {
        setChampionProviders(prov);
        setLoadingChampionProviders(false);
      });
      return;
    }

    setDuelContenderA(winner);
    setDuelContenderB(nextCandidate);
    setDuelHistory(prev => [...prev, nextCandidate.id]);
    setDuelRound(r => r + 1);

    // Keep winner details, load next challenger details
    if (winner.id !== duelContenderA?.id) {
      setDuelDetailsA(duelDetailsB);
    }
    setDuelDetailsB(null);
    loadFilmDetails(nextCandidate).then(d => setDuelDetailsB(d));
  };

  // Showdown Duel: Swap out unknown title for a fresh contender
  const swapContender = (side: 'A' | 'B') => {
    if (duelChampion) return;
    const currentAId = duelContenderA?.id;
    const currentBId = duelContenderB?.id;

    let nextCandidate = filteredFilms.find(f => !duelHistory.includes(f.id) && f.id !== currentAId && f.id !== currentBId);
    if (!nextCandidate) {
      nextCandidate = filteredFilms.find(f => (side === 'A' ? f.id !== currentBId : f.id !== currentAId));
    }
    if (!nextCandidate) return;

    setDuelHistory(prev => [...prev, nextCandidate!.id]);
    if (side === 'A') {
      setDuelContenderA(nextCandidate);
      setDuelDetailsA(null);
      loadFilmDetails(nextCandidate).then(d => setDuelDetailsA(d));
    } else {
      setDuelContenderB(nextCandidate);
      setDuelDetailsB(null);
      loadFilmDetails(nextCandidate).then(d => setDuelDetailsB(d));
    }
  };

  const skipMatchup = () => {
    swapContender('B');
  };

  // Live TMDB Search for 850k+ movies
  const handleTmdbSearch = async () => {
    const q = librarySearch.trim();
    if (!q) return;
    setTmdbSearching(true);
    try {
      const res = await fetch(`/api/tools/movies/search?q=${encodeURIComponent(q)}`).then(r => r.json());
      if (res.success && Array.isArray(res.results)) {
        setTmdbResults(res.results);
        setTmdbConfigured(res.configured ?? null);
      } else {
        setTmdbResults([]);
        if (res.configured !== undefined) setTmdbConfigured(res.configured);
      }
    } catch (err) {
      console.error('TMDB search error:', err);
      setTmdbResults([]);
    } finally {
      setTmdbSearching(false);
    }
  };

  // Import TMDB Movie into user's customFilms & trigger action
  const handleImportTmdbMovie = (item: FilmSearchResult, action: 'watchlist' | 'watched' | 'review') => {
    const filmId = item.imdbId || item.id || `tmdb_${item.tmdbId}`;
    const importedFilm: Film = {
      id: filmId,
      title: item.title,
      year: item.year || null,
      rating: item.rating || 0,
      genres: item.genres || [],
      runtime: item.runtime || 0,
    };

    updateState(prev => {
      const existingCustom = prev.customFilms || [];
      const inCatalog = movies.some(m => m.id === filmId || m.title.toLowerCase() === importedFilm.title.toLowerCase());
      const inCustom = existingCustom.some(m => m.id === filmId || m.title.toLowerCase() === importedFilm.title.toLowerCase());

      const nextCustom = (!inCatalog && !inCustom) ? [...existingCustom, importedFilm] : existingCustom;
      let nextWl = prev.watchlist;
      let nextWatched = prev.watched;

      if (action === 'watchlist') {
        const isWl = nextWl.some(w => w === filmId || w.toLowerCase() === importedFilm.title.toLowerCase());
        nextWl = isWl ? nextWl.filter(w => w !== filmId && w.toLowerCase() !== importedFilm.title.toLowerCase()) : [filmId, ...nextWl];
      } else if (action === 'watched') {
        const isW = isFilmWatched(importedFilm, nextWatched);
        nextWatched = isW ? nextWatched.filter(w => w !== filmId && w.toLowerCase() !== importedFilm.title.toLowerCase()) : [filmId, ...nextWatched];
      }

      return {
        ...prev,
        customFilms: nextCustom,
        watchlist: nextWl,
        watched: nextWatched,
      };
    });

    if (action === 'review') {
      openReviewModal(importedFilm);
    }
  };

  // Helper to render streaming badges with direct links
  const renderStreamingBadges = (providers: WatchProviders | null, loading: boolean, filmTitle: string) => {
    if (loading) {
      return <div className="tl-provider-loading">Looking up streaming services…</div>;
    }
    if (!providers) return null;

    const hasFlatrate = providers.flatrate && providers.flatrate.length > 0;
    const hasRent = providers.rent && providers.rent.length > 0;

    if (!hasFlatrate && !hasRent) {
      return (
        <div className="tl-provider-bar">
          <span className="tl-muted" style={{ fontSize: '0.78rem' }}>
            Not currently streaming on major US subscription services.
          </span>
          {providers.link && (
            <a href={providers.link} target="_blank" rel="noreferrer" className="tl-justwatch-badge">
              Check JustWatch ↗
            </a>
          )}
        </div>
      );
    }

    return (
      <div className="tl-provider-section">
        {hasFlatrate && (
          <div className="tl-provider-bar">
            <span className="tl-provider-label">Stream:</span>
            <div className="tl-provider-badges">
              {providers.flatrate!.map(p => (
                <a
                  key={p.providerId || p.providerName}
                  href={providers.link || `https://www.google.com/search?q=watch+${encodeURIComponent(filmTitle)}+on+${encodeURIComponent(p.providerName)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="tl-provider-badge"
                  title={`Watch ${filmTitle} on ${p.providerName}`}
                >
                  {p.logoPath && (
                    <img
                      src={p.logoPath.startsWith('http') ? p.logoPath : `https://image.tmdb.org/t/p/w92${p.logoPath}`}
                      alt={p.providerName}
                      className="tl-provider-logo"
                    />
                  )}
                  <span>{p.providerName}</span>
                </a>
              ))}
            </div>
            {providers.link && (
              <a href={providers.link} target="_blank" rel="noreferrer" className="tl-justwatch-badge" title="Direct link on JustWatch / TMDB">
                JustWatch ↗
              </a>
            )}
          </div>
        )}

        {!hasFlatrate && hasRent && (
          <div className="tl-provider-bar">
            <span className="tl-provider-label">Rent / Buy:</span>
            <div className="tl-provider-badges">
              {providers.rent!.slice(0, 5).map(p => (
                <a
                  key={p.providerId || p.providerName}
                  href={providers.link || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="tl-provider-badge is-rent"
                >
                  {p.logoPath && (
                    <img
                      src={p.logoPath.startsWith('http') ? p.logoPath : `https://image.tmdb.org/t/p/w92${p.logoPath}`}
                      alt={p.providerName}
                      className="tl-provider-logo"
                    />
                  )}
                  <span>{p.providerName}</span>
                </a>
              ))}
            </div>
            {providers.link && (
              <a href={providers.link} target="_blank" rel="noreferrer" className="tl-justwatch-badge">
                JustWatch ↗
              </a>
            )}
          </div>
        )}
      </div>
    );
  };

  // Toggle user watched
  const toggleWatched = (film: Film) => {
    const isW = isFilmWatched(film, userState.watched);
    updateState(prev => {
      const titleLower = film.title.toLowerCase();
      const nextWatched = isW
        ? prev.watched.filter(w => w !== film.id && w.toLowerCase() !== titleLower)
        : [film.id, ...prev.watched];
      return { ...prev, watched: nextWatched };
    });
  };

  // Toggle watchlist
  const toggleWatchlist = (film: Film) => {
    const isWl = userState.watchlist.some(w => w === film.id || w.toLowerCase() === film.title.toLowerCase());
    updateState(prev => {
      const titleLower = film.title.toLowerCase();
      const nextWl = isWl
        ? prev.watchlist.filter(w => w !== film.id && w.toLowerCase() !== titleLower)
        : [film.id, ...prev.watchlist];
      return { ...prev, watchlist: nextWl };
    });
  };

  // Toggle Favorite
  const toggleFavorite = (film: Film) => {
    const currentReview = userState.reviews[film.id] || userState.reviews[film.title];
    const isFav = currentReview?.favorite === true;
    updateState(prev => {
      const updatedRev: MovieReview = {
        rating: currentReview?.rating || film.rating,
        review: currentReview?.review,
        watchedDate: currentReview?.watchedDate || new Date().toISOString().slice(0, 10),
        favorite: !isFav,
        tags: currentReview?.tags || [],
        updatedAt: new Date().toISOString(),
      };
      const watched = isFilmWatched(film, prev.watched) ? prev.watched : [film.id, ...prev.watched];
      return {
        ...prev,
        watched,
        reviews: { ...prev.reviews, [film.id]: updatedRev },
      };
    });
  };

  // Open Review Modal
  const openReviewModal = (film: Film) => {
    const existing = userState.reviews[film.id] || userState.reviews[film.title];
    setReviewingFilm(film);
    setReviewScore(existing?.rating ?? Math.round(film.rating));
    setReviewFavorite(existing?.favorite ?? false);
    setReviewDate(existing?.watchedDate ?? new Date().toISOString().slice(0, 10));
    setReviewNotes(existing?.review ?? '');
    setReviewTags(existing?.tags ?? []);
  };

  // Save Review
  const saveReview = () => {
    if (!reviewingFilm) return;
    const film = reviewingFilm;
    updateState(prev => {
      const watched = isFilmWatched(film, prev.watched) ? prev.watched : [film.id, ...prev.watched];
      const newReview: MovieReview = {
        rating: reviewScore,
        review: reviewNotes.trim() || undefined,
        watchedDate: reviewDate,
        favorite: reviewFavorite,
        tags: reviewTags.length > 0 ? reviewTags : undefined,
        updatedAt: new Date().toISOString(),
      };
      // If not in rankings, append to rankings
      let rankings = prev.rankings || [];
      if (!rankings.includes(film.id) && !rankings.includes(film.title)) {
        rankings = [...rankings, film.id];
      }
      return {
        ...prev,
        watched,
        reviews: { ...prev.reviews, [film.id]: newReview },
        rankings,
      };
    });
    setReviewingFilm(null);
  };

  // Delete Review
  const deleteReview = () => {
    if (!reviewingFilm) return;
    const film = reviewingFilm;
    updateState(prev => {
      const reviews = { ...prev.reviews };
      delete reviews[film.id];
      delete reviews[film.title];
      const rankings = (prev.rankings || []).filter(r => r !== film.id && r !== film.title);
      return { ...prev, reviews, rankings };
    });
    setReviewingFilm(null);
  };

  // Move Ranking Up / Down
  const moveRank = (filmId: string, direction: 'up' | 'down') => {
    const list = [...(userState.rankings || [])];
    const idx = list.indexOf(filmId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;

    updateState(prev => ({ ...prev, rankings: list }));
  };

  // Apply Direct Rank #
  const applyDirectRank = () => {
    if (!rankingPromptFilm) return;
    const targetRank = parseInt(rankingPromptInput, 10);
    if (Number.isFinite(targetRank) && targetRank >= 1) {
      updateState(prev => rankFilm(prev, rankingPromptFilm.id, targetRank));
    }
    setRankingPromptFilm(null);
  };

  // Group Mode: Toggle other user selection
  const toggleGroupUser = async (userId: string) => {
    const isSelected = selectedGroupUserIds.includes(userId);
    if (isSelected) {
      setSelectedGroupUserIds(prev => prev.filter(id => id !== userId));
    } else {
      setSelectedGroupUserIds(prev => [...prev, userId]);
      if (!groupPartyStates[userId]) {
        try {
          const res = await fetch(`/api/tools/movies/user?userId=${userId}`).then(r => r.json());
          if (res.success && res.state) {
            setGroupPartyStates(prev => ({ ...prev, [userId]: res.state }));
          }
        } catch {
          // ignore
        }
      }
    }
  };

  // Add Custom Film
  const handleAddCustomFilm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim()) return;
    const newFilm: Film = {
      id: `custom_${Date.now()}`,
      title: customTitle.trim(),
      year: customYear ? parseInt(customYear, 10) : null,
      rating: parseFloat(customRating) || 8.0,
      runtime: parseInt(customRuntime, 10) || 110,
      genres: customGenre ? [customGenre] : ['Drama'],
    };

    updateState(prev => ({
      ...prev,
      customFilms: [...(prev.customFilms || []), newFilm],
    }));

    setCustomTitle('');
    setCustomYear('');
    setShowAddCustom(false);
  };

  // Personal Rankings list resolved with films
  const rankedFilmsList = useMemo(() => {
    const items: { film: Film; rank: number; review?: MovieReview }[] = [];
    const rankings = userState.rankings || [];
    rankings.forEach((entry, idx) => {
      const match = allFilms.find(f => f.id === entry || f.title.toLowerCase() === entry.toLowerCase());
      if (match) {
        const review = userState.reviews[match.id] || userState.reviews[match.title];
        items.push({ film: match, rank: idx + 1, review });
      }
    });
    return items;
  }, [userState.rankings, userState.reviews, allFilms]);

  // Statistics calculations
  const stats = useMemo(() => {
    const topTarget = movies.length >= 1000 ? 1000 : 250;
    const watchedTopCount = movies.slice(0, topTarget).filter(f => isFilmWatched(f, userState.watched)).length;
    const watchedPercent = ((watchedTopCount / Math.max(1, topTarget)) * 100).toFixed(1);

    const reviewedEntries = Object.entries(userState.reviews);
    let avgUserScore = '—';
    let avgImdbScore = '—';

    if (reviewedEntries.length > 0) {
      const userTotal = reviewedEntries.reduce((sum, [, r]) => sum + r.rating, 0);
      avgUserScore = (userTotal / reviewedEntries.length).toFixed(1);

      let imdbTotal = 0;
      let matchedCount = 0;
      for (const [id] of reviewedEntries) {
        const f = allFilms.find(film => film.id === id || film.title.toLowerCase() === id.toLowerCase());
        if (f) {
          imdbTotal += f.rating;
          matchedCount++;
        }
      }
      if (matchedCount > 0) {
        avgImdbScore = (imdbTotal / matchedCount).toFixed(1);
      }
    }

    // Favorite genres tally
    const genreTally: Record<string, number> = {};
    const eraTally: Record<string, number> = {};

    allFilms.forEach(film => {
      if (isFilmWatched(film, userState.watched)) {
        if (film.genres) {
          film.genres.forEach(g => {
            genreTally[g] = (genreTally[g] || 0) + 1;
          });
        }
        if (film.year) {
          const era = film.year < 1970 ? '<1970' :
            film.year < 1980 ? '70s' :
            film.year < 1990 ? '80s' :
            film.year < 2000 ? '90s' :
            film.year < 2010 ? '00s' :
            film.year < 2020 ? '10s' : '20s';
          eraTally[era] = (eraTally[era] || 0) + 1;
        }
      }
    });

    const topGenres = Object.entries(genreTally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g, c]) => `${g} (${c})`)
      .join(', ') || 'None yet';

    return {
      topTarget,
      watchedTopCount,
      watchedPercent,
      avgUserScore,
      avgImdbScore,
      topGenres,
      eraTally,
    };
  }, [movies, allFilms, userState.watched, userState.reviews]);

  // Watchlist & Library filtered view
  const libraryFilms = useMemo(() => {
    let list = allFilms;
    if (librarySubfilter === 'watchlist') {
      const wlSet = new Set(userState.watchlist.map(w => w.toLowerCase()));
      list = list.filter(f => wlSet.has(f.id.toLowerCase()) || wlSet.has(f.title.toLowerCase()));
    } else if (librarySubfilter === 'watched') {
      list = list.filter(f => isFilmWatched(f, userState.watched));
    } else if (librarySubfilter === 'custom') {
      list = userState.customFilms || [];
    }

    if (librarySearch.trim()) {
      const q = librarySearch.trim().toLowerCase();
      list = list.filter(f =>
        f.title.toLowerCase().includes(q) ||
        (f.year && String(f.year).includes(q)) ||
        (f.genres && f.genres.some(g => g.toLowerCase().includes(q)))
      );
    }
    return list;
  }, [allFilms, librarySubfilter, librarySearch, userState.watchlist, userState.watched, userState.customFilms]);

  if (loadError) {
    return (
      <section className="tl-card">
        <p className="tl-muted" style={{ margin: 0 }}>Couldn’t load the film list. Refresh to try again.</p>
      </section>
    );
  }

  return (
    <>
      {/* ── Hub Sub-navigation ── */}
      <nav className="tl-movie-nav" role="tablist" aria-label="Movie hub navigation">
        <button
          role="tab"
          aria-selected={activeTab === 'picker'}
          onClick={() => setActiveTab('picker')}
        >
          <span>🎲</span>
          <span>Picker</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'rankings'}
          onClick={() => setActiveTab('rankings')}
        >
          <span>🏆</span>
          <span>Rankings & Reviews</span>
          {rankedFilmsList.length > 0 && <span className="tl-tag" style={{ minHeight: 20, padding: '0 0.4rem', fontSize: '0.72rem' }}>{rankedFilmsList.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'watchlist'}
          onClick={() => setActiveTab('watchlist')}
        >
          <span>📋</span>
          <span>Watchlist & Library</span>
          {userState.watchlist.length > 0 && <span className="tl-tag" style={{ minHeight: 20, padding: '0 0.4rem', fontSize: '0.72rem' }}>{userState.watchlist.length}</span>}
        </button>
      </nav>

      {/* ── User Account & Sync Status Bar ── */}
      <div className="tl-movie-sync-bar">
        <div>
          {authStatus.authenticated ? (
            <span>👤 Signed in as <strong>{authStatus.username}</strong> · Synced to account ✓</span>
          ) : (
            <span>💾 Saved on this device (Guest mode)</span>
          )}
        </div>
        {syncNotice && <span style={{ color: 'var(--accent-light)' }}>{syncNotice}</span>}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: PICKER
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'picker' && (
        <>
          {/* Picker Mode Switcher */}
          <div className="tl-movie-modes" role="group" aria-label="Picker mode">
            <button
              className="tl-movie-mode-btn"
              aria-pressed={pickerMode === 'wheel'}
              onClick={() => setPickerMode('wheel')}
            >
              <span>🎰</span>
              <span>Reel Wheel</span>
            </button>
            <button
              className="tl-movie-mode-btn"
              aria-pressed={pickerMode === 'duel'}
              onClick={() => {
                setPickerMode('duel');
                if (!duelContenderA && !duelChampion) startShowdown();
              }}
            >
              <span>⚔️</span>
              <span>Showdown</span>
            </button>
            <button
              className="tl-movie-mode-btn"
              aria-pressed={pickerMode === 'vibe'}
              onClick={() => setPickerMode('vibe')}
            >
              <span>✨</span>
              <span>Vibe Presets</span>
            </button>
            <button
              className="tl-movie-mode-btn"
              aria-pressed={pickerMode === 'group'}
              onClick={() => setPickerMode('group')}
            >
              <span>👥</span>
              <span>Watch Together</span>
            </button>
          </div>

          {/* ── Comprehensive Filter Box ── */}
          <section className="tl-filters-card">
            <div
              className="tl-filter-toggle"
              onClick={() => setFiltersOpen(!filtersOpen)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setFiltersOpen(!filtersOpen); }}
              aria-expanded={filtersOpen}
            >
              <h3>
                <span>🎯 Filters</span>
                <span className="tl-muted" style={{ fontSize: '0.82rem', fontWeight: 400 }}>
                  ({filteredFilms.length} {filteredFilms.length === 1 ? 'match' : 'matches'})
                </span>
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {(selectedGenres.length > 0 || selectedEra !== 'all' || selectedRuntime !== 'all' || minRating > 0 || poolSource !== '100' || selectedProviders.length > 0) && (
                  <button
                    className="tl-link-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedGenres([]);
                      setSelectedEra('all');
                      setSelectedRuntime('all');
                      setMinRating(0);
                      setPoolSource('100');
                      setSelectedProviders([]);
                    }}
                  >
                    Reset
                  </button>
                )}
                <span style={{ fontSize: '0.85rem' }}>{filtersOpen ? '▲' : '▼'}</span>
              </div>
            </div>

            {filtersOpen && (
              <div className="tl-filter-body animate-fade-in">
                {/* Pool Source */}
                <div>
                  <div className="tl-filter-sublabel">Pool Source</div>
                  <div className="tl-seg" role="group">
                    {POOL_PRESETS.map(n => (
                      <button
                        key={n}
                        aria-pressed={poolSource === String(n)}
                        onClick={() => setPoolSource(String(n) as any)}
                      >
                        {n === 1000 ? 'Top 1,000' : `Top ${n}`}
                      </button>
                    ))}
                    <button
                      aria-pressed={poolSource === 'all'}
                      onClick={() => setPoolSource('all')}
                    >
                      All
                    </button>
                    <button
                      aria-pressed={poolSource === 'watchlist'}
                      onClick={() => setPoolSource('watchlist')}
                    >
                      Watchlist ({userState.watchlist.length})
                    </button>
                  </div>
                </div>

                {/* Watched Status */}
                <div>
                  <div className="tl-filter-sublabel">Watched Status</div>
                  <div className="tl-seg" role="group">
                    <button
                      aria-pressed={watchedFilter === 'unwatched'}
                      onClick={() => setWatchedFilter('unwatched')}
                    >
                      Unwatched Only
                    </button>
                    <button
                      aria-pressed={watchedFilter === 'favorites'}
                      onClick={() => setWatchedFilter('favorites')}
                    >
                      Favorites ❤️
                    </button>
                    <button
                      aria-pressed={watchedFilter === 'all'}
                      onClick={() => setWatchedFilter('all')}
                    >
                      All Films
                    </button>
                  </div>
                </div>

                {/* Streaming Services (US) */}
                <div>
                  <div className="tl-filter-sublabel">
                    <span>Streaming Services (US) {selectedProviders.length > 0 ? `(${selectedProviders.length})` : ''}</span>
                    {selectedProviders.length > 0 && (
                      <button className="tl-link-btn" onClick={() => setSelectedProviders([])}>Clear</button>
                    )}
                  </div>
                  <div className="tl-filter-chips">
                    {STREAMING_PROVIDERS.map(p => {
                      const sel = selectedProviders.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          className="tl-filter-chip"
                          aria-pressed={sel}
                          onClick={() => {
                            setSelectedProviders(prev =>
                              sel ? prev.filter(x => x !== p.id) : [...prev, p.id]
                            );
                          }}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Genre Chips Multi-Select */}
                <div>
                  <div className="tl-filter-sublabel">
                    <span>Genres ({selectedGenres.length > 0 ? selectedGenres.length : 'Any'})</span>
                    {selectedGenres.length > 0 && (
                      <button className="tl-link-btn" onClick={() => setSelectedGenres([])}>Clear</button>
                    )}
                  </div>
                  <div className="tl-filter-chips">
                    {ALL_GENRES.map(g => {
                      const sel = selectedGenres.includes(g);
                      return (
                        <button
                          key={g}
                          className="tl-filter-chip"
                          aria-pressed={sel}
                          onClick={() => {
                            setSelectedGenres(prev =>
                              sel ? prev.filter(x => x !== g) : [...prev, g]
                            );
                          }}
                        >
                          {g}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Era / Decade Filter */}
                <div>
                  <div className="tl-filter-sublabel">Era / Decade</div>
                  <div className="tl-filter-chips">
                    {ERAS.map(era => (
                      <button
                        key={era.id}
                        className="tl-filter-chip"
                        aria-pressed={selectedEra === era.id}
                        onClick={() => setSelectedEra(era.id)}
                      >
                        {era.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Runtime Filter */}
                <div>
                  <div className="tl-filter-sublabel">Runtime</div>
                  <div className="tl-filter-chips">
                    {RUNTIMES.map(rt => (
                      <button
                        key={rt.id}
                        className="tl-filter-chip"
                        aria-pressed={selectedRuntime === rt.id}
                        onClick={() => setSelectedRuntime(rt.id)}
                      >
                        {rt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Minimum IMDb Rating */}
                <div>
                  <div className="tl-filter-sublabel">Minimum Rating</div>
                  <div className="tl-filter-chips">
                    {RATINGS.map(r => (
                      <button
                        key={r.id}
                        className="tl-filter-chip"
                        aria-pressed={minRating === r.id}
                        onClick={() => setMinRating(r.id)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Include Custom Films */}
                {userState.customFilms && userState.customFilms.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={includeCustom}
                      onChange={e => setIncludeCustom(e.target.checked)}
                    />
                    <span>Include {userState.customFilms.length} custom user films</span>
                  </label>
                )}
              </div>
            )}
          </section>

          {/* ── Mode 1: Spin Reel / Roulette ── */}
          {pickerMode === 'wheel' && (
            <section className="tl-card" style={{ textAlign: 'center' }}>
              <h2>🎬 Spin the Reel</h2>
              <p className="tl-sub">
                Picking from <strong>{filteredFilms.length}</strong> matching candidate {filteredFilms.length === 1 ? 'film' : 'films'}.
              </p>

              {/* Finalist Strip for Large Pools (>50) */}
              {filteredFilms.length > 50 && finalists.length > 0 && (
                <div className="tl-finalist-reel-wrap">
                  <div className="tl-finalist-reel-head">
                    <h4>🎞️ Finalist Reel ({finalists.length} contenders sampled from {filteredFilms.length})</h4>
                    <button
                      type="button"
                      className="tl-link-btn"
                      onClick={() => setFinalists(drawFinalists(filteredFilms))}
                      disabled={spinning}
                    >
                      🔄 Reshuffle Strip
                    </button>
                  </div>
                  <div className="tl-finalist-track">
                    {finalists.map((f, idx) => {
                      const isActive = activeFinalistIndex === idx;
                      return (
                        <div
                          key={f.id}
                          className={`tl-finalist-card${isActive ? ' is-active' : ''}`}
                          onClick={() => {
                            if (spinning) return;
                            setActiveFinalistIndex(idx);
                            setPick({ ...f, rank: (movies.findIndex(m => m.id === f.id) + 1) || 1 });
                            setDetailsState('loading');
                            loadFilmDetails(f).then(d => {
                              if (d) {
                                setDetails(d);
                                setDetailsState('idle');
                              } else {
                                setDetailsState('missing');
                              }
                            });
                            setLoadingPickProviders(true);
                            loadFilmProviders(f.id).then(prov => {
                              setPickProviders(prov);
                              setLoadingPickProviders(false);
                            });
                          }}
                        >
                          <div className="tl-finalist-thumb">
                            {isActive ? '🎬' : '🎞️'}
                          </div>
                          <div className="tl-finalist-title">{f.title}</div>
                          <div className="tl-finalist-meta">
                            {f.year || ''} · ★ {f.rating.toFixed(1)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={`tl-wheel${spinning ? ' is-spinning' : ''}`} aria-live="off">
                {wheelDisplay !== null ? `#${wheelDisplay}` : '?'}
              </div>

              <button
                className="btn btn-primary tl-btn"
                style={{ minWidth: 220 }}
                onClick={spin}
                disabled={spinning || filteredFilms.length === 0}
              >
                {spinning ? 'Spinning…' : filteredFilms.length === 0 ? 'No matching films' : pick ? '🎲 Spin Again' : '🎲 Spin Wheel'}
              </button>

              {filteredFilms.length === 0 && (
                <p className="tl-muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  Try widening your filters to see more candidate films!
                </p>
              )}
            </section>
          )}

          {/* ── Pick Winner Display (Wheel Mode) ── */}
          {pickerMode === 'wheel' && pick && (
            <section className="tl-card animate-fade-in" aria-live="polite">
              <div className="tl-film">
                {details?.poster ? (
                  <img src={details.poster} alt={pick.title} />
                ) : (
                  <div className="tl-poster-empty" aria-hidden>🎞️</div>
                )}
                <div>
                  <div className="tl-label" style={{ margin: 0 }}>
                    #{pick.rank || 1} on IMDb · {pick.year || 'Unknown'} · ★ {pick.rating.toFixed(1)} {pick.runtime ? `· ${formatRuntime(pick.runtime)}` : ''}
                  </div>
                  <h3>{details?.title || pick.title}</h3>

                  {pick.genres && pick.genres.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', margin: '0.35rem 0 0.6rem' }}>
                      {pick.genres.map(g => (
                        <span key={g} className="tl-duel-genre-tag">{g}</span>
                      ))}
                    </div>
                  )}

                  {detailsState === 'loading' && <p className="tl-muted">Looking up summary from Wikipedia…</p>}
                  {detailsState === 'missing' && <p className="tl-muted">No plot summary found.</p>}
                  {details && <p>{details.description}</p>}

                  {/* Streaming watch options */}
                  {renderStreamingBadges(pickProviders, loadingPickProviders, pick.title)}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => toggleWatched(pick)}
                    >
                      {isFilmWatched(pick, userState.watched) ? '✓ Watched' : '✓ Mark Watched'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => openReviewModal(pick)}
                    >
                      ⭐ Review & Rate
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => toggleFavorite(pick)}
                    >
                      {userState.reviews[pick.id]?.favorite ? '❤️ Favorited' : '🤍 Favorite'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => toggleWatchlist(pick)}
                    >
                      {userState.watchlist.includes(pick.id) ? '📌 In Watchlist' : '+ Watchlist'}
                    </button>
                    <a
                      className="btn btn-secondary"
                      href={`https://www.imdb.com/title/${pick.id}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      IMDb ↗
                    </a>
                    {details?.url && (
                      <a
                        className="btn btn-secondary"
                        href={details.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Wikipedia ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Mode 2: Showdown Duel ('This or That') ── */}
          {pickerMode === 'duel' && (
            <section className="tl-card">
              <div className="tl-duel-status">
                <div>
                  <h2 style={{ margin: 0 }}>⚔️ Movie Showdown</h2>
                  <p className="tl-sub" style={{ margin: 0 }}>
                    {duelChampion ? 'We have a winner!' : `Round ${duelRound} of 5 — Pick which film you’d rather watch:`}
                  </p>
                </div>
                {!duelChampion && (
                  <button className="btn btn-secondary" onClick={startShowdown}>
                    Reset Duel
                  </button>
                )}
              </div>

              {filteredFilms.length < 2 && (
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  <p className="tl-muted">At least 2 matching films are required for a Showdown.</p>
                  <button className="btn btn-primary" onClick={() => setSelectedGenres([])}>
                    Widen Filters
                  </button>
                </div>
              )}

              {/* Contenders Arena */}
              {!duelChampion && duelContenderA && duelContenderB && (
                <div className="tl-duel-arena animate-fade-in">
                  {/* Contender A */}
                  <div className="tl-duel-card">
                    <div>
                      <div className="tl-duel-head">
                        {duelDetailsA?.poster ? (
                          <img src={duelDetailsA.poster} alt={duelContenderA.title} className="tl-duel-poster" />
                        ) : (
                          <div className="tl-duel-empty-poster" aria-hidden>🎞️</div>
                        )}
                        <div className="tl-duel-info">
                          <h4>{duelContenderA.title}</h4>
                          <div className="tl-duel-meta">
                            {duelContenderA.year || 'Unknown'} · ★ {duelContenderA.rating.toFixed(1)} {duelContenderA.runtime ? `· ${formatRuntime(duelContenderA.runtime)}` : ''}
                          </div>
                          {duelContenderA.genres && duelContenderA.genres.length > 0 && (
                            <div className="tl-duel-genres">
                              {duelContenderA.genres.map(g => (
                                <span key={g} className="tl-duel-genre-tag">{g}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {duelDetailsA?.description && (
                        <p className="tl-duel-overview">{duelDetailsA.description}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1 }}
                        onClick={() => chooseContender(duelContenderA)}
                      >
                        👉 Pick {duelContenderA.title}
                      </button>
                      <button
                        type="button"
                        className="tl-swap-btn"
                        onClick={() => swapContender('A')}
                        title="Swap this movie for another contender"
                      >
                        🔄 Swap
                      </button>
                    </div>
                  </div>

                  {/* VS Badge */}
                  <div className="tl-duel-vs">
                    <span>VS</span>
                    <button
                      type="button"
                      className="btn btn-secondary tl-duel-skip-btn"
                      onClick={skipMatchup}
                      title="Skip this round or pick a new challenger"
                    >
                      ⏭️ Skip Matchup
                    </button>
                  </div>

                  {/* Contender B */}
                  <div className="tl-duel-card">
                    <div>
                      <div className="tl-duel-head">
                        {duelDetailsB?.poster ? (
                          <img src={duelDetailsB.poster} alt={duelContenderB.title} className="tl-duel-poster" />
                        ) : (
                          <div className="tl-duel-empty-poster" aria-hidden>🎞️</div>
                        )}
                        <div className="tl-duel-info">
                          <h4>{duelContenderB.title}</h4>
                          <div className="tl-duel-meta">
                            {duelContenderB.year || 'Unknown'} · ★ {duelContenderB.rating.toFixed(1)} {duelContenderB.runtime ? `· ${formatRuntime(duelContenderB.runtime)}` : ''}
                          </div>
                          {duelContenderB.genres && duelContenderB.genres.length > 0 && (
                            <div className="tl-duel-genres">
                              {duelContenderB.genres.map(g => (
                                <span key={g} className="tl-duel-genre-tag">{g}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {duelDetailsB?.description && (
                        <p className="tl-duel-overview">{duelDetailsB.description}</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1 }}
                        onClick={() => chooseContender(duelContenderB)}
                      >
                        👉 Pick {duelContenderB.title}
                      </button>
                      <button
                        type="button"
                        className="tl-swap-btn"
                        onClick={() => swapContender('B')}
                        title="Swap this movie for another contender"
                      >
                        🔄 Swap
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Duel Champion Screen */}
              {duelChampion && (
                <div className="tl-duel-winner-box animate-fade-in">
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👑</div>
                  <h2>Tonight’s Showdown Champion!</h2>
                  <h3 style={{ fontSize: '1.6rem', color: 'var(--accent-light)', margin: '0.4rem 0' }}>
                    {duelChampion.title} {duelChampion.year ? `(${duelChampion.year})` : ''}
                  </h3>
                  <p className="tl-muted" style={{ margin: '0 0 1.25rem' }}>
                    ★ {duelChampion.rating.toFixed(1)} IMDb {duelChampion.runtime ? `· ${formatRuntime(duelChampion.runtime)}` : ''} {duelChampion.genres ? `· ${duelChampion.genres.join(', ')}` : ''}
                  </p>
                  {renderStreamingBadges(championProviders, loadingChampionProviders, duelChampion.title)}
                  <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => toggleWatched(duelChampion)}
                    >
                      {isFilmWatched(duelChampion, userState.watched) ? '✓ Watched' : '✓ Mark Watched'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => openReviewModal(duelChampion)}
                    >
                      ⭐ Review & Rate
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => toggleWatchlist(duelChampion)}
                    >
                      {userState.watchlist.includes(duelChampion.id) ? '📌 In Watchlist' : '+ Watchlist'}
                    </button>
                    <button className="btn btn-secondary" onClick={startShowdown}>
                      ⚔️ Play Another Showdown
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Mode 3: Quick Vibe Presets ── */}
          {pickerMode === 'vibe' && (
            <section className="tl-card">
              <h2>✨ 1-Click Vibe Presets</h2>
              <p className="tl-sub">Pick a mood to instantly configure the perfect movie pool:</p>

              <div className="tl-vibe-grid">
                {VIBE_PRESETS.map(vibe => (
                  <button
                    key={vibe.id}
                    className="tl-vibe-card"
                    onClick={() => {
                      const cfg = vibe.apply();
                      setSelectedGenres(cfg.genres);
                      setSelectedEra(cfg.era);
                      setSelectedRuntime(cfg.runtime);
                      setMinRating(cfg.minRating);
                      setPoolSource(cfg.pool);
                      setWatchedFilter('unwatched');
                      setPickerMode('wheel');
                    }}
                  >
                    <span className="tl-vibe-icon">{vibe.icon}</span>
                    <span className="tl-vibe-title">{vibe.title}</span>
                    <span className="tl-vibe-desc">{vibe.desc}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ── Mode 4: Watch Together (Group Mode) ── */}
          {pickerMode === 'group' && (
            <section className="tl-card">
              <h2>👥 Watch Together (Group Mode)</h2>
              <p className="tl-sub">
                Select everyone who’s watching tonight. We’ll automatically exclude any film that <em>any</em> person has already seen!
              </p>

              <div className="tl-group-box">
                <span className="tl-filter-sublabel">Party Members</span>
                <div className="tl-user-pills">
                  {/* Current User */}
                  <span className="tl-user-pill" aria-checked="true">
                    ✓ You ({userState.watched.length} watched)
                  </span>

                  {/* Registered Users */}
                  {authStatus.users && authStatus.users.filter(u => u.id !== authStatus.userId).map(u => {
                    const checked = selectedGroupUserIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        className="tl-user-pill"
                        aria-pressed={checked}
                        onClick={() => toggleGroupUser(u.id)}
                      >
                        {checked ? '✓ ' : '+ '} {u.username}
                      </button>
                    );
                  })}

                  {/* Guest Party Members */}
                  {groupGuestNames.map(guest => (
                    <span key={guest} className="tl-user-pill" aria-checked="true">
                      👤 {guest}
                      <button
                        onClick={() => setGroupGuestNames(prev => prev.filter(g => g !== guest))}
                        aria-label={`Remove ${guest}`}
                        style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', marginLeft: 4 }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add Guest Name */}
                <div className="tl-row" style={{ marginTop: '0.75rem' }}>
                  <input
                    value={newGuestInput}
                    onChange={e => setNewGuestInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newGuestInput.trim()) {
                        setGroupGuestNames(prev => [...prev, newGuestInput.trim()]);
                        setNewGuestInput('');
                      }
                    }}
                    placeholder="Add guest friend (e.g. Sarah, Dad)"
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      if (newGuestInput.trim()) {
                        setGroupGuestNames(prev => [...prev, newGuestInput.trim()]);
                        setNewGuestInput('');
                      }
                    }}
                    disabled={!newGuestInput.trim()}
                  >
                    Add Member
                  </button>
                </div>
              </div>

              {/* Group Results & Action */}
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                  {filteredFilms.length} Films Unwatched by Everyone
                </div>
                <p className="tl-muted" style={{ margin: '0 0 1rem' }}>
                  {groupWatchedIds.size} total watched films excluded across the group.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary tl-btn"
                    onClick={() => {
                      setPickerMode('wheel');
                      spin();
                    }}
                    disabled={filteredFilms.length === 0}
                  >
                    🎲 Spin For Group
                  </button>
                  <button
                    className="btn btn-secondary tl-btn"
                    onClick={() => {
                      setPickerMode('duel');
                      startShowdown();
                    }}
                    disabled={filteredFilms.length < 2}
                  >
                    ⚔️ Group Showdown
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: RANKINGS & REVIEWS
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'rankings' && (
        <>
          {/* Stats Summary Dashboard */}
          <section className="tl-card">
            <h2>📊 Your Movie Stats</h2>
            <p className="tl-sub">Track your progress through IMDb’s Top {stats.topTarget || 250} and your taste profile:</p>

            <div className="tl-stats-grid">
              {/* Stat 1: Top Watched Progress */}
              <div className="tl-stat-card">
                <div>
                  <div className="tl-stat-label">Top {stats.topTarget || 250} Progress</div>
                  <div className="tl-stat-val">
                    {stats.watchedTopCount} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--muted)' }}>/ {stats.topTarget || 250}</span>
                  </div>
                  <div className="tl-stat-bar">
                    <div
                      className="tl-stat-bar-fill"
                      style={{ width: `${Math.min(100, (stats.watchedTopCount / (stats.topTarget || 250)) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="tl-stat-sub">{stats.watchedPercent}% completed</div>
              </div>

              {/* Stat 2: Rating Comparison */}
              <div className="tl-stat-card">
                <div>
                  <div className="tl-stat-label">Avg User Score</div>
                  <div className="tl-stat-val" style={{ color: '#f59e0b' }}>
                    ★ {stats.avgUserScore}
                  </div>
                </div>
                <div className="tl-stat-sub">IMDb avg: ★ {stats.avgImdbScore}</div>
              </div>

              {/* Stat 3: Favorite Genres */}
              <div className="tl-stat-card">
                <div>
                  <div className="tl-stat-label">Top Genres</div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, marginTop: '0.2rem' }}>
                    {stats.topGenres}
                  </div>
                </div>
                <div className="tl-stat-sub">Across all watched films</div>
              </div>

              {/* Stat 4: Era Distribution */}
              <div className="tl-stat-card">
                <div>
                  <div className="tl-stat-label">Eras Watched</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.2rem' }}>
                    {Object.entries(stats.eraTally).map(([era, count]) => (
                      <span key={era} className="tl-rank-tag-chip">
                        {era}: {count}
                      </span>
                    ))}
                    {Object.keys(stats.eraTally).length === 0 && (
                      <span className="tl-muted" style={{ fontSize: '0.8rem' }}>None yet</span>
                    )}
                  </div>
                </div>
                <div className="tl-stat-sub">Decade distribution</div>
              </div>
            </div>
          </section>

          {/* Personal Leaderboard */}
          <section className="tl-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h2 style={{ margin: 0 }}>🏆 Personal Rankings ({rankedFilmsList.length})</h2>
                <p className="tl-sub" style={{ margin: '0.2rem 0 0' }}>
                  Your hand-ordered favorite films of all time:
                </p>
              </div>
            </div>

            {rankedFilmsList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <p className="tl-muted" style={{ margin: '0 0 1rem' }}>
                  No ranked films yet! Rate and review films from the Picker or Watchlist to build your personal Top Leaderboard.
                </p>
                <button className="btn btn-primary" onClick={() => setActiveTab('picker')}>
                  🎲 Start Picking & Rating
                </button>
              </div>
            ) : (
              <div className="tl-rank-list">
                {rankedFilmsList.map((item, idx) => {
                  const f = item.film;
                  const rev = item.review;
                  const topClass = idx === 0 ? 'is-top-1' : idx === 1 ? 'is-top-2' : idx === 2 ? 'is-top-3' : '';

                  return (
                    <div key={f.id} className="tl-rank-row">
                      <div className={`tl-rank-num ${topClass}`}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${item.rank}`}
                      </div>

                      <div className="tl-rank-body">
                        <div className="tl-rank-head">
                          <span className="tl-rank-title">{f.title}</span>
                          <span className="tl-rank-meta">{f.year || ''}</span>
                          {rev?.rating && (
                            <span className="tl-rank-user-score">★ {rev.rating.toFixed(1)}</span>
                          )}
                          {rev?.favorite && <span>❤️</span>}
                          <span className="tl-rank-meta">IMDb: ★ {f.rating.toFixed(1)}</span>
                        </div>

                        {rev?.review && (
                          <div className="tl-rank-snippet">“{rev.review}”</div>
                        )}

                        {rev?.tags && rev.tags.length > 0 && (
                          <div className="tl-rank-tags">
                            {rev.tags.map(t => (
                              <span key={t} className="tl-rank-tag-chip">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Ranking Action Controls */}
                      <div className="tl-rank-actions">
                        <button
                          className="tl-rank-btn"
                          disabled={idx === 0}
                          onClick={() => moveRank(f.id, 'up')}
                          aria-label={`Move ${f.title} up`}
                          title="Move Up"
                        >
                          ▲
                        </button>
                        <button
                          className="tl-rank-btn"
                          disabled={idx === rankedFilmsList.length - 1}
                          onClick={() => moveRank(f.id, 'down')}
                          aria-label={`Move ${f.title} down`}
                          title="Move Down"
                        >
                          ▼
                        </button>
                        <button
                          className="tl-rank-btn"
                          onClick={() => {
                            setRankingPromptFilm(f);
                            setRankingPromptInput(String(item.rank));
                          }}
                          aria-label={`Set rank for ${f.title}`}
                          title="Direct Rank #"
                        >
                          #
                        </button>
                        <button
                          className="tl-rank-btn"
                          onClick={() => openReviewModal(f)}
                          aria-label={`Edit review for ${f.title}`}
                          title="Edit Review"
                        >
                          ✎
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: WATCHLIST & WATCHED (LIBRARY)
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'watchlist' && (
        <section className="tl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <h2>📋 Movie Library</h2>
            <button
              className="btn btn-secondary"
              onClick={() => setShowAddCustom(!showAddCustom)}
            >
              {showAddCustom ? '✕ Cancel' : '+ Add Custom Film'}
            </button>
          </div>

          {/* Add Custom Film Form */}
          {showAddCustom && (
            <form onSubmit={handleAddCustomFilm} className="tl-group-box animate-fade-in" style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}>Add a Custom Film</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <input
                  required
                  placeholder="Film Title *"
                  value={customTitle}
                  onChange={e => setCustomTitle(e.target.value)}
                />
                <input
                  placeholder="Release Year (e.g. 2024)"
                  type="number"
                  value={customYear}
                  onChange={e => setCustomYear(e.target.value)}
                />
                <input
                  placeholder="IMDb / Score (e.g. 8.2)"
                  type="number"
                  step="0.1"
                  value={customRating}
                  onChange={e => setCustomRating(e.target.value)}
                />
                <input
                  placeholder="Runtime in min (e.g. 120)"
                  type="number"
                  value={customRuntime}
                  onChange={e => setCustomRuntime(e.target.value)}
                />
                <input
                  placeholder="Genre (e.g. Sci-Fi, Drama)"
                  value={customGenre}
                  onChange={e => setCustomGenre(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Save Custom Film
              </button>
            </form>
          )}

          {/* Library Subfilters */}
          <div className="tl-seg" role="group" aria-label="Library view" style={{ marginBottom: '0.75rem' }}>
            <button
              aria-pressed={librarySubfilter === 'all'}
              onClick={() => setLibrarySubfilter('all')}
            >
              All {movies.length} Films
            </button>
            <button
              aria-pressed={librarySubfilter === 'watchlist'}
              onClick={() => setLibrarySubfilter('watchlist')}
            >
              Watchlist ({userState.watchlist.length})
            </button>
            <button
              aria-pressed={librarySubfilter === 'watched'}
              onClick={() => setLibrarySubfilter('watched')}
            >
              Watched ({userState.watched.length})
            </button>
            {userState.customFilms && userState.customFilms.length > 0 && (
              <button
                aria-pressed={librarySubfilter === 'custom'}
                onClick={() => setLibrarySubfilter('custom')}
              >
                Custom ({userState.customFilms.length})
              </button>
            )}
          </div>

          {/* Unified Search & Live TMDB Search Bar */}
          <div className="tl-search-bar-wrap">
            <div className="tl-search-input-group">
              <span className="tl-search-icon">🔍</span>
              <input
                type="search"
                value={librarySearch}
                onChange={e => {
                  setLibrarySearch(e.target.value);
                  if (!e.target.value.trim()) {
                    setTmdbResults(null);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleTmdbSearch();
                  }
                }}
                placeholder="Search local library or press Enter to search 850k+ movies…"
                aria-label="Search movie library"
                className="tl-search-input"
              />
              {librarySearch.trim() && (
                <button
                  type="button"
                  className="tl-search-clear-btn"
                  onClick={() => {
                    setLibrarySearch('');
                    setTmdbResults(null);
                  }}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn-secondary tl-tmdb-search-btn"
              onClick={handleTmdbSearch}
              disabled={tmdbSearching || !librarySearch.trim()}
            >
              {tmdbSearching ? 'Searching…' : '🌐 Search 850k+ (TMDB)'}
            </button>
          </div>

          {/* Unobtrusive tip if TMDB is not configured */}
          {tmdbConfigured === false && !tmdbNoticeDismissed && (
            <div className="tl-tmdb-notice animate-fade-in">
              <span>💡 <strong>Tip:</strong> Set <code>TMDB_API_KEY</code> in <code>.env.local</code> to unlock live search across 850,000+ films & streaming services.</span>
              <button
                type="button"
                className="tl-link-btn"
                onClick={() => setTmdbNoticeDismissed(true)}
                aria-label="Dismiss tip"
              >
                ✕
              </button>
            </div>
          )}

          {/* TMDB Global Search Results */}
          {tmdbResults !== null && (
            <div className="tl-tmdb-results-box animate-fade-in">
              <div className="tl-tmdb-results-head">
                <h3>
                  🌐 TMDB Results for “{librarySearch}” ({tmdbResults.length})
                </h3>
                <button
                  type="button"
                  className="tl-link-btn"
                  onClick={() => setTmdbResults(null)}
                >
                  Close Results ✕
                </button>
              </div>

              {tmdbResults.length === 0 ? (
                <p className="tl-muted" style={{ margin: '0.5rem 0', fontSize: '0.85rem' }}>
                  No external films found matching “{librarySearch}”.
                </p>
              ) : (
                <div className="tl-tmdb-cards">
                  {tmdbResults.map(item => {
                    const filmId = item.imdbId || item.id || `tmdb_${item.tmdbId}`;
                    const inWl = userState.watchlist.some(w => w === filmId || w.toLowerCase() === item.title.toLowerCase());
                    const watched = isFilmWatched({ id: filmId, title: item.title, year: item.year, rating: item.rating, genres: item.genres, runtime: item.runtime }, userState.watched);
                    const review = userState.reviews[filmId] || userState.reviews[item.title];

                    return (
                      <div key={item.id} className="tl-tmdb-card">
                        {item.poster ? (
                          <img src={item.poster} alt={item.title} className="tl-tmdb-poster" />
                        ) : (
                          <div className="tl-tmdb-poster-empty" aria-hidden>🎞️</div>
                        )}
                        <div className="tl-tmdb-info">
                          <div className="tl-tmdb-title-row">
                            <span className="tl-tmdb-title">{item.title}</span>
                            <span className="tl-tmdb-meta">
                              {item.year || 'Unknown'} · ★ {item.rating.toFixed(1)} {item.runtime ? `· ${formatRuntime(item.runtime)}` : ''}
                            </span>
                            {review?.rating && (
                              <span className="tl-rank-user-score">Your rating: ★ {review.rating.toFixed(1)}</span>
                            )}
                          </div>

                          {item.genres && item.genres.length > 0 && (
                            <div className="tl-tmdb-genres">
                              {item.genres.map(g => (
                                <span key={g} className="tl-duel-genre-tag">{g}</span>
                              ))}
                            </div>
                          )}

                          {item.overview && (
                            <p className="tl-tmdb-overview">{item.overview}</p>
                          )}

                          <div className="tl-tmdb-actions">
                            <button
                              type="button"
                              className="tl-movie-toggle-btn"
                              aria-pressed={inWl}
                              onClick={() => handleImportTmdbMovie(item, 'watchlist')}
                            >
                              {inWl ? '✓ In Watchlist' : '+ Watchlist'}
                            </button>
                            <button
                              type="button"
                              className="tl-movie-toggle-btn"
                              aria-pressed={watched}
                              onClick={() => handleImportTmdbMovie(item, 'watched')}
                            >
                              {watched ? '✓ Watched' : 'Seen it'}
                            </button>
                            <button
                              type="button"
                              className="tl-rank-btn"
                              onClick={() => handleImportTmdbMovie(item, 'review')}
                              title="Review & Rate"
                            >
                              ⭐ Review
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Film List */}
          <div className="tl-movie-list">
            {libraryFilms.slice(0, 100).map(film => {
              const watched = isFilmWatched(film, userState.watched);
              const inWatchlist = userState.watchlist.some(w => w === film.id || w.toLowerCase() === film.title.toLowerCase());
              const review = userState.reviews[film.id] || userState.reviews[film.title];

              return (
                <div key={film.id} className="tl-movie-item">
                  <div className="tl-movie-item-main">
                    <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <strong>{film.title}</strong>
                      <span className="tl-muted" style={{ fontSize: '0.82rem' }}>
                        {film.year || ''} · ★ {film.rating.toFixed(1)} {film.runtime ? `· ${formatRuntime(film.runtime)}` : ''}
                      </span>
                      {review?.rating && (
                        <span className="tl-rank-user-score">Your rating: ★ {review.rating.toFixed(1)}</span>
                      )}
                      {review?.favorite && <span>❤️</span>}
                    </div>

                    {film.genres && film.genres.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}>
                        {film.genres.map(g => (
                          <span key={g} className="tl-duel-genre-tag">{g}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="tl-movie-item-actions">
                    <button
                      className="tl-movie-toggle-btn"
                      aria-pressed={inWatchlist}
                      onClick={() => toggleWatchlist(film)}
                      title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    >
                      {inWatchlist ? '✓ Watchlist' : '+ Watchlist'}
                    </button>
                    <button
                      className="tl-movie-toggle-btn"
                      aria-pressed={watched}
                      onClick={() => toggleWatched(film)}
                      title={watched ? 'Mark as unwatched' : 'Mark as watched'}
                    >
                      {watched ? '✓ Watched' : 'Seen it'}
                    </button>
                    <button
                      className="tl-rank-btn"
                      onClick={() => openReviewModal(film)}
                      title="Rate & Review"
                    >
                      ⭐
                    </button>
                  </div>
                </div>
              );
            })}

            {libraryFilms.length === 0 && (
              <p className="tl-muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                No films match your search or filter.
              </p>
            )}

            {libraryFilms.length > 100 && (
              <p className="tl-muted" style={{ textAlign: 'center', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                Showing first 100 matches of {libraryFilms.length}. Refine search to see more.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────
          REVIEW & RATING MODAL
      ───────────────────────────────────────────────────────────── */}
      {reviewingFilm && (
        <div className="tl-modal-backdrop" onClick={() => setReviewingFilm(null)}>
          <div className="tl-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="tl-modal-head">
              <div>
                <h3>{reviewingFilm.title}</h3>
                <div className="tl-muted" style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  {reviewingFilm.year || 'Unknown'} · IMDb: ★ {reviewingFilm.rating.toFixed(1)} {reviewingFilm.runtime ? `· ${formatRuntime(reviewingFilm.runtime)}` : ''}
                </div>
              </div>
              <button
                className="tl-modal-close"
                onClick={() => setReviewingFilm(null)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {/* Score Slider */}
            <div>
              <label className="tl-filter-sublabel" htmlFor="tl-score-slider">
                <span>Your Rating (1.0 - 10.0)</span>
                <span className="tl-rating-val">★ {reviewScore.toFixed(1)}</span>
              </label>
              <div className="tl-rating-slider-row">
                <input
                  id="tl-score-slider"
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={reviewScore}
                  onChange={e => setReviewScore(parseFloat(e.target.value))}
                  className="tl-rating-slider"
                />
              </div>
            </div>

            {/* Favorite Heart Toggle */}
            <div style={{ margin: '1rem 0' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  borderColor: reviewFavorite ? 'var(--accent)' : undefined,
                  background: reviewFavorite ? 'rgba(var(--accent-rgb), 0.2)' : undefined,
                }}
                onClick={() => setReviewFavorite(!reviewFavorite)}
              >
                <span>{reviewFavorite ? '❤️' : '🤍'}</span>
                <span>{reviewFavorite ? 'Favorited Movie' : 'Add to Favorites'}</span>
              </button>
            </div>

            {/* Watched Date Picker */}
            <div style={{ marginBottom: '1rem' }}>
              <label className="tl-filter-sublabel" htmlFor="tl-watched-date">
                Date Watched
              </label>
              <input
                id="tl-watched-date"
                type="date"
                value={reviewDate}
                onChange={e => setReviewDate(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            {/* Quick Tags Chips */}
            <div style={{ marginBottom: '1rem' }}>
              <div className="tl-filter-sublabel">Tags & Impressions</div>
              <div className="tl-filter-chips">
                {QUICK_TAGS.map(tag => {
                  const sel = reviewTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className="tl-filter-chip"
                      aria-pressed={sel}
                      onClick={() => {
                        setReviewTags(prev =>
                          sel ? prev.filter(t => t !== tag) : [...prev, tag]
                        );
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Review Notes */}
            <div style={{ marginBottom: '1rem' }}>
              <label className="tl-filter-sublabel" htmlFor="tl-review-notes">
                Review Notes & Thoughts
              </label>
              <textarea
                id="tl-review-notes"
                rows={3}
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                placeholder="What did you love or dislike about this film?"
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>

            {/* Modal Actions */}
            <div className="tl-modal-actions">
              <div>
                {(userState.reviews[reviewingFilm.id] || userState.reviews[reviewingFilm.title]) && (
                  <button
                    type="button"
                    className="tl-link-btn"
                    style={{ color: 'var(--danger)' }}
                    onClick={deleteReview}
                  >
                    Delete Review
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReviewingFilm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveReview}
                >
                  Save Review
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          DIRECT RANK NUMBER PROMPT MODAL
      ───────────────────────────────────────────────────────────── */}
      {rankingPromptFilm && (
        <div className="tl-modal-backdrop" onClick={() => setRankingPromptFilm(null)}>
          <div className="tl-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="tl-modal-head">
              <h3>Move to Rank</h3>
              <button className="tl-modal-close" onClick={() => setRankingPromptFilm(null)}>✕</button>
            </div>
            <p className="tl-muted" style={{ fontSize: '0.85rem' }}>
              Enter rank position for <strong>{rankingPromptFilm.title}</strong> (1 to {rankedFilmsList.length}):
            </p>
            <input
              type="number"
              min="1"
              max={rankedFilmsList.length}
              value={rankingPromptInput}
              onChange={e => setRankingPromptInput(e.target.value)}
              style={{ width: '100%', marginBottom: '1rem', fontSize: '1.2rem', textAlign: 'center' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setRankingPromptFilm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyDirectRank}>Set Rank</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
